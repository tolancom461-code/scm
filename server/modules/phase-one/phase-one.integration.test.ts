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
  simpleContractInput,
} from "../../../shared/phase-one";
import { closeDb } from "../../db";
import { documentPeriod } from "../../../shared/numbering";
import * as service from "./service";
import { loadAccess } from "../../core/policy";
describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "phase one contracts, certificates and accounting vouchers",
  () => {
    let f: PhaseFixture, certificateId: number;
    const state = async () => service.state((await loadAccess(f.actors[2]))!);
    const balance = async () =>
      (await state()).balances.find(b => b.contractId === f.contractId)!;
    beforeAll(async () => {
      f = await setupPhaseOne();
    }, 90000);
    afterAll(async () => {
      try {
        if (f) await cleanupPhaseOne(f);
      } finally {
        await closeDb();
      }
    }, 90000);
    const payment = async (
      amount: string,
      voucher: string,
      key = randomUUID(),
      certificate = certificateId
    ) => {
      const b = await balance();
      return service.recordPayment(
        simplePaymentInput.parse({
          contractId: f.contractId,
          certificateId: certificate,
          milestoneId: b.upcoming?.id,
          kind: "normal",
          amount,
          paymentDate: f.date,
          voucher,
        }),
        f.actors[2],
        key
      );
    };
    it("numbers projects and contracts automatically and replays a project save without duplication", async () => {
      const initial = await state();
      const project = initial.projects.find(p => p.id === f.projectId)!;
      const contract = initial.contracts.find(c => c.id === f.contractId)!;
      const { year, month } = documentPeriod();
      const period = `${String(year).slice(-2)}-${month}`;
      expect(project.number).toMatch(new RegExp(`^PRJ-${period}-[0-9]{4,}$`));
      expect(contract.number).toMatch(new RegExp(`^CTR-${period}-[0-9]{4,}$`));
      expect(
        await service.createProject(
          { name: f.code + " مشروع", site: "QA" },
          f.actors[0],
          f.projectKey
        )
      ).toEqual({ id: f.projectId });
      expect(
        (await state()).projects.filter(p => p.name === project.name)
      ).toHaveLength(1);
    });
    it("creates one pending certificate and requires independent approval", async () => {
      certificateId = (
        await service.createCertificate(
          simpleCertificateInput.parse({
            contractId: f.contractId,
            certificateDate: f.date,
            mode: "percent",
            progress: "90",
            delayDays: 2,
            otherDeduction: "414",
            deductionReason: "إهدار مواد",
          }),
          f.actors[0],
          randomUUID()
        )
      ).id;
      expect((await balance()).certificates[0].number).toMatch(
        /^IPC-\d{2}-\d{2}-\d{4,}$/
      );
      expect((await balance()).certificates[0].net).toBe("1622.48");
      expect((await balance()).outstanding).toBe("0.00");
      await expect(
        payment("100", f.code + "-unapproved")
      ).rejects.toMatchObject({ domainCode: "INVALID_REFERENCE" });
      await expect(
        service.decideCertificate(
          certificateId,
          f.actors[0],
          "approve",
          "self approval"
        )
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      const attempts = await Promise.allSettled([
        service.decideCertificate(
          certificateId,
          f.actors[1],
          "approve",
          "Reviewed"
        ),
        service.decideCertificate(
          certificateId,
          f.actors[1],
          "approve",
          "Duplicate"
        ),
      ]);
      expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((await balance()).upcoming?.readyAmount).toBe("846.00");
    }, 60000);
    it("refuses cancellation after a certificate has been issued", async () => {
      await expect(
        service.correctContract(
          {
            id: f.contractId,
            revision: 0,
            action: "cancel",
            reason: "invalid cancellation",
          },
          f.actors[0]
        )
      ).rejects.toMatchObject({ domainCode: "INVALID_TRANSITION" });
    });
    it("records a partial voucher once and excludes retention from the payable", async () => {
      const key = randomUUID(),
        voucher = f.code + "-PV1";
      const first = await payment("600", voucher, key);
      expect(await payment("600", voucher, key)).toEqual(first);
      const b = await balance();
      expect(b.paid).toBe("600.00");
      expect(b.outstanding).toBe("1022.48");
      expect(b.retained).toBe("609.12");
      expect(b.upcoming?.readyAmount).toBe("246.00");
      await expect(
        payment("50", "  " + voucher.toLowerCase() + "  ")
      ).rejects.toMatchObject({ domainCode: "CONFLICT" });
      await expect(payment("300", f.code + "-OVER")).rejects.toMatchObject({
        domainCode: "PAYMENT_EXCEEDED",
      });
    }, 60000);
    it("serializes competing payments and moves to the next installment", async () => {
      const before = await balance();
      const data = {
        contractId: f.contractId,
        certificateId,
        milestoneId: before.upcoming!.id,
        kind: "normal" as const,
        amount: "246",
        paymentDate: f.date,
      };
      const attempts = await Promise.allSettled([
        service.recordPayment(
          simplePaymentInput.parse({ ...data, voucher: f.code + "-A" }),
          f.actors[2],
          randomUUID()
        ),
        service.recordPayment(
          simplePaymentInput.parse({ ...data, voucher: f.code + "-B" }),
          f.actors[2],
          randomUUID()
        ),
      ]);
      expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((await balance()).paid).toBe("846.00");
      expect((await balance()).upcoming?.position).toBe(2);
      expect((await balance()).upcoming?.readyAmount).toBe("776.48");
      await payment("776.48", f.code + "-PV2");
      expect((await balance()).outstanding).toBe("0.00");
      expect((await balance()).upcoming?.ready).toBe(false);
    }, 60000);
    it("reconciles subsequent progress without duplicating earlier deductions", async () => {
      const second = await service.createCertificate(
        simpleCertificateInput.parse({
          contractId: f.contractId,
          certificateDate: f.date,
          mode: "quantity",
          quantities: ["141"],
          delayDays: 2,
        }),
        f.actors[0],
        randomUUID()
      );
      await service.decideCertificate(
        second.id,
        f.actors[1],
        "approve",
        "Final execution accepted"
      );
      const b = await balance();
      expect(b.certificates.at(-1)?.gross).toBe("338.40");
      expect(b.certificates.at(-1)?.penalty).toBe("0.00");
      expect(b.outstanding).toBe("270.72");
      expect(b.upcoming?.readyAmount).toBe("69.52");
      await payment("69.52", f.code + "-PV3", randomUUID(), second.id);
      await payment("201.20", f.code + "-PV4", randomUUID(), second.id);
      expect((await balance()).upcoming).toBeNull();
    }, 60000);
    it("releases retention independently and records its voucher without changing normal installments", async () => {
      await expect(
        service.releaseRetention(certificateId, f.actors[0], "Release")
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      await expect(
        service.releaseRetention(
          certificateId,
          f.actors[1],
          "Before handover",
          "2026-02-01"
        )
      ).rejects.toMatchObject({ domainCode: "RETENTION_NOT_DUE" });
      await service.acceptHandover(
        {
          id: f.contractId,
          revision: 0,
          handoverDate: f.date,
          reason: "Final works accepted independently",
        },
        f.actors[1]
      );
      await service.releaseRetention(
        certificateId,
        f.actors[1],
        "Warranty condition verified",
        "2026-02-01"
      );
      await expect(
        service.recordPayment(
          simplePaymentInput.parse({
            contractId: f.contractId,
            certificateId,
            milestoneId: null,
            kind: "retention",
            amount: "100",
            paymentDate: "2026-01-20",
            voucher: f.code + "-RET-before",
          }),
          f.actors[2],
          randomUUID()
        )
      ).rejects.toMatchObject({ domainCode: "INVALID_INPUT" });
      await service.recordPayment(
        simplePaymentInput.parse({
          contractId: f.contractId,
          certificateId,
          milestoneId: null,
          kind: "retention",
          amount: "609.12",
          paymentDate: "2026-02-01",
          voucher: f.code + "-RET",
        }),
        f.actors[2],
        randomUUID()
      );
      const b = await balance();
      expect(b.outstanding).toBe("0.00");
      expect(b.retained).toBe("67.68");
      expect(b.paid).toBe("2502.32");
      const account = (await state()).accounts.find(
        a => a.supplierId === f.supplierId
      )!;
      expect(account.paid).toBe(b.paid);
      expect(account.outstanding).toBe("0.00");
    }, 60000);
    it("audits descriptive corrections, cancels only unused contracts and protects backdated vouchers", async () => {
      const source = (await state()).contracts.find(
        c => c.id === f.contractId
      )!;
      const c = await service.createContract(
        simpleContractInput.parse({
          ...source,
          title: f.code + " correction",
          taxPercent: "0",
          retentionPercent: "0",
          dailyPenalty: "0",
          items: [
            {
              description: "Review",
              unit: "each",
              quantity: "1",
              unitPrice: "1000",
            },
          ],
          milestones: [
            {
              name: "Single",
              percent: "100",
              dueDate: f.date,
              minProgress: "0",
            },
          ],
        }),
        f.actors[0],
        randomUUID()
      );
      await service.correctContract(
        {
          id: c.id,
          revision: 0,
          action: "cancel",
          reason: "duplicate fixture",
        },
        f.actors[0]
      );
      expect((await state()).contracts.some(x => x.id === c.id)).toBe(false);
      expect((await state()).cancelledContracts.some(x => x.id === c.id)).toBe(
        true
      );
      await expect(
        service.createCertificate(
          simpleCertificateInput.parse({
            contractId: c.id,
            certificateDate: f.date,
            mode: "percent",
            progress: "100",
          }),
          f.actors[0],
          randomUUID()
        )
      ).rejects.toMatchObject({ domainCode: "INVALID_TRANSITION" });
      await service.correctContract(
        { id: c.id, revision: 1, action: "restore", reason: "restore fixture" },
        f.actors[0]
      );
      await service.correctContract(
        {
          id: c.id,
          revision: 2,
          action: "terms",
          terms: "Corrected description",
          reason: "review correction",
        },
        f.actors[0]
      );
      await expect(
        service.correctContract(
          {
            id: c.id,
            revision: 2,
            action: "terms",
            terms: "stale",
            reason: "stale write",
          },
          f.actors[0]
        )
      ).rejects.toMatchObject({ domainCode: "CONFLICT" });
      const updated = await state();
      expect(updated.contracts.find(x => x.id === c.id)?.total).toBe("1000.00");
      expect(
        updated.corrections.filter(x => x.contractId === c.id)
      ).toHaveLength(3);
      const cert = await service.createCertificate(
        simpleCertificateInput.parse({
          contractId: c.id,
          certificateDate: f.date,
          mode: "percent",
          progress: "100",
        }),
        f.actors[0],
        randomUUID()
      );
      await service.decideCertificate(
        cert.id,
        f.actors[1],
        "approve",
        "Reviewed fixture"
      );
      const preview = await service.paymentPreview(c.id, "2026-06-01");
      const data = {
        contractId: c.id,
        certificateId: cert.id,
        milestoneId: preview.upcoming!.id,
        kind: "normal" as const,
      };
      await service.recordPayment(
        simplePaymentInput.parse({
          ...data,
          amount: "400",
          paymentDate: "2026-06-01",
          voucher: f.code + "-future",
        }),
        f.actors[2],
        randomUUID()
      );
      expect(
        (await service.paymentPreview(c.id, "2026-03-01")).upcoming?.readyAmount
      ).toBe("600.00");
      await service.recordPayment(
        simplePaymentInput.parse({
          ...data,
          amount: "100",
          paymentDate: "2026-03-01",
          voucher: f.code + "-past",
        }),
        f.actors[2],
        randomUUID()
      );
      const past = await service.paymentPreview(c.id, "2026-03-01");
      expect(past.paid).toBe("100.00");
      expect(past.upcoming?.readyAmount).toBe("500.00");
      await expect(
        service.recordPayment(
          simplePaymentInput.parse({
            ...data,
            amount: "501",
            paymentDate: "2026-03-01",
            voucher: f.code + "-past-over",
          }),
          f.actors[2],
          randomUUID()
        )
      ).rejects.toMatchObject({ domainCode: "PAYMENT_EXCEEDED" });
    }, 90000);
  }
);
