import { z } from "zod";
import { router, protectedProcedure } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import { accessProfileInput, roleTemplates } from "../../../shared/policy";
import * as service from "./service";
export const policyRouter = router({
  me: protectedProcedure.query(({ ctx }) => ({
    ...ctx.access!.scope,
    permissions: ctx.user.permissionCodes,
    owner: ctx.user.role === "admin",
    landing:
      ctx.user.role === "admin"
        ? "contracts"
        : roleTemplates[ctx.access!.scope.template].landing,
  })),
  catalog: requiring("policy.view").query(({ ctx }) =>
    service.catalog(ctx.access!)
  ),
  user: requiring("policy.manage")
    .input(z.object({ userId: z.number().int().positive() }))
    .query(({ input, ctx }) => service.userPolicy(input.userId, ctx.access!)),
  save: requiring("policy.manage")
    .input(accessProfileInput)
    .mutation(({ input, ctx }) => service.savePolicy(input, ctx.access!)),
  audit: requiring("policy.view").query(({ ctx }) =>
    service.denials(ctx.access!)
  ),
});
