import { z } from "zod";
import { and, asc, count, desc, eq, like, or } from "drizzle-orm";
import { router } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import { database } from "../../core/database";
import { DomainError } from "../../core/errors";
import { listInput, idInput, reasonInput } from "../../../shared/list";
import { definitionInput, delegationInput } from "../../../shared/workflows";
import {
  workflowDefinitions as definitions,
  workflowSteps as steps,
  workflowApprovers as approvers,
  workflowInstances as instances,
  workflowDecisions as decisions,
  workflowDelegations as delegations,
} from "../../../drizzle/workflows";
import { users } from "../../../drizzle/schema";
import * as service from "./service";
export const workflowsRouter = router({
  list: requiring("workflows.view")
    .input(listInput)
    .query(async ({ input }) => {
      const db = await database();
      const search = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
      const filter = input.search
        ? or(
            like(definitions.code, search),
            like(definitions.nameAr, search),
            like(definitions.nameEn, search),
            like(definitions.nameUr, search)
          )
        : undefined;
      const records = await db
        .select()
        .from(definitions)
        .where(filter)
        .orderBy(desc(definitions.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await db
        .select({ value: count() })
        .from(definitions)
        .where(filter);
      return { records, total: total.value };
    }),
  detail: requiring("workflows.view")
    .input(idInput)
    .query(async ({ input }) => {
      const db = await database();
      const [definition] = await db
        .select()
        .from(definitions)
        .where(eq(definitions.id, input.id));
      if (!definition) throw new DomainError("NOT_FOUND");
      const ordered = await db
        .select()
        .from(steps)
        .where(eq(steps.definitionId, input.id))
        .orderBy(asc(steps.position));
      return {
        definition,
        steps: await Promise.all(
          ordered.map(async step => ({
            ...step,
            approvers: await db
              .select({
                userId: approvers.userId,
                limit: approvers.limit,
                name: users.name,
                username: users.username,
              })
              .from(approvers)
              .innerJoin(users, eq(approvers.userId, users.id))
              .where(eq(approvers.stepId, step.id)),
          }))
        ),
      };
    }),
  users: requiring("workflows.view")
    .input(listInput)
    .query(async ({ input }) =>
      (await database())
        .select({ id: users.id, name: users.name, username: users.username })
        .from(users)
        .where(
          and(
            eq(users.active, true),
            input.search
              ? or(
                  like(
                    users.name,
                    `%${input.search.replace(/[\\%_]/g, "\\$&")}%`
                  ),
                  like(
                    users.username,
                    `%${input.search.replace(/[\\%_]/g, "\\$&")}%`
                  )
                )
              : undefined
          )
        )
        .orderBy(asc(users.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize)
    ),
  create: requiring("workflows.manage")
    .input(z.object({ data: definitionInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createDefinition(input.data, ctx.user.id, input.key)
    ),
  deactivate: requiring("workflows.manage")
    .input(reasonInput)
    .mutation(({ input, ctx }) =>
      service.deactivateDefinition(input.id, ctx.user.id, input.reason)
    ),
  delegationList: requiring("workflows.view")
    .input(listInput)
    .query(async ({ input }) => {
      const db = await database();
      const records = await db
        .select()
        .from(delegations)
        .orderBy(desc(delegations.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await db.select({ value: count() }).from(delegations);
      return { records, total: total.value };
    }),
  delegate: requiring("workflows.manage")
    .input(z.object({ data: delegationInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.delegate(input.data, ctx.user.id, input.key)
    ),
  revoke: requiring("workflows.manage")
    .input(reasonInput)
    .mutation(({ input, ctx }) =>
      service.revoke(input.id, ctx.user.id, input.reason)
    ),
  history: requiring("approvals.view")
    .input(idInput)
    .query(async ({ input }) => {
      const db = await database();
      const [instance] = await db
        .select()
        .from(instances)
        .where(eq(instances.id, input.id));
      if (!instance) throw new DomainError("NOT_FOUND");
      return {
        instance,
        decisions: await db
          .select({
            decision: decisions,
            name: users.name,
            username: users.username,
          })
          .from(decisions)
          .innerJoin(users, eq(decisions.actorId, users.id))
          .where(eq(decisions.instanceId, input.id))
          .orderBy(asc(decisions.id)),
      };
    }),
});
