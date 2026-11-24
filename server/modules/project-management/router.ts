import { z } from "zod";
import { router } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import {
  projectSaveInput,
  projectLinkCmmsLocationInput,
  projectActionInput,
  taskInput,
  employeeInput,
  statusInput,
  projectStates,
} from "../../../shared/construction";
import { saveHolidayCalendarInput } from "../../../shared/work-calendar";
import * as service from "./service";
import { projectListInput, projectListView } from "./project-list";
import { holidayCalendar, saveHolidayCalendar } from "./work-calendar";
import {
  taskMaterialCosts,
  taskMaterialProgress,
  taskMaterialSummary,
} from "../material-requisitions/service";
export const projectManagementRouter = router({
  listView: requiring("pm.view")
    .input(projectListInput)
    .query(({ input, ctx }) => projectListView(ctx.access!, input)),
  list: requiring("pm.view")
    .input(
      z
        .object({
          q: z.string().trim().max(100).default(""),
          status: z.enum(["", ...projectStates]).default(""),
          beforeId: z.number().int().positive().optional(),
          pageSize: z.number().int().min(1).max(200).optional(),
        })
        .default({ q: "", status: "" })
    )
    .query(({ input, ctx }) =>
      service.listProjects(
        ctx.access!,
        input.q,
        input.status,
        input.beforeId,
        input.pageSize
      )
    ),
  directory: requiring("pm.view").query(() => service.directory()),
  detail: requiring("pm.view")
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input, ctx }) => service.detail(input.id, ctx.access!)),
  holidayCalendar: requiring("pm.view").query(({ ctx }) =>
    holidayCalendar(ctx.access!)
  ),
  saveHolidayCalendar: requiring("pm.tasks.manage")
    .input(saveHolidayCalendarInput)
    .mutation(({ input, ctx }) => saveHolidayCalendar(input, ctx.access!)),
  taskMaterialSummary: requiring("pm.view")
    .input(
      z.object({
        projectId: z.number().int().positive(),
        taskId: z.number().int().positive().optional(),
      })
    )
    .query(({ input, ctx }) =>
      taskMaterialSummary(input.projectId, input.taskId, ctx.access!)
    ),
  taskMaterialCosts: requiring("pm.view")
    .input(
      z.object({
        projectId: z.number().int().positive(),
        taskId: z.number().int().positive().optional(),
      })
    )
    .query(({ input, ctx }) =>
      taskMaterialCosts(input.projectId, input.taskId, ctx.access!)
    ),
  taskMaterialProgress: requiring("pm.view")
    .input(
      z.object({
        projectId: z.number().int().positive(),
        taskId: z.number().int().positive(),
        beforeId: z.number().int().positive().optional(),
      })
    )
    .query(({ input, ctx }) =>
      taskMaterialProgress(
        input.projectId,
        input.taskId,
        input.beforeId,
        ctx.access!
      )
    ),
  save: requiring("pm.view")
    .input(projectSaveInput)
    .mutation(({ input, ctx }) => service.saveProject(input, ctx.access!)),
  linkCmmsLocation: requiring("pm.edit")
    .input(projectLinkCmmsLocationInput)
    .mutation(({ input, ctx }) => service.linkCmmsLocation(input, ctx.access!)),
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
