import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  setupPolicyFixture,
  cleanupPolicyFixture,
  callerFor,
  configure,
  type PolicyFixture,
} from "../../scripts/policy-fixture";
import { loadAccess } from "./policy";
import { appRouter } from "../routers";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import { database } from "./database";
import { accessDenials } from "../../drizzle/policy";
import { closeDb, getUserByUsername } from "../db";
import { roleTemplates, togglePermission } from "../../shared/policy";
import { setFixturePermissions as setUserPermissions } from "../../scripts/permissions-fixture";
import { userPolicy } from "../modules/policy/service";
import {
  simpleCertificateInput,
  simpleContractInput,
} from "../../shared/phase-one";

describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "central policy against the database and direct API calls",
  () => {
    let f: PolicyFixture, certificateId: number, paymentId: number;
    let preparer: Awaited<ReturnType<typeof callerFor>>,
      approver: typeof preparer,
      accountant: typeof preparer,
      owner: typeof preparer;
    beforeAll(async () => {
      f = await setupPolicyFixture();
      preparer = await callerFor(f.a.actors[0]);
      approver = await callerFor(f.a.actors[1]);
      accountant = await callerFor(f.a.actors[2]);
      owner = await callerFor(f.extra.owner);
    }, 180000);
    afterAll(async () => {
      try {
        if (f) await cleanupPolicyFixture(f);
      } finally {
        await closeDb();
      }
    }, 90000);
    it("filters reads to assigned projects and shows no projects to unconfigured users", async () => {
      const state = await preparer.phaseOne.state();
      expect(state.projects.map(p => p.id)).toEqual([f.a.projectId]);
      expect(state.contracts.map(p => p.id)).toEqual([f.a.contractId]);
      expect(state.payments).toEqual([]);
      expect(state.balances).toEqual([]);
      expect(state.accounts).toEqual([]);
      expect(state.schedules[0].stages).toHaveLength(3);
      expect((await owner.phaseOne.state()).contracts.map(c => c.id)).toEqual(
        expect.arrayContaining([f.a.contractId, f.b.contractId])
      );
      const empty = await callerFor(f.extra.empty);
      await expect(empty.phaseOne.state()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await configure(
        f.extra.owner,
        f.extra.empty,
        "custom",
        [],
        ["p1.projects.view"]
      );
      expect((await empty.phaseOne.state()).projects).toEqual([]);
    }, 60000);
    it("blocks direct certificate writes against other projects, including unknown IDs", async () => {
      await expect(
        accountant.phaseOne.correctContract({
          id: f.a.contractId,
          revision: 0,
          action: "cancel",
          reason: "forbidden correction",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        preparer.phaseOne.correctContract({
          id: f.b.contractId,
          revision: 0,
          action: "cancel",
          reason: "wrong project",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        accountant.phaseOne.paymentPreview({
          contractId: f.b.contractId,
          paymentDate: f.a.date,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const snapshot = await owner.phaseOne.state();
      const foreign = snapshot.contracts.find(c => c.id === f.b.contractId)!;
      await expect(
        preparer.phaseOne.createContract({
          key: randomUUID(),
          data: simpleContractInput.parse({
            ...foreign,
            reference: f.a.code + "-blocked",
            milestones: snapshot.schedules.find(
              c => c.contractId === f.b.contractId
            )!.stages,
          }),
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      for (const contractId of [f.b.contractId, 2147483000])
        await expect(
          preparer.phaseOne.createCertificate({
            key: randomUUID(),
            data: simpleCertificateInput.parse({
              contractId,
              certificateDate: f.a.date,
              mode: "percent",
              progress: "100",
            }),
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (await owner.phaseOne.state()).certificates.filter(
          c => c.contractId === f.b.contractId
        )
      ).toEqual([]);
    }, 60000);
    it("assigns a newly created project to its creator without granting other projects", async () => {
      await configure(
        f.extra.owner,
        f.extra.empty,
        "custom",
        [],
        ["p1.projects.create"]
      );
      const creator = await callerFor(f.extra.empty);
      const result = await creator.phaseOne.createProject({
        key: randomUUID(),
        name: f.a.code + " created project",
        site: "QA",
      });
      expect((await creator.phaseOne.state()).projects.map(p => p.id)).toEqual([
        result.id,
      ]);
    }, 60000);
    it("supports independent approval and payment while preserving separate duties", async () => {
      certificateId = (
        await preparer.phaseOne.createCertificate({
          key: randomUUID(),
          data: simpleCertificateInput.parse({
            contractId: f.a.contractId,
            certificateDate: f.a.date,
            mode: "percent",
            progress: "100",
          }),
        })
      ).id;
      await expect(
        accountant.phaseOne.decideCertificate({
          id: certificateId,
          action: "approve",
          reason: "Reviewed",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await approver.phaseOne.decideCertificate({
        id: certificateId,
        action: "approve",
        reason: "Reviewed independently",
      });
      const state = await accountant.phaseOne.state();
      const milestoneId = state.balances[0].upcoming!.id;
      paymentId = (
        await accountant.phaseOne.recordPayment({
          key: randomUUID(),
          data: {
            contractId: f.a.contractId,
            certificateId,
            milestoneId,
            kind: "normal",
            amount: "100",
            paymentDate: f.a.date,
            voucher: f.a.code + "-POLICY",
          },
        })
      ).id;
      await expect(
        approver.phaseOne.releaseRetention({
          id: certificateId,
          reason: "Warranty fulfilled",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await owner.phaseOne.acceptHandover({
        id: f.a.contractId,
        revision: 0,
        handoverDate: f.a.date,
        reason: "Final handover independently reviewed",
      });
      await owner.phaseOne.releaseRetention({
        id: certificateId,
        reason: "Warranty fulfilled",
      });
      const limited = await preparer.phaseOne.state();
      expect(limited.certificates[0]).toMatchObject({
        releasedAmount: null,
        releasedBy: null,
        releaseReason: null,
        releaseDate: null,
      });
      expect(limited.payments).toEqual([]);
      expect(limited.accounts).toEqual([]);
      expect(
        (await accountant.phaseOne.state()).payments.map(p => p.id)
      ).toEqual([paymentId]);
    }, 60000);
    it("allows owner self-approval and project manager self-handover while preserving scope", async () => {
      const id = (
        await owner.phaseOne.createCertificate({
          key: randomUUID(),
          data: simpleCertificateInput.parse({
            contractId: f.b.contractId,
            certificateDate: f.b.date,
            mode: "percent",
            progress: "100",
          }),
        })
      ).id;
      await expect(
        owner.phaseOne.decideCertificate({
          id,
          action: "approve",
          reason: "Self approval",
        })
      ).resolves.toEqual({ id });
      await expect(
        owner.phaseOne.acceptHandover({
          id: f.b.contractId,
          revision: 0,
          handoverDate: f.b.date,
          reason: "Owner self-handover exception",
        })
      ).resolves.toEqual({ id: f.b.contractId });
      await expect(
        approver.phaseOne.decideCertificate({
          id,
          action: "approve",
          reason: "Other project",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        accountant.phaseOne.recordPayment({
          key: randomUUID(),
          data: {
            contractId: f.b.contractId,
            certificateId: id,
            milestoneId: null,
            kind: "normal",
            amount: "100",
            paymentDate: f.b.date,
            voucher: f.a.code + "-blocked-payment",
          },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }, 60000);
    it("allows project manager self-handover but denies other templates", async () => {
      const existingFinal = (await owner.phaseOne.state()).certificates.some(
        c =>
          c.contractId === f.b.contractId &&
          c.status === "approved" &&
          Number(c.progress) === 100
      );
      if (!existingFinal) {
        const cert = (
          await owner.phaseOne.createCertificate({
            key: randomUUID(),
            data: simpleCertificateInput.parse({
              contractId: f.b.contractId,
              certificateDate: f.b.date,
              mode: "percent",
              progress: "100",
            }),
          })
        ).id;
        await owner.phaseOne.decideCertificate({
          id: cert,
          action: "approve",
          reason: "Owner test approval",
        });
      }
      await configure(f.extra.owner, f.b.actors[0], "approver", [
        f.b.projectId,
      ]);
      const manager = await callerFor(f.b.actors[0]);
      const contract = (await owner.phaseOne.state()).contracts.find(
        c => c.id === f.b.contractId
      )!;
      const input = {
        id: f.b.contractId,
        revision: contract.revision,
        handoverDate: f.b.date,
        reason: "Manager self-handover test",
      };
      await expect(
        manager.phaseOne.acceptHandover(input)
      ).rejects.toMatchObject({ message: expect.any(String) });
      await configure(f.extra.owner, f.b.actors[0], "project_manager", [
        f.b.projectId,
      ]);
      await expect(manager.phaseOne.acceptHandover(input)).resolves.toEqual({
        id: f.b.contractId,
      });
    }, 60000);
    it("scopes filtered and unfiltered attachment lists and rejects uploads before writing storage", async () => {
      const upload = (
        entityType:
          | "p1_contract"
          | "p1_certificate"
          | "p1_payment"
          | "p1_inspection",
        entityId: number,
        classification: "internal" | "confidential" = "internal"
      ) =>
        owner.documents.upload({
          entityType,
          entityId,
          classification,
          title: "Policy fixture",
          fileName: "policy.txt",
          mimeType: "text/plain",
          base64: Buffer.from("Policy fixture content").toString("base64"),
        });
      await upload("p1_contract", f.a.contractId);
      await upload("p1_contract", f.b.contractId);
      await upload("p1_payment", paymentId);
      await upload("p1_contract", f.a.contractId, "confidential");
      const docs = await preparer.documents.list();
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        entityType: "p1_contract",
        entityId: f.a.contractId,
      });
      expect(
        (await accountant.documents.list()).map(d => d.entityType).sort()
      ).toEqual(["p1_contract", "p1_payment"]);
      await expect(
        preparer.documents.list({
          entityType: "p1_payment",
          entityId: paymentId,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        preparer.documents.upload({
          entityType: "p1_contract",
          entityId: f.b.contractId,
          title: "Forbidden target",
          fileName: "blocked.txt",
          mimeType: "text/plain",
          base64: "YQ==",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }, 60000);
    it("reloads actual identity, grants and scope instead of trusting a stale or forged context", async () => {
      const actual = (await loadAccess(f.extra.viewer))!;
      const forged = appRouter.createCaller({
        user: {
          ...actual.user,
          role: "admin",
          permissionCodes: ["policy.manage", "p1.payments.record"],
        },
      } as TrpcContext);
      await expect(forged.policy.catalog()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      const viewer = await callerFor(f.extra.viewer);
      expect((await viewer.phaseOne.state()).contracts).toHaveLength(1);
      await configure(f.extra.owner, f.extra.viewer, "viewer", []);
      expect((await viewer.phaseOne.state()).contracts).toEqual([]);
      await configure(f.extra.owner, f.extra.viewer, "custom", []);
      await expect(viewer.phaseOne.state()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await configure(f.extra.owner, f.extra.viewer, "viewer", [f.a.projectId]);
    }, 60000);
    it("limits delegated grants and project scopes and protects broader accounts from password takeover", async () => {
      const manager = await callerFor(f.extra.manager);
      const config = await owner.policy.user({ userId: f.extra.viewer });
      await expect(
        manager.policy.save({
          ...config,
          permissions: ["p1.payments.record"],
          template: "custom",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        manager.policy.save({
          ...config,
          projectIds: [f.b.projectId],
          template: "custom",
          permissions: [],
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        manager.policy.save({
          ...config,
          allProjects: true,
          template: "custom",
          permissions: [],
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        manager.users.resetPassword({
          userId: f.a.actors[2],
          password: f.a.password,
          confirmation: f.a.password,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        manager.policy.user({ userId: f.extra.owner })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        owner.policy.save({
          ...(await owner.policy.user({ userId: f.extra.owner })),
          template: "custom",
          permissions: [],
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }, 60000);
    it("handles stale policy edits as a conflict and rejects unknown grant codes", async () => {
      const config = await owner.policy.user({ userId: f.extra.empty });
      await owner.policy.save(config);
      await expect(owner.policy.save(config)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      const current = await owner.policy.user({ userId: f.extra.empty });
      await expect(
        owner.policy.save({ ...current, permissions: ["future.unregistered"] })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const profile = await userPolicy(
        f.extra.empty,
        (await loadAccess(f.extra.owner))!
      );
      expect(profile.permissions).not.toContain("future.unregistered");
    }, 60000);
    it("denies future unregistered public and protected actions even to the owner", async () => {
      const unknown = router({
        futurePublic: publicProcedure.query(() => "UNSAFE"),
        futureProtected: protectedProcedure.query(() => "UNSAFE"),
      });
      const caller = unknown.createCaller({
        user: (await loadAccess(f.extra.owner))!.user,
      } as TrpcContext);
      await expect(caller.futurePublic()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(caller.futureProtected()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }, 60000);
    it("creates and edits a role with per-user overrides atomically without changing the template or other users", async () => {
      const username = f.a.code.toLowerCase() + "-role-create";
      const original = await owner.policy.user({ userId: f.a.actors[2] });
      const accessPolicy = {
        template: "accountant" as const,
        permissions: togglePermission(
          roleTemplates.accountant.permissions,
          "p1.payments.record",
          false
        ),
        allProjects: false,
        projectIds: [f.a.projectId],
      };
      const result = await owner.users.create({
        username,
        name: f.a.code + " role user",
        password: f.a.password,
        accessPolicy,
      });
      f.a.actors.push(result.id);
      const created = await owner.policy.user({ userId: result.id });
      expect(created.template).toBe("accountant");
      expect(created.permissions).not.toContain("p1.payments.record");
      expect(created.permissions).toContain("p1.payments.view");
      expect(created.projectIds).toEqual([f.a.projectId]);
      expect(roleTemplates.accountant.permissions).toContain(
        "p1.payments.record"
      );
      expect(await owner.policy.user({ userId: f.a.actors[2] })).toEqual(
        original
      );
      const details = {
        userId: result.id,
        username,
        name: f.a.code + " changed",
        email: "",
        locale: "ar" as const,
      };
      await owner.users.update({
        ...details,
        accessPolicy: {
          ...created,
          template: "approver",
          permissions: [
            ...roleTemplates.approver.permissions,
            "p1.payments.view",
          ],
        },
      });
      expect((await owner.policy.user({ userId: result.id })).template).toBe(
        "approver"
      );
      await expect(
        owner.users.update({
          ...details,
          name: "Must roll back",
          accessPolicy: created,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await getUserByUsername(username))?.name).toBe(details.name);
      const manager = await callerFor(f.extra.manager);
      const blocked = f.a.code.toLowerCase() + "-blocked-role";
      await expect(
        manager.users.create({
          username: blocked,
          name: "Blocked",
          password: f.a.password,
          accessPolicy,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await getUserByUsername(blocked)).toBeNull();
      const preparerAccess = (await loadAccess(f.a.actors[0]))!;
      await setUserPermissions(f.a.actors[0], [
        ...preparerAccess.user.permissionCodes,
        "users.create",
        "users.edit",
      ]);
      const noPolicy = await callerFor(f.a.actors[0]);
      await expect(
        noPolicy.users.create({
          username: blocked,
          name: "Blocked",
          password: f.a.password,
          accessPolicy: { ...accessPolicy, permissions: [] },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await getUserByUsername(blocked)).toBeNull();
      await configure(f.extra.owner, f.a.actors[0], "preparer", [
        f.a.projectId,
      ]);
    }, 90000);
    it("records denied actions without payloads, passwords or attachment contents", async () => {
      const events = await (await database())
        .select()
        .from(accessDenials)
        .where(eq(accessDenials.actorId, f.a.actors[0]));
      expect(events.map(e => e.reason)).toEqual(
        expect.arrayContaining(["PROJECT_SCOPE", "DOCUMENT_TARGET"])
      );
      expect(JSON.stringify(events)).not.toContain(f.a.password);
      expect(JSON.stringify(events)).not.toContain("YQ==");
      expect(
        (await owner.policy.audit()).some(
          e => e.reason === "UNREGISTERED_ACTION"
        )
      ).toBe(true);
    }, 60000);
  }
);
