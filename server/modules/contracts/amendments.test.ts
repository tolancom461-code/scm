import { describe, expect, it } from "vitest";
import { assertAmendmentTransition } from "./service";
describe("amendment approval guard", () => {
  it("requires review before a contract value can change", () => {
    expect(() =>
      assertAmendmentTransition("draft", "effective", 1, 2)
    ).toThrow();
    expect(() =>
      assertAmendmentTransition("submitted", "effective", 1, 2)
    ).toThrow();
    expect(() =>
      assertAmendmentTransition("reviewed", "effective", 1, 2)
    ).not.toThrow();
  });
  it("prevents self-approval including administrators", () => {
    expect(() =>
      assertAmendmentTransition("submitted", "reviewed", 1, 1)
    ).toThrow();
    expect(() =>
      assertAmendmentTransition("reviewed", "effective", 1, 1)
    ).toThrow();
  });
  it("permits the creator to submit and prevents reapplication", () => {
    expect(() =>
      assertAmendmentTransition("draft", "submitted", 1, 1)
    ).not.toThrow();
    expect(() =>
      assertAmendmentTransition("effective", "effective", 1, 2)
    ).toThrow();
  });
});
