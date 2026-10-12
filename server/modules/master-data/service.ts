import { sql } from "drizzle-orm";
import {
  masterInput,
  type MasterInput,
  type MasterKind,
} from "../../../shared/master-data";
import { decimal } from "../../../shared/decimal";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { once } from "../../core/idempotency";
import { recordChange } from "../../core/audit";
import * as repository from "./repository";

export async function validateReferences(
  tx: Transaction,
  input: MasterInput,
  updatingId?: number
) {
  const active = async (kind: MasterKind, id: number) => {
    const row = await repository.find(tx, kind, id, true);
    if (!row?.active) throw new DomainError("INVALID_REFERENCE");
    return row;
  };
  switch (input.kind) {
    case "categories": {
      if (input.parentId === null) break;
      const seen = new Set<number>(updatingId ? [updatingId] : []);
      let parent: number | null = input.parentId;
      while (parent !== null) {
        if (seen.has(parent)) throw new DomainError("INVALID_REFERENCE");
        seen.add(parent);
        const row = await active("categories", parent);
        parent = "parentId" in row ? row.parentId : null;
      }
      break;
    }
    case "sites":
    case "costCenters":
      await active("branches", input.branchId);
      break;
    case "warehouses":
      await active("sites", input.siteId);
      break;
    case "locations":
      await active("warehouses", input.warehouseId);
      break;
    case "items": {
      await active("categories", input.categoryId);
      const from = await active("units", input.baseUomId),
        to = await active("units", input.purchasingUomId);
      if (
        "dimension" in from &&
        "dimension" in to &&
        from.dimension !== to.dimension
      )
        throw new DomainError("INVALID_REFERENCE");
      // Conversion is item-specific and created AFTER the item. Purchasing services must
      // require an active conversion before ordering in a non-base unit.
      break;
    }
    case "conversions": {
      const item = await active("items", input.itemId);
      const from = await active("units", input.fromUomId),
        to = await active("units", input.toUomId);
      if (
        !("baseUomId" in item) ||
        input.toUomId !== item.baseUomId ||
        input.fromUomId !== item.purchasingUomId
      )
        throw new DomainError("INVALID_REFERENCE");
      if (
        "dimension" in from &&
        "dimension" in to &&
        from.dimension !== to.dimension
      )
        throw new DomainError("INVALID_REFERENCE");
      break;
    }
  }
}
function databaseFailure(error: unknown): never {
  if (error instanceof DomainError) throw error;
  let current: unknown = error;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    if (
      "code" in current &&
      ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
        String(current.code)
      )
    )
      throw new DomainError("CONFLICT");
    if (
      "code" in current &&
      ["ER_NO_REFERENCED_ROW_2", "ER_ROW_IS_REFERENCED_2"].includes(
        String(current.code)
      )
    )
      throw new DomainError("INVALID_REFERENCE");
    current = "cause" in current ? current.cause : null;
  }
  // No raw SQL, parameters, payloads or secrets are logged.
  console.error(
    JSON.stringify({
      event: "master_data.failure",
      errorType: error instanceof Error ? error.name : "unknown",
    })
  );
  throw new DomainError("SERVICE_UNAVAILABLE");
}
async function lockCategoryGraph(tx: Transaction) {
  // A dedicated row lock prevents two concurrent reparent operations forming a cycle.
  await tx.execute(
    sql`INSERT INTO document_sequences (prefix, year, next_value) VALUES ('CATEGORY', 0, 1) ON DUPLICATE KEY UPDATE prefix = prefix`
  );
  await tx.execute(
    sql`SELECT id FROM document_sequences WHERE prefix = 'CATEGORY' AND year = 0 FOR UPDATE`
  );
}
export async function create(input: MasterInput, actorId: number, key: string) {
  input = masterInput.parse(input);
  try {
    return await (
      await database()
    ).transaction(tx =>
      once(tx, actorId, `master.${input.kind}.create`, key, input, async () => {
        if (input.kind === "categories") await lockCategoryGraph(tx);
        await validateReferences(tx, input);
        const [created] = await repository.insert(tx, input);
        if (!created) throw new DomainError("SERVICE_UNAVAILABLE");
        await recordChange(tx, {
          actorId,
          action: "master.create",
          entityType: input.kind,
          entityId: created.id,
          after: input,
        });
        return { id: created.id };
      })
    );
  } catch (error) {
    return databaseFailure(error);
  }
}
export async function update(
  input: MasterInput,
  id: number,
  version: number,
  actorId: number,
  reason: string
) {
  input = masterInput.parse(input);
  try {
    return await (
      await database()
    ).transaction(async tx => {
      if (input.kind === "categories") await lockCategoryGraph(tx);
      const before = await repository.find(tx, input.kind, id, true);
      if (!before) throw new DomainError("NOT_FOUND");
      if (before.version !== version) throw new DomainError("CONFLICT");
      // Unit semantics and item tracking are immutable after creation. Once stock exists,
      // changing these would reinterpret historical quantities. Deactivate/create instead.
      const immutable: Record<string, readonly string[]> = {
        units: ["dimension"],
        conversions: ["itemId", "fromUomId", "toUomId", "factor"],
        items: [
          "type",
          "baseUomId",
          "purchasingUomId",
          "trackInventory",
          "lotTracking",
          "serialTracking",
          "expiryTracking",
        ],
      };
      for (const field of immutable[input.kind] ?? []) {
        const oldValue = Reflect.get(before, field),
          newValue = Reflect.get(input, field);
        if (
          field === "factor"
            ? decimal(String(oldValue)) !== decimal(String(newValue))
            : oldValue !== newValue
        )
          throw new DomainError("INVALID_INPUT");
      }
      await validateReferences(tx, input, id);
      await repository.update(tx, id, version, input);
      await recordChange(tx, {
        actorId,
        action: "master.update",
        entityType: input.kind,
        entityId: id,
        before,
        after: input,
        reason,
      });
      return { id };
    });
  } catch (error) {
    return databaseFailure(error);
  }
}
export async function detail(kind: MasterKind, id: number) {
  return (await database()).transaction(async tx => {
    const record = await repository.find(tx, kind, id);
    if (!record) throw new DomainError("NOT_FOUND");
    return record;
  });
}
