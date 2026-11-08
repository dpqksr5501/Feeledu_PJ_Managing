import { randomUUID } from "node:crypto";
import type { Policy } from "../shared/types.ts";
export type SqlValue = string | number | null;
export interface Db {
  prepare(sql: string): {
    get(...args: SqlValue[]): Record<string, unknown> | undefined;
    all(...args: SqlValue[]): Record<string, unknown>[];
    run(...args: SqlValue[]): unknown;
  };
  exec(sql: string): unknown;
  close(): void;
  transactionSync?<T>(fn: () => T): T;
}
export const defaultPolicy: Policy = {
  academyName: "필에듀",
  weeklyEnabled: true,
  weeklyThresholdHours: 15,
  weeklyCapHours: 40,
  weeklyDivisor: 5,
  weekStartsOn: 1,
  holidayMultiplier: 1.5,
  holidayWeekdays: [],
  confirmed: false,
};
export function initializeDb(db: Db) {
  const versionTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
    )
    .get();
  if (versionTable) {
    const version = db
      .prepare("SELECT MAX(version) AS n FROM schema_version")
      .get() as { n: number };
    if (version.n > 3) {
      db.close();
      throw new Error(
        "이 데이터베이스는 더 최신 앱 버전으로 생성됐습니다. 앱을 업데이트해 주세요.",
      );
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO schema_version VALUES(1);
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','manager')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id), expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone_last4 TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '',
      weekly_enabled INTEGER NOT NULL DEFAULT 1, holiday_multiplier REAL,
      created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rates (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id),
      effective_from TEXT NOT NULL, hourly_rate INTEGER NOT NULL CHECK(hourly_rate > 0),
      reason TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(employee_id,effective_from));
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, last_seen TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pairing_codes (code_hash TEXT PRIMARY KEY, name TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id),
      started_at TEXT NOT NULL, ended_at TEXT, break_minutes INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
      voided INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift ON shifts(employee_id) WHERE ended_at IS NULL AND voided=0;
    CREATE INDEX IF NOT EXISTS shifts_dates ON shifts(started_at,ended_at);
    CREATE TABLE IF NOT EXISTS clock_events (
      id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
      employee_id TEXT NOT NULL REFERENCES employees(id), action TEXT NOT NULL,
      captured_at TEXT NOT NULL, received_at TEXT NOT NULL,
      status TEXT NOT NULL, review_reason TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL, shift_id TEXT REFERENCES shifts(id));
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS holidays (id TEXT PRIMARY KEY, date TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS adjustments (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), date TEXT NOT NULL,
      amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY, date_from TEXT NOT NULL, date_to TEXT NOT NULL, version INTEGER NOT NULL,
      total INTEGER NOT NULL, snapshot TEXT NOT NULL, fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES admins(id), reason TEXT NOT NULL,
      UNIQUE(date_from,date_to,version));
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  db.prepare("INSERT OR IGNORE INTO settings VALUES(1,?)").run(
    JSON.stringify(defaultPolicy),
  );
  transaction(db, () => {
    const columns = db.prepare("PRAGMA table_info(employees)").all();
    if (
      !db
        .prepare("PRAGMA table_info(sessions)")
        .all()
        .some((column) => column.name === "shared_tablet")
    )
      db.exec(
        "ALTER TABLE sessions ADD COLUMN shared_tablet INTEGER NOT NULL DEFAULT 0",
      );
    if (!columns.some((column) => column.name === "revision"))
      db.exec(
        "ALTER TABLE employees ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
      );
    db.prepare("INSERT OR IGNORE INTO schema_version VALUES(2)").run();
  });
  transaction(db, () => {
    db.exec(`CREATE TABLE IF NOT EXISTS day_rates (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id),
      date TEXT NOT NULL, hourly_rate INTEGER NOT NULL CHECK(hourly_rate > 0),
      reason TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(employee_id,date));`);
    db.prepare("INSERT OR IGNORE INTO schema_version VALUES(3)").run();
  });
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  if (db.transactionSync) return db.transactionSync(fn);
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function audit(
  db: Db,
  actor: string,
  action: string,
  target: string,
  detail: unknown,
) {
  db.prepare("INSERT INTO audit VALUES(?,?,?,?,?,?)").run(
    randomUUID(),
    actor,
    action,
    target,
    JSON.stringify(detail),
    new Date().toISOString(),
  );
}
export function getPolicy(db: Db): Policy {
  return JSON.parse(
    (
      db.prepare("SELECT json FROM settings WHERE id=1").get() as {
        json: string;
      }
    ).json,
  );
}
