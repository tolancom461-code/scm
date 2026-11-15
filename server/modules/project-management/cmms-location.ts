import type { z } from "zod";
import type { cmmsProjectLocationInput } from "../../../shared/construction";
import { DomainError } from "../../core/errors";
import {
  cmmsReferencesConfigured,
  readCmmsAssets,
  readCmmsSections,
  readCmmsSites,
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
  const [sites, sections, assets] = await Promise.all([
    readCmmsSites(locale),
    readCmmsSections(siteId, locale),
    assetId === null ? [] : readCmmsAssets(siteId, sectionId, locale),
  ]);
  const site = sites.find(row => row.id === siteId);
  const section = sections.find(row => row.id === sectionId);
  const asset = assets.find(row => row.id === assetId);
  if (!site || !section || (assetId !== null && !asset))
    throw new DomainError("INVALID_REFERENCE");
  return {
    cmmsSiteId: site.id,
    cmmsSiteName: site.name,
    cmmsSectionId: section.id,
    cmmsSectionName: section.name,
    cmmsAssetId: asset?.id ?? null,
    cmmsAssetName: asset?.name ?? null,
  };
}
