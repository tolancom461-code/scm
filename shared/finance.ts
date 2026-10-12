import { z } from "zod";
import { quantityInput } from "./procurement";
import { dateInput } from "./projects";
import { moneyInput, namesInput } from "./workflows";
const id = z.number().int().positive(),
  percent = z
    .string()
    .regex(/^\d{1,3}(\.\d{1,4})?$/)
    .refine(v => Number(v) <= 100);
export const invoiceInput = z
  .object({
    orderId: id,
    supplierReference: z.string().trim().min(1).max(100),
    invoiceDate: dateInput,
    dueDate: dateInput,
    retentionPercent: percent.default("0"),
    lines: z
      .array(
        z.object({
          orderLineId: id,
          quantity: quantityInput,
          unitPrice: moneyInput,
          discountPercent: percent.default("0"),
          taxPercent: percent.default("0"),
        })
      )
      .min(1)
      .max(100),
  })
  .refine(v => v.dueDate >= v.invoiceDate);
export const scheduleInput = z.object({
  orderId: id,
  milestones: z
    .array(
      z.object({
        ...namesInput,
        percent:percent.refine(v=>Number(v)>0),
        dueDate: dateInput,
        condition: z.enum([
          "advance",
          "accepted",
          "planting",
          "warranty",
          "manual",
        ]),
      })
    )
    .min(1)
    .max(20),
});
export const paymentInput = z.object({
  orderId: id,
  invoiceId: id.nullable(),
  milestoneId: id.nullable(),
  sourceAdvanceId: id.nullable(),
  kind: z.enum(["advance", "invoice", "recovery"]),
  amount: moneyInput,
  reference: z.string().trim().min(3).max(150),
  reason: z.string().trim().min(3).max(2000),
});
export const creditInput = z.object({
  invoiceId: id,
  supplierReference: z.string().trim().min(1).max(100),
  returnId: id.nullable(),
  reason: z.string().trim().min(3).max(2000),
  lines: z
    .array(z.object({ invoiceLineId: id, quantity: quantityInput }))
    .min(1)
    .max(100),
});
export const certificateInput = z.object({
  orderId: id,
  certificateDate: dateInput,
  evidence: z.string().trim().min(3).max(4000),
  lines: z
    .array(z.object({ orderLineId: id, quantity: quantityInput }))
    .min(1)
    .max(100),
});
