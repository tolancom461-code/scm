import {projectManagementRouter} from "./modules/project-management/router";
import { router } from "./_core/trpc";
import { authRouter } from "./modules/auth/router";
import { phaseOneRouter } from "./modules/phase-one/router";
import { policyRouter } from "./modules/policy/router";
import { usersRouter } from "./modules/users/router";
import { suppliersRouter } from "./modules/suppliers/router";
import { documentsRouter } from "./modules/documents/router";
export const appRouter = router({
  projectManagement:projectManagementRouter,
  auth: authRouter,
  phaseOne: phaseOneRouter,
  policy: policyRouter,
  users: usersRouter,
  suppliers: suppliersRouter,
  documents: documentsRouter,
});
export type AppRouter = typeof appRouter;
