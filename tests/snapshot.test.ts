import { test, expect } from "vitest";
import { openDb } from "../server/db.ts";
import {
  passwordHash as nativeHash,
  passwordMatches as nativeMatches,
} from "../server/security.ts";
import {
  passwordHash as cloudHash,
  passwordMatches as cloudMatches,
} from "../cloudflare/security.ts";
import {
  exportSnapshot,
  importSnapshotIntoEmptyDatabase,
} from "../server/snapshot.ts";
import { createHash } from "node:crypto";
import { inspectSnapshot } from "../shared/snapshot-format.ts";

test("cloud and Node verify each other's passwords, including existing UTF-8 passwords", () => {
  const password = "학원 관리자 암호-1234";
  expect(cloudMatches(password, nativeHash(password))).toBe(true);
  expect(nativeMatches(password, cloudHash(password))).toBe(true);
  expect(cloudMatches("different", nativeHash(password))).toBe(false);
});
test("portable snapshots preserve employees and settings, reject corruption and never overwrite an operating DB", async () => {
  const source = openDb(":memory:"),
    destination = openDb(":memory:");
  try {
    source
      .prepare("INSERT INTO admins VALUES(?,?,?,?,?,?,?)")
      .run(
        "owner",
        "owner",
        "원본 운영자",
        nativeHash("test-password-123"),
        "owner",
        1,
        "2026-01-01",
      );
    source
      .prepare(
        "INSERT INTO employees (id,name,phone_last4,created_at) VALUES(?,?,?,?)",
      )
      .run("employee", "원본 조교", "0012", "2026-01-01");
    const snapshot = exportSnapshot(source);
    await expect(
      inspectSnapshot(JSON.parse(JSON.stringify(snapshot))),
    ).resolves.toMatchObject({ employees: 1, shifts: 0, events: 0 });
    const corrupt = structuredClone(snapshot);
    corrupt.tables.employees[0].name = "수정된 백업";
    await expect(inspectSnapshot(corrupt)).rejects.toThrow(/검사값/);
    expect(() => importSnapshotIntoEmptyDatabase(destination, corrupt)).toThrow(
      /검사값/,
    );
    expect(destination.prepare("SELECT * FROM admins").all()).toEqual([]);
    const count = importSnapshotIntoEmptyDatabase(destination, snapshot);
    expect(count.employees).toBe(1);
    expect(
      destination.prepare("SELECT name,phone_last4 FROM employees").get(),
    ).toEqual({ name: "원본 조교", phone_last4: "0012" });
    expect(() =>
      importSnapshotIntoEmptyDatabase(destination, snapshot),
    ).toThrow(/덮어쓰지/);
    expect(
      destination.prepare("SELECT COUNT(*) AS n FROM employees").get()!.n,
    ).toBe(1);
  } finally {
    source.close();
    destination.close();
  }
});
test("an invalid reference rolls back an entire import, including the default settings", () => {
  const source = openDb(":memory:"),
    destination = openDb(":memory:");
  try {
    source
      .prepare("INSERT INTO admins VALUES(?,?,?,?,?,?,?)")
      .run(
        "owner",
        "owner",
        "원본 운영자",
        nativeHash("test-password-123"),
        "owner",
        1,
        "2026-01-01",
      );
    const snapshot = exportSnapshot(source);
    snapshot.tables.rates.push({
      id: "orphan",
      employee_id: "missing",
      effective_from: "2026-01-01",
      hourly_rate: 12000,
      reason: "잘못된 참조",
      created_at: "2026-01-01",
    });
    snapshot.checksum = createHash("sha256")
      .update(JSON.stringify(snapshot.tables))
      .digest("hex");
    expect(() =>
      importSnapshotIntoEmptyDatabase(destination, snapshot),
    ).toThrow();
    expect(destination.prepare("SELECT * FROM admins").all()).toEqual([]);
    expect(destination.prepare("SELECT * FROM settings").all()).toHaveLength(1);
  } finally {
    source.close();
    destination.close();
  }
});
