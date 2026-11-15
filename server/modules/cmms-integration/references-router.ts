import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import {
  cmmsReferenceId,
  cmmsReferenceLocale,
  cmmsReferencesConfigured,
  readCmmsAssets,
  readCmmsPurchaseOptions,
  readCmmsSections,
  readCmmsSites,
} from "./references";

const localized = z.object({ locale: cmmsReferenceLocale.optional() });

export const cmmsReferencesRouter = router({
  status: protectedProcedure.query(() => ({
    configured: cmmsReferencesConfigured(),
  })),
  sites: protectedProcedure
    .input(localized.optional())
    .query(({ input }) => readCmmsSites(input?.locale)),
  sections: protectedProcedure
    .input(localized.extend({ siteId: cmmsReferenceId }))
    .query(({ input }) => readCmmsSections(input.siteId, input.locale)),
  assets: protectedProcedure
    .input(
      localized.extend({ siteId: cmmsReferenceId, sectionId: cmmsReferenceId })
    )
    .query(({ input }) =>
      readCmmsAssets(input.siteId, input.sectionId, input.locale)
    ),
  purchaseOptions: protectedProcedure
    .input(localized.optional())
    .query(({ input }) => readCmmsPurchaseOptions(input?.locale)),
});
