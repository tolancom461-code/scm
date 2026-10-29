import { z } from "zod";
import { dateInput } from "./validation";
import { decimal, formatDecimal } from "./decimal";

const quantity = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/);
export const inspectionInput = z
  .object({
    contractId: z.number().int().positive(),
    itemIndex: z.number().int().nonnegative(),
    inspectionDate: dateInput,
    location: z.string().trim().min(1).max(500),
    description: z.string().trim().min(2).max(2000),
    executed: quantity.refine(q => decimal(q) > 0n),
    accepted: quantity,
    status: z.enum(["pending", "accepted", "accepted_noted", "rejected"]),
    notes: z.string().trim().max(4000).default(""),
    additionalSignatures: z
      .array(
        z.object({
          role: z.string().trim().min(1).max(100),
          name: z.string().trim().min(1).max(150),
        })
      )
      .max(4)
      .default([]),
    previousInspectionId: z.number().int().positive().nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (decimal(v.accepted) > decimal(v.executed))
      ctx.addIssue({
        code: "custom",
        path: ["accepted"],
        message:
          "الكمية المقبولة تتجاوز المنفذة / Accepted quantity exceeds executed",
      });
    if (
      ["pending", "rejected"].includes(v.status) &&
      decimal(v.accepted) !== 0n
    )
      ctx.addIssue({
        code: "custom",
        path: ["accepted"],
        message:
          "الفحص المعلق أو المرفوض لا يعتمد كميات / Pending or rejected inspections accept no quantity",
      });
    if (
      ["accepted", "accepted_noted"].includes(v.status) &&
      decimal(v.accepted) <= 0n
    )
      ctx.addIssue({
        code: "custom",
        path: ["accepted"],
        message: "أدخل الكمية المقبولة / Enter accepted quantity",
      });
    if (["accepted_noted", "rejected"].includes(v.status) && v.notes.length < 3)
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message: "الملاحظات مطلوبة / Notes required",
      });
  });
export const inspectionAllocationInput = z.object({
  inspectionId: z.number().int().positive(),
  quantity: quantity.refine(q => decimal(q) > 0n),
});
export type InspectionAllocation = z.infer<typeof inspectionAllocationInput> & {
  number: string;
  itemIndex: number;
  revision: number;
};

/** Pending and approved certificates reserve accepted quantities; rejection releases them. */
export function inspectionRemaining(
  id: number,
  accepted: string,
  certificates: {
    status: string;
    inspectionAllocations: InspectionAllocation[] | null;
  }[]
) {
  const used = certificates
    .filter(c => c.status !== "rejected")
    .flatMap(c => c.inspectionAllocations ?? [])
    .filter(a => a.inspectionId === id)
    .reduce((n, a) => n + decimal(a.quantity), 0n);
  return formatDecimal(decimal(accepted) - used, 4);
}
