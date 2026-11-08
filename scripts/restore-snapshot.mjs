import { existsSync, readFileSync } from "node:fs";
import { openDb } from "../server/db.ts";
import { importSnapshotIntoEmptyDatabase } from "../server/snapshot.ts";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "Usage: node scripts/restore-snapshot.mjs <backup.json> <new-database.db>",
  );
if (
  existsSync(output) ||
  existsSync(output + "-wal") ||
  existsSync(output + "-shm")
)
  throw new Error("출력 파일이 이미 있습니다. 새 경로를 지정해 주세요.");
const snapshot = JSON.parse(readFileSync(input, "utf8"));
const db = openDb(output);
try {
  const counts = importSnapshotIntoEmptyDatabase(db, snapshot);
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("복구 DB의 무결성 검사가 실패했습니다.");
  console.log(JSON.stringify({ ok: true, counts }));
} finally {
  db.close();
}
