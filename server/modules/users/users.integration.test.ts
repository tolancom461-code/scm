import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  setupUsersFixture,
  cleanupUsersFixture,
  type UsersFixture,
} from "../../../scripts/users-fixture";
import * as db from "../../db";
import * as service from "./service";
import { userProfileInput, userPasswordInput } from "../../../shared/users";
import { database } from "../../core/database";
import { scmAuditEvents } from "../../../drizzle/foundation";
import { verifyPassword } from "../../localAuth";
import { appRouter } from "../../routers";
import type { TrpcContext } from "../../_core/context";

describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "user account administration",
  () => {
    let f: UsersFixture;
    const account = (kind: string) => f.accounts.find(a => a.kind === kind)!;
    let renamed = "",
      newPassword = "";
    beforeAll(async () => {
      f = await setupUsersFixture();
    }, 90000);
    afterAll(async () => {
      try {
        if (f) await cleanupUsersFixture(f);
      } finally {
        await db.closeDb();
      }
    }, 90000);
    it("updates profile and rejects duplicate usernames without changing roles", async () => {
      const target = account("target");
      renamed = f.code + "_renamed";
      const data = userProfileInput.parse({
        userId: target.id,
        username: renamed.toUpperCase(),
        name: "Updated fixture",
        email: "fixture@example.test",
        locale: "en",
      });
      await service.updateProfile(data, account("adminA").id);
      expect(await db.getUserByUsername(target.username)).toBeNull();
      expect(await db.getUserByUsername(renamed)).toMatchObject({
        id: target.id,
        name: "Updated fixture",
        email: "fixture@example.test",
        preferredLocale: "en",
        role: "user",
      });
      await expect(
        service.updateProfile(
          { ...data, username: account("adminA").username },
          account("adminA").id
        )
      ).rejects.toMatchObject({ domainCode: "USERNAME_TAKEN" });
      expect((await db.getUserByUsername(renamed))?.id).toBe(target.id);
    }, 60000);
    it("resets passwords, revokes sessions and rejects a login verified against the old hash", async () => {
      const target = account("target"),
        owner = account("adminA");
      const before = (await db.getUserByUsername(renamed))!;
      const token = randomUUID();
      expect(
        await db.createSession(
          target.id,
          token,
          new Date(Date.now() + 60000),
          before.passwordHash
        )
      ).toBe(true);
      newPassword = "New-Password-" + randomUUID();
      await service.resetPassword(
        userPasswordInput.parse({
          userId: target.id,
          password: newPassword,
          confirmation: newPassword,
        }),
        owner.id
      );
      const after = (await db.getUserByUsername(renamed))!;
      expect(await verifyPassword(newPassword, after.passwordHash)).toBe(true);
      expect(await verifyPassword(f.password, after.passwordHash)).toBe(false);
      expect(await db.getUserBySessionToken(token)).toBeNull();
      expect(
        await db.createSession(
          target.id,
          randomUUID(),
          new Date(Date.now() + 60000),
          before.passwordHash
        )
      ).toBe(false);
      const events = await (await database())
        .select()
        .from(scmAuditEvents)
        .where(eq(scmAuditEvents.entityId, target.id));
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(newPassword);
      expect(serialized).not.toContain(after.passwordHash!);
    }, 60000);
    it("deactivates and reactivates without reviving old sessions", async () => {
      const target = account("target"),
        actor = account("adminA").id,
        token = randomUUID();
      const user = (await db.getUserByUsername(renamed))!;
      expect(
        await db.createSession(
          target.id,
          token,
          new Date(Date.now() + 60000),
          user.passwordHash
        )
      ).toBe(true);
      await service.setActive({ userId: target.id, active: false }, actor);
      expect(await db.getUserBySessionToken(token)).toBeNull();
      expect(
        await db.createSession(
          target.id,
          randomUUID(),
          new Date(Date.now() + 60000),
          user.passwordHash
        )
      ).toBe(false);
      await service.setActive({ userId: target.id, active: true }, actor);
      expect(await db.getUserBySessionToken(token)).toBeNull();
      expect(
        await db.createSession(
          target.id,
          randomUUID(),
          new Date(Date.now() + 60000),
          user.passwordHash
        )
      ).toBe(true);
    }, 60000);
    it("enforces action permissions, administrator hierarchy and self-deactivation protection", async () => {
      const admin = account("adminA"),
        manager = account("manager"),
        viewer = account("viewer");
      await expect(
        service.setActive({ userId: admin.id, active: false }, admin.id)
      ).rejects.toMatchObject({ domainCode: "SELF_DEACTIVATION" });
      await expect(
        service.setActive({ userId: admin.id, active: false }, manager.id)
      ).rejects.toMatchObject({ domainCode: "USER_ADMIN_REQUIRED" });
      const user = (await db.getUserByUsername(viewer.username))!;
      const caller = appRouter.createCaller({
        user: { ...user, permissionCodes: ["users.view"] },
        req: {} as TrpcContext["req"],
        res: {} as TrpcContext["res"],
      });
      await expect(
        caller.users.setActive({ userId: account("target").id, active: false })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.users.resetPassword({
          userId: account("target").id,
          password: newPassword,
          confirmation: newPassword,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.users.update({
          userId: account("target").id,
          username: renamed,
          name: "No permission",
          email: "",
          locale: "ar",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }, 60000);
    it("serializes administrators disabling each other and keeps one active", async () => {
      const a = account("adminA"),
        b = account("adminB");
      const results = await Promise.allSettled([
        service.setActive({ userId: b.id, active: false }, a.id),
        service.setActive({ userId: a.id, active: false }, b.id),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      const admins = await Promise.all([
        db.getUserByUsername(a.username),
        db.getUserByUsername(b.username),
      ]);
      expect(admins.filter(u => u?.active)).toHaveLength(1);
    }, 60000);
  }
);
