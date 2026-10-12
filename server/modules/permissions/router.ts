import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";

import { requiring } from "../../core/permissions";
import { canAccess } from "../../core/policy";
export const permissionsRouter = router({
  list: requiring("policy.manage").query(async ({ ctx }) =>
    (await db.listPermissions()).filter(p => canAccess(ctx.access!, p.code))
  ),
});
