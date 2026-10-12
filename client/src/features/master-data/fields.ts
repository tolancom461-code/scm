import type { MasterKind } from "@shared/master-data";
import type { MasterLabel } from "./copy";
export type Field = {
  key: MasterLabel;
  type: "text" | "boolean" | "select" | "reference" | "decimal";
  options?: MasterLabel[];
  reference?: MasterKind;
  optional?: boolean;
  immutable?: boolean;
};
const reference = (
  key: MasterLabel,
  kind: MasterKind,
  optional = false,
  immutable = false
): Field => ({ key, type: "reference", reference: kind, optional, immutable });
const flag = (key: MasterLabel, immutable = false): Field => ({
  key,
  type: "boolean",
  immutable,
});
export const fields: Record<MasterKind, Field[]> = {
  categories: [reference("parentId", "categories", true)],
  units: [
    {
      key: "dimension",
      type: "select",
      options: ["count", "mass", "length", "area", "volume", "time"],
      immutable: true,
    },
  ],
  branches: [{ key: "address", type: "text", optional: true }],
  sites: [
    reference("branchId", "branches"),
    { key: "address", type: "text", optional: true },
  ],
  costCenters: [reference("branchId", "branches")],
  warehouses: [reference("siteId", "sites")],
  locations: [
    reference("warehouseId", "warehouses"),
    {
      key: "type",
      type: "select",
      options: ["receiving", "inspection", "quarantine", "storage"],
    },
  ],
  items: [
    {
      key: "type",
      type: "select",
      options: ["inventory", "consumable", "service", "asset", "non_stock"],
      immutable: true,
    },
    reference("categoryId", "categories"),
    reference("baseUomId", "units", false, true),
    reference("purchasingUomId", "units", false, true),
    { key: "description", type: "text", optional: true },
    { key: "barcode", type: "text", optional: true },
    flag("trackInventory", true),
    flag("inspectionRequired"),
    flag("lotTracking", true),
    flag("serialTracking", true),
    flag("expiryTracking", true),
  ],
  conversions: [
    reference("itemId", "items", false, true),
    reference("fromUomId", "units", false, true),
    reference("toUomId", "units", false, true),
    { key: "factor", type: "decimal", immutable: true },
  ],
};
