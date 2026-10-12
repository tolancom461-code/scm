import { router } from "./_core/trpc";
import { phaseOneRouter } from "./modules/phase-one/router";
import { policyRouter } from "./modules/policy/router";
import { financeRouter } from "./modules/finance-control/router";
import { masterDataRouter } from "./modules/master-data/router";
import { workflowsRouter } from "./modules/workflows/router";
import { projectsRouter } from "./modules/projects/router";
import { procurementRouter } from "./modules/procurement/scm-router";
import { receivingRouter } from "./modules/receiving/scm-router";
import { inventoryRouter } from "./modules/inventory/router";
import { authRouter } from "./modules/auth/router";
import { dashboardRouter } from "./modules/reporting/dashboard";
import { reportsRouter } from "./modules/reporting/reports";
import { permissionsRouter } from "./modules/permissions/router";
import { usersRouter } from "./modules/users/router";
import { suppliersRouter } from "./modules/suppliers/router";
import { purchaseRequestsRouter } from "./modules/procurement/router";
import { contractsRouter } from "./modules/contracts/router";
import { rfqsRouter } from "./modules/sourcing/router";
import { ordersRouter } from "./modules/purchasing/router";
import { deliveriesRouter } from "./modules/receiving/router";
import { documentsRouter } from "./modules/documents/router";
import { notificationsRouter } from "./modules/notifications/router";

export const appRouter = router({
  policy: policyRouter,
  phaseOne: phaseOneRouter,
  finance: financeRouter,
  workflows: workflowsRouter,
  procurement: procurementRouter,
  receiving: receivingRouter,
  inventory: inventoryRouter,
  projects: projectsRouter,
  masterData: masterDataRouter,
  auth: authRouter,
  dashboard: dashboardRouter,
  reports: reportsRouter,
  permissions: permissionsRouter,
  users: usersRouter,
  suppliers: suppliersRouter,
  purchaseRequests: purchaseRequestsRouter,
  contracts: contractsRouter,
  rfqs: rfqsRouter,
  orders: ordersRouter,
  deliveries: deliveriesRouter,
  documents: documentsRouter,
  notifications: notificationsRouter,
});
export type AppRouter = typeof appRouter;
