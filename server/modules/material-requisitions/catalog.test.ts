import { afterEach, describe, expect, it, vi } from "vitest";
import { previewImageUrl, validatePreviewToken } from "./catalog";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Authenticated catalog image previews", () => {
  it("conceals the remote image URL and binds the token to its requester", () => {
    vi.stubEnv("JWT_SECRET", "catalog-preview-qa-signing-secret");
    const source = "https://catalog.example/image.png?assetKey=private";
    const preview = previewImageUrl(source, 41);
    const token = new URL(preview, "https://pscm.example").searchParams.get(
      "token"
    )!;
    expect(preview).not.toContain("catalog.example");
    expect(preview).not.toContain("private");
    expect(validatePreviewToken(token, 41)).toBe(source);
    expect(validatePreviewToken(token, 42)).toBeNull();
  });

  it("rejects tampered and expired tokens", () => {
    vi.stubEnv("JWT_SECRET", "catalog-preview-qa-signing-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-12-01T00:00:00Z"));
    const preview = previewImageUrl("https://catalog.example/image.png", 41);
    const token = new URL(preview, "https://pscm.example").searchParams.get(
      "token"
    )!;
    const parts = token.split(".");
    parts[1] = (parts[1][0] === "a" ? "b" : "a") + parts[1].slice(1);
    expect(validatePreviewToken(parts.join("."), 41)).toBeNull();
    vi.advanceTimersByTime(5 * 60_000);
    expect(validatePreviewToken(token, 41)).toBeNull();
    expect(validatePreviewToken("not-a-valid-token", 41)).toBeNull();
  });
});
