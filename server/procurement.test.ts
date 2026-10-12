import { describe, expect, it } from "vitest";
import { canTransitionRequest } from "./workflow";
import { hashPassword, verifyPassword } from "./localAuth";

describe("purchase request workflow", () => {
  it("permits a draft request to be submitted but not approved directly", () => {
    expect(canTransitionRequest("draft", "submitted")).toBe(true);
    expect(canTransitionRequest("draft", "approved")).toBe(false);
  });

  it("allows a rejected request to be revised", () => {
    expect(canTransitionRequest("rejected", "draft")).toBe(true);
  });
});

describe("local credential protection", () => {
  it("verifies only the original password", async () => {
    const encoded = await hashPassword("Strong-password-123!");
    await expect(verifyPassword("Strong-password-123!", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", encoded)).resolves.toBe(false);
  });
});
