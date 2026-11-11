import { describe, expect, it } from "vitest";
import {
  assertApprovedNeedBoundaries,
  assertRequisitionSourceStart,
  type ApprovedNeedBoundary,
} from "./schedule-guards";

const boundary: ApprovedNeedBoundary = {
  number: "MR-26-11-0001",
  taskName: "Crane hire",
  projectName: "Tower model",
  itemName: "Crane",
  needDate: "2026-12-07",
  startDate: "2026-12-10",
};

describe("approved requisition schedule boundary", () => {
  it("allows the exact three-day lead and later scheduling without moving the commitment", () => {
    expect(() => assertApprovedNeedBoundaries([boundary])).not.toThrow();
    expect(() =>
      assertApprovedNeedBoundaries([{ ...boundary, startDate: "2026-12-14" }])
    ).not.toThrow();
    expect(boundary.needDate).toBe("2026-12-07");
  });

  it("blocks advancing a task into the official material lead time and identifies the request", () => {
    expect(() =>
      assertApprovedNeedBoundaries([{ ...boundary, startDate: "2026-12-09" }])
    ).toThrow(/MR-26-11-0001.*Crane/);
  });

  it("checks every item, including an ancestor's requirement after bottom-up rollup", () => {
    expect(() =>
      assertApprovedNeedBoundaries([
        { ...boundary, needDate: "2026-12-01" },
        { ...boundary, taskName: "Parent structure", startDate: "2026-12-08" },
      ])
    ).toThrow(/Parent structure/);
  });

  it("requires a valid source start for an official project-level request", () => {
    expect(() =>
      assertApprovedNeedBoundaries([
        { ...boundary, taskName: null, startDate: null },
      ])
    ).toThrow(/Tower model/);
  });

  it("protects a project-level draft from losing the start that drives its dates", () => {
    expect(() => assertRequisitionSourceStart(undefined)).not.toThrow();
    expect(() =>
      assertRequisitionSourceStart({
        number: boundary.number,
        projectName: boundary.projectName,
        startDate: boundary.startDate,
      })
    ).not.toThrow();
    expect(() =>
      assertRequisitionSourceStart({
        number: boundary.number,
        projectName: boundary.projectName,
        startDate: null,
      })
    ).toThrow(/MR-26-11-0001/);
  });
});
