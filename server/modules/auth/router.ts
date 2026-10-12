import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "../../_core/cookies";
import { publicProcedure, router } from "../../_core/trpc";
import { roleTemplates } from "../../../shared/policy";
import * as db from "../../db";
import {
  clearLoginFailures,
  generateSessionToken,
  hashPassword,
  isLoginRateLimited,
  LOCAL_SESSION_COOKIE,
  registerLoginFailure,
  SESSION_TTL_MS,
  verifyPassword,
} from "../../localAuth";

const localeSchema = z.enum(["ar", "en", "ur"]);

export const authRouter = router({
  firstRunStatus: publicProcedure.query(async () => {
    await db.seedPermissions();
    return { needsSetup: (await db.countUsers()) === 0 };
  }),
  bootstrap: publicProcedure
    .input(
      z.object({
        username: z
          .string()
          .trim()
          .min(3)
          .max(80)
          .regex(/^[a-zA-Z0-9._-]+$/),
        password: z.string().min(12).max(128),
        name: z.string().trim().min(2).max(150),
        email: z.string().email().optional(),
        locale: localeSchema.default("ar"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (await db.countUsers())
        throw new TRPCError({
          code: "CONFLICT",
          message: "تم إعداد النظام مسبقاً.",
        });
      await db.seedPermissions();
      const userId = await db.createFirstAdministrator({
        username: input.username.toLowerCase(),
        passwordHash: await hashPassword(input.password),
        name: input.name,
        email: input.email,
        role: "admin",
        locale: input.locale,
      });
      const token = generateSessionToken();
      await db.createSession(
        userId,
        token,
        new Date(Date.now() + SESSION_TTL_MS)
      );
      ctx.res.cookie(LOCAL_SESSION_COOKIE, token, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: SESSION_TTL_MS,
      });
      await db.createAuditLog(userId, "auth.bootstrap", "user", userId, {
        username: input.username,
      });
      return { success: true };
    }),
  login: publicProcedure
    .input(
      z.object({
        username: z.string().trim().min(3).max(80),
        password: z.string().min(1).max(128),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const loginKey = `${ctx.req.ip}:${input.username.toLowerCase()}`;
      if (isLoginRateLimited(loginKey))
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "محاولات دخول كثيرة؛ أعد المحاولة لاحقاً.",
        });
      const user = await db.getUserByUsername(input.username.toLowerCase());
      if (
        !user ||
        !user.active ||
        !(await verifyPassword(input.password, user.passwordHash))
      ) {
        registerLoginFailure(loginKey);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "اسم المستخدم أو كلمة المرور غير صحيحة.",
        });
      }
      clearLoginFailures(loginKey);
      const token = generateSessionToken();
      const sessionCreated = await db.createSession(
        user.id,
        token,
        new Date(Date.now() + SESSION_TTL_MS),
        user.passwordHash
      );
      if (!sessionCreated)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "اسم المستخدم أو كلمة المرور غير صحيحة.",
        });
      ctx.res.cookie(LOCAL_SESSION_COOKIE, token, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: SESSION_TTL_MS,
      });
      await db.createAuditLog(user.id, "auth.login", "user", user.id);
      return { success: true };
    }),
  logout: publicProcedure.mutation(async ({ ctx }) => {
    const token = (ctx.req.headers.cookie ?? "").match(
      new RegExp(`${LOCAL_SESSION_COOKIE}=([^;]+)`)
    )?.[1];
    if (token) await db.deleteSession(token);
    ctx.res.clearCookie(LOCAL_SESSION_COOKIE, getSessionCookieOptions(ctx.req));
    return { success: true } as const;
  }),
  me: publicProcedure.query(({ ctx }) =>
    ctx.user
      ? {
          id: ctx.user.id,
          username: ctx.user.username,
          name: ctx.user.name,
          email: ctx.user.email,
          locale: ctx.user.preferredLocale,
          permissions: ctx.user.permissionCodes,
          role: ctx.user.role,
          policy: ctx.access
            ? {
                ...ctx.access.scope,
                owner: ctx.user.role === "admin",
                landing:
                  ctx.user.role === "admin"
                    ? "contracts"
                    : roleTemplates[ctx.access.scope.template].landing,
              }
            : undefined,
        }
      : null
  ),
});
