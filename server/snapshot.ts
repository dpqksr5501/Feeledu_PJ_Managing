import {
  snapshotSchema as schema,
  snapshotTables,
} from "../shared/snapshot-format.ts";
export { snapshotTables } from "../shared/snapshot-format.ts";
import { createHash } from "node:crypto";
import { transaction, type Db } from "./database.ts";
import { attachShiftBreaks, breakError } from "./shift-breaks.ts";
import type { Shift } from "../shared/types.ts";
const checksum = (tables: unknown) =>
  createHash("sha256").update(JSON.stringify(tables)).digest("hex");
export function exportSnapshot(db: Db) {
  const tables = Object.fromEntries(
    snapshotTables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
  return {
    format: "feeledu-snapshot" as const,
    version: 1 as const,
    schema: 5 as const,
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
    throw new Error("활성 운영자 계정이 없는 백업입니다.");
  transaction(db, () => {
    if (
      snapshotTables.some(
        (table) =>
          table !== "settings" &&
          db.prepare(`SELECT 1 AS found FROM ${table} LIMIT 1`).get(),
      )
    )
      throw new Error(
        "빈 운영 DB에만 이전할 수 있습니다. 기존 기록은 덮어쓰지 않습니다.",
      );
    db.prepare("DELETE FROM settings").run();
    // All table and column identifiers come from our schema, never the upload.
    for (const table of snapshotTables) {
      const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((column) => String(column.name));
      for (const item of snapshot.tables[table] ?? []) {
        if (
          Object.keys(item).some((column) => !columns.includes(column)) ||
          columns.some((column) => !(column in item))
        )
          throw new Error(`${table} 백업의 열 구성이 올바르지 않습니다.`);
        db.prepare(
          `INSERT INTO ${table} (${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((column) => item[column]));
      }
    }
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
