import { z } from "zod";
import { ATOMIC_PERMISSIONS } from "./permissions";

const known = new Set<string>(ATOMIC_PERMISSIONS.map(p => p.code));
export function isKnownPermission(code: string) {
  return known.has(code);
}
export function permissionAllowed(
  user: { role: string; permissionCodes: string[]; active?: boolean },
  code: string
) {
  return (
    user.active !== false &&
    known.has(code) &&
    (user.role === "admin" || user.permissionCodes.includes(code))
  );
}
const read = [
  "p1.inspections.view",
  "pm.view",
  "p1.projects.view",
  "p1.contracts.view",
  "p1.certificates.view",
  "suppliers.view",
  "documents.view",
  "p1.print",
];
export const roleTemplates = {
  project_manager: {
    labels: ["مدير المشاريع", "Project manager", "منصوبوں کا مدیر"],
    permissions: ATOMIC_PERMISSIONS.filter(
      p => !["users", "policy", "permissions"].includes(p.module)
    ).map(p => p.code),
    landing: "projectModule",
  },
  preparer: {
    labels: [
      "مسؤول المشاريع والعقود",
      "Projects & contracts officer",
      "منصوبوں اور معاہدوں کا ذمہ دار",
    ],
    permissions: [
      ...read,
      "pm.create",
      "pm.edit",
      "pm.submit",
      "pm.tasks.manage",
      "pm.start",
      "p1.company.view",
      "p1.projects.create",
      "p1.contracts.create",
      "p1.certificates.create",
      "p1.inspections.manage",
      "suppliers.create",
      "suppliers.edit",
      "documents.upload",
    ],
    landing: "contracts",
  },
  approver: {
    labels: [
      "معتمد المستخلصات",
      "Certificate approver",
      "مستخلص کی منظوری دینے والا",
    ],
    permissions: [
      ...read,
      "p1.certificates.approve",
      "p1.certificates.schedule",
      "p1.payments.reverse.approve",
      "p1.contracts.handover",
    ],
    landing: "certificates",
  },
  accountant: {
    labels: ["المحاسب", "Accountant", "اکاؤنٹنٹ"],
    permissions: [
      ...read,
      "p1.payments.view",
      "p1.payments.record",
      "documents.upload",
    ],
    landing: "accounts",
  },
  viewer: {
    labels: ["مراقب / إدارة عليا", "Observer / management", "نگران / انتظامیہ"],
    permissions: [...read, "p1.payments.view"],
    landing: "contracts",
  },
  executive: {
    labels: [
      "الإدارة العليا — اعتماد المشاريع",
      "Management — project approvals",
      "انتظامیہ — منصوبے کی منظوری",
    ],
    permissions: ["pm.view", "pm.review", "documents.view"],
    landing: "projectModule",
  },
  custom: {
    labels: ["صلاحيات مخصصة", "Custom permissions", "مخصوص اجازتیں"],
    permissions: [] as string[],
    landing: "contracts",
  },
} as const;
export type AccessTemplate = keyof typeof roleTemplates;
const dependencies: Record<string, string[]> = {
  "p1.inspections.view": ["p1.contracts.view", "p1.certificates.view"],
  "p1.inspections.manage": ["p1.inspections.view"],
  "pm.create": ["pm.view"],
  "pm.edit": ["pm.view"],
  "pm.submit": ["pm.view"],
  "pm.review": ["pm.view"],
  "pm.start": ["pm.view"],
  "pm.tasks.manage": ["pm.view"],
  "pm.employees.manage": ["pm.view"],
  "pm.statuses.manage": ["pm.view"],
  "p1.certificates.schedule": ["p1.certificates.view"],
  "p1.payments.reverse.approve": ["p1.certificates.view"],
  "p1.contracts.handover": ["p1.certificates.view"],
  "p1.contracts.view": ["p1.projects.view"],
  "p1.certificates.view": ["p1.contracts.view"],
  "p1.projects.create": ["p1.projects.view"],
  "p1.contracts.create": [
    "p1.contracts.view",
    "p1.projects.view",
    "suppliers.view",
  ],
  "p1.certificates.create": [
    "p1.certificates.view",
    "p1.contracts.view",
    "p1.projects.view",
  ],
  "p1.certificates.approve": [
    "p1.certificates.view",
    "p1.contracts.view",
    "p1.projects.view",
  ],
  "p1.payments.view": [
    "p1.certificates.view",
    "p1.contracts.view",
    "p1.projects.view",
  ],
  "p1.payments.record": ["p1.payments.view"],
  "p1.retention.release": ["p1.payments.view"],
  "p1.company.manage": ["p1.company.view"],
  "policy.view": ["users.view", "p1.projects.view"],
  "policy.manage": ["policy.view"],
};
export function completePermissions(codes: readonly string[]) {
  const result = new Set(codes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const code of result)
      for (const required of dependencies[code] ?? [])
        if (!result.has(required)) {
          result.add(required);
          changed = true;
        }
  }
  return [...result];
}
/** Removing a prerequisite also removes actions that cannot work without it. */
export function togglePermission(
  codes: readonly string[],
  code: string,
  enabled: boolean
) {
  if (enabled) return completePermissions([...codes, code]);
  return completePermissions(codes).filter(
    candidate =>
      candidate !== code && !completePermissions([candidate]).includes(code)
  );
}
export const accessProfileInput = z.object({
  userId: z.number().int().positive(),
  version: z.number().int().min(0),
  template: z.enum([
    "project_manager",
    "preparer",
    "approver",
    "accountant",
    "viewer",
    "custom",
    "executive",
  ]),
  permissions: z.array(z.string().refine(isKnownPermission)).max(200),
  allProjects: z.boolean(),
  constructionProjectIds: z
    .array(z.number().int().positive())
    .max(500)
    .default([])
    .transform(v => [...new Set(v)]),
  projectIds: z
    .array(z.number().int().positive())
    .max(500)
    .transform(v => [...new Set(v)]),
});
export type AccessScope = {
  constructionProjectIds?: number[];
  allProjects: boolean;
  projectIds: number[];
  template: AccessTemplate;
  version: number;
};
export function scopeAllows(scope: AccessScope, projectId: number) {
  return scope.allProjects || scope.projectIds.includes(projectId);
}
