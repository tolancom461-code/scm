import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback);

export const LOCAL_SESSION_COOKIE = "procureflow_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_TRACKED_KEYS = 4096;
type Attempt = { count: number; resetAt: number };

function attemptWindow(limit: number, windowMs: number) {
  const entries = new Map<string, Attempt>();
  function cleanup(now: number) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
  }
  function current(key: string, now: number) {
    const entry = entries.get(key);
    if (entry && entry.resetAt <= now) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }
  function atCapacity(now: number) {
    if (entries.size < MAX_TRACKED_KEYS) return false;
    // A flood of distinct keys cannot trigger a full scan on every request.
    if (now >= nextSweep) {
      cleanup(now);
      nextSweep = now + 60_000;
    }
    return entries.size >= MAX_TRACKED_KEYS;
  }
  let nextSweep = 0;
  return {
    limited(key: string, now: number) {
      const entry = current(key, now);
      return entry ? entry.count >= limit : atCapacity(now);
    },
    add(key: string, now: number) {
      const entry = current(key, now);
      if (entry) entry.count = Math.min(entry.count + 1, limit);
      else if (!atCapacity(now))
        entries.set(key, { count: 1, resetAt: now + windowMs });
    },
    clear: (key: string) => entries.delete(key),
    cleanup,
  };
}

const loginAttempts = attemptWindow(MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
const loginSources = attemptWindow(120, 60_000);
setInterval(() => {
  const now = Date.now();
  loginAttempts.cleanup(now);
  loginSources.cleanup(now);
}, 60_000).unref();

export function isLoginRateLimited(key: string, now = Date.now()) {
  return loginAttempts.limited(key, now);
}

export function admitLoginSource(source: string, now = Date.now()) {
  if (loginSources.limited(source, now)) return false;
  loginSources.add(source, now);
  return true;
}

export function registerLoginFailure(key: string, now = Date.now()) {
  loginAttempts.add(key, now);
}

export function clearLoginFailures(key: string) {
  loginAttempts.clear(key);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [scheme, salt, expected] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    expectedBuffer.length === derived.length &&
    timingSafeEqual(expectedBuffer, derived)
  );
}

export function generateSessionToken() {
  return randomBytes(48).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
