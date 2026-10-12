// Explicitly reviewed route policies. A new path must be registered here.
export type RoutePolicy = {
  public?: boolean;
  session?: boolean;
  any?: string[];
  legacy?: boolean;
};
export const routePolicies: Record<string, RoutePolicy> = {
  "phaseOne.configureSchedule": { any: ["p1.certificates.schedule"] },
  "phaseOne.schedulePreview": { any: ["p1.certificates.schedule"] },
  "phaseOne.acceptHandover": { any: ["p1.contracts.handover"] },
  "phaseOne.requestReversal": { any: ["p1.payments.record"] },
  "phaseOne.decideReversal": { any: ["p1.payments.reverse.approve"] },
  "phaseOne.state": {
    any: [
      "p1.projects.view",
      "p1.contracts.view",
      "p1.certificates.view",
      "p1.payments.view",
      "p1.company.view",
    ],
  },
  "phaseOne.createProject": {
    any: ["p1.projects.create"],
  },
  "phaseOne.saveCompany": {
    any: ["p1.company.manage"],
  },
  "phaseOne.createContract": {
    any: ["p1.contracts.create"],
  },
  "phaseOne.correctContract": { any: ["p1.contracts.create"] },
  "phaseOne.paymentPreview": { any: ["p1.payments.record"] },
  "phaseOne.createCertificate": {
    any: ["p1.certificates.create"],
  },
  "phaseOne.decideCertificate": {
    any: ["p1.certificates.approve"],
  },
  "phaseOne.releaseRetention": {
    any: ["p1.retention.release"],
  },
  "phaseOne.recordPayment": {
    any: ["p1.payments.record"],
  },
  "finance.projectOverview": {
    any: ["finance.view"],
    legacy: true,
  },
  "finance.resubmit": {
    any: ["finance.view"],
    legacy: true,
  },
  "finance.closeOrder": {
    any: ["orders.approve"],
    legacy: true,
  },
  "finance.list": {
    any: ["finance.view"],
    legacy: true,
  },
  "finance.orderSummary": {
    any: ["finance.view"],
    legacy: true,
  },
  "finance.invoiceDetail": {
    any: ["finance.view"],
    legacy: true,
  },
  "finance.paymentDetail": {
    any: ["finance.view"],
    legacy: true,
  },
  "finance.certificateDetail": {
    any: ["receiving.view"],
    legacy: true,
  },
  "finance.creditDetail": {
    any: ["finance.view"],
    legacy: true,
  },
  "finance.createInvoice": {
    any: ["finance.create"],
    legacy: true,
  },
  "finance.matchInvoice": {
    any: ["finance.create"],
    legacy: true,
  },
  "finance.cancelInvoice": {
    any: ["finance.create"],
    legacy: true,
  },
  "finance.createSchedule": {
    any: ["finance.create"],
    legacy: true,
  },
  "finance.certify": {
    any: ["receiving.inspect"],
    legacy: true,
  },
  "finance.requestPayment": {
    any: ["payments.create"],
    legacy: true,
  },
  "finance.createCertificate": {
    any: ["receiving.create"],
    legacy: true,
  },
  "finance.createCredit": {
    any: ["finance.create"],
    legacy: true,
  },
  "finance.releaseRetention": {
    any: ["finance.create"],
    legacy: true,
  },
  "finance.decideInvoice": {
    any: ["finance.approve"],
    legacy: true,
  },
  "finance.decidePayment": {
    any: ["payments.approve"],
    legacy: true,
  },
  "finance.decideCertificate": {
    any: ["receiving.inspect"],
    legacy: true,
  },
  "finance.decideCredit": {
    any: ["finance.approve"],
    legacy: true,
  },
  "finance.decideRetention": {
    any: ["finance.approve"],
    legacy: true,
  },
  "workflows.list": {
    any: ["workflows.view"],
    legacy: true,
  },
  "workflows.detail": {
    any: ["workflows.view"],
    legacy: true,
  },
  "workflows.users": {
    any: ["workflows.view"],
    legacy: true,
  },
  "workflows.create": {
    any: ["workflows.manage"],
    legacy: true,
  },
  "workflows.deactivate": {
    any: ["workflows.manage"],
    legacy: true,
  },
  "workflows.delegationList": {
    any: ["workflows.view"],
    legacy: true,
  },
  "workflows.delegate": {
    any: ["workflows.manage"],
    legacy: true,
  },
  "workflows.revoke": {
    any: ["workflows.manage"],
    legacy: true,
  },
  "workflows.history": {
    any: ["approvals.view"],
    legacy: true,
  },
  "procurement.cancelOrder": {
    any: ["orders.create"],
    legacy: true,
  },
  "procurement.list": {
    any: ["procurement.view"],
    legacy: true,
  },
  "procurement.detail": {
    any: ["procurement.view"],
    legacy: true,
  },
  "procurement.suppliers": {
    any: ["procurement.view"],
    legacy: true,
  },
  "procurement.createRequisition": {
    any: ["requests.create"],
    legacy: true,
  },
  "procurement.reviseRequisition": {
    any: ["requests.create"],
    legacy: true,
  },
  "procurement.createRfq": {
    any: ["rfqs.create"],
    legacy: true,
  },
  "procurement.rfqStatus": {
    any: ["rfqs.create"],
    legacy: true,
  },
  "procurement.createQuotation": {
    any: ["quotations.create"],
    legacy: true,
  },
  "procurement.evaluate": {
    any: ["quotations.evaluate"],
    legacy: true,
  },
  "procurement.createAward": {
    any: ["awards.create"],
    legacy: true,
  },
  "procurement.createOrder": {
    any: ["orders.create"],
    legacy: true,
  },
  "procurement.createDirectOrder": {
    any: ["orders.create"],
    legacy: true,
  },
  "procurement.submitRequisition": {
    any: ["requests.submit"],
    legacy: true,
  },
  "procurement.submitAward": {
    any: ["awards.create"],
    legacy: true,
  },
  "procurement.submitOrder": {
    any: ["orders.create"],
    legacy: true,
  },
  "procurement.decideRequisition": {
    any: ["requests.approve"],
    legacy: true,
  },
  "procurement.decideAward": {
    any: ["awards.approve"],
    legacy: true,
  },
  "procurement.decideOrder": {
    any: ["orders.approve"],
    legacy: true,
  },
  "receiving.orderPlan": {
    any: ["receiving.view"],
    legacy: true,
  },
  "receiving.list": {
    any: ["receiving.view"],
    legacy: true,
  },
  "receiving.detail": {
    any: ["receiving.view"],
    legacy: true,
  },
  "receiving.shipment": {
    any: ["receiving.create"],
    legacy: true,
  },
  "receiving.receipt": {
    any: ["receiving.create"],
    legacy: true,
  },
  "receiving.inspect": {
    any: ["receiving.inspect"],
    legacy: true,
  },
  "receiving.return": {
    any: ["receiving.return"],
    legacy: true,
  },
  "receiving.shipmentStatus": {
    any: ["receiving.create"],
    legacy: true,
  },
  "inventory.balances": {
    any: ["inventory.view"],
    legacy: true,
  },
  "inventory.ledger": {
    any: ["inventory.view"],
    legacy: true,
  },
  "inventory.operations": {
    any: ["inventory.view"],
    legacy: true,
  },
  "inventory.detail": {
    any: ["inventory.view"],
    legacy: true,
  },
  "inventory.create": {
    any: ["inventory.operate"],
    legacy: true,
  },
  "inventory.decide": {
    any: ["inventory.approve"],
    legacy: true,
  },
  "projects.progress": {
    any: ["projects.manage"],
    legacy: true,
  },
  "projects.list": {
    any: ["projects.view"],
    legacy: true,
  },
  "projects.detail": {
    any: ["projects.view"],
    legacy: true,
  },
  "projects.users": {
    any: ["projects.view"],
    legacy: true,
  },
  "projects.create": {
    any: ["projects.manage"],
    legacy: true,
  },
  "projects.createWbs": {
    any: ["projects.manage"],
    legacy: true,
  },
  "projects.createBudget": {
    any: ["projects.manage"],
    legacy: true,
  },
  "projects.approveBudget": {
    any: ["budgets.approve"],
    legacy: true,
  },
  "projects.status": {
    any: ["projects.manage"],
    legacy: true,
  },
  "masterData.list": {
    any: ["master.view"],
    legacy: true,
  },
  "masterData.detail": {
    any: ["master.view"],
    legacy: true,
  },
  "masterData.create": {
    any: ["master.manage"],
    legacy: true,
  },
  "masterData.update": {
    any: ["master.manage"],
    legacy: true,
  },
  "auth.firstRunStatus": {
    public: true,
  },
  "auth.bootstrap": {
    public: true,
  },
  "auth.login": {
    public: true,
  },
  "auth.logout": {
    public: true,
  },
  "auth.me": {
    public: true,
  },
  "dashboard.overview": {
    any: ["dashboard.view"],
    legacy: true,
  },
  "reports.options": {
    any: ["reports.export"],
    legacy: true,
  },
  "reports.data": {
    any: ["reports.export"],
    legacy: true,
  },
  "reports.auditExport": {
    any: ["reports.export"],
    legacy: true,
  },
  "permissions.list": {
    any: ["policy.manage"],
  },
  "users.list": {
    any: ["users.view"],
  },
  "users.update": {
    any: ["users.edit"],
  },
  "users.resetPassword": {
    any: ["users.password.reset"],
  },
  "users.setActive": {
    any: ["users.status.manage"],
  },
  "users.permissions": {
    any: ["policy.manage"],
  },
  "users.create": {
    any: ["users.create"],
  },
  "users.setPermissions": {
    any: ["policy.manage"],
  },
  "suppliers.update": {
    any: ["suppliers.edit"],
  },
  "suppliers.list": {
    any: ["suppliers.view"],
  },
  "suppliers.create": {
    any: ["suppliers.create"],
  },
  "purchaseRequests.list": {
    any: ["requests.view"],
    legacy: true,
  },
  "purchaseRequests.history": {
    any: ["requests.view"],
    legacy: true,
  },
  "purchaseRequests.create": {
    any: ["requests.create"],
    legacy: true,
  },
  "purchaseRequests.transition": {
    any: ["requests.submit"],
    legacy: true,
  },
  "contracts.list": {
    any: ["contracts.view"],
    legacy: true,
  },
  "contracts.create": {
    any: ["contracts.create"],
    legacy: true,
  },
  "contracts.amendments.submit": {
    any: ["contracts.amend"],
    legacy: true,
  },
  "contracts.amendments.approve": {
    any: ["contracts.approve"],
    legacy: true,
  },
  "contracts.amendments.list": {
    any: ["contracts.view"],
    legacy: true,
  },
  "contracts.amendments.create": {
    any: ["contracts.amend"],
    legacy: true,
  },
  "contracts.certificates.list": {
    any: ["contracts.view"],
    legacy: true,
  },
  "contracts.certificates.create": {
    any: ["certificates.create"],
    legacy: true,
  },
  "contracts.financial.list": {
    any: ["contracts.view"],
    legacy: true,
  },
  "contracts.financial.create": {
    any: ["financial.create"],
    legacy: true,
  },
  "rfqs.list": {
    any: ["rfqs.view"],
    legacy: true,
  },
  "rfqs.packages.list": {
    any: ["rfqs.view"],
    legacy: true,
  },
  "rfqs.packages.create": {
    any: ["packages.create"],
    legacy: true,
  },
  "rfqs.create": {
    any: ["rfqs.create"],
    legacy: true,
  },
  "rfqs.quotations.list": {
    any: ["rfqs.view"],
    legacy: true,
  },
  "rfqs.quotations.create": {
    any: ["quotations.create"],
    legacy: true,
  },
  "rfqs.awards.list": {
    any: ["rfqs.view"],
    legacy: true,
  },
  "rfqs.awards.create": {
    any: ["awards.create"],
    legacy: true,
  },
  "orders.list": {
    any: ["orders.view"],
    legacy: true,
  },
  "orders.create": {
    any: ["orders.create"],
    legacy: true,
  },
  "deliveries.list": {
    any: ["deliveries.view"],
    legacy: true,
  },
  "deliveries.create": {
    any: ["deliveries.create"],
    legacy: true,
  },
  "documents.list": {
    any: ["documents.view"],
  },
  "documents.upload": {
    any: ["documents.upload"],
  },
  "notifications.list": {
    session: true,
    legacy: true,
  },
  "notifications.markRead": {
    session: true,
    legacy: true,
  },
  "policy.me": {
    session: true,
  },
  "policy.catalog": {
    any: ["policy.view"],
  },
  "policy.user": {
    any: ["policy.manage"],
  },
  "policy.save": {
    any: ["policy.manage"],
  },
  "policy.audit": {
    any: ["policy.view"],
  },
};
