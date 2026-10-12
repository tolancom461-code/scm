import { describe, expect, it } from "vitest";
import { canTransitionRequest } from "./workflow";

describe("local session logout behavior", () => {
  it("does not allow a cancelled purchase request to return to an active state", () => {
    expect(canTransitionRequest("cancelled", "draft")).toBe(false);
    expect(canTransitionRequest("cancelled", "submitted")).toBe(false);
  });
});
