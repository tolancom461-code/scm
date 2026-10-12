import { z } from "zod";
import { quantityInput } from "./procurement";
import { dateInput } from "./projects";
import { moneyInput } from "./workflows";
const id = z.number().int().positive(),
  zeroQuantity = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
export const shipmentInput = z
  .object({
    orderId: id,
    carrier: z.string().trim().min(1).max(150),
    trackingNumber: z.string().max(150).default(""),
    shipDate: dateInput,
    expectedArrival: dateInput,
    freight: moneyInput.default("0"),
    insurance: moneyInput.default("0"),
    customs: moneyInput.default("0"),
    lines: z
      .array(z.object({ orderLineId: id, quantity: quantityInput }))
      .min(1)
      .max(100),
  })
  .refine(v => v.expectedArrival >= v.shipDate);
export const receiptInput = z.object({
  orderId: id,
  shipmentId: id.nullable(),
  warehouseId: id,
  receivedAt: z.date(),
  lines: z
    .array(
      z.object({
        orderLineId: id,
        scheduleId: id,
        quantity: quantityInput,
        receivedLocationId: id,
        allocations: z
          .array(
            z.object({
              baseQuantity: quantityInput,
              lotCode: z.string().trim().max(100).nullable(),
              serialCode: z.string().trim().max(100).nullable(),
              expiresAt: dateInput.nullable(),
            })
          )
          .min(1)
          .max(500),
      })
    )
    .min(1)
    .max(100),
});
export const inspectionInput = z.object({
  receiptId: id,
  notes: z.string().trim().min(3).max(2000),
  lines: z
    .array(
      z.object({
        allocationId: id,
        accepted: zeroQuantity,
        rejected: zeroQuantity,
        quarantine: zeroQuantity,
        defects: z.string().max(2000).default(""),
        storageLocationId: id,
        rejectedLocationId: id,
        quarantineLocationId: id,
      })
    )
    .min(1)
    .max(500),
});
export const returnInput = z.object({
  receiptId: id,
  reason: z.string().trim().min(3).max(2000),
  resolution: z.enum(["replacement", "credit"]),
  lines: z
    .array(
      z.object({
        allocationId: id,
        locationId: id,
        quantity: quantityInput,
        sourceStatus: z.enum(["available", "rejected", "quarantine"]),
      })
    )
    .min(1)
    .max(500),
});
