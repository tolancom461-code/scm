import { z } from "zod";
import { quantityInput } from "./procurement";
import { moneyInput } from "./workflows";
const id = z.number().int().positive();
export const stockOperationInput = z.object({
  type: z.enum([
    "issue",
    "transfer",
    "reserve",
    "release",
    "adjustment",
    "count",
  ]),
  projectId: id.nullable(),
  wbsId: id.nullable(),
  reason: z.string().trim().min(3).max(2000),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("SAR"),
  department: z.string().trim().min(1).max(100),
  lines: z
    .array(
      z.object({
        itemId: id,
        batchId: id,
        fromLocationId: id,
        toLocationId: id.nullable(),
        quantity: z.string().regex(/^-?\d{1,12}(\.\d{1,6})?$/),
        countedQuantity: z
          .string()
          .regex(/^\d{1,12}(\.\d{1,6})?$/)
          .nullable(),
        balanceVersion: z.number().int().positive().nullable(),
        reservationLineId: id.nullable(),
        unitCost: moneyInput.nullable(),
      })
    )
    .min(1)
    .max(100),
});
