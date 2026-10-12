import type { CookieOptions, Request } from "express";

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;
  const forwarded = req.headers["x-forwarded-proto"];
  const values = Array.isArray(forwarded) ? forwarded : (forwarded?.split(",") ?? []);
  return values.some(value => value.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(req: Request): Pick<CookieOptions, "httpOnly" | "path" | "sameSite" | "secure"> {
  const secure = isSecureRequest(req);
  return { httpOnly: true, path: "/", sameSite: secure ? "none" : "lax", secure };
}
