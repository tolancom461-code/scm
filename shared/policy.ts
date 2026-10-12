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
export const legacyPhaseAliases: Record<string, string[]> = {
  "contracts.view": [
    "p1.projects.view",
    "p1.contracts.view",
    "p1.certificates.view",
    "p1.print",
  ],
  "contracts.create": ["p1.contracts.create"],
  "certificates.create": ["p1.certificates.create"],
  "certificates.approve": ["p1.certificates.approve"],
  "finance.view": [
    "p1.projects.view",
    "p1.contracts.view",
    "p1.certificates.view",
    "p1.payments.view",
  ],
  "financial.create": ["p1.payments.record"],
  "finance.approve": ["p1.retention.release"],
  "master.view": ["p1.company.view", "p1.projects.view"],
  "master.manage": ["p1.company.manage"],
  "projects.manage": ["p1.projects.create"],
  "permissions.manage": ["policy.view", "policy.manage"],
};
/** Compatibility is applied when importing legacy grants, not on every authorization. */
export function importLegacyPermissions(codes: readonly string[]) {
  return [
    ...new Set(
      codes.flatMap(code => [code, ...(legacyPhaseAliases[code] ?? [])])
    ),
  ];
}
const read = [
  "p1.projects.view",
  "p1.contracts.view",
  "p1.certificates.view",
  "suppliers.view",
  "documents.view",
  "p1.print",
];
export const roleTemplates = {
  preparer: {
    labels: [
      "مسؤول المشاريع والعقود",
      "Projects & contracts officer",
      "منصوبوں اور معاہدوں کا ذمہ دار",
    ],
    permissions: [
      ...read,
      "p1.company.view",
      "p1.projects.create",
      "p1.contracts.create",
      "p1.certificates.create",
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
  custom: {
    labels: ["صلاحيات مخصصة", "Custom permissions", "مخصوص اجازتیں"],
    permissions: [] as string[],
    landing: "contracts",
  },
} as const;
export type AccessTemplate = keyof typeof roleTemplates;
const dependencies: Record<string, string[]> = {
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
  template: z.enum(["preparer", "approver", "accountant", "viewer", "custom"]),
  permissions: z.array(z.string().refine(isKnownPermission)).max(200),
  allProjects: z.boolean(),
  projectIds: z
    .array(z.number().int().positive())
    .max(500)
    .transform(v => [...new Set(v)]),
  legacyAccess: z.boolean(),
});
export type AccessScope = {
  allProjects: boolean;
  projectIds: number[];
  legacyAccess: boolean;
  template: AccessTemplate;
  version: number;
};
export function scopeAllows(scope: AccessScope, projectId: number) {
  return scope.allProjects || scope.projectIds.includes(projectId);
}
