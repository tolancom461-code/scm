import { describe, it, expect } from "vitest";
import { contractBalance, paymentCapacity } from "./service";
type Args = Parameters<typeof contractBalance>;
const contract = { id: 1, currency: "SAR" } as Args[0];
const certificate = (id: number, date: string, net: string) =>
  ({
    id,
    contractId: 1,
    certificateDate: date,
    status: "approved",
    net,
    progress: "100",
    retention: "0",
    releasedAmount: "0",
  }) as Args[1][number];
const milestone = {
  id: 1,
  contractId: 1,
  position: 1,
  amount: "1000",
  dueDate: "2026-01-01",
  minProgress: "0",
} as Args[3][number];
const payment = (date: string, amount: string) =>
  ({
    contractId: 1,
    certificateId: 1,
    milestoneId: 1,
    kind: "normal",
    paymentDate: date,
    amount,
  }) as Args[2][number];
describe("historical voucher capacity", () => {
  it("keeps reversed originals outside every financial balance", () => {
    const b = paymentCapacity(
      contract,
      [certificate(1, "2026-01-01", "1000")],
      [
        { ...payment("2026-02-01", "1000"), status: "reversed" },
        { ...payment("2026-02-02", "300"), status: "active" },
      ],
      [milestone],
      "2026-03-01"
    );
    expect(b.paid).toBe("300.00");
    expect(b.outstanding).toBe("700.00");
    expect(b.upcoming?.readyAmount).toBe("700.00");
  });
  it("does not make retained money payable before its effective release date", () => {
    const c = {
      ...certificate(1, "2026-01-01", "900"),
      retention: "100",
      releasedAmount: "100",
      releaseDate: "2026-06-01",
    };
    const before = paymentCapacity(
      contract,
      [c],
      [],
      [milestone],
      "2026-03-01"
    );
    expect(before.retained).toBe("100.00");
    expect(before.certificates[0].releasedOutstanding).toBe("0.00");
    const after = paymentCapacity(contract, [c], [], [milestone], "2026-06-01");
    expect(after.retained).toBe("0.00");
    expect(after.certificates[0].releasedOutstanding).toBe("100.00");
  });
  it("excludes later certificates and vouchers from historical balances", () => {
    const b = contractBalance(
      contract,
      [
        certificate(1, "2026-01-01", "600"),
        certificate(2, "2026-06-01", "400"),
      ],
      [payment("2026-02-01", "100"), payment("2026-07-01", "300")],
      [milestone],
      "2026-03-01"
    );
    expect(b.paid).toBe("100.00");
    expect(b.approvedNet).toBe("600.00");
    expect(b.outstanding).toBe("500.00");
    expect(b.upcoming?.readyAmount).toBe("500.00");
    expect(b.certificates).toHaveLength(1);
  });
  it("allows backfilling without double paying the certificate or installment", () => {
    const b = paymentCapacity(
      contract,
      [certificate(1, "2026-01-01", "1000")],
      [payment("2026-06-01", "900")],
      [milestone],
      "2026-03-01"
    );
    expect(b.paid).toBe("0.00");
    expect(b.upcoming?.readyAmount).toBe("100.00");
    expect(b.certificates[0].outstanding).toBe("100.00");
  });
  it("preserves headroom at future dates before later progress becomes approved", () => {
    const b = paymentCapacity(
      contract,
      [
        certificate(1, "2026-01-01", "600"),
        certificate(2, "2026-07-01", "400"),
      ],
      [payment("2026-06-01", "500")],
      [milestone],
      "2026-03-01"
    );
    expect(b.upcoming?.readyAmount).toBe("100.00");
  });
  it("never reopens a fully paid stage for a backdated duplicate", () => {
    const b = paymentCapacity(
      contract,
      [certificate(1, "2026-01-01", "1000")],
      [payment("2026-06-01", "1000")],
      [milestone],
      "2026-03-01"
    );
    expect(b.upcoming?.ready).toBe(false);
    expect(b.upcoming?.readyAmount).toBe("0.00");
  });
});
