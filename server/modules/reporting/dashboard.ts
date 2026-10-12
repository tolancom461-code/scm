import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";

import { requiring } from "../../core/permissions";
export const dashboardRouter = router({
  overview: requiring("dashboard.view").query(() => db.dashboardOverview()),
});
