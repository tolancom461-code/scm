import { projectManagementRouter } from "./modules/project-management/router";
import { ganttRouter } from "./modules/gantt/router";
import { router } from "./_core/trpc";
import { authRouter } from "./modules/auth/router";
import { phaseOneRouter } from "./modules/phase-one/router";
import { policyRouter } from "./modules/policy/router";
import { usersRouter } from "./modules/users/router";
import { suppliersRouter } from "./modules/suppliers/router";
import { documentsRouter } from "./modules/documents/router";
import { materialRequisitionsRouter } from "./modules/material-requisitions/router";
export const appRouter = router({
  projectManagement: projectManagementRouter,
  gantt: ganttRouter,
  auth: authRouter,
  phaseOne: phaseOneRouter,
  policy: policyRouter,
  users: usersRouter,
  suppliers: suppliersRouter,
  documents: documentsRouter,
  materialRequisitions: materialRequisitionsRouter,
});
export type AppRouter = typeof appRouter;
