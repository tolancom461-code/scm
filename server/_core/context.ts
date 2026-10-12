import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse } from "cookie";
import type { User } from "../../drizzle/schema";
import { getUserBySessionToken } from "../db";
import { LOCAL_SESSION_COOKIE } from "../localAuth";
import type { AccessContext } from "../core/policy";

export type LocalUser = User & { permissionCodes: string[] };

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: LocalUser | null;
  access?: AccessContext;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const cookies = parse(opts.req.headers.cookie ?? "");
  const token = cookies[LOCAL_SESSION_COOKIE];
  const user = token ? await getUserBySessionToken(token) : null;
  return { req: opts.req, res: opts.res, user };
}
