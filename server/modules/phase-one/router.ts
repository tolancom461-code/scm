import { z } from "zod";
import { router, protectedProcedure } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import {
  companyInput,
  contractCorrectionInput,
  projectInput,
  simpleCertificateInput,
  simpleContractInput,
  simplePaymentInput,
  certificateScheduleInput,
  handoverInput,
} from "../../../shared/phase-one";
import * as service from "./service";
import { dateInput } from "../../../shared/projects";
const key = z.string().uuid(),
  id = z.number().int().positive();
export const phaseOneRouter = router({
  configureSchedule: requiring("p1.certificates.schedule")
    .input(certificateScheduleInput)
    .mutation(({ input, ctx }) =>
      service.configureSchedule(input, ctx.user.id)
    ),
  schedulePreview: requiring("p1.certificates.schedule")
    .input(z.object({ id }))
    .query(({ input }) => service.schedulePreview(input.id)),
  acceptHandover: requiring("p1.contracts.handover")
    .input(handoverInput)
    .mutation(({ input, ctx }) => service.acceptHandover(input, ctx.user.id)),
  requestReversal: requiring("p1.payments.record")
    .input(
      z.object({
        paymentId: id,
        reason: z.string().trim().min(3).max(2000),
        key,
      })
    )
    .mutation(({ input, ctx }) =>
      service.requestReversal(
        input.paymentId,
        input.reason,
        ctx.user.id,
        input.key
      )
    ),
  decideReversal: requiring("p1.payments.reverse.approve")
    .input(
      z.object({
        id,
        action: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(3).max(2000),
      })
    )
    .mutation(({ input, ctx }) =>
      service.decideReversal(input.id, input.action, input.reason, ctx.user.id)
    ),
  state: protectedProcedure.query(({ ctx }) => service.state(ctx.access!)),
  correctContract: requiring("p1.contracts.create")
    .input(contractCorrectionInput)
    .mutation(({ input, ctx }) => service.correctContract(input, ctx.user.id)),
  paymentPreview: requiring("p1.payments.record")
    .input(
      z.object({
        contractId: z.number().int().positive(),
        paymentDate: dateInput,
      })
    )
    .query(({ input }) =>
      service.paymentPreview(input.contractId, input.paymentDate)
    ),
  createProject: requiring("p1.projects.create")
    .input(projectInput.extend({ key: key.optional() }))
    .mutation(({ input, ctx }) => {
      const { key, ...data } = input;
      return service.createProject(data, ctx.user.id, key);
    }),
  saveCompany: requiring("p1.company.manage")
    .input(companyInput)
    .mutation(({ input, ctx }) => service.saveCompany(input, ctx.user.id)),
  createContract: requiring("p1.contracts.create")
    .input(z.object({ data: simpleContractInput, key }))
    .mutation(({ input, ctx }) =>
      service.createContract(input.data, ctx.user.id, input.key)
    ),
  createCertificate: requiring("p1.certificates.create")
    .input(z.object({ data: simpleCertificateInput, key }))
    .mutation(({ input, ctx }) =>
      service.createCertificate(input.data, ctx.user.id, input.key)
    ),
  decideCertificate: requiring("p1.certificates.approve")
    .input(
      z.object({
        id,
        action: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(3).max(2000),
      })
    )
    .mutation(({ input, ctx }) =>
      service.decideCertificate(
        input.id,
        ctx.user.id,
        input.action,
        input.reason
      )
    ),
  releaseRetention: requiring("p1.retention.release")
    .input(
      z.object({
        id,
        reason: z.string().trim().min(3).max(2000),
        releaseDate: dateInput.optional(),
      })
    )
    .mutation(({ input, ctx }) =>
      service.releaseRetention(
        input.id,
        ctx.user.id,
        input.reason,
        input.releaseDate
      )
    ),
  recordPayment: requiring("p1.payments.record")
    .input(z.object({ data: simplePaymentInput, key }))
    .mutation(({ input, ctx }) =>
      service.recordPayment(input.data, ctx.user.id, input.key)
    ),
});
