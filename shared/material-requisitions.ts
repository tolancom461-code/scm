import { z } from "zod";
import { dateInput } from "./validation";

const id = z.number().int().positive();
export const materialRequisitionStatuses = ["draft", "approved"] as const;
export const externalRequisitionStatuses = [
  "pending_send",
  "sending",
  "received",
  "purchase_request_created",
  "send_failed",
  "rejected",
] as const;

export const requisitionItemInput = z.object({
  itemName: z.string().trim().min(1).max(255),
  catalogEntryId: id.nullable().default(null),
  catalogCode: z.string().max(255).default(""),
  quantity: z
    .string()
    .trim()
    .regex(/^\d{1,9}(?:\.\d{1,9})?$/, "INVALID_QUANTITY")
    .refine(value => Number(value) > 0, "INVALID_QUANTITY"),
  unitId: id,
  specifications: z.string().trim().max(5000).default(""),
  notes: z.string().trim().max(5000).default(""),
  needDate: dateInput,
});

export const materialRequisitionSaveInput = z.object({
  key: z.string().uuid(),
  id: id.optional(),
  version: z.number().int().nonnegative().default(0),
  projectId: id,
  taskId: id.nullable().default(null),
  expectedSourceStartDate: dateInput.optional(),
  items: z.array(requisitionItemInput).min(1).max(20),
});

export const materialRequisitionListInput = z.object({
  q: z.string().trim().max(150).default(""),
  projectId: z.number().int().nonnegative().default(0),
  taskId: z.number().int().nonnegative().default(0),
  createdBy: z.number().int().nonnegative().default(0),
  linkType: z.enum(["", "project", "main_task", "subtask"]).default(""),
  status: z.enum(["", ...materialRequisitionStatuses]).default(""),
  createdFrom: z.union([z.literal(""), dateInput]).default(""),
  createdTo: z.union([z.literal(""), dateInput]).default(""),
  approvedFrom: z.union([z.literal(""), dateInput]).default(""),
  approvedTo: z.union([z.literal(""), dateInput]).default(""),
  needFrom: z.union([z.literal(""), dateInput]).default(""),
  needTo: z.union([z.literal(""), dateInput]).default(""),
  sort: z
    .enum([
      "created_desc",
      "created_asc",
      "project",
      "need_date",
      "number",
      "status",
      "task_level",
    ])
    .default("created_desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(100),
});

export const materialRequisitionApproveInput = z.object({
  key: z.string().uuid(),
  id,
  version: z.number().int().nonnegative(),
});

export const materialUnitSaveInput = z.object({
  key: z.string().uuid(),
  id: id.optional(),
  version: z.number().int().nonnegative().default(0),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,100}$/),
  nameAr: z.string().trim().min(1).max(100),
  nameEn: z.string().trim().min(1).max(100),
  nameUr: z.string().trim().min(1).max(100),
  active: z.boolean().default(true),
});

export const externalPurchaseRequestUpdateInput = z
  .object({
    key: z.string().uuid(),
    requisitionNumber: z.string().trim().min(1).max(50),
    status: z.enum(externalRequisitionStatuses),
    purchaseRequestNumber: z.string().trim().max(100).nullable().default(null),
    referenceUrl: z
      .string()
      .url()
      .max(700)
      .refine(value => /^https?:\/\//i.test(value))
      .nullable()
      .default(null),
    message: z.string().trim().max(5000).default(""),
  })
  .refine(
    value =>
      value.status !== "purchase_request_created" ||
      Boolean(value.purchaseRequestNumber?.trim()),
    {
      path: ["purchaseRequestNumber"],
      message:
        "رقم طلب الشراء مطلوب / Purchase request number is required / خریداری درخواست نمبر ضروری ہے۔",
    }
  );

export function leadDays(startDate: string, needDate: string) {
  return Math.round(
    (Date.parse(`${startDate}T00:00:00Z`) -
      Date.parse(`${needDate}T00:00:00Z`)) /
      86400000
  );
}

export function dateFromLead(startDate: string, days: number) {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
