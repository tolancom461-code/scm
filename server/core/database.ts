import { getDb } from "../db";
import { DomainError } from "./errors";
import { retryTransaction } from "./transaction-retry";

export type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const transactional = new WeakMap<Database, Database>();

export async function database(): Promise<Database> {
  const db = await getDb();
  if (!db) throw new DomainError("SERVICE_UNAVAILABLE");
  let facade = transactional.get(db);
  if (!facade) {
    facade = new Proxy(db, {
      get(target, property) {
        if (property === "transaction") {
          const transaction: Database["transaction"] = (callback, config) =>
            retryTransaction(() => target.transaction(callback, config));
          return transaction;
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    transactional.set(db, facade);
  }
  return facade;
}
