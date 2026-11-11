import { describe, expect, it } from "vitest";
import {
  dateFromLead,
  externalPurchaseRequestUpdateInput,
  leadDays,
  materialRequisitionSaveInput,
  requisitionItemInput,
} from "../../../shared/material-requisitions";

const item = {
  itemName: "Epoxy",
  quantity: "0.123456789",
  unitId: 1,
  specifications: "",
  notes: "",
  needDate: "2026-12-07",
};
describe("Material requisition constraints", () => {
  it("preserves exact decimal strings and limits the official document to 20 items", () => {
    const input = {
      key: "ec85b526-7488-4931-ace7-7c6f3abe60f5",
      projectId: 1,
      taskId: 5,
      items: Array.from({ length: 20 }, () => item),
    };
    expect(materialRequisitionSaveInput.parse(input).items[0].quantity).toBe(
      "0.123456789"
    );
    expect(
      materialRequisitionSaveInput.safeParse({
        ...input,
        items: [...input.items, item],
      }).success
    ).toBe(false);
    for (const quantity of ["0", "-1", "1e3", "١٢", "1,5", "1.1234567890"])
      expect(
        requisitionItemInput.safeParse({ ...item, quantity }).success
      ).toBe(false);
  });
  it("preserves lead days when drafts move across months or years", () => {
    expect(leadDays("2026-12-10", "2026-12-07")).toBe(3);
    expect(leadDays("2026-12-10", "2026-12-08")).toBe(2);
    expect(dateFromLead("2027-01-03", 5)).toBe("2026-12-29");
    expect(dateFromLead("2028-03-02", 3)).toBe("2028-02-28");
  });
  it("requires a returning purchase request number and safe navigation links", () => {
    const response = {
      key: "ec85b526-7488-4931-ace7-7c6f3abe60f5",
      requisitionNumber: "MR-26-11-0001",
      status: "purchase_request_created",
    };
    expect(externalPurchaseRequestUpdateInput.safeParse(response).success).toBe(
      false
    );
    expect(
      externalPurchaseRequestUpdateInput.safeParse({
        ...response,
        purchaseRequestNumber: "PR-001",
        referenceUrl: "https://purchasing.example/PR-001",
      }).success
    ).toBe(true);
    expect(
      externalPurchaseRequestUpdateInput.safeParse({
        ...response,
        purchaseRequestNumber: "PR-001",
        referenceUrl: "javascript:alert(1)",
      }).success
    ).toBe(false);
  });
});
