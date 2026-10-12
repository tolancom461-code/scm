import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";
import {
  userProfileInput,
  userPasswordInput,
  userStatusInput,
  userCreateInput,
} from "../../../shared/users";
import * as service from "./service";
import { saveCustomGrants, userPolicy } from "../policy/service";

const permissionSchema = z.string().min(3).max(120);

import { requiring } from "../../core/permissions";
export const usersRouter = router({
  list: requiring("users.view").query(() => db.listUsers()),
  update: requiring("users.edit")
    .input(userProfileInput)
    .mutation(({ input, ctx }) =>
      service.updateProfile(input, ctx.user.id, ctx.access!)
    ),
  resetPassword: requiring("users.password.reset")
    .input(userPasswordInput)
    .mutation(({ input, ctx }) => service.resetPassword(input, ctx.user.id)),
  setActive: requiring("users.status.manage")
    .input(userStatusInput)
    .mutation(({ input, ctx }) => service.setActive(input, ctx.user.id)),
  permissions: requiring("policy.manage")
    .input(z.object({ userId: z.number().int().positive() }))
    .query(
      async ({ input, ctx }) =>
        (await userPolicy(input.userId, ctx.access!)).permissions
    ),
  create: requiring("users.create")
    .input(userCreateInput)
    .mutation(({ input, ctx }) => service.createUser(input, ctx.access!)),
  setPermissions: requiring("policy.manage")
    .input(
      z.object({
        userId: z.number().int().positive(),
        permissions: z.array(permissionSchema),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await saveCustomGrants(input.userId, input.permissions, ctx.access!);
      return { success: true };
    }),
});
