import { describe, it, expect } from "vitest";
import {
  inspectionInput,
  inspectionRemaining,
} from "../../../shared/inspections";
const data = {
  contractId: 1,
  itemIndex: 0,
  inspectionDate: "2026-10-13",
  location: "Site",
  description: "Epoxy",
  executed: "100",
  accepted: "90",
  status: "accepted",
};
describe("FIR validation and reservations", () => {
  it("accepts partial quantities and rejects quantities above executed", () => {
    expect(inspectionInput.safeParse(data).success).toBe(true);
    expect(
      inspectionInput.safeParse({ ...data, accepted: "100.0001" }).success
    ).toBe(false);
  });
  it("pending/rejected never provide payable quantities", () => {
    for (const status of ["pending", "rejected"]) {
      expect(inspectionInput.safeParse({ ...data, status }).success).toBe(
        false
      );
      expect(
        inspectionInput.safeParse({
          ...data,
          status,
          accepted: "0",
          notes: "Repair required",
        }).success
      ).toBe(true);
    }
  });
  it("notes and positive accepted quantities are required for conditional acceptance", () => {
    expect(
      inspectionInput.safeParse({ ...data, status: "accepted_noted" }).success
    ).toBe(false);
    expect(inspectionInput.safeParse({ ...data, accepted: "0" }).success).toBe(
      false
    );
    expect(
      inspectionInput.safeParse({
        ...data,
        status: "accepted_noted",
        notes: "Minor comments",
      }).success
    ).toBe(true);
  });
  it("keeps zero additional signatures and validates every extra signatory", () => {
    expect(inspectionInput.parse(data).additionalSignatures).toEqual([]);
    expect(
      inspectionInput.safeParse({
        ...data,
        additionalSignatures: [{ role: "", name: "" }],
      }).success
    ).toBe(false);
    expect(
      inspectionInput.safeParse({
        ...data,
        additionalSignatures: [
          { role: "Engineer", name: "Engineer A" },
          { role: "Manager", name: "Manager B" },
        ],
      }).success
    ).toBe(true);
  });
  it("reserves pending and approved quantities exactly but releases rejected ones", () => {
    const allocation = (quantity: string) => [
      { inspectionId: 1, quantity, number: "FIR", itemIndex: 0, revision: 0 },
    ];
    expect(
      inspectionRemaining(1, "90.1250", [
        { status: "pending", inspectionAllocations: allocation("20.0001") },
        { status: "approved", inspectionAllocations: allocation("30.1249") },
        { status: "rejected", inspectionAllocations: allocation("60") },
      ])
    ).toBe("40.0000");
  });
});
