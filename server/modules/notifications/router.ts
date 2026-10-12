import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import * as db from "../../db";

export const notificationsRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    db.listNotifications(ctx.user.id)
  ),
  markRead: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await db.markNotificationRead(input.id, ctx.user.id);
      return { success: true };
    }),
});
