import { test, expect } from "vitest";
import { fixture } from "./helpers.ts";
import { calculatePayroll } from "../server/payroll.ts";
import { holidayName, workedDates } from "../shared/workdays.ts";

test("one-day rates override the date only, recompute holiday/weekly pay and preserve finalized versions", async () => {
  const f = await fixture();
  try {
    await f.policy();
    const employee = await f.employee();
    for (const date of ["26", "27", "28"])
      await f.shift(
        employee,
        `2026-10-${date}T09:00:00+09:00`,
        `2026-10-${date}T14:00:00+09:00`,
      );
    await f.request("/admin/holidays", {
      date: "2026-10-27",
      name: "학원 휴일",
    });
    const original = calculatePayroll(f.db, "2026-10-26", "2026-11-01");
    expect(original.total).toBe(246000);
    expect(
      (
        await f.request("/admin/settlements", {
          from: original.from,
          to: original.to,
          fingerprint: original.fingerprint,
          reason: "변경 전 정산",
        })
      ).status,
    ).toBe(201);
    const rate = {
      date: "2026-10-27",
      hourly_rate: 20000,
      expectedRate: null,
      reason: "휴일 특별 시급",
    };
    expect(
      (
        await f.request(
          `/admin/employees/${employee}/day-rates`,
          rate,
          "POST",
          "",
        )
      ).status,
    ).toBe(401);
    expect(
      (await f.request(`/admin/employees/${employee}/day-rates`, rate)).status,
    ).toBe(200);
    expect(
      (await f.request(`/admin/employees/${employee}/day-rates`, rate)).status,
    ).toBe(409);
    const updated = calculatePayroll(f.db, original.from, original.to);
    expect(updated.rows[0]).toMatchObject({
      base: 220000,
      holiday: 50000,
      weekly: 44000,
      total: 314000,
    });
    expect(
      updated.rows[0].dailyDetails?.map((day) => [
        day.date,
        day.hourlyRate,
        day.specialRate,
      ]),
    ).toEqual([
      ["2026-10-26", 12000, false],
      ["2026-10-27", 20000, true],
      ["2026-10-28", 12000, false],
    ]);
    expect(updated.rows[0].dailyDetails?.[1].holidayName).toBe("학원 휴일");
    expect(updated.settlement!.snapshot.total).toBe(246000);
    expect(updated.difference).toBe(68000);
    await f.request(`/admin/employees/${employee}/rates`, {
      effective_from: "2026-10-26",
      hourly_rate: 13000,
      expectedRate: null,
      reason: "기본 시급 소급",
    });
    expect(calculatePayroll(f.db, original.from, original.to).total).toBe(
      326000,
    );
    expect(
      (
        await f.request(`/admin/employees/${employee}/day-rates/remove`, {
          date: rate.date,
          expectedRate: 15000,
          reason: "오래된 수정",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request(`/admin/employees/${employee}/day-rates/remove`, {
          date: rate.date,
          expectedRate: 20000,
          reason: "하루 시급 해제",
        })
      ).status,
    ).toBe(200);
    const restored = calculatePayroll(f.db, original.from, original.to);
    expect(restored.total).toBe(266500);
    expect(restored.settlement!.snapshot.total).toBe(246000);
    expect(
      (
        await f.request(`/admin/employees/${employee}/day-rates`, {
          ...rate,
          date: "2026-02-30",
        })
      ).status,
    ).toBe(400);
    expect((await f.request("/admin/employees")).data[0].day_rates).toEqual([]);
    expect(
      (await f.request("/admin/audit")).data.some(
        (entry: { action: string }) => entry.action === "dayrate.remove",
      ),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

test("splits a single-date override at Seoul midnight without leaking into the next date", async () => {
  const f = await fixture();
  try {
    await f.policy({ weeklyEnabled: false });
    const employee = await f.employee();
    await f.shift(
      employee,
      "2026-10-31T23:00:00+09:00",
      "2026-11-01T01:00:00+09:00",
      30,
    );
    await f.request(`/admin/employees/${employee}/day-rates`, {
      date: "2026-10-31",
      hourly_rate: 20000,
      expectedRate: null,
      reason: "하루 특별 시급",
    });
    expect(
      calculatePayroll(f.db, "2026-10-31", "2026-10-31").rows[0],
    ).toMatchObject({ seconds: 2700, base: 15000 });
    expect(
      calculatePayroll(f.db, "2026-11-01", "2026-11-01").rows[0],
    ).toMatchObject({ seconds: 2700, base: 9000 });
  } finally {
    await f.close();
  }
});

test("holiday filtering handles crossing midnight, an exact midnight end and the selected range", () => {
  const shift = {
    started_at: "2026-10-31T23:00:00+09:00",
    ended_at: "2026-11-01T01:00:00+09:00",
  };
  expect(workedDates(shift, "2026-10-31", "2026-11-01")).toEqual([
    "2026-10-31",
    "2026-11-01",
  ]);
  expect(workedDates(shift, "2026-11-01", "2026-11-01")).toEqual([
    "2026-11-01",
  ]);
  expect(
    workedDates(
      { ...shift, ended_at: "2026-11-01T00:00:00+09:00" },
      "2026-11-01",
      "2026-11-01",
    ),
  ).toEqual([]);
  expect(
    holidayName(
      "2026-11-01",
      [{ id: "holiday", date: "2026-11-01", name: "지정 휴일" }],
      { holidayWeekdays: [0] },
    ),
  ).toBe("지정 휴일");
  expect(holidayName("2026-11-01", [], { holidayWeekdays: [0] })).toBe(
    "정기 휴일",
  );
});

test("shared tablet sessions expire on the server and only deliberate activity extends them", async () => {
  const f = await fixture();
  try {
    const logged = await f.request(
      "/login",
      {
        username: "test-owner",
        password: "test-only-password-123",
        sharedTablet: true,
      },
      "POST",
      "",
    );
    expect(logged.status).toBe(200);
    const cookie = logged.response.headers.get("set-cookie")!.split(";")[0];
    const me = await f.request("/admin/me", undefined, "GET", cookie);
    expect(me.data.shared_tablet).toBe(1);
    const session = () =>
      f.db.prepare("SELECT * FROM sessions WHERE shared_tablet=1").get()!;
    expect(
      Date.parse(String(session().expires_at)) - Date.now(),
    ).toBeLessThanOrEqual(120000);
    f.db
      .prepare("UPDATE sessions SET expires_at=? WHERE shared_tablet=1")
      .run(new Date(Date.now() + 45000).toISOString());
    const expires = session().expires_at;
    await f.request("/admin/employees", undefined, "GET", cookie);
    expect(session().expires_at).toBe(expires);
    expect(
      (await f.request("/admin/activity", {}, "POST", cookie)).status,
    ).toBe(200);
    expect(
      Date.parse(String(session().expires_at)) - Date.now(),
    ).toBeGreaterThan(110000);
    f.db
      .prepare("UPDATE sessions SET expires_at=? WHERE shared_tablet=1")
      .run("2000-01-01T00:00:00.000Z");
    expect(
      (await f.request("/admin/activity", {}, "POST", cookie)).status,
    ).toBe(401);
    expect(
      (await f.request("/admin/employees", undefined, "GET", cookie)).status,
    ).toBe(401);
    expect((await f.request("/admin/me")).status).toBe(200);
  } finally {
    await f.close();
  }
});
