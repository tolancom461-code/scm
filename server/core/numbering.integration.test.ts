import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { documentSequences } from "../../drizzle/foundation";
import { closeDb } from "../db";
import { database } from "./database";
import { allocateDocumentNumber } from "./numbering";

describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "central number allocation",
  () => {
    const prefix =
      "NR" +
      randomUUID()
        .replaceAll("-", "")
        .slice(0, 10)
        .split("")
        .map(c => String.fromCharCode(65 + parseInt(c, 16)))
        .join("");
    const reserve = async (date: string) =>
      (await database()).transaction(tx =>
        allocateDocumentNumber(tx, prefix, new Date(date))
      );
    afterAll(async () => {
      try {
        await (await database())
          .delete(documentSequences)
          .where(eq(documentSequences.prefix, prefix));
      } finally {
        await closeDb();
      }
    }, 60000);

    it("keeps a single annual counter across months and starts a new year", async () => {
      expect(await reserve("2038-10-01T00:00:00Z")).toBe(
        `${prefix}-38-10-0001`
      );
      expect(await reserve("2038-11-01T00:00:00Z")).toBe(
        `${prefix}-38-11-0002`
      );
      expect(await reserve("2038-12-31T21:00:00Z")).toBe(
        `${prefix}-39-01-0001`
      );
    }, 60000);
    it("rolls back the counter with a failed document transaction", async () => {
      await expect(
        (await database()).transaction(async tx => {
          await allocateDocumentNumber(
            tx,
            prefix,
            new Date("2039-01-01T00:00:00Z")
          );
          throw new Error("Document rejected");
        })
      ).rejects.toThrow("Document rejected");
      expect(await reserve("2039-01-01T00:00:00Z")).toBe(
        `${prefix}-39-01-0002`
      );
    }, 60000);
    it("allocates unique serials under simultaneous saves", async () => {
      const numbers = await Promise.all(
        Array.from({ length: 12 }, () => reserve("2039-02-01T00:00:00Z"))
      );
      expect(new Set(numbers).size).toBe(12);
      expect(
        numbers.map(n => Number(n.split("-").at(-1))).sort((a, b) => a - b)
      ).toEqual(Array.from({ length: 12 }, (_, i) => i + 3));
    }, 90000);
  }
);
