import { describe, expect, it } from "vitest";
import {
  admitLoginSource,
  clearLoginFailures,
  isLoginRateLimited,
  registerLoginFailure,
} from "./localAuth";

describe("حد محاولات الدخول", () => {
  it("يحظر المفتاح بعد خمس محاولات فاشلة ضمن نافذة الحماية", () => {
    const key = "rate-test-user";
    const now = 1_700_000_000_000;
    clearLoginFailures(key);
    for (let attempt = 0; attempt < 5; attempt += 1)
      registerLoginFailure(key, now);
    expect(isLoginRateLimited(key, now)).toBe(true);
    clearLoginFailures(key);
  });

  it("يلغي الحظر تلقائياً بعد انتهاء نافذة الحماية", () => {
    const key = "rate-test-expiry";
    const now = 1_700_000_000_000;
    clearLoginFailures(key);
    for (let attempt = 0; attempt < 5; attempt += 1)
      registerLoginFailure(key, now);
    expect(isLoginRateLimited(key, now + 16 * 60 * 1000)).toBe(false);
  });

  it("keeps the failure store bounded and preserves tracked entries at capacity", () => {
    const now = 1_800_000_000_000;
    for (let i = 0; i < 4096; i++) registerLoginFailure(`bounded-${i}`, now);
    try {
      expect(isLoginRateLimited("new-at-capacity", now)).toBe(true);
      expect(isLoginRateLimited("bounded-0", now)).toBe(false);
      for (let i = 0; i < 4; i++) registerLoginFailure("bounded-0", now);
      expect(isLoginRateLimited("bounded-0", now)).toBe(true);
      expect(isLoginRateLimited("new-at-capacity", now + 16 * 60_000)).toBe(
        false
      );
    } finally {
      for (let i = 0; i < 4096; i++) clearLoginFailures(`bounded-${i}`);
    }
  });

  it("limits successive requests from one source without blocking another", () => {
    const now = 1_800_000_000_000;
    for (let i = 0; i < 120; i++)
      expect(admitLoginSource("source-one", now)).toBe(true);
    expect(admitLoginSource("source-one", now)).toBe(false);
    expect(admitLoginSource("source-two", now)).toBe(true);
    expect(admitLoginSource("source-one", now + 60_000)).toBe(true);
  });
});
