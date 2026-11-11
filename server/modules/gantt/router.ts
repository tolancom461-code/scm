import { z } from "zod";
import { router } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import {
  ganttBaselineInput,
  ganttLinkInput,
  ganttProjectScheduleInput,
  ganttScheduleInput,
  ganttSettingsInput,
  ganttSharedGroupInput,
  ganttStudioStateInput,
} from "../../../shared/gantt";
import * as service from "./service";

export const ganttRouter = router({
  projects: requiring("pm.view").query(({ ctx }) =>
    service.projects(ctx.access!)
  ),
  detail: requiring("pm.view")
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(({ input, ctx }) => service.detail(input.projectId, ctx.access!)),
  sharedDirectory: requiring("pm.view").query(({ ctx }) =>
    service.sharedDirectory(ctx.access!)
  ),
  saveProjectSchedule: requiring("pm.tasks.manage")
    .input(ganttProjectScheduleInput)
    .mutation(({ input, ctx }) =>
      service.saveProjectSchedule(input, ctx.access!)
    ),
  saveSharedGroup: requiring("pm.tasks.manage")
    .input(ganttSharedGroupInput)
    .mutation(({ input, ctx }) => service.saveSharedGroup(input, ctx.access!)),
  saveSettings: requiring("pm.tasks.manage")
    .input(ganttSettingsInput)
    .mutation(({ input, ctx }) => service.saveSettings(input, ctx.access!)),
  saveLink: requiring("pm.tasks.manage")
    .input(ganttLinkInput)
    .mutation(({ input, ctx }) => service.saveLink(input, ctx.access!)),
  saveSchedule: requiring("pm.tasks.manage")
    .input(ganttScheduleInput)
    .mutation(({ input, ctx }) => service.saveSchedule(input, ctx.access!)),
  captureBaseline: requiring("pm.tasks.manage")
    .input(ganttBaselineInput)
    .mutation(({ input, ctx }) => service.captureBaseline(input, ctx.access!)),
  saveStudioState: requiring("pm.tasks.manage")
    .input(ganttStudioStateInput)
    .mutation(({ input, ctx }) => service.saveStudioState(input, ctx.access!)),
});
