import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
vi.setConfig({ testTimeout: 60000 });
import { randomUUID } from "node:crypto";
import {
  setupPhaseOne,
  cleanupPhaseOne,
  type PhaseFixture,
} from "../../../scripts/phase-one-fixture";
import { inspectionInput } from "../../../shared/inspections";
import {
  simpleCertificateInput,
  simplePaymentInput,
} from "../../../shared/phase-one";
import { saveInspection, enableInspections } from "./inspections";
import * as service from "./service";
import {
  authorizeRequest,
  loadAccess,
  assertDocumentTarget,
} from "../../core/policy";
import { closeDb } from "../../db";
import { database } from "../../core/database";
import { accessProjects } from "../../../drizzle/policy";
import { appRouter } from "../../routers";
import type { TrpcContext } from "../../_core/context";
describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "FIR integrated with certificates and policy",
  () => {
    let f: PhaseFixture, fir: number, certificateId: number;
    const read = async () => service.state((await loadAccess(f.actors[1]))!);
    const firData = (changes: Record<string, unknown> = {}) =>
      inspectionInput.parse({
        contractId: f.contractId,
        itemIndex: 0,
        inspectionDate: "2026-01-02",
        location: "Parking",
        description: "Epoxy work",
        executed: "100",
        accepted: "90",
        status: "accepted",
        additionalSignatures: [
          { role: "Engineer", name: "Engineer A" },
          { role: "Manager", name: "Manager B" },
        ],
        ...changes,
      });
    const cert = (
      allocations: { inspectionId: number; quantity: string }[],
      date = "2026-01-03"
    ) =>
      service.createCertificate(
        simpleCertificateInput.parse({
          contractId: f.contractId,
          certificateDate: date,
          mode: "percent",
          progress: "100",
          inspectionAllocations: allocations,
        }),
        f.actors[0],
        randomUUID()
      );
    beforeAll(async () => {
      f = await setupPhaseOne();
      await (
        await database()
      )
        .insert(accessProjects)
        .values({ userId: f.actors[0], projectId: f.projectId })
        .onDuplicateKeyUpdate({ set: { projectId: f.projectId } });
    }, 90000);
    afterAll(async () => {
      try {
        if (f) await cleanupPhaseOne(f);
      } finally {
        await closeDb();
      }
    }, 90000);
    it("enables an existing contract without altering financial records", async () => {
      const before = await read();
      await enableInspections(f.contractId, f.actors[0]);
      const after = await read();
      expect(before.certificates).toEqual(after.certificates);
      expect(
        after.contracts.find(c => c.id === f.contractId)?.inspectionRequired
      ).toBe(true);
    });
    it("one person creates and accepts the inspection with automatic number and signatures", async () => {
      fir = (await saveInspection(firData(), f.actors[0], randomUUID())).id;
      const row = (await read()).inspections.find(r => r.id === fir)!;
      expect(row.number).toMatch(/^FIR-\d{2}-\d{2}-\d+$/);
      expect(row.accepted).toBe("90.0000");
      expect(row.additionalSignatures).toHaveLength(2);
      expect(row.supplierName).toContain(f.code);
    });
    it("refuses uninspected, excessive, duplicated and future evidence", async () => {
      await expect(cert([])).rejects.toThrow("INSPECTION_REQUIRED");
      await expect(
        cert([{ inspectionId: fir, quantity: "90.0001" }])
      ).rejects.toThrow("QUANTITY_EXCEEDED");
      await expect(
        cert([
          { inspectionId: fir, quantity: "1" },
          { inspectionId: fir, quantity: "1" },
        ])
      ).rejects.toThrow("INVALID_INPUT");
      await expect(
        cert([{ inspectionId: fir, quantity: "1" }], "2026-01-01")
      ).rejects.toThrow("INVALID_REFERENCE");
      await expect(
        saveInspection(
          firData({ accepted: "142", executed: "142" }),
          f.actors[0],
          randomUUID()
        )
      ).rejects.toThrow();
    });
    it("limits reinspection to the unaccepted balance of the original work", async () => {
      await expect(
        saveInspection(
          firData({
            previousInspectionId: fir,
            executed: "11",
            accepted: "11",
          }),
          f.actors[0],
          randomUUID()
        )
      ).rejects.toThrow("QUANTITY_EXCEEDED");
      const child = await saveInspection(
        firData({ previousInspectionId: fir, executed: "10", accepted: "10" }),
        f.actors[0],
        randomUUID()
      );
      expect(
        (await read()).inspections.find(r => r.id === child.id)
          ?.previousInspectionId
      ).toBe(fir);
      await expect(
        saveInspection(
          firData({ previousInspectionId: fir, executed: "1", accepted: "1" }),
          f.actors[0],
          randomUUID()
        )
      ).rejects.toThrow("QUANTITY_EXCEEDED");
    });
    it("serializes simultaneous submissions and releases reservation on rejection", async () => {
      const results = await Promise.allSettled([
        cert([{ inspectionId: fir, quantity: "45" }]),
        cert([{ inspectionId: fir, quantity: "45" }]),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      certificateId = (
        results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<{
          id: number;
        }>
      ).value.id;
      expect(
        (await read()).inspections.find(r => r.id === fir)?.remaining
      ).toBe("45.0000");
      await service.decideCertificate(
        certificateId,
        f.actors[1],
        "reject",
        "Correction required"
      );
      expect(
        (await read()).inspections.find(r => r.id === fir)?.remaining
      ).toBe("90.0000");
      await expect(
        saveInspection(firData(), f.actors[0], randomUUID(), fir, 0)
      ).rejects.toThrow("INSPECTION_LOCKED");
    });
    it("uses accepted quantities rather than a tampered free percentage and prevents reuse", async () => {
      certificateId = (await cert([{ inspectionId: fir, quantity: "90" }])).id;
      let state = await read(),
        c = state.certificates.find(c => c.id === certificateId)!;
      expect(c.gross).toBe("2160.00");
      expect(c.net).toBe("1728.00");
      expect(Number(c.progress)).toBeLessThan(64);
      expect(c.quantities).toEqual(["90.0000"]);
      expect(c.inspectionAllocations?.[0].number).toContain("FIR-");
      await service.decideCertificate(
        certificateId,
        f.actors[1],
        "approve",
        "Accepted work verified"
      );
      expect(
        (await read()).inspections.find(r => r.id === fir)?.remaining
      ).toBe("0.0000");
      await expect(
        cert([{ inspectionId: fir, quantity: "1" }])
      ).rejects.toThrow("QUANTITY_EXCEEDED");
    });
    it("retains the existing accounting workflow after FIR certification", async () => {
      const preview = await service.paymentPreview(f.contractId, "2026-01-03");
      await service.recordPayment(
        simplePaymentInput.parse({
          contractId: f.contractId,
          certificateId,
          milestoneId: preview.upcoming!.id,
          kind: "normal",
          amount: "846",
          paymentDate: "2026-01-03",
          voucher: f.code + "-FIR",
        }),
        f.actors[2],
        randomUUID()
      );
      const state = await service.state((await loadAccess(f.actors[2]))!);
      expect(
        state.balances.find(b => b.contractId === f.contractId)?.paid
      ).toBe("846.00");
    });
    it("central permissions deny accounting users mutation and constrain attachment access", async () => {
      await expect(
        authorizeRequest(f.actors[2], "phaseOne.saveInspection", {
          data: firData(),
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await assertDocumentTarget(
        (await loadAccess(f.actors[1]))!,
        "p1_inspection",
        fir
      );
      const access = (await loadAccess(f.actors[1]))!;
      access.scope.projectIds = [];
      await expect(
        assertDocumentTarget(access, "p1_inspection", fir)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("uploads and lists FIR evidence through the real centrally protected document routes", async () => {
      const caller = appRouter.createCaller({
        user: (await loadAccess(f.actors[0]))!.user,
        req: { headers: {} } as TrpcContext["req"],
        res: {} as TrpcContext["res"],
      });
      await caller.documents.upload({
        entityType: "p1_inspection",
        entityId: fir,
        title: "FIR test evidence",
        fileName: "fir-proof.png",
        mimeType: "image/png",
        classification: "internal",
        base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLwAAAABJRU5ErkJggg==",
      });
      const documents = await caller.documents.list({
        entityType: "p1_inspection",
        entityId: fir,
      });
      expect(documents).toHaveLength(1);
      expect(documents[0].entityId).toBe(fir);
    });
  }
);
