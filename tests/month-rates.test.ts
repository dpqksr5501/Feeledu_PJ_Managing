import { test, expect } from "vitest";
import { fixture } from "./helpers.ts";
import { calculatePayroll } from "../server/payroll.ts";
import { rateMonthVersion } from "../shared/rate-month.ts";
import type { Rate } from "../shared/types.ts";

test("monthly rates consolidate legacy mid-month changes, preserve later months/day exceptions, and reject stale editors", async () => {
  const f = await fixture();
  try {
    await f.policy({ weeklyEnabled: false });
    const id = await f.employee();
    const rates = () =>
      f.db
        .prepare("SELECT * FROM rates WHERE employee_id=?")
        .all(id) as unknown as Rate[];
    const monthly = (
      month: string,
      rate: number,
      expected = rateMonthVersion(rates(), month),
    ) =>
      f.request(`/admin/employees/${id}/month-rates`, {
        month,
        hourly_rate: rate,
        reason: "월 시급 변경 검증",
        expected,
      });
    for (const [effective_from, hourly_rate] of [
      ["2026-10-05", 14000],
      ["2026-10-15", 16000],
    ] as const)
      expect(
        (
          await f.request(`/admin/employees/${id}/rates`, {
            effective_from,
            hourly_rate,
            reason: "기존 날짜 기준 이력",
            expectedRate: null,
          })
        ).status,
      ).toBe(200);
    expect((await monthly("2026-11", 13000)).status).toBe(200);
    await f.shift(id, "2026-10-20T09:00:00+09:00", "2026-10-20T10:00:00+09:00");
    await f.request(`/admin/employees/${id}/day-rates`, {
      date: "2026-10-31",
      hourly_rate: 20000,
      expectedRate: null,
      reason: "하루 예외 시급",
    });
    await f.shift(id, "2026-10-31T22:00:00+09:00", "2026-11-01T04:00:00+09:00");
    await f.request("/admin/holidays", {
      date: "2026-10-31",
      name: "지정 휴일",
    });
    const before = calculatePayroll(f.db, "2026-10-31", "2026-11-01");
    const saved = await f.request("/admin/settlements", {
      from: before.from,
      to: before.to,
      fingerprint: before.fingerprint,
      reason: "변경 전 정산 보존",
    });
    expect(saved.status).toBe(201);
    const stale = rateMonthVersion(rates(), "2026-10");
    expect((await monthly("2026-10", 11000)).status).toBe(200);
    expect((await monthly("2026-10", 15000, stale)).status).toBe(409);
    expect(
      rates().filter((row) => row.effective_from.startsWith("2026-10")),
    ).toMatchObject([{ effective_from: "2026-10-01", hourly_rate: 11000 }]);
    expect(
      rates().find((row) => row.effective_from === "2026-11-01")?.hourly_rate,
    ).toBe(13000);
    expect(
      rates().find((row) => row.effective_from === "2026-01-01")?.hourly_rate,
    ).toBe(12000);
    const after = calculatePayroll(f.db, before.from, before.to);
    expect(after.rows[0]).toMatchObject({
      seconds: 21600,
      base: 92000,
      holiday: 20000,
      total: 112000,
    });
    expect(
      f.db
        .prepare("SELECT hourly_rate FROM day_rates WHERE employee_id=?")
        .get(id)?.hourly_rate,
    ).toBe(20000);
    expect(
      (await f.request(`/admin/settlements/${saved.data.id}`)).data.total,
    ).toBe(before.total);
    expect(
      calculatePayroll(f.db, "2026-10-01", "2026-10-31").rows[0].base,
    ).toBe(51000);
    expect((await monthly("2026-11", 14000)).status).toBe(200);
    const revised = calculatePayroll(f.db, before.from, before.to);
    expect(revised.difference).toBe(4000);
    expect(revised.settlement?.snapshot.total).toBe(before.total);
    for (const month of [
      "2026-00",
      "2026-13",
      "2026-1",
      "2026-11-01",
      "9999-12",
    ])
      expect((await monthly(month, 12000)).status).toBe(400);
  } finally {
    await f.close();
  }
});
