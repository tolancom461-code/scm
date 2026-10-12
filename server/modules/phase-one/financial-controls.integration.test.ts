import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  setupPhaseOne,
  cleanupPhaseOne,
  type PhaseFixture,
} from "../../../scripts/phase-one-fixture";
import {
  simpleCertificateInput,
  simplePaymentInput,
  certificateScheduleInput,
} from "../../../shared/phase-one";
import { closeDb } from "../../db";
import { loadAccess, authorizeRequest } from "../../core/policy";
import * as service from "./service";
describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "financial corrections, certificate schedules and warranty",
  () => {
    let f: PhaseFixture, certId: number, paymentId: number, requestId: number;
    const read = async () => service.state((await loadAccess(f.actors[2]))!);
    const plan = [
      { name: "First", percent: "30", dueDate: "2026-01-20" },
      { name: "Second", percent: "40", dueDate: "2026-02-20" },
      { name: "Third", percent: "30", dueDate: "2026-03-20" },
    ];
    const pay = async (
      amount: string,
      date: string,
      replacesPaymentId: number | null = null
    ) => {
      const preview = await service.paymentPreview(f.contractId, date);
      const cert = preview.certificates.find(c => c.id === certId)!;
      return service.recordPayment(
        simplePaymentInput.parse({
          contractId: f.contractId,
          certificateId: certId,
          milestoneId: null,
          installmentId: cert.nextInstallment?.id ?? null,
          kind: "normal",
          amount,
          paymentDate: date,
          voucher: f.code + "-REPLACE",
          replacesPaymentId,
        }),
        f.actors[2],
        randomUUID()
      );
    };
    beforeAll(async () => {
      f = await setupPhaseOne(12);
    }, 90000);
    afterAll(async () => {
      try {
        if (f) await cleanupPhaseOne(f);
      } finally {
        await closeDb();
      }
    }, 90000);
    it("allocates rounded net amounts exactly and refuses early or excess installments", async () => {
      certId = (
        await service.createCertificate(
          simpleCertificateInput.parse({
            contractId: f.contractId,
            certificateDate: f.date,
            mode: "percent",
            progress: "100",
            installments: plan,
          }),
          f.actors[0],
          randomUUID()
        )
      ).id;
      await service.decideCertificate(
        certId,
        f.actors[1],
        "approve",
        "Reviewed plan"
      );
      const state = await read(),
        installments = state.installments.filter(
          i => i.certificateId === certId
        );
      expect(installments.map(i => i.amount)).toEqual([
        "812.16",
        "1082.88",
        "812.16",
      ]);
      await expect(pay("1", "2026-01-10")).rejects.toMatchObject({
        domainCode: "PAYMENT_EXCEEDED",
      });
      await expect(pay("813", "2026-01-20")).rejects.toMatchObject({
        domainCode: "PAYMENT_EXCEEDED",
      });
      paymentId = (await pay("812.16", "2026-01-20")).id;
      expect(
        (await service.paymentPreview(f.contractId, "2026-01-20"))
          .certificates[0].nextInstallment?.ready
      ).toBe(false);
    }, 60000);
    it("keeps the original immutable and requires independent reversal before replacement", async () => {
      const key = randomUUID();
      const first = await service.requestReversal(
        paymentId,
        "Incorrect training voucher date",
        f.actors[2],
        key
      );
      expect(
        await service.requestReversal(
          paymentId,
          "Incorrect training voucher date",
          f.actors[2],
          key
        )
      ).toEqual(first);
      requestId = first.id;
      expect((await read()).balances[0].paid).toBe("812.16");
      await expect(
        service.decideReversal(first.id, "approve", "Self", f.actors[2])
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      await expect(
        service.requestReversal(
          paymentId,
          "Duplicate",
          f.actors[2],
          randomUUID()
        )
      ).rejects.toMatchObject({ domainCode: "CONFLICT" });
      await service.decideReversal(
        first.id,
        "approve",
        "Checked original record",
        f.actors[1]
      );
      const state = await read();
      expect(state.balances[0].paid).toBe("0.00");
      expect(state.payments.find(p => p.id === paymentId)).toMatchObject({
        status: "reversed",
        paymentDate: "2026-01-20",
        amount: "812.16",
        voucherKey: null,
      });
      await expect(pay("812.16", "2026-01-20")).rejects.toMatchObject({
        domainCode: "INVALID_REFERENCE",
      });
      const replacement = await pay("812.16", "2026-01-21", paymentId);
      expect(
        (await read()).payments.find(p => p.id === replacement.id)
          ?.replacesPaymentId
      ).toBe(paymentId);
      await expect(pay("1", "2026-02-20", paymentId)).rejects.toMatchObject({
        domainCode: "INVALID_REFERENCE",
      });
    }, 60000);
    it("versions schedule changes and validates all actual voucher allocations", async () => {
      const active = (await read()).payments.filter(p => p.status === "active");
      const input = certificateScheduleInput.parse({
        id: certId,
        version: 1,
        installments: plan,
        assignments: active.map(p => ({ paymentId: p.id, position: 1 })),
        reason: "Confirmed certificate plan",
      });
      await expect(
        service.configureSchedule({ ...input, assignments: [] }, f.actors[1])
      ).rejects.toMatchObject({ domainCode: "INVALID_INPUT" });
      await expect(
        service.configureSchedule(
          {
            ...input,
            installments: plan.map((p, n) =>
              n === 0 ? { ...p, dueDate: "2026-01-22" } : p
            ),
          },
          f.actors[1]
        )
      ).rejects.toMatchObject({ domainCode: "PAYMENT_EXCEEDED" });
      await service.configureSchedule(input, f.actors[1]);
      expect(
        (await read()).installments.filter(i => i.certificateId === certId)
      ).toHaveLength(6);
      await expect(
        service.configureSchedule(input, f.actors[1])
      ).rejects.toMatchObject({ domainCode: "CONFLICT" });
      await expect(
        authorizeRequest(f.actors[2], "phaseOne.configureSchedule", input)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        authorizeRequest(f.actors[2], "phaseOne.decideReversal", {
          id: requestId,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        authorizeRequest(f.actors[1], "phaseOne.schedulePreview", {
          id: 2147483646,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (await service.state((await loadAccess(f.actors[0]))!)).reversals
      ).toEqual([]);
    }, 60000);
    it("starts warranty at independently approved final handover and blocks premature releases", async () => {
      await expect(
        service.releaseRetention(
          certId,
          f.actors[1],
          "Missing handover",
          f.date
        )
      ).rejects.toMatchObject({ domainCode: "RETENTION_NOT_DUE" });
      await expect(
        service.acceptHandover(
          {
            id: f.contractId,
            revision: 0,
            handoverDate: f.date,
            reason: "Self handover",
          },
          f.actors[0]
        )
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      await service.acceptHandover(
        {
          id: f.contractId,
          revision: 0,
          handoverDate: f.date,
          reason: "Completed work accepted",
        },
        f.actors[1]
      );
      await expect(
        service.releaseRetention(certId, f.actors[1], "Premature", "2026-10-01")
      ).rejects.toMatchObject({ domainCode: "RETENTION_NOT_DUE" });
      await expect(
        service.releaseRetention(
          certId,
          f.actors[1],
          "Future dated",
          "2027-01-01"
        )
      ).rejects.toMatchObject({ domainCode: "INVALID_INPUT" });
      expect((await read()).balances[0].retained).toBe("676.80");
    }, 60000);
  }
);
