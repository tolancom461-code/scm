import { describe, expect, it } from "vitest";
import { assertRequisitionSourceStart } from "./schedule-guards";

const draft = {
  number: "MR-26-11-0001",
  projectName: "Tower model",
  startDate: "2026-12-10",
};

describe("draft requisition schedule source", () => {
  it("protects a project-level draft from losing the start that drives its dates", () => {
    expect(() => assertRequisitionSourceStart(undefined)).not.toThrow();
    expect(() => assertRequisitionSourceStart(draft)).not.toThrow();
    expect(() =>
      assertRequisitionSourceStart({ ...draft, startDate: null })
    ).toThrow(/MR-26-11-0001/);
  });
});
