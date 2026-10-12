import { z } from "zod";
import { and, asc, count, eq, like, or,sql } from "drizzle-orm";
import { router } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import { database } from "../../core/database";
import { DomainError } from "../../core/errors";
import { listInput, idInput, reasonInput } from "../../../shared/list";
import {
  requisitionInput,
  rfqInput,
  quotationInput,
  evaluationInput,
  awardInput,
  orderInput,
  directOrderInput,
  procurementKinds,
} from "../../../shared/procurement";
import { workflowDecisionInput } from "../../../shared/workflows";
import * as schema from "../../../drizzle/procurement";
import { suppliers } from "../../../drizzle/schema";
import { items } from "../../../drizzle/master-data";
import * as service from "./scm-service";
const tables = {
  requisitions: schema.requisitions,
  rfqs: schema.sourcingRfqs,
  quotations: schema.supplierQuotations,
  awards: schema.sourcingAwards,
  orders: schema.orders,
};
export const procurementRouter = router({
  cancelOrder:requiring("orders.create").input(reasonInput).mutation(({input,ctx})=>service.cancelOrder(input.id,ctx.user.id,input.reason)),
  list: requiring("procurement.view")
    .input(
      listInput.extend({
        kind: z.enum(procurementKinds),
        status: z.string().max(30).optional(),
        projectId:z.number().int().positive().optional(),
        execution:z.enum(["goods","works"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await database(),
        table = tables[input.kind],
        q = "%" + input.search.replace(/[\\%_]/g, "\\$&") + "%";
      const filter = and(
        input.search ? (input.kind==="orders"?or(like(table.number,q),like(schema.orders.title,q),like(schema.orders.contractReference,q)):like(table.number,q)) : undefined,
        input.status ? eq(table.status, input.status as "draft") : undefined,
        input.kind==="orders"&&input.projectId?sql`EXISTS (SELECT 1 FROM ${schema.orderLines} WHERE ${schema.orderLines.orderId}=${schema.orders.id} AND ${schema.orderLines.projectId}=${input.projectId})`:undefined,
        input.kind==="orders"&&input.execution?eq(schema.orders.execution,input.execution):undefined
      );
      const records = await db
        .select({
          id: table.id,
          number: table.number,
          title:input.kind==="orders"?schema.orders.title:sql<string>`''`,
          status: table.status,
          currency: table.currency,
          createdBy: table.createdBy,
          createdAt: table.createdAt,
        })
        .from(table)
        .where(filter)
        .orderBy(asc(table.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await db
        .select({ value: count() })
        .from(table)
        .where(filter);
      return { records, total: total.value };
    }),
  detail: requiring("procurement.view")
    .input(idInput.extend({ kind: z.enum(procurementKinds) }))
    .query(async ({ input }) => {
      const db = await database();
      switch (input.kind) {
        case "requisitions": {
          const [header] = await db
            .select()
            .from(schema.requisitions)
            .where(eq(schema.requisitions.id, input.id));
          if (!header) throw new DomainError("NOT_FOUND");
          const lines = await db
            .select({ line: schema.requisitionLines, item: items })
            .from(schema.requisitionLines)
            .innerJoin(items, eq(schema.requisitionLines.itemId, items.id))
            .where(eq(schema.requisitionLines.requisitionId, input.id))
            .orderBy(asc(schema.requisitionLines.position));
          return { kind: "requisitions" as const, header, lines };
        }
        case "rfqs": {
          const [header] = await db
            .select()
            .from(schema.sourcingRfqs)
            .where(eq(schema.sourcingRfqs.id, input.id));
          if (!header) throw new DomainError("NOT_FOUND");
          const lines = await db
            .select({
              line: schema.rfqLines,
              source: schema.requisitionLines,
              item: items,
            })
            .from(schema.rfqLines)
            .innerJoin(
              schema.requisitionLines,
              eq(schema.rfqLines.requisitionLineId, schema.requisitionLines.id)
            )
            .innerJoin(items, eq(schema.requisitionLines.itemId, items.id))
            .where(eq(schema.rfqLines.rfqId, input.id));
          const invited = await db
            .select({
              supplierId: suppliers.id,
              nameAr: suppliers.nameAr,
              nameEn: suppliers.nameEn,
              nameUr: suppliers.nameUr,
            })
            .from(schema.rfqSuppliers)
            .innerJoin(
              suppliers,
              eq(schema.rfqSuppliers.supplierId, suppliers.id)
            )
            .where(eq(schema.rfqSuppliers.rfqId, input.id));
          return { kind: "rfqs" as const, header, lines, invited };
        }
        case "quotations": {
          const [header] = await db
            .select()
            .from(schema.supplierQuotations)
            .where(eq(schema.supplierQuotations.id, input.id));
          if (!header) throw new DomainError("NOT_FOUND");
          const lines = await db
            .select()
            .from(schema.quotationLines)
            .where(eq(schema.quotationLines.quotationId, input.id));
          const [evaluation] = await db
            .select()
            .from(schema.quotationEvaluations)
            .where(eq(schema.quotationEvaluations.quotationId, input.id));
          return {
            kind: "quotations" as const,
            header,
            lines,
            evaluation: evaluation ?? null,
          };
        }
        case "awards": {
          const [header] = await db
            .select()
            .from(schema.sourcingAwards)
            .where(eq(schema.sourcingAwards.id, input.id));
          if (!header) throw new DomainError("NOT_FOUND");
          const lines = await db
            .select({
              line: schema.awardLines,
              quotationLine: schema.quotationLines,
              quotation: schema.supplierQuotations,
            })
            .from(schema.awardLines)
            .innerJoin(
              schema.quotationLines,
              eq(schema.awardLines.quotationLineId, schema.quotationLines.id)
            )
            .innerJoin(
              schema.supplierQuotations,
              eq(
                schema.quotationLines.quotationId,
                schema.supplierQuotations.id
              )
            )
            .where(eq(schema.awardLines.awardId, input.id));
          return { kind: "awards" as const, header, lines };
        }
        case "orders": {
          const [header] = await db
            .select()
            .from(schema.orders)
            .where(eq(schema.orders.id, input.id));
          if (!header) throw new DomainError("NOT_FOUND");
          const lines = await db
            .select({
              line: schema.orderLines,
              item: items,
              award: schema.sourcingAwards,
              quotation: schema.supplierQuotations,
              rfq: schema.sourcingRfqs,
              requisition: schema.requisitions,
            })
            .from(schema.orderLines)
            .innerJoin(items, eq(schema.orderLines.itemId, items.id))
            .leftJoin(
              schema.awardLines,
              eq(schema.orderLines.awardLineId, schema.awardLines.id)
            )
            .leftJoin(
              schema.sourcingAwards,
              eq(schema.awardLines.awardId, schema.sourcingAwards.id)
            )
            .leftJoin(
              schema.quotationLines,
              eq(schema.awardLines.quotationLineId, schema.quotationLines.id)
            )
            .leftJoin(
              schema.supplierQuotations,
              eq(
                schema.quotationLines.quotationId,
                schema.supplierQuotations.id
              )
            )
            .leftJoin(
              schema.rfqLines,
              eq(schema.quotationLines.rfqLineId, schema.rfqLines.id)
            )
            .leftJoin(
              schema.sourcingRfqs,
              eq(schema.rfqLines.rfqId, schema.sourcingRfqs.id)
            )
            .leftJoin(
              schema.requisitionLines,
              eq(schema.rfqLines.requisitionLineId, schema.requisitionLines.id)
            )
            .leftJoin(
              schema.requisitions,
              eq(schema.requisitionLines.requisitionId, schema.requisitions.id)
            )
            .where(eq(schema.orderLines.orderId, input.id));
          const schedules = await db
            .select({ schedule: schema.orderSchedules })
            .from(schema.orderSchedules)
            .innerJoin(
              schema.orderLines,
              eq(schema.orderSchedules.orderLineId, schema.orderLines.id)
            )
            .where(eq(schema.orderLines.orderId, input.id));
          return { kind: "orders" as const, header, lines, schedules };
        }
      }
    }),
  suppliers: requiring("procurement.view")
    .input(listInput)
    .query(async ({ input }) => {
      const db = await database(),
        q = "%" + input.search.replace(/[\\%_]/g, "\\$&") + "%";
      return db
        .select({
          id: suppliers.id,
          code: suppliers.supplierNumber,
          nameAr: suppliers.nameAr,
          nameEn: suppliers.nameEn,
          nameUr: suppliers.nameUr,
        })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.status, "active"),
            input.search
              ? or(
                  like(suppliers.nameAr, q),
                  like(suppliers.nameEn, q),
                  like(suppliers.supplierNumber, q)
                )
              : undefined
          )
        )
        .orderBy(asc(suppliers.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
    }),
  createRequisition: requiring("requests.create")
    .input(z.object({ data: requisitionInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createRequisition(input.data, ctx.user.id, input.key)
    ),
  reviseRequisition: requiring("requests.create")
    .input(
      reasonInput.extend({
        data: requisitionInput,
        version: z.number().int().positive(),
      })
    )
    .mutation(({ input, ctx }) =>
      service.reviseRequisition(
        input.id,
        input.data,
        input.version,
        ctx.user.id,
        input.reason
      )
    ),
  createRfq: requiring("rfqs.create")
    .input(z.object({ data: rfqInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createRfq(input.data, ctx.user.id, input.key)
    ),
  rfqStatus: requiring("rfqs.create")
    .input(
      reasonInput.extend({ status: z.enum(["open", "closed", "cancelled"]) })
    )
    .mutation(({ input, ctx }) =>
      service.rfqStatus(input.id, input.status, ctx.user.id, input.reason)
    ),
  createQuotation: requiring("quotations.create")
    .input(z.object({ data: quotationInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createQuotation(input.data, ctx.user.id, input.key)
    ),
  evaluate: requiring("quotations.evaluate")
    .input(evaluationInput)
    .mutation(({ input, ctx }) => service.evaluate(input, ctx.user.id)),
  createAward: requiring("awards.create")
    .input(z.object({ data: awardInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createAward(input.data, ctx.user.id, input.key)
    ),
  createOrder: requiring("orders.create")
    .input(z.object({ data: orderInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createOrder(input.data, ctx.user.id, input.key)
    ),
  createDirectOrder: requiring("orders.create").input(z.object({data:directOrderInput,key:z.string().uuid()})).mutation(({input,ctx})=>service.createDirectOrder(input.data,ctx.user.id,input.key)),
  submitRequisition: requiring("requests.submit")
    .input(idInput)
    .mutation(({ input, ctx }) =>
      service.submit("requisition", input.id, ctx.user.id)
    ),
  submitAward: requiring("awards.create")
    .input(idInput)
    .mutation(({ input, ctx }) =>
      service.submit("award", input.id, ctx.user.id)
    ),
  submitOrder: requiring("orders.create")
    .input(idInput)
    .mutation(({ input, ctx }) =>
      service.submit("order", input.id, ctx.user.id)
    ),
  decideRequisition: requiring("requests.approve")
    .input(workflowDecisionInput)
    .mutation(({ input, ctx }) =>
      service.decide(
        "requisition",
        input.id,
        input.instanceId,
        ctx.user.id,
        input.action,
        input.reason,
        input.expectedPosition
      )
    ),
  decideAward: requiring("awards.approve")
    .input(workflowDecisionInput)
    .mutation(({ input, ctx }) =>
      service.decide(
        "award",
        input.id,
        input.instanceId,
        ctx.user.id,
        input.action,
        input.reason,
        input.expectedPosition
      )
    ),
  decideOrder: requiring("orders.approve")
    .input(workflowDecisionInput)
    .mutation(({ input, ctx }) =>
      service.decide(
        "order",
        input.id,
        input.instanceId,
        ctx.user.id,
        input.action,
        input.reason,
        input.expectedPosition
      )
    ),
});

