import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { TrpcContext } from "./context";
import { DomainError, domainMessages } from "../core/errors";
import { authorizeRequest, loadAccess, logAccessDenied } from "../core/policy";
import { routePolicies } from "../core/policy-registry";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error, ctx }) {
    const { stack: _stack, ...safeData } = shape.data;
    const locale = ctx?.user?.preferredLocale ?? "ar";
    const domain = error.cause instanceof DomainError ? error.cause : null;
    return {
      ...shape,
      message: domain
        ? domainMessages[domain.domainCode][locale]
        : error.cause instanceof ZodError
          ? domainMessages.INVALID_INPUT[locale]
          : error.code === "INTERNAL_SERVER_ERROR"
            ? domainMessages.SERVICE_UNAVAILABLE[locale]
            : shape.message,
      data: { ...safeData, domainCode: domain?.domainCode ?? null },
    };
  },
});

export const router = t.router;
const domainErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof DomainError) {
    const domain = result.error.cause;
    const code =
      domain.domainCode === "NOT_FOUND"
        ? "NOT_FOUND"
        : ["CONFLICT", "USERNAME_TAKEN"].includes(domain.domainCode)
          ? "CONFLICT"
          : [
                "DUTY_CONFLICT",
                "APPROVER_INELIGIBLE",
                "USER_ADMIN_REQUIRED",
              ].includes(domain.domainCode)
            ? "FORBIDDEN"
            : domain.domainCode === "SERVICE_UNAVAILABLE"
              ? "INTERNAL_SERVER_ERROR"
              : "BAD_REQUEST";
    throw new TRPCError({ code, message: domain.message, cause: domain });
  }
  return result;
});
const policyGate = t.middleware(async ({ ctx, path, getRawInput, next }) => {
  const policy = routePolicies[path];
  if (!policy) {
    if (ctx.user)
      await logAccessDenied(ctx.user.id, path, "UNREGISTERED_ACTION");
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "لم تُعرّف سياسة لهذا الإجراء / No policy registered",
    });
  }
  if (policy.public) {
    const access = ctx.user ? await loadAccess(ctx.user.id) : null;
    return next({
      ctx: { ...ctx, user: access?.user ?? null, access: access ?? undefined },
    });
  }
  if (!ctx.user)
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  const access = await authorizeRequest(ctx.user.id, path, await getRawInput());
  const result = await next({ ctx: { ...ctx, user: access.user, access } });
  if (
    !result.ok &&
    (result.error.code === "FORBIDDEN" ||
      (result.error.cause instanceof DomainError &&
        [
          "DUTY_CONFLICT",
          "APPROVER_INELIGIBLE",
          "USER_ADMIN_REQUIRED",
        ].includes(result.error.cause.domainCode)))
  )
    await logAccessDenied(
      ctx.user.id,
      path,
      result.error.cause instanceof DomainError &&
        result.error.cause.domainCode === "USER_ADMIN_REQUIRED"
        ? "GRANT_AUTHORITY"
        : "BUSINESS_RULE"
    );
  return result;
});
export const publicProcedure = t.procedure.use(domainErrors).use(policyGate);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireUser);

export const adminProcedure = publicProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
