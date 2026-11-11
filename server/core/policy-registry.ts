// Every public or authenticated action must have an explicit policy.
export type RoutePolicy = {
  public?: boolean;
  session?: boolean;
  any?: string[];
};
export const routePolicies: Record<string, RoutePolicy> = {
  "projectManagement.list": { any: ["pm.view"] },
  "projectManagement.directory": { any: ["pm.view"] },
  "projectManagement.detail": { any: ["pm.view"] },
  "projectManagement.save": { any: ["pm.create", "pm.edit"] },
  "projectManagement.action": { any: ["pm.submit", "pm.review", "pm.start"] },
  "projectManagement.saveTask": { any: ["pm.tasks.manage"] },
  "projectManagement.saveEmployee": { any: ["pm.employees.manage"] },
  "projectManagement.saveStatus": { any: ["pm.statuses.manage"] },
  "gantt.projects": { any: ["pm.view"] },
  "gantt.detail": { any: ["pm.view"] },
  "gantt.sharedDirectory": { any: ["pm.view"] },
  "gantt.saveProjectSchedule": { any: ["pm.tasks.manage"] },
  "gantt.saveSharedGroup": { any: ["pm.tasks.manage"] },
  "gantt.saveSettings": { any: ["pm.tasks.manage"] },
  "gantt.saveLink": { any: ["pm.tasks.manage"] },
  "gantt.saveSchedule": { any: ["pm.tasks.manage"] },
  "gantt.captureBaseline": { any: ["pm.tasks.manage"] },
  "gantt.saveStudioState": { any: ["pm.tasks.manage"] },
  "materialRequisitions.directory": { any: ["materialRequisitions.view"] },
  "materialRequisitions.catalogStatus": {
    any: ["materialRequisitions.create"],
  },
  "materialRequisitions.catalogSearch": {
    any: ["materialRequisitions.create"],
  },
  "materialRequisitions.catalogImport": {
    any: ["materialRequisitions.create"],
  },
  "materialRequisitions.allUnits": {
    any: ["materialRequisitions.units.manage"],
  },
  "materialRequisitions.exportApproved": {
    any: ["materialRequisitions.integration"],
  },
  "materialRequisitions.list": { any: ["materialRequisitions.view"] },
  "materialRequisitions.detail": { any: ["materialRequisitions.view"] },
  "materialRequisitions.save": { any: ["materialRequisitions.create"] },
  "materialRequisitions.approve": { any: ["materialRequisitions.approve"] },
  "materialRequisitions.saveUnit": {
    any: ["materialRequisitions.units.manage"],
  },
  "materialRequisitions.updateExternal": {
    any: ["materialRequisitions.integration"],
  },
  "phaseOne.saveInspection": { any: ["p1.inspections.manage"] },
  "phaseOne.enableInspections": { any: ["p1.inspections.manage"] },
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
      "p1.inspections.view",
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
  "users.create": {
    any: ["users.create"],
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
  "documents.list": {
    any: ["documents.view"],
  },
  "documents.upload": {
    any: ["documents.upload"],
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

/** HTTP media endpoints use the same central authorizer as the typed API. */
export const httpRoutePolicies: Record<string, RoutePolicy> = {
  "materialRequisitions.catalogImage": { any: ["materialRequisitions.view"] },
  "materialRequisitions.catalogPreview": {
    any: ["materialRequisitions.create"],
  },
};
