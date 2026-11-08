// One-time copy into an empty Cloudflare deployment. Never logs credentials or rows.
import { DatabaseSync } from "node:sqlite";
import { exportSnapshot, snapshotTables } from "../server/snapshot.ts";
const [destination, source = "data/feeledu.db"] = process.argv.slice(2);
if (!destination)
  throw new Error(
    "Usage: node scripts/cloud-migrate.mjs <https://worker-url> [source-db]",
  );
const url = new URL(destination);
if (url.protocol !== "https:" || !url.hostname.endsWith(".workers.dev"))
  throw new Error("검증한 HTTPS workers.dev 배포 주소를 지정해 주세요.");
if (!process.env.MIGRATION_TOKEN)
  throw new Error(
    "MIGRATION_TOKEN 환경변수가 필요합니다. 명령 인수에 토큰을 넣지 마세요.",
  );
const db = new DatabaseSync(source, { readOnly: true });
let snapshot;
try {
  db.exec("BEGIN");
  snapshot = exportSnapshot(db);
  db.exec("COMMIT");
} finally {
  db.close();
}
const response = await fetch(new URL("/api/deployment/import", url), {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + process.env.MIGRATION_TOKEN,
  },
  body: JSON.stringify(snapshot),
  signal: AbortSignal.timeout(60000),
});
const result = await response.json();
if (!response.ok || !result.ok)
  throw new Error(result.error || "데이터 이전에 실패했습니다.");
if (
  snapshotTables.some(
    (table) => result.counts[table] !== snapshot.tables[table].length,
  )
)
  throw new Error(
    "이전 후 건수가 일치하지 않습니다. 원본을 유지하고 관리자 확인이 필요합니다.",
  );
console.log(JSON.stringify({ ok: true, counts: result.counts }));
