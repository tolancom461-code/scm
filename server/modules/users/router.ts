import { router } from "../../_core/trpc";
import * as db from "../../db";
import {
  userProfileInput,
  userPasswordInput,
  userStatusInput,
  userCreateInput,
} from "../../../shared/users";
import * as service from "./service";

import { requiring } from "../../core/permissions";
export const usersRouter = router({
  list: requiring("users.view").query(() => db.listUsers()),
  update: requiring("users.edit")
    .input(userProfileInput)
    .mutation(({ input, ctx }) =>
      service.updateProfile(input, ctx.user.id, ctx.access!)
    ),
  resetPassword: requiring("users.password.reset")
    .input(userPasswordInput)
    .mutation(({ input, ctx }) => service.resetPassword(input, ctx.user.id)),
  setActive: requiring("users.status.manage")
    .input(userStatusInput)
    .mutation(({ input, ctx }) => service.setActive(input, ctx.user.id)),
  create: requiring("users.create")
    .input(userCreateInput)
    .mutation(({ input, ctx }) => service.createUser(input, ctx.access!)),
});
