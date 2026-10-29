import type { Express } from "express";

import { parse } from "cookie";
import { getDocumentByStorageKey, getUserBySessionToken } from "../db";
import { LOCAL_SESSION_COOKIE } from "../localAuth";
import { localDocumentPath } from "../storage";
import {
  assertDocumentTarget,
  canAccess,
  loadAccess,
  logAccessDenied,
} from "../core/policy";

export function registerDocumentDownloads(app: Express) {
  app.get("/documents/files/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    try {
      const token = parse(req.headers.cookie ?? "")[LOCAL_SESSION_COOKIE];
      const user = token ? await getUserBySessionToken(token) : null;
      if (!user) {
        res.status(401).send("Authentication required");
        return;
      }
      const document = await getDocumentByStorageKey(key);
      const access = await loadAccess(user.id);
      if (
        !document ||
        !access ||
        !canAccess(access, "documents.view") ||
        (["confidential", "highly_confidential"].includes(
          document.classification
        ) &&
          !canAccess(access, "documents.view_confidential"))
      ) {
        if (document && access)
          await logAccessDenied(
            user.id,
            "storage.download",
            "PERMISSION_DENIED"
          );
        res.status(404).send("Document unavailable");
        return;
      }
      try {
        await assertDocumentTarget(
          access,
          document.entityType,
          document.entityId
        );
      } catch {
        await logAccessDenied(user.id, "storage.download", "DOCUMENT_TARGET");
        res.status(404).send("Document unavailable");
        return;
      }
      if (key.startsWith("local/")) {
        res.set("Cache-Control", "no-store");
        res.set("X-Content-Type-Options", "nosniff");
        res.download(localDocumentPath(key), document.fileName, error => {
          if (error && !res.headersSent)
            res.status(404).send("Document unavailable");
        });
        return;
      }
      res.status(404).send("Document unavailable");
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "storage.download.failure",
          errorType: err instanceof Error ? err.name : "unknown",
        })
      );
      res.status(502).send("Storage proxy error");
    }
  });
}
