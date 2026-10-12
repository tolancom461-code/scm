import { describe, expect, it, vi } from "vitest";
import { retryTransaction } from "./transaction-retry";

describe("complete transaction deadlock retry", () => {
  it("restarts a rolled back transaction, including wrapped driver errors", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("query", {
          cause: Object.assign(new Error("deadlock"), { errno: 1213 }),
        })
      )
      .mockResolvedValueOnce({ id: 42 });
    const pause = vi.fn().mockResolvedValue(undefined);
    await expect(retryTransaction(run, pause)).resolves.toEqual({ id: 42 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledTimes(1);
  });
  it("limits deadlock retries to three complete attempts", async () => {
    const error = Object.assign(new Error("deadlock"), {
      code: "ER_LOCK_DEADLOCK",
    });
    const run = vi.fn().mockRejectedValue(error);
    await expect(retryTransaction(run, async () => {})).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it.each([
    "BUDGET_EXCEEDED",
    "PROTOCOL_CONNECTION_LOST",
    "ER_LOCK_WAIT_TIMEOUT",
  ])(
    "does not retry %s or risk replaying a possibly committed operation",
    async code => {
      const error = Object.assign(new Error(code), { code });
      const run = vi.fn().mockRejectedValue(error);
      await expect(retryTransaction(run, async () => {})).rejects.toBe(error);
      expect(run).toHaveBeenCalledTimes(1);
    }
  );
});
