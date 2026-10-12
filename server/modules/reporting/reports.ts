import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";

const reportFiltersSchema = z
  .object({
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    department: z.string().trim().min(1).max(120).optional(),
    supplierId: z.number().int().positive().optional(),
    status: z.string().trim().min(1).max(40).optional(),
  })
  .optional();

import { requiring } from "../../core/permissions";
export const reportsRouter = router({
  options: requiring("reports.export")
    .input(
      z.object({
        module: z.enum([
          "requests",
          "rfqs",
          "contracts",
          "orders",
          "deliveries",
        ]),
      })
    )
    .query(({ input }) => db.getReportFilterOptions(input.module)),
  data: requiring("reports.export")
    .input(
      z.object({
        module: z.enum([
          "requests",
          "rfqs",
          "contracts",
          "orders",
          "deliveries",
        ]),
        filters: reportFiltersSchema,
      })
    )
    .query(({ input }) => db.getReportData(input.module, input.filters)),
  auditExport: requiring("reports.export")
    .input(
      z.object({
        module: z.enum([
          "requests",
          "rfqs",
          "contracts",
          "orders",
          "deliveries",
        ]),
        format: z.enum(["pdf", "excel"]),
        recordCount: z.number().int().nonnegative().max(10000),
        filters: reportFiltersSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      await db.createAuditLog(
        ctx.user.id,
        `report.export.${input.format}`,
        "report",
        null,
        input
      );
      return { success: true } as const;
    }),
});
