import { z } from "zod";
import { router } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import {
  masterInput,
  masterKinds,
  masterListInput,
} from "../../../shared/master-data";
import * as repository from "./repository";
import * as service from "./service";

export const masterDataRouter = router({
  list: requiring("master.view")
    .input(masterListInput)
    .query(({ input }) => repository.list(input)),
  detail: requiring("master.view")
    .input(
      z.object({ kind: z.enum(masterKinds), id: z.number().int().positive() })
    )
    .query(({ input }) => service.detail(input.kind, input.id)),
  create: requiring("master.manage")
    .input(z.object({ data: masterInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.create(input.data, ctx.user.id, input.key)
    ),
  update: requiring("master.manage")
    .input(
      z.object({
        data: masterInput,
        id: z.number().int().positive(),
        version: z.number().int().positive(),
        reason: z.string().trim().min(3).max(1000),
      })
    )
    .mutation(({ input, ctx }) =>
      service.update(
        input.data,
        input.id,
        input.version,
        ctx.user.id,
        input.reason
      )
    ),
});
