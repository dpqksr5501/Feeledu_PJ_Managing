import {
  snapshotSchema as schema,
  snapshotTables,
  tablesForSnapshotSchema,
} from "../shared/snapshot-format.ts";
export { snapshotTables } from "../shared/snapshot-format.ts";
import { createHash } from "node:crypto";
import { seedDefaultJob, transaction, type Db } from "./database.ts";
import { DEFAULT_JOB_ID } from "../shared/jobs.ts";
import { attachShiftBreaks, breakError } from "./shift-breaks.ts";
import type { Shift } from "../shared/types.ts";
const checksum = (tables: unknown) =>
  createHash("sha256").update(JSON.stringify(tables)).digest("hex");
export function exportSnapshot(db: Db) {
  const schemaVersion = db
    .prepare("SELECT MAX(version) AS version FROM schema_version")
    .get()?.version;
  if (
    schemaVersion !== 3 &&
    schemaVersion !== 4 &&
    schemaVersion !== 5 &&
    schemaVersion !== 6
  )
    throw new Error(
      "백업을 만들기 전에 앱에서 데이터베이스를 업데이트해 주세요.",
    );
  const tables = Object.fromEntries(
    tablesForSnapshotSchema(schemaVersion).map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
  return {
    format: "feeledu-snapshot" as const,
    version: 1 as const,
    schema: schemaVersion,
    created_at: new Date().toISOString(),
    tables,
    checksum: checksum(tables),
  };
}
export function importSnapshotIntoEmptyDatabase(db: Db, input: unknown) {
  const snapshot = schema.parse(input);
  if (snapshot.checksum !== checksum(snapshot.tables))
    throw new Error("백업의 검사값이 일치하지 않습니다.");
  if (
    !snapshot.tables.admins.length ||
    !snapshot.tables.admins.some(
      (admin) => admin.role === "owner" && admin.active === 1,
    )
  )
    throw new Error("활성 개발자 계정이 없는 백업입니다.");
  transaction(db, () => {
    if (
      snapshotTables.some(
        (table) =>
          table !== "settings" &&
          (table === "job_roles"
            ? db
                .prepare("SELECT 1 FROM job_roles WHERE id<>? LIMIT 1")
                .get(DEFAULT_JOB_ID)
            : db.prepare(`SELECT 1 AS found FROM ${table} LIMIT 1`).get()),
      )
    )
      throw new Error(
        "빈 운영 DB에만 이전할 수 있습니다. 기존 기록은 덮어쓰지 않습니다.",
      );
    db.prepare("DELETE FROM settings").run();
    db.prepare("DELETE FROM job_roles WHERE id=?").run(DEFAULT_JOB_ID);
    // All table and column identifiers come from our schema, never the upload.
    for (const table of snapshotTables) {
      const rows = snapshot.tables[table];
      if (!rows?.length) continue;
      const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((column) => String(column.name));
      const insert = db.prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
      );
      for (const item of rows) {
        if (
          Object.keys(item).some((column) => !columns.includes(column)) ||
          columns.some((column) => !(column in item))
        )
          throw new Error(`${table} 백업의 열 구성이 올바르지 않습니다.`);
        insert.run(...columns.map((column) => item[column]));
      }
    }
    seedDefaultJob(db);
    if (
      !db
        .prepare("SELECT 1 FROM job_roles WHERE id=? AND active=1")
        .get(DEFAULT_JOB_ID)
    )
      throw new Error("백업의 기본 직무가 올바르지 않습니다.");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("백업의 연결된 기록을 확인해 주세요.");
    for (const shift of attachShiftBreaks(
      db,
      db
        .prepare(
          "SELECT s.* FROM shifts s WHERE EXISTS(SELECT 1 FROM shift_breaks b WHERE b.shift_id=s.id)",
        )
        .all() as unknown as Shift[],
    )) {
      const error = breakError(
        shift.started_at,
        shift.ended_at,
        shift.break_minutes,
        shift.breaks!,
      );
      if (error) throw new Error(error);
    }
  });
  return Object.fromEntries(
    snapshotTables.map((table) => [table, snapshot.tables[table]?.length ?? 0]),
  );
}
