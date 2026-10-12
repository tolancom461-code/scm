import { z } from "zod";
import { dateInput } from "./projects";
import { moneyInput } from "./workflows";
const id = z.number().int().positive();
export const quantityInput = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,6})?$/)
  .refine(v => Number(v) > 0);
const percent = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/)
  .refine(v => Number(v) <= 100);
export const requisitionInput = z.object({
  title: z.string().trim().min(3).max(255),
  department: z.string().trim().min(1).max(100),
  branchId: id,
  currency: z.string().regex(/^[A-Z]{3}$/),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  requiredDate: dateInput,
  reason: z.string().trim().min(3).max(2000),
  lines: z
    .array(
      z.object({
        itemId: id,
        description: z.string().trim().min(1).max(2000),
        specification: z.string().trim().max(2000).default(""),
        quantity: quantityInput,
        uomId: id,
        unitPrice: moneyInput,
        requiredDate: dateInput,
        siteId: id,
        warehouseId: id,
        projectId: id,
        wbsId: id,
        costCenterId: id,
        budgetId: id,
      })
    )
    .min(1)
    .max(100),
});
export const rfqInput = z
  .object({
    title: z.string().trim().min(3).max(255),
    currency: z.string().regex(/^[A-Z]{3}$/),
    opensAt: dateInput,
    closesAt: dateInput,
    terms: z.string().trim().min(3).max(4000),
    supplierIds: z.array(id).min(1).max(50),
    lines: z
      .array(z.object({ requisitionLineId: id, quantity: quantityInput }))
      .min(1)
      .max(100),
  })
  .refine(v => v.closesAt >= v.opensAt);
export const quotationInput = z.object({
  rfqId: id,
  supplierId: id,
  supplierReference: z.string().trim().min(1).max(100),
  validUntil: dateInput,
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentTerms: z.string().trim().min(1).max(2000),
  deliveryTerms: z.string().trim().min(1).max(2000),
  lines: z
    .array(
      z.object({
        rfqLineId: id,
        quantity: quantityInput,
        unitPrice: moneyInput,
        discountPercent: percent.default("0"),
        taxPercent: percent.default("0"),
        brand: z.string().max(100).default(""),
        model: z.string().max(100).default(""),
        deliveryDays: z.number().int().min(0).max(3650),
        warranty: z.string().max(2000).default(""),
        notes: z.string().max(2000).default(""),
      })
    )
    .min(1)
    .max(100),
});
export const evaluationInput = z.object({
  quotationId: id,
  technical: z.number().int().min(0).max(100),
  commercial: z.number().int().min(0).max(100),
  delivery: z.number().int().min(0).max(100),
  eligible: z.enum(["yes", "no"]),
  reason: z.string().trim().min(3).max(2000),
});
export const awardInput = z.object({
  rfqId: id,
  department: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(3).max(2000),
  lines: z
    .array(z.object({ quotationLineId: id, quantity: quantityInput }))
    .min(1)
    .max(100),
});
export const orderInput = z.object({
  supplierId: id,
  department: z.string().trim().min(1).max(100),
  paymentTerms: z.string().trim().min(1).max(2000),
  deliveryTerms: z.string().trim().min(1).max(2000),
  lines: z
    .array(
      z.object({
        awardLineId: id,
        quantity: quantityInput,
        schedules: z
          .array(
            z.object({
              quantity: quantityInput,
              dueDate: dateInput,
              warehouseId: id,
              siteId: id,
            })
          )
          .min(1)
          .max(20),
      })
    )
    .min(1)
    .max(100),
});
export const procurementKinds = [
  "requisitions",
  "rfqs",
  "quotations",
  "awards",
  "orders",
] as const;
export type ProcurementKind = (typeof procurementKinds)[number];
export const directOrderInput = requisitionInput.extend({
  supplierId: id,
  execution: z.enum(["goods", "works"]),
  contractReference: z.string().trim().max(100).default(""),
  paymentTerms: z.string().trim().min(1).max(2000),
  deliveryTerms: z.string().trim().min(1).max(2000),
  lines: z.array(requisitionInput.shape.lines.element.extend({ discountPercent: percent.default("0"), taxPercent: percent.default("0") })).min(1).max(100),
});
