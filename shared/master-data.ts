import { z } from "zod";

export const masterKinds = [
  "items",
  "categories",
  "units",
  "conversions",
  "branches",
  "sites",
  "costCenters",
  "warehouses",
  "locations",
] as const;
export type MasterKind = (typeof masterKinds)[number];
const id = z.number().int().positive();
const named = {
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/)
    .transform(v => v.toUpperCase()),
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  nameUr: z.string().trim().min(1).max(200),
  active: z.boolean().default(true),
};
export const masterInput = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("categories"),
      ...named,
      parentId: id.nullable().default(null),
    }),
    z.object({
      kind: z.literal("units"),
      ...named,
      dimension: z.enum(["count", "mass", "length", "area", "volume", "time"]),
    }),
    z.object({
      kind: z.literal("branches"),
      ...named,
      address: z.string().trim().max(2000).nullable().default(null),
    }),
    z.object({
      kind: z.literal("sites"),
      ...named,
      branchId: id,
      address: z.string().trim().max(2000).nullable().default(null),
    }),
    z.object({ kind: z.literal("costCenters"), ...named, branchId: id }),
    z.object({ kind: z.literal("warehouses"), ...named, siteId: id }),
    z.object({
      kind: z.literal("locations"),
      ...named,
      warehouseId: id,
      type: z.enum(["receiving", "inspection", "quarantine", "storage"]),
    }),
    z.object({
      kind: z.literal("items"),
      ...named,
      type: z.enum([
        "inventory",
        "consumable",
        "service",
        "asset",
        "non_stock",
      ]),
      categoryId: id,
      baseUomId: id,
      purchasingUomId: id,
      description: z.string().trim().max(4000).nullable().default(null),
      barcode: z.string().trim().min(1).max(100).nullable().default(null),
      trackInventory: z.boolean().default(false),
      inspectionRequired: z.boolean().default(false),
      lotTracking: z.boolean().default(false),
      serialTracking: z.boolean().default(false),
      expiryTracking: z.boolean().default(false),
    }),
    z.object({
      kind: z.literal("conversions"),
      ...named,
      itemId: id,
      fromUomId: id,
      toUomId: id,
      factor: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/),
    }),
  ])
  .superRefine((input, ctx) => {
    const fail = (path: string) =>
      ctx.addIssue({ code: "custom", path: [path], message: "INVALID_INPUT" });
    if (input.kind === "items") {
      if (input.type === "service" && input.trackInventory)
        fail("trackInventory");
      if (
        !input.trackInventory &&
        (input.lotTracking || input.serialTracking || input.expiryTracking)
      )
        fail("trackInventory");
      if (input.expiryTracking && !input.lotTracking) fail("lotTracking");
    }
    if (input.kind === "conversions") {
      if (input.fromUomId === input.toUomId) fail("toUomId");
      if (/^0+(\.0+)?$/.test(input.factor)) fail("factor");
    }
  });
export type MasterInput = z.infer<typeof masterInput>;
export const masterListInput = z.object({
  kind: z.enum(masterKinds),
  search: z.string().trim().max(100).default(""),
  active: z.boolean().optional(),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  sort: z.enum(["code", "nameAr", "nameEn", "nameUr"]).default("code"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
