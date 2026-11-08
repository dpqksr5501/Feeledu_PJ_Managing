import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { initializeDb } from "./database.ts";
export {
  defaultPolicy,
  initializeDb,
  transaction,
  audit,
  getPolicy,
} from "./database.ts";
export type { Db } from "./database.ts";
export function openDb(path = "data/feeledu.db") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000",
  );
  initializeDb(db);
  return db;
}
