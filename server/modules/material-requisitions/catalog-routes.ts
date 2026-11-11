import type { Express, Request, Response } from "express";
import { parse } from "cookie";
import { and, eq } from "drizzle-orm";
import * as s from "../../../drizzle/construction";
import { getUserBySessionToken } from "../../db";
import { LOCAL_SESSION_COOKIE } from "../../localAuth";
import {
  authorizeRequest,
  canAccess,
  constructionScope,
  type AccessContext,
} from "../../core/policy";
import { database } from "../../core/database";
import { readStoredDocument } from "../../storage";
import { validatePreviewToken } from "./catalog";
import { fetchCatalogImage } from "./catalog-media";

async function accessFor(
  req: Request,
  res: Response,
  policy: string
): Promise<AccessContext | null> {
  const token = parse(req.headers.cookie ?? "")[LOCAL_SESSION_COOKIE];
  const user = token ? await getUserBySessionToken(token) : null;
  if (!user) {
    res.sendStatus(401);
    return null;
  }
  try {
    return await authorizeRequest(user.id, policy, {});
  } catch {
    res.sendStatus(404);
    return null;
  }
}
function sendImage(res: Response, content: Buffer, mimeType: string) {
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "default-src 'none'; sandbox");
  res.type(mimeType).send(content);
}
export function registerCatalogImages(app: Express) {
  app.get("/material-requisitions/catalog-preview", async (req, res) => {
    try {
      const access = await accessFor(
        req,
        res,
        "materialRequisitions.catalogPreview"
      );
      if (!access) return;
      const url =
        typeof req.query.token === "string"
          ? validatePreviewToken(req.query.token, access.user.id)
          : null;
      if (!url) {
        res.sendStatus(404);
        return;
      }
      const image = await fetchCatalogImage(url);
      sendImage(res, image.content, image.mimeType);
    } catch {
      if (!res.headersSent) res.sendStatus(502);
    }
  });
  app.get("/material-requisitions/catalog-images/:id", async (req, res) => {
    try {
      const access = await accessFor(
        req,
        res,
        "materialRequisitions.catalogImage"
      );
      if (!access) return;
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        res.sendStatus(404);
        return;
      }
      const db = await database();
      const [entry] = await db
        .select()
        .from(s.materialCatalogEntries)
        .where(eq(s.materialCatalogEntries.id, id));
      if (!entry?.imageStorageKey || !entry.imageMimeType) {
        res.sendStatus(404);
        return;
      }
      const ownsImport =
        canAccess(access, "materialRequisitions.create") &&
        entry.createdBy === access.user.id;
      if (!ownsImport) {
        const [linked] = await db
          .select({ id: s.materialRequisitions.id })
          .from(s.materialRequisitionItems)
          .innerJoin(
            s.materialRequisitions,
            eq(
              s.materialRequisitions.id,
              s.materialRequisitionItems.requisitionId
            )
          )
          .where(
            and(
              eq(s.materialRequisitionItems.catalogEntryId, id),
              constructionScope(access, s.materialRequisitions.projectId)
            )
          )
          .limit(1);
        if (!linked) {
          res.sendStatus(404);
          return;
        }
      }
      sendImage(
        res,
        await readStoredDocument(entry.imageStorageKey),
        entry.imageMimeType
      );
    } catch {
      if (!res.headersSent) res.sendStatus(502);
    }
  });
}
