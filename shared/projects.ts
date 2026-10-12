import { z } from "zod";
import { namesInput, moneyInput } from "./workflows";
export const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    v =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v
  );
const date = dateInput;
export const projectInput = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/),
    ...namesInput,
    branchId: z.number().int().positive(),
    managerId: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    startsAt: date.nullable(),
    endsAt: date.nullable(),
  })
  .refine(v => !v.startsAt || !v.endsAt || v.endsAt >= v.startsAt);
export const wbsInput = z
  .object({
    projectId: z.number().int().positive(),
    parentId: z.number().int().positive().nullable(),
    code: z.string().trim().min(1).max(40),
    ...namesInput,
    startsAt: date.nullable(),
    endsAt: date.nullable(),
  })
  .refine(v => !v.startsAt || !v.endsAt || v.endsAt >= v.startsAt);
export const budgetInput = z.object({
  projectId: z.number().int().positive(),
  wbsId: z.number().int().positive(),
  costCenterId: z.number().int().positive(),
  amount: moneyInput,
  replacesId: z.number().int().positive().nullable(),
  reason: z.string().trim().min(3).max(1000),
});
