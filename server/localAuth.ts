import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback);

export const LOCAL_SESSION_COOKIE = "procureflow_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function isLoginRateLimited(key: string, now = Date.now()) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (entry.resetAt <= now) { loginAttempts.delete(key); return false; }
  return entry.count >= MAX_LOGIN_ATTEMPTS;
}

export function registerLoginFailure(key: string, now = Date.now()) {
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) { loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS }); return; }
  entry.count += 1;
  loginAttempts.set(key, entry);
}

export function clearLoginFailures(key: string) { loginAttempts.delete(key); }

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
  return expectedBuffer.length === derived.length && timingSafeEqual(expectedBuffer, derived);
}

export function generateSessionToken() {
  return randomBytes(48).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
