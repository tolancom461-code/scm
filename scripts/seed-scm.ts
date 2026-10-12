import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  closeDb,
  createLocalUser,
  listUsers,
  seedPermissions,
} from "../server/db";
import { hashPassword } from "../server/localAuth";
import { create } from "../server/modules/master-data/service";
import { list } from "../server/modules/master-data/repository";
import {
  masterInput,
  masterListInput,
  type MasterInput,
} from "../shared/master-data";

async function main() {
  await seedPermissions();
  let admin = (await listUsers()).find(user => user.role === "admin");
  if (!admin) {
    const username = process.env.ADMIN_USERNAME?.trim().toLowerCase(),
      password = process.env.ADMIN_PASSWORD;
    if (
      !username ||
      !/^[a-z0-9._-]{3,80}$/.test(username) ||
      !password ||
      password.length < 12
    )
      throw new Error(
        "Create an administrator using first-run setup or set ADMIN_USERNAME / ADMIN_PASSWORD."
      );
    const id = await createLocalUser({
      username,
      passwordHash: await hashPassword(password),
      name: "SCM Administrator",
      role: "admin",
      locale: "ar",
    });
    admin = (await listUsers()).find(user => user.id === id);
  }
  if (!admin) throw new Error("No administrator available");
  const actorId = admin.id;
  const named = (
    code: string,
    nameAr: string,
    nameEn: string,
    nameUr: string
  ) => ({ code, nameAr, nameEn, nameUr });
  async function seed(data: MasterInput) {
    const existing = await list(
      masterListInput.parse({
        kind: data.kind,
        search: data.code,
        pageSize: 100,
      })
    );
    const row = existing.records.find(r => r.code === data.code);
    return row?.id ?? (await create(data, actorId, randomUUID())).id;
  }
  const parse = (data: unknown) => masterInput.parse(data);
  const unitData = [
    ["EA", "حبة", "Each", "عدد", "count"],
    ["BOX", "صندوق", "Box", "ڈبہ", "count"],
    ["KG", "كيلوغرام", "Kilogram", "کلوگرام", "mass"],
    ["TON", "طن", "Tonne", "ٹن", "mass"],
    ["M", "متر", "Metre", "میٹر", "length"],
    ["M2", "متر مربع", "Square metre", "مربع میٹر", "area"],
    ["M3", "متر مكعب", "Cubic metre", "مکعب میٹر", "volume"],
    ["L", "لتر", "Litre", "لیٹر", "volume"],
  ];
  const unitIds = new Map<string, number>();
  for (const [code, ar, en, ur, dimension] of unitData)
    unitIds.set(
      code,
      await seed(
        parse({ kind: "units", ...named(code, ar, en, ur), dimension })
      )
    );
  const categoryId = await seed(
    parse({
      kind: "categories",
      ...named("LANDSCAPE", "تنسيق المواقع", "Landscaping", "زمین کی تزئین"),
    })
  );
  const treesId = await seed(
    parse({
      kind: "categories",
      ...named("TREES", "الأشجار", "Trees", "درخت"),
      parentId: categoryId,
    })
  );
  const branchId = await seed(
    parse({
      kind: "branches",
      ...named("RIYADH", "فرع الرياض", "Riyadh Branch", "ریاض شاخ"),
    })
  );
  const siteId = await seed(
    parse({
      kind: "sites",
      ...named(
        "RIYADH-SITE",
        "موقع فرع الرياض",
        "Riyadh Branch Site",
        "ریاض شاخ سائٹ"
      ),
      branchId,
    })
  );
  await seed(
    parse({
      kind: "costCenters",
      ...named(
        "RIYADH-CC",
        "تكاليف فرع الرياض",
        "Riyadh Cost Center",
        "ریاض لاگت مرکز"
      ),
      branchId,
    })
  );
  const warehouseId = await seed(
    parse({
      kind: "warehouses",
      ...named(
        "RIYADH-WH",
        "مستودع فرع الرياض",
        "Riyadh Warehouse",
        "ریاض گودام"
      ),
      siteId,
    })
  );
  for (const [type, ar, en, ur] of [
    ["receiving", "الاستلام", "Receiving", "وصولی"],
    ["inspection", "الفحص", "Inspection", "معائنہ"],
    ["quarantine", "الحجر", "Quarantine", "قرنطینہ"],
    ["storage", "التخزين", "Storage", "ذخیرہ"],
  ])
    await seed(
      parse({
        kind: "locations",
        ...named(`RIYADH-${type.toUpperCase()}`, ar, en, ur),
        warehouseId,
        type,
      })
    );
  await seed(
    parse({
      kind: "items",
      ...named("OLIVE-TREE", "شجرة زيتون", "Olive Tree", "زیتون کا درخت"),
      type: "inventory",
      categoryId: treesId,
      baseUomId: unitIds.get("EA"),
      purchasingUomId: unitIds.get("EA"),
      trackInventory: true,
      inspectionRequired: true,
    })
  );
  const consumableId = await seed(
    parse({
      kind: "items",
      ...named(
        "GARDEN-GLOVES",
        "قفازات زراعة",
        "Garden gloves",
        "باغبانی کے دستانے"
      ),
      type: "consumable",
      categoryId,
      baseUomId: unitIds.get("EA"),
      purchasingUomId: unitIds.get("BOX"),
      trackInventory: true,
    })
  );
  await seed(
    parse({
      kind: "conversions",
      ...named(
        "GLOVES-BOX-EA",
        "صندوق قفازات إلى حبة",
        "Glove box to each",
        "دستانوں کا ڈبہ سے عدد"
      ),
      itemId: consumableId,
      fromUomId: unitIds.get("BOX"),
      toUomId: unitIds.get("EA"),
      factor: "12",
    })
  );
  await seed(
    parse({
      kind: "items",
      ...named(
        "PLANTING",
        "خدمة زراعة الأشجار",
        "Tree planting service",
        "درخت لگانے کی خدمت"
      ),
      type: "service",
      categoryId,
      baseUomId: unitIds.get("EA"),
      purchasingUomId: unitIds.get("EA"),
    })
  );
  console.log(
    "SCM master demo data seeded. Olive transactional scenario will be added with procurement/receiving phases."
  );
}
main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : "Seed failed");
    process.exitCode = 1;
  })
  .finally(closeDb);
