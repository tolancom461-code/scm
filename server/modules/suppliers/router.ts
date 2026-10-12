import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";

import { requiring } from "../../core/permissions";
import { nextDocumentNumber } from "../../core/numbering";
import { database } from "../../core/database";
import { suppliers } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { DomainError } from "../../core/errors";
import { recordChange } from "../../core/audit";
export const suppliersRouter = router({
  update: requiring("suppliers.edit")
    .input(
      z.object({
        id: z.number().int().positive(),
        nameAr: z.string().trim().min(2).max(255),
        phone: z.string().trim().max(60),
        email: z.string().email().optional(),
        commercialRegistration: z.string().trim().max(100),
        taxNumber: z.string().trim().max(100),
        notes: z.string().trim().max(3000),
      })
    )
    .mutation(({ input, ctx }) =>
      database().then(db =>
        db.transaction(async tx => {
          const { id, ...fields } = input;
          const [before] = await tx
            .select()
            .from(suppliers)
            .where(eq(suppliers.id, id))
            .for("update");
          if (!before) throw new DomainError("NOT_FOUND");
          const after = { ...fields, email: fields.email ?? null };
          await tx.update(suppliers).set(after).where(eq(suppliers.id, id));
          await recordChange(tx, {
            actorId: ctx.user.id,
            action: "supplier.updated",
            entityType: "supplier",
            entityId: id,
            before,
            after,
          });
          return { id };
        })
      )
    ),
  list: requiring("suppliers.view").query(() => db.listSuppliers()),
  create: requiring("suppliers.create")
    .input(
      z.object({
        nameAr: z.string().trim().min(2).max(255),
        nameEn: z.string().trim().max(255).optional(),
        nameUr: z.string().trim().max(255).optional(),
        commercialRegistration: z.string().trim().max(100).optional(),
        taxNumber: z.string().trim().max(100).optional(),
        email: z.string().email().optional(),
        phone: z.string().trim().max(60).optional(),
        country: z.string().trim().max(120).optional(),
        category: z.string().trim().max(120).optional(),
        notes: z.string().trim().max(3000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = await db.createSupplier({
        ...input,
        supplierNumber: await nextDocumentNumber("SUP"),
        createdBy: ctx.user.id,
      });
      await db.createAuditLog(
        ctx.user.id,
        "supplier.create",
        "supplier",
        id ?? null,
        input
      );
      return { id };
    }),
});
