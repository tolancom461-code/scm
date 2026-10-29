import { z } from "zod";
import { dateInput } from "./validation";
import { decimal, formatDecimal, multiply, roundedDivide } from "./decimal";
import { inspectionAllocationInput } from "./inspections";

const id = z.number().int().positive();
export const contractCorrectionInput = z
  .object({
    id,
    revision: z.number().int().nonnegative(),
    action: z.enum(["terms", "cancel", "restore"]),
    terms: z.string().trim().max(6000).optional(),
    reason: z.string().trim().min(3).max(2000),
  })
  .refine(v => v.action !== "terms" || v.terms !== undefined);
export const phaseMoney = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const qty = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/);
const percent = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/)
  .refine(v => Number(v) <= 100);
export const installmentInput = z.object({
  name: z.string().trim().min(2).max(150),
  percent: percent.refine(v => decimal(v) > 0n),
  dueDate: dateInput,
});
export const installmentPlan = z
  .array(installmentInput)
  .min(1)
  .max(20)
  .refine(
    rows => rows.reduce((n, r) => n + decimal(r.percent), 0n) === decimal("100")
  )
  .refine(rows =>
    rows.every((r, i) => i === 0 || r.dueDate >= rows[i - 1].dueDate)
  );
export const certificateScheduleInput = z.object({
  id,
  version: z.number().int().nonnegative(),
  installments: installmentPlan,
  assignments: z.array(z.object({ paymentId: id, position: id })).max(1000),
  reason: z.string().trim().min(3).max(2000),
});
export const handoverInput = z.object({
  id,
  revision: z.number().int().nonnegative(),
  handoverDate: dateInput,
  reason: z.string().trim().min(3).max(2000),
});
export const projectInput = z.object({
  name: z.string().trim().min(2).max(255),
  site: z.string().trim().max(255).default(""),
});
export const companyInput = z.object({
  name: z.string().trim().min(2).max(255),
  address: z.string().trim().max(500).default(""),
  registration: z.string().trim().max(100).default(""),
  taxNumber: z.string().trim().max(100).default(""),
  representative: z.string().trim().max(255).default(""),
  logo: z
    .string()
    .max(350000)
    .regex(/^(|data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+)$/)
    .default(""),
});
export const simpleContractInput = z
  .object({
    projectId: id,
    supplierId: id,
    inspectionRequired: z.boolean().default(true),
    title: z.string().trim().min(2).max(255),
    reference: z.string().trim().max(100).default(""),
    contractDate: dateInput,
    siteDate: dateInput,
    durationDays: z.number().int().min(1).max(3650),
    warrantyDays: z.number().int().min(0).max(73050).default(0),
    scope: z.string().trim().max(6000).default(""),
    terms: z.string().trim().max(6000).default(""),
    retentionPercent: percent.default("0"),
    taxPercent: percent.default("0"),
    dailyPenalty: phaseMoney.default("0"),
    items: z
      .array(
        z.object({
          description: z.string().trim().min(2).max(500),
          unit: z.string().trim().min(1).max(30),
          quantity: qty.refine(v => Number(v) > 0),
          unitPrice: phaseMoney.refine(v => Number(v) > 0),
        })
      )
      .min(1)
      .max(50),
    milestones: z
      .array(
        z.object({
          name: z.string().trim().min(2).max(150),
          percent: percent.refine(v => Number(v) > 0),
          dueDate: dateInput,
          minProgress: percent,
        })
      )
      .min(1)
      .max(20),
  })
  .refine(v => v.siteDate >= v.contractDate, {
    path: ["siteDate"],
    message: "Site date precedes contract date",
  })
  .refine(
    v =>
      v.milestones.reduce((s, m) => s + decimal(m.percent), 0n) ===
      decimal("100"),
    { path: ["milestones"], message: "Payment percentages must total 100" }
  );
export type ContractItem = z.infer<typeof simpleContractInput>["items"][number];
export const simpleCertificateInput = z
  .object({
    contractId: id,
    certificateDate: dateInput,
    inspectionAllocations: z
      .array(inspectionAllocationInput)
      .max(200)
      .default([]),
    mode: z.enum(["percent", "quantity"]),
    progress: percent.default("0"),
    quantities: z.array(qty).max(50).default([]),
    delayDays: z.number().int().min(0).max(3650).default(0),
    otherDeduction: phaseMoney.default("0"),
    deductionReason: z.string().trim().max(2000).default(""),
    notes: z.string().trim().max(4000).default(""),
    installments: installmentPlan.optional(),
  })
  .refine(
    v => Number(v.otherDeduction) === 0 || v.deductionReason.length >= 3,
    { path: ["deductionReason"] }
  );
export const simplePaymentInput = z.object({
  contractId: id,
  certificateId: id,
  milestoneId: id.nullable(),
  installmentId: id.nullable().default(null),
  replacesPaymentId: id.nullable().default(null),
  kind: z.enum(["normal", "retention"]),
  amount: phaseMoney.refine(v => Number(v) > 0),
  paymentDate: dateInput,
  voucher: z.string().trim().min(1).max(100),
  notes: z.string().trim().max(2000).default(""),
});
export function percentOf(amount: string, value: string) {
  return formatDecimal(
    roundedDivide(multiply(decimal(amount), decimal(value)), 100n)
  );
}
export function totalItems(items: ContractItem[]) {
  return formatDecimal(
    items.reduce(
      (sum, i) =>
        sum +
        decimal(
          formatDecimal(multiply(decimal(i.quantity), decimal(i.unitPrice)))
        ),
      0n
    )
  );
}
export function calculateSimpleCertificate(input: {
  items: ContractItem[];
  quantities: string[];
  previousQuantities: string[];
  retentionPercent: string;
  taxPercent: string;
  dailyPenalty: string;
  delayDays: number;
  previousDelayDays: number;
  previousPenalty: string;
  otherDeduction: string;
}) {
  const { items, quantities, previousQuantities } = input;
  if (
    quantities.length !== items.length ||
    previousQuantities.length !== items.length ||
    input.delayDays < input.previousDelayDays
  )
    throw new Error("INVALID_INPUT");
  let cumulative = 0n,
    previous = 0n;
  for (let i = 0; i < items.length; i++) {
    const q = decimal(quantities[i]),
      p = decimal(previousQuantities[i]);
    if (q < p || q > decimal(items[i].quantity))
      throw new Error("QUANTITY_EXCEEDED");
    cumulative += decimal(
      formatDecimal(multiply(q, decimal(items[i].unitPrice)))
    );
    previous += decimal(
      formatDecimal(multiply(p, decimal(items[i].unitPrice)))
    );
  }
  const gross = cumulative - previous;
  if (gross <= 0n) throw new Error("INVALID_INPUT");
  const grossText = formatDecimal(gross),
    retention = formatDecimal(
      decimal(percentOf(formatDecimal(cumulative), input.retentionPercent)) -
        decimal(percentOf(formatDecimal(previous), input.retentionPercent))
    ),
    tax = formatDecimal(
      decimal(percentOf(formatDecimal(cumulative), input.taxPercent)) -
        decimal(percentOf(formatDecimal(previous), input.taxPercent))
    );
  const cumulativePenalty = decimal(
    formatDecimal(
      multiply(decimal(String(input.delayDays)), decimal(input.dailyPenalty))
    )
  );
  const penalty = cumulativePenalty - decimal(input.previousPenalty);
  if (penalty < 0n) throw new Error("INVALID_INPUT");
  const net =
    gross +
    decimal(tax) -
    decimal(retention) -
    penalty -
    decimal(input.otherDeduction);
  if (net < 0n) throw new Error("INVALID_INPUT");
  return {
    cumulativeGross: formatDecimal(cumulative),
    previousGross: formatDecimal(previous),
    gross: grossText,
    retention,
    tax,
    penalty: formatDecimal(penalty),
    net: formatDecimal(net),
    progress: formatDecimal(
      roundedDivide(cumulative * decimal("100"), decimal(totalItems(items))),
      4
    ),
  };
}
export function voucherKey(voucher: string, paymentDate: string) {
  return (
    paymentDate.slice(0, 4) +
    ":" +
    voucher
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleUpperCase("en-US")
  );
}
