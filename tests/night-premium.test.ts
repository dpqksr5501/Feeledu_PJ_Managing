import { afterEach, beforeEach, expect, test } from "vitest";
import { fixture } from "./helpers.ts";
import { calculatePayroll } from "../server/payroll.ts";
import { attendanceWeek } from "../server/attendance.ts";
import {
  exportSnapshot,
  importSnapshotIntoEmptyDatabase,
} from "../server/snapshot.ts";
import { openDb } from "../server/db.ts";
import { inspectSnapshot } from "../shared/snapshot-format.ts";
import { createHash } from "node:crypto";
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
  await f.policy({ weeklyEnabled: false });
});
afterEach(async () => {
  await f.close();
});
const row = (from = "2026-10-26", to = "2026-11-01") =>
  calculatePayroll(f.db, from, to).rows[0];

test.each([
  ["2026-10-26T21:00:00", "2026-10-26T22:00:00", 0],
  ["2026-10-26T06:00:00", "2026-10-26T07:00:00", 0],
  ["2026-10-26T21:00:00", "2026-10-27T07:00:00", 8 * 3600],
  ["2026-10-26T22:00:00", "2026-10-27T04:00:00", 6 * 3600],
  ["2026-10-26T04:00:00", "2026-10-27T04:00:00", 8 * 3600],
  ["2026-10-26T21:59:59.500", "2026-10-26T22:00:00.500", 0.5],
  ["2026-10-26T05:59:59.500", "2026-10-26T06:00:00.500", 0.5],
])("Seoul night boundaries: %s to %s", async (start, end, nightSeconds) => {
  const id = await f.employee();
  expect((await f.shift(id, start + "+09:00", end + "+09:00")).status).toBe(
    201,
  );
  expect(row().night).toBe(Math.round((nightSeconds / 3600) * 12000 * 0.5));
  expect(row().nightSeconds).toBe(Math.round(nightSeconds));
  expect(row().total).toBe(row().base + row().night!);
});

test("holiday and night premiums add, monthly/day rates split at midnight and finalized history stays immutable", async () => {
  const id = await f.employee();
  await f.request("/admin/holidays", { date: "2026-11-01", name: "지정 휴일" });
  await f.request(`/admin/employees/${id}/rates`, {
    effective_from: "2026-11-01",
    hourly_rate: 18000,
    reason: "월 시급 인상",
    expectedRate: null,
  });
  await f.request(`/admin/employees/${id}/day-rates`, {
    date: "2026-11-01",
    hourly_rate: 15000,
    reason: "하루 예외",
    expectedRate: null,
  });
  await f.shift(id, "2026-10-31T22:00:00+09:00", "2026-11-01T04:00:00+09:00");
  const original = calculatePayroll(f.db, "2026-10-31", "2026-11-01");
  expect(original.rows[0]).toMatchObject({
    base: 84000,
    holiday: 30000,
    night: 42000,
    nightSeconds: 21600,
    total: 156000,
  });
  expect(row("2026-10-31", "2026-10-31")).toMatchObject({
    night: 12000,
    total: 36000,
  });
  expect(row("2026-11-01", "2026-11-01")).toMatchObject({
    night: 30000,
    total: 120000,
  });
  expect(
    (
      await f.request("/admin/settlements", {
        from: original.from,
        to: original.to,
        fingerprint: original.fingerprint,
        reason: "야간 정산 확정",
      })
    ).status,
  ).toBe(201);
  await f.policy({ nightPremiumRate: 0.6 });
  const revised = calculatePayroll(f.db, original.from, original.to);
  expect(revised.rows[0].night).toBe(50400);
  expect(revised.settlement!.snapshot.rows[0].night).toBe(42000);
  expect(revised.difference).toBe(8400);
});

test("actual breaks outside/inside night hours subtract exactly, duplicate/overlap/mismatch edits roll back, old tabs preserve intervals", async () => {
  const id = await f.employee();
  const body = {
    employee_id: id,
    started_at: "2026-10-26T21:00:00+09:00",
    ended_at: "2026-10-27T07:00:00+09:00",
    break_minutes: 60,
    note: "",
    reason: "실제 휴게 입력",
    breaks: [
      {
        started_at: "2026-10-26T21:15:00+09:00",
        ended_at: "2026-10-26T21:45:00+09:00",
      },
      {
        started_at: "2026-10-27T02:00:00+09:00",
        ended_at: "2026-10-27T02:30:00+09:00",
      },
    ],
  };
  const created = await f.request("/admin/records", body);
  expect(created.status).toBe(201);
  expect(row()).toMatchObject({
    seconds: 32400,
    base: 108000,
    night: 45000,
    nightSeconds: 27000,
    total: 153000,
    warnings: [],
  });
  const list = await f.request("/admin/records?from=2026-10-26&to=2026-10-27");
  const saved = list.data[0];
  expect(saved.breaks).toHaveLength(2);
  expect(
    attendanceWeek(f.db, "2026-10-26")
      .employees[0].days.slice(0, 2)
      .map((day) => day.completedSeconds),
  ).toEqual([9000, 23400]);
  // Old clients omit breaks on note-only edits; they cannot discard them.
  expect(
    (
      await f.request(
        `/admin/records/${created.data.id}`,
        { ...body, breaks: undefined, revision: 1, note: "메모만 정정" },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  for (const change of [
    { breaks: [...body.breaks, body.breaks[0]] },
    { break_minutes: 59 },
    {
      breaks: [
        {
          started_at: "2026-10-26T20:00:00+09:00",
          ended_at: "2026-10-26T21:00:00+09:00",
        },
      ],
    },
    {
      breaks: [
        {
          started_at: body.breaks[0].ended_at,
          ended_at: body.breaks[0].started_at,
        },
      ],
    },
  ])
    expect(
      (
        await f.request(
          `/admin/records/${created.data.id}`,
          { ...body, ...change, revision: 2 },
          "PATCH",
        )
      ).status,
    ).toBe(400);
  expect(row().night).toBe(45000);
  expect(f.db.prepare("SELECT revision FROM shifts").get()!.revision).toBe(2);
});

test("unknown break placement is visibly estimated and cannot be finalized until corrected", async () => {
  const id = await f.employee();
  const created = await f.shift(
    id,
    "2026-10-26T21:00:00+09:00",
    "2026-10-27T07:00:00+09:00",
    60,
  );
  let payroll = calculatePayroll(f.db, "2026-10-26", "2026-10-27");
  expect(payroll.rows[0].night).toBe(43200); // explicit proportional preview
  expect(payroll.rows[0].warnings.join()).toContain("비례 추정");
  expect(
    (
      await f.request("/admin/settlements", {
        from: payroll.from,
        to: payroll.to,
        fingerprint: payroll.fingerprint,
        reason: "휴게 미확인",
      })
    ).status,
  ).toBe(409);
  const saved = (
    await f.request("/admin/records?from=2026-10-26&to=2026-10-27")
  ).data[0];
  expect(
    (
      await f.request(
        `/admin/records/${created.data.id}`,
        {
          ...saved,
          breaks: [
            {
              started_at: "2026-10-26T21:00:00+09:00",
              ended_at: "2026-10-26T22:00:00+09:00",
            },
          ],
          reason: "실제 휴게 확인",
        },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  payroll = calculatePayroll(f.db, payroll.from, payroll.to);
  expect(payroll.rows[0]).toMatchObject({ night: 48000, warnings: [] });
  expect(
    (
      await f.request("/admin/settlements", {
        from: payroll.from,
        to: payroll.to,
        fingerprint: payroll.fingerprint,
        reason: "실제 휴게 확인",
      })
    ).status,
  ).toBe(201);
});

test("night additions never inflate weekly allowance and disabled night policy remains explicit", async () => {
  await f.policy({ weeklyEnabled: true });
  const id = await f.employee();
  for (const day of ["26", "27", "28"])
    await f.shift(
      id,
      `2026-10-${day}T00:00:00+09:00`,
      `2026-10-${day}T05:00:00+09:00`,
    );
  expect(row()).toMatchObject({ weekly: 36000, night: 90000, total: 306000 });
  await f.policy({ nightEnabled: false });
  expect(row()).toMatchObject({
    weekly: 36000,
    night: 0,
    nightSeconds: 54000,
    total: 216000,
  });
});

test("schema-5 backup round-trip preserves actual breaks and rejects corrupt intervals atomically; schema-4 backups still restore", async () => {
  const id = await f.employee();
  const created = await f.shift(
    id,
    "2026-10-26T21:00:00+09:00",
    "2026-10-27T07:00:00+09:00",
    60,
  );
  const saved = (
    await f.request("/admin/records?from=2026-10-26&to=2026-10-27")
  ).data[0];
  await f.request(
    `/admin/records/${created.data.id}`,
    {
      ...saved,
      breaks: [
        {
          started_at: "2026-10-27T02:00:00+09:00",
          ended_at: "2026-10-27T03:00:00+09:00",
        },
      ],
      reason: "실제 휴게 확인",
    },
    "PATCH",
  );
  const snapshot = exportSnapshot(f.db);
  await expect(inspectSnapshot(snapshot)).resolves.toMatchObject({ shifts: 1 });
  const restored = openDb(":memory:"),
    invalid = openDb(":memory:"),
    legacyTarget = openDb(":memory:");
  try {
    expect(
      importSnapshotIntoEmptyDatabase(restored, snapshot).shift_breaks,
    ).toBe(1);
    expect(
      calculatePayroll(restored, "2026-10-26", "2026-10-27").rows[0],
    ).toEqual(row("2026-10-26", "2026-10-27"));
    const corrupt = structuredClone(snapshot);
    corrupt.tables.shift_breaks[0].ended_at = "2026-10-27T03:00:00.000Z";
    corrupt.checksum = createHash("sha256")
      .update(JSON.stringify(corrupt.tables))
      .digest("hex");
    expect(() => importSnapshotIntoEmptyDatabase(invalid, corrupt)).toThrow(
      /휴게/,
    );
    expect(invalid.prepare("SELECT * FROM employees").all()).toEqual([]);
    const legacy = structuredClone(snapshot) as unknown as {
      schema: number;
      tables: Record<string, unknown>;
      checksum: string;
    };
    legacy.schema = 4;
    delete legacy.tables.shift_breaks;
    legacy.checksum = createHash("sha256")
      .update(JSON.stringify(legacy.tables))
      .digest("hex");
    expect(
      importSnapshotIntoEmptyDatabase(legacyTarget, legacy).shift_breaks,
    ).toBe(0);
    expect(
      calculatePayroll(
        legacyTarget,
        "2026-10-26",
        "2026-10-27",
      ).rows[0].warnings.join(),
    ).toContain("비례 추정");
  } finally {
    restored.close();
    invalid.close();
    legacyTarget.close();
  }
});
