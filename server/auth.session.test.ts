import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalUser, TrpcContext } from "./_core/context";
import { router } from "./_core/trpc";
import { loadAccess } from "./core/policy";
import { LOCAL_SESSION_COOKIE, hashPassword } from "./localAuth";
import { authRouter } from "./modules/auth/router";
import {
  createAuditLog,
  createSession,
  deleteSession,
  getUserByUsername,
  renewRememberedSession,
} from "./db";

vi.mock("./db", () => ({
  createAuditLog: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getUserByUsername: vi.fn(),
  renewRememberedSession: vi.fn(),
}));
vi.mock("./core/policy", () => ({ loadAccess: vi.fn() }));

const now = new Date("2026-11-18T12:00:00Z");
const hour = 60 * 60 * 1000;
const day = 24 * hour;
const rememberedToken = "remembered.test-token";
const credentials = { username: "test-user", password: "test-secret" };
const user: LocalUser = {
  id: 42,
  username: credentials.username,
  passwordHash: null,
  active: true,
  name: "Test User",
  email: null,
  role: "user",
  preferredLocale: "ar",
  createdAt: now,
  updatedAt: now,
  lastSignedIn: now,
  permissionCodes: [],
};

function createCaller(
  options: Pick<TrpcContext, "user" | "rememberedSession"> = { user: null },
  token?: string
) {
  const cookie = vi.fn();
  const clearCookie = vi.fn();
  const ctx = {
    req: {
      ip: "127.0.0.1",
      protocol: "https",
      headers: token ? { cookie: `${LOCAL_SESSION_COOKIE}=${token}` } : {},
    },
    res: { cookie, clearCookie },
    ...options,
  } as unknown as TrpcContext;
  return {
    api: router({ auth: authRouter }).createCaller(ctx).auth,
    cookie,
    clearCookie,
  };
}

describe("remembered login", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.mocked(loadAccess).mockResolvedValue({
      user,
      scope: {
        template: "custom",
        allProjects: false,
        projectIds: [],
        version: 0,
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    { label: "12 hours by default", rememberMe: undefined, ttl: 12 * hour },
    { label: "365 days when remembered", rememberMe: true, ttl: 365 * day },
  ])(
    "uses the same expiration for the session and cookie for $label",
    async ({ rememberMe, ttl }) => {
      const passwordHash = await hashPassword(credentials.password);
      vi.mocked(getUserByUsername).mockResolvedValue({ ...user, passwordHash });
      vi.mocked(createSession).mockResolvedValue(true);
      const { api, cookie } = createCaller();

      const input = rememberMe ? { ...credentials, rememberMe } : credentials;
      await expect(api.login(input)).resolves.toEqual({ success: true });

      const token = vi.mocked(createSession).mock.calls[0]?.[1];
      expect(token?.startsWith("remembered.")).toBe(Boolean(rememberMe));
      expect(createSession).toHaveBeenCalledWith(
        user.id,
        token,
        new Date(now.getTime() + ttl),
        passwordHash
      );
      expect(cookie).toHaveBeenCalledWith(LOCAL_SESSION_COOKIE, token, {
        httpOnly: true,
        path: "/",
        sameSite: "none",
        secure: true,
        maxAge: ttl,
      });
      expect(createAuditLog).toHaveBeenCalledWith(
        user.id,
        "auth.login",
        "user",
        user.id
      );
    }
  );

  it("renews the authenticated remembered session near expiration", async () => {
    const expiresAt = new Date(now.getTime() + 2 * day);
    vi.mocked(renewRememberedSession).mockResolvedValue(true);
    const { api, cookie } = createCaller(
      { user, rememberedSession: { token: rememberedToken, expiresAt } },
      rememberedToken
    );

    await expect(api.me()).resolves.toMatchObject({ id: user.id });

    expect(renewRememberedSession).toHaveBeenCalledWith(
      rememberedToken,
      expiresAt,
      new Date(now.getTime() + 365 * day)
    );
    expect(cookie).toHaveBeenCalledWith(
      LOCAL_SESSION_COOKIE,
      rememberedToken,
      expect.objectContaining({ maxAge: 365 * day })
    );
  });

  it("does not renew a regular session or a remembered session outside the renewal window", async () => {
    const regularSession = createCaller({ user }, "regular-test-token");
    const expiresAt = new Date(now.getTime() + 31 * day);
    const rememberedSession = createCaller(
      { user, rememberedSession: { token: rememberedToken, expiresAt } },
      rememberedToken
    );

    await regularSession.api.me();
    await rememberedSession.api.me();

    expect(renewRememberedSession).not.toHaveBeenCalled();
    expect(regularSession.cookie).not.toHaveBeenCalled();
    expect(rememberedSession.cookie).not.toHaveBeenCalled();
  });

  it("does not renew the cookie when the session could not be renewed", async () => {
    const expiresAt = new Date(now.getTime() + day);
    vi.mocked(renewRememberedSession).mockResolvedValue(false);
    const { api, cookie } = createCaller(
      { user, rememberedSession: { token: rememberedToken, expiresAt } },
      rememberedToken
    );

    await api.me();

    expect(renewRememberedSession).toHaveBeenCalledOnce();
    expect(cookie).not.toHaveBeenCalled();
  });

  it("revokes and clears the remembered session on explicit logout", async () => {
    const { api, clearCookie } = createCaller({ user }, rememberedToken);

    await expect(api.logout()).resolves.toEqual({ success: true });

    expect(deleteSession).toHaveBeenCalledWith(rememberedToken);
    expect(clearCookie).toHaveBeenCalledWith(LOCAL_SESSION_COOKIE, {
      httpOnly: true,
      path: "/",
      sameSite: "none",
      secure: true,
    });
  });
});
