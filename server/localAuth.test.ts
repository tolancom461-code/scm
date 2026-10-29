import { describe, expect, it } from "vitest";
import {
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
});
