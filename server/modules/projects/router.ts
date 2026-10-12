import { z } from "zod";
import { asc, count, eq, like, or, and } from "drizzle-orm";
import { router } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import { database } from "../../core/database";
import { projectInput, wbsInput, budgetInput } from "../../../shared/projects";
import { listInput, idInput, reasonInput } from "../../../shared/list";
import { projects } from "../../../drizzle/projects";
import { users } from "../../../drizzle/schema";
import * as service from "./service";
export const projectsRouter = router({
  progress:requiring("projects.manage").input(reasonInput.extend({version:z.number().int().min(0).max(100),progress:z.number().int().min(0).max(100)})).mutation(({input,ctx})=>service.progress(input.id,input.version,input.progress,ctx.user.id,input.reason)),
  list: requiring("projects.view")
    .input(listInput)
    .query(async ({ input }) => {
      const db = await database();
      const q = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
      const filter = input.search
        ? or(
            ...[
              projects.code,
              projects.nameAr,
              projects.nameEn,
              projects.nameUr,
            ].map(c => like(c, q))
          )
        : undefined;
      const records = await db
        .select()
        .from(projects)
        .where(filter)
        .orderBy(asc(projects.code))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await db
        .select({ value: count() })
        .from(projects)
        .where(filter);
      return { records, total: total.value };
    }),
  detail: requiring("projects.view")
    .input(idInput)
    .query(({ input }) => service.detail(input.id)),
  users: requiring("projects.view")
    .input(listInput)
    .query(async ({ input }) =>
      (await database())
        .select({ id: users.id, name: users.name, username: users.username })
        .from(users)
        .where(
          and(
            eq(users.active, true),
            input.search
              ? like(users.name, `%${input.search.replace(/[\\%_]/g, "\\$&")}%`)
              : undefined
          )
        )
        .orderBy(asc(users.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize)
    ),
  create: requiring("projects.manage")
    .input(z.object({ data: projectInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createProject(input.data, ctx.user.id, input.key)
    ),
  createWbs: requiring("projects.manage")
    .input(z.object({ data: wbsInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createWbs(input.data, ctx.user.id, input.key)
    ),
  createBudget: requiring("projects.manage")
    .input(z.object({ data: budgetInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createBudget(input.data, ctx.user.id, input.key)
    ),
  approveBudget: requiring("budgets.approve")
    .input(reasonInput.extend({ action: z.enum(["approve", "reject"]) }))
    .mutation(({ input, ctx }) =>
      service.approveBudget(input.id, ctx.user.id, input.action, input.reason)
    ),
  status: requiring("projects.manage")
    .input(
      reasonInput.extend({
        version: z.number().int().positive(),
        status: z.enum(["active", "on_hold", "completed", "cancelled"]),
      })
    )
    .mutation(({ input, ctx }) =>
      service.setStatus(
        input.id,
        input.version,
        input.status,
        ctx.user.id,
        input.reason
      )
    ),
});

