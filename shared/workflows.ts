import { z } from "zod";
export const workflowTypes = [
  "requisition",
  "award",
  "order",
  "contract",
  "amendment",
  "variation",
  "invoice",
  "adjustment",
  "budget",
  "payment",
  "credit",
  "retention",
  "acceptance",
] as const;
export const moneyInput = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/);
export const namesInput = {
  nameAr: z.string().trim().min(1).max(255),
  nameEn: z.string().trim().min(1).max(255),
  nameUr: z.string().trim().min(1).max(255),
};
export const definitionInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9-]{1,39}$/),
  ...namesInput,
  entityType: z.enum(workflowTypes),
  currency: z.string().regex(/^[A-Z]{3}$/),
  department: z.string().trim().min(1).max(100).default("*"),
  minAmount: moneyInput,
  maxAmount: moneyInput.nullable(),
  steps: z
    .array(
      z.object({
        ...namesInput,
        approvers: z
          .array(
            z.object({ userId: z.number().int().positive(), limit: moneyInput })
          )
          .min(1)
          .max(20),
      })
    )
    .min(1)
    .max(12),
});
export const delegationInput = z
  .object({
    fromUserId: z.number().int().positive(),
    toUserId: z.number().int().positive(),
    entityType: z.enum(workflowTypes),
    startsAt: z.date(),
    endsAt: z.date(),
    reason: z.string().trim().min(3).max(1000),
  })
  .refine(v => v.fromUserId !== v.toUserId && v.endsAt > v.startsAt, {
    message: "Invalid delegation",
  });
export const workflowDecisionInput = z.object({
  expectedPosition: z.number().int().positive(),
  id: z.number().int().positive(),
  instanceId: z.number().int().positive(),
  action: z.enum(["approve", "reject", "return"]),
  reason: z.string().trim().min(3).max(1000),
});
