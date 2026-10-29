import { z } from "zod";
import { router } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import {
  projectSaveInput,
  projectActionInput,
  taskInput,
  employeeInput,
  statusInput,
  projectStates,
} from "../../../shared/construction";
import * as service from "./service";
export const projectManagementRouter = router({
  list: requiring("pm.view")
    .input(
      z
        .object({
          q: z.string().trim().max(100).default(""),
          status: z.enum(["", ...projectStates]).default(""),
        })
        .default({ q: "", status: "" })
    )
    .query(({ input, ctx }) =>
      service.listProjects(ctx.access!, input.q, input.status)
    ),
  directory: requiring("pm.view").query(() => service.directory()),
  detail: requiring("pm.view")
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input, ctx }) => service.detail(input.id, ctx.access!)),
  save: requiring("pm.view")
    .input(projectSaveInput)
    .mutation(({ input, ctx }) => service.saveProject(input, ctx.access!)),
  action: requiring("pm.view")
    .input(projectActionInput)
    .mutation(({ input, ctx }) => service.projectAction(input, ctx.access!)),
  saveTask: requiring("pm.tasks.manage")
    .input(taskInput)
    .mutation(({ input, ctx }) => service.saveTask(input, ctx.access!)),
  saveEmployee: requiring("pm.employees.manage")
    .input(employeeInput)
    .mutation(({ input, ctx }) => service.saveEmployee(input, ctx.access!)),
  saveStatus: requiring("pm.statuses.manage")
    .input(statusInput)
    .mutation(({ input, ctx }) => service.saveStatus(input, ctx.access!)),
});
