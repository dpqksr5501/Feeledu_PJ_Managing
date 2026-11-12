import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { openDb } from "../server/db.ts";
import { overlappingShift, shiftRangeSql } from "../server/shift-query.ts";

function workspace() {
  const folder = mkdtempSync(join(tmpdir(), "feeledu-migration-"));
  return {
    path: join(folder, "migration.db"),
    close() {
      if (
        dirname(folder) === resolve(tmpdir()) &&
        basename(folder).startsWith("feeledu-migration-")
      )
        rmSync(folder, { recursive: true, force: true });
    },
  };
}
test("indexed range preserves cross-midnight, long open, voided and exact boundary semantics", () => {
  const db = openDb(":memory:");
  try {
    db.prepare(
      "INSERT INTO employees(id,name,phone_last4,created_at) VALUES('e','조교','0012','2026-01-01')",
    ).run();
    const insert = db.prepare(
      "INSERT INTO shifts(id,employee_id,started_at,ended_at,voided,source,created_at) VALUES(?,'e',?,?,?,'manual','2026-01-01')",
    );
    insert.run("long-open", "2025-01-01T00:00:00.000Z", null, 0);
    insert.run(
      "crossing",
      "2026-11-10T23:00:00.000Z",
      "2026-11-11T03:00:00.000Z",
      0,
    );
    insert.run(
      "before",
      "2026-11-10T22:00:00.000Z",
      "2026-11-11T00:00:00.000Z",
      0,
    );
    insert.run(
      "after",
      "2026-11-12T00:00:00.000Z",
      "2026-11-12T02:00:00.000Z",
      0,
    );
    insert.run(
      "voided",
      "2026-11-11T01:00:00.000Z",
      "2026-11-11T02:00:00.000Z",
      1,
    );
    const begin = "2026-11-11T00:00:00.000Z",
      end = "2026-11-12T00:00:00.000Z";
    expect(
      db
        .prepare(shiftRangeSql())
        .all(end, begin, end)
        .map((s) => s.id),
    ).toEqual(["long-open", "crossing"]);
    expect(
      db
        .prepare(shiftRangeSql(true))
        .all(end, begin, end)
        .map((s) => s.id),
    ).toEqual(["voided", "crossing", "long-open"]);
    expect(overlappingShift(db, "e", begin, end)?.id).toBe("long-open");
    expect(overlappingShift(db, "e", begin, end, "long-open")?.id).toBe(
      "crossing",
    );
    expect(
      overlappingShift(db, "e", "2026-11-11T03:00:00.000Z", end, "long-open"),
    ).toBeUndefined();
    expect(
      overlappingShift(db, "e", "2026-11-11T03:00:00.000Z", null, "long-open")
        ?.id,
    ).toBe("after");
  } finally {
    db.close();
  }
});
test("migrates a version-1 employee without dropping data and can safely reopen the result", () => {
  const temporary = workspace();
  try {
    const old = new DatabaseSync(temporary.path);
    old.exec(`CREATE TABLE schema_version(version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES(1);
      CREATE TABLE employees(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone_last4 TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,note TEXT NOT NULL DEFAULT '',weekly_enabled INTEGER NOT NULL DEFAULT 1,holiday_multiplier REAL,created_at TEXT NOT NULL);
      INSERT INTO employees VALUES('preserved-employee','이전 버전 조교','0012',1,'기존 메모',1,1.8,'2026-10-01T00:00:00.000Z');`);
    old.close();
    for (let opening = 0; opening < 2; opening++) {
      const migrated = openDb(temporary.path);
      try {
        expect(migrated.prepare("SELECT * FROM employees").get()).toMatchObject(
          {
            id: "preserved-employee",
            name: "이전 버전 조교",
            phone_last4: "0012",
            note: "기존 메모",
            holiday_multiplier: 1.8,
            revision: 1,
          },
        );
        expect(
          migrated
            .prepare("SELECT MAX(version) AS n FROM schema_version")
            .get()!.n,
        ).toBe(3);
        expect(
          migrated.prepare("PRAGMA integrity_check").get()!.integrity_check,
        ).toBe("ok");
      } finally {
        migrated.close();
      }
    }
  } finally {
    temporary.close();
  }
});
test("refuses a future schema before modifying the database", () => {
  const temporary = workspace();
  try {
    const future = new DatabaseSync(temporary.path);
    future.exec(
      "CREATE TABLE schema_version(version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES(4); CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('보존할 원본');",
    );
    future.close();
    expect(() => openDb(temporary.path)).toThrow(/더 최신 앱 버전/);
    const checked = new DatabaseSync(temporary.path, { readOnly: true });
    try {
      expect(checked.prepare("SELECT value FROM sentinel").get()!.value).toBe(
        "보존할 원본",
      );
      expect(
        checked
          .prepare("SELECT name FROM sqlite_master WHERE name='employees'")
          .get(),
      ).toBeUndefined();
    } finally {
      checked.close();
    }
  } finally {
    temporary.close();
  }
});

test("upgrades a version-2 login session without changing its owner or expiry", () => {
  const temporary = workspace();
  try {
    const old = new DatabaseSync(temporary.path);
    old.exec(`CREATE TABLE schema_version(version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES(2);
      CREATE TABLE admins(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL,created_at TEXT NOT NULL);
      INSERT INTO admins VALUES('owner','owner','기존 운영자','existing-hash','owner',1,'2026-01-01');
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES admins(id),expires_at TEXT NOT NULL);
      INSERT INTO sessions VALUES('existing-token','owner','2027-01-01T00:00:00.000Z');`);
    old.close();
    const migrated = openDb(temporary.path);
    try {
      expect(migrated.prepare("SELECT * FROM sessions").get()).toEqual({
        token_hash: "existing-token",
        admin_id: "owner",
        expires_at: "2027-01-01T00:00:00.000Z",
        shared_tablet: 0,
      });
      expect(migrated.prepare("SELECT * FROM day_rates").all()).toEqual([]);
      expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated.close();
    }
  } finally {
    temporary.close();
  }
});
