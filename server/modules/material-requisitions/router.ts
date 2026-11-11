import { z } from "zod";
import { router } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import {
  externalPurchaseRequestUpdateInput,
  materialRequisitionApproveInput,
  materialRequisitionListInput,
  materialRequisitionSaveInput,
  materialUnitSaveInput,
} from "../../../shared/material-requisitions";
import * as service from "./service";
import * as catalog from "./catalog";

export const materialRequisitionsRouter = router({
  catalogStatus: requiring("materialRequisitions.create").query(() =>
    catalog.catalogStatus()
  ),
  catalogSearch: requiring("materialRequisitions.create")
    .input(
      z.object({
        q: z.string().trim().max(150).default(""),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
        locale: z.enum(["ar", "en", "ur"]).default("ar"),
      })
    )
    .query(({ input, ctx }) => catalog.catalogSearch(input, ctx.access!)),
  catalogImport: requiring("materialRequisitions.create")
    .input(
      z.object({
        locale: z.enum(["ar", "en", "ur"]).default("ar"),
        ids: z
          .array(z.string().min(1).max(160))
          .min(1)
          .max(20)
          .refine(ids => new Set(ids).size === ids.length),
      })
    )
    .mutation(({ input, ctx }) =>
      catalog.catalogImport(input.ids, ctx.access!, input.locale)
    ),
  allUnits: requiring("materialRequisitions.units.manage").query(() =>
    service.allUnits()
  ),
  exportApproved: requiring("materialRequisitions.integration")
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input, ctx }) => service.exportApproved(input.id, ctx.access!)),
  directory: requiring("materialRequisitions.view").query(({ ctx }) =>
    service.directory(ctx.access!)
  ),
  list: requiring("materialRequisitions.view")
    .input(materialRequisitionListInput)
    .query(({ input, ctx }) => service.list(input, ctx.access!)),
  detail: requiring("materialRequisitions.view")
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input, ctx }) => service.detail(input.id, ctx.access!)),
  save: requiring("materialRequisitions.create")
    .input(materialRequisitionSaveInput)
    .mutation(({ input, ctx }) => service.save(input, ctx.access!)),
  approve: requiring("materialRequisitions.approve")
    .input(materialRequisitionApproveInput)
    .mutation(({ input, ctx }) => service.approve(input, ctx.access!)),
  saveUnit: requiring("materialRequisitions.units.manage")
    .input(materialUnitSaveInput)
    .mutation(({ input, ctx }) => service.saveUnit(input, ctx.access!)),
  updateExternal: requiring("materialRequisitions.integration")
    .input(externalPurchaseRequestUpdateInput)
    .mutation(({ input, ctx }) => service.updateExternal(input, ctx.access!)),
});
