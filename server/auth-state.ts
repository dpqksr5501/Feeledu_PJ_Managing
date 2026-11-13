import type { Db } from "./database.ts";
import {
  ADMIN_IDLE_MS,
  ADMIN_SESSION_MAX_MS,
} from "../shared/session-policy.ts";
export const PC_IDLE_MS = ADMIN_IDLE_MS;
export const TABLET_IDLE_MS = ADMIN_IDLE_MS;
export const SESSION_MAX_MS = ADMIN_SESSION_MAX_MS;
const WINDOW_MS = 15 * 60000;
export function initializeAuthState(db: Db) {
  // Operational state is deliberately excluded from business data snapshots.
  db.exec(`CREATE TABLE IF NOT EXISTS auth_failures (key TEXT PRIMARY KEY, failures INTEGER NOT NULL, window_started INTEGER NOT NULL, blocked_until INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS auth_failure_window ON auth_failures(window_started);
    CREATE TABLE IF NOT EXISTS session_deadlines (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, absolute_expires_at TEXT NOT NULL);`);
}
export function authBackoff(db: Db, key: string) {
  const row = db
    .prepare("SELECT blocked_until FROM auth_failures WHERE key=?")
    .get(key) as { blocked_until: number } | undefined;
  return Math.max(
    0,
    Math.ceil(((row?.blocked_until || 0) - Date.now()) / 1000),
  );
}
export function recordAuthFailure(db: Db, key: string) {
  const now = Date.now();
  db.prepare("DELETE FROM auth_failures WHERE window_started<?").run(
    now - WINDOW_MS,
  );
  const row = db
    .prepare("SELECT failures FROM auth_failures WHERE key=?")
    .get(key) as { failures: number } | undefined;
  const failures = (row?.failures || 0) + 1;
  const delay =
    failures < 5 ? 0 : Math.min(300000, 30000 * 2 ** Math.min(4, failures - 5));
  db.prepare(
    "INSERT INTO auth_failures VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until",
  ).run(key, failures, now, now + delay);
}
export function clearAuthFailures(db: Db, key: string) {
  db.prepare("DELETE FROM auth_failures WHERE key=?").run(key);
}
