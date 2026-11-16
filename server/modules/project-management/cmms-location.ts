import type { z } from "zod";
import type { cmmsProjectLocationInput } from "../../../shared/construction";
import { DomainError } from "../../core/errors";
import {
  cmmsReferencesConfigured,
  readCmmsProjectLocation,
} from "../cmms-integration/references";

type Selection = z.infer<typeof cmmsProjectLocationInput>;
type SavedLocation = {
  cmmsSiteId: number | null;
  cmmsSectionId: number | null;
  cmmsAssetId: number | null;
};

export function matchesProjectLocation(input: Selection, saved: SavedLocation) {
  return (
    input.siteId === saved.cmmsSiteId &&
    input.sectionId === saved.cmmsSectionId &&
    input.assetId === saved.cmmsAssetId
  );
}

export async function resolveProjectLocation(input: Selection) {
  if (!cmmsReferencesConfigured()) throw new DomainError("SERVICE_UNAVAILABLE");
  const { siteId, sectionId, assetId, locale } = input;
  const location = await readCmmsProjectLocation(
    siteId,
    sectionId,
    assetId,
    locale
  );
  if (
    !location ||
    location.site.id !== siteId ||
    location.section.id !== sectionId ||
    (location.asset?.id ?? null) !== assetId
  )
    throw new DomainError("INVALID_REFERENCE");
  const { site, section, asset } = location;
  return {
    cmmsSiteId: site.id,
    cmmsSiteName: site.name,
    cmmsSectionId: section.id,
    cmmsSectionName: section.name,
    cmmsAssetId: asset?.id ?? null,
    cmmsAssetName: asset?.name ?? null,
  };
}
