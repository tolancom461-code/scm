import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../_core/trpc";
import { permissionAllowed } from "../../shared/policy";

export function hasPermission(
  user: { role: string; permissionCodes: string[] },
  permission: string
) {
  return permissionAllowed(user, permission);
}
export function requiring(permission: string) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!hasPermission(ctx.user, permission))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "لا تملك صلاحية هذا الإجراء / Permission denied / اجازت نہیں۔",
      });
    return next();
  });
}
