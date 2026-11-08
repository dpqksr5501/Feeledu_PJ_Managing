import { test, expect } from "vitest";
import { fixture } from "./helpers.ts";
import { attendanceWeek } from "../server/attendance.ts";
import { calculatePayroll } from "../server/payroll.ts";

test("weekly attendance enforces authentication, validates dates and follows the configured week", async () => {
  const f = await fixture();
  try {
    expect(
      (await f.request("/admin/attendance-week", undefined, "GET", "")).status,
    ).toBe(401);
    expect(
      (await f.request("/admin/attendance-week?date=2026-02-30")).status,
    ).toBe(400);
    await f.policy({ weekStartsOn: 0 });
    await f.employee();
    const result = await f.request("/admin/attendance-week?date=2026-11-04");
    expect(result.data).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-07",
      weekStartsOn: 0,
    });
    expect(result.data.employees[0].days).toHaveLength(7);
    expect(result.data.employees[0]).not.toHaveProperty("phone_last4");
    expect(result.data.employees[0]).not.toHaveProperty("current_rate");
  } finally {
    await f.close();
  }
});
test("daily bars match payroll across midnight/week boundaries, breaks, voids and retirement", async () => {
  const f = await fixture();
  try {
    await f.policy();
    const id = await f.employee(),
      retired = await f.employee("퇴사 조교", "3333"),
      empty = await f.employee("기록 없는 퇴사자", "4444");
    await f.shift(
      id,
      "2026-11-01T23:00:00+09:00",
      "2026-11-02T01:00:00+09:00",
      30,
    );
    const ignored = await f.shift(
      id,
      "2026-11-03T09:00:00+09:00",
      "2026-11-03T12:00:00+09:00",
    );
    f.db.prepare("UPDATE shifts SET voided=1 WHERE id=?").run(ignored.data.id);
    await f.shift(
      retired,
      "2026-11-04T09:00:00+09:00",
      "2026-11-04T10:00:00+09:00",
    );
    f.db
      .prepare("UPDATE employees SET active=0 WHERE id IN (?,?)")
      .run(retired, empty);
    await f.request("/admin/holidays", {
      date: "2026-11-02",
      name: "지정 휴일",
    });
    const week = attendanceWeek(
      f.db,
      "2026-11-04",
      Date.parse("2026-11-08T22:00:00+09:00"),
    );
    expect(week.from).toBe("2026-11-02");
    expect(week.employees).toHaveLength(2);
    const person = week.employees.find((e) => e.id === id)!;
    expect(person.completedSeconds).toBe(2700);
    expect(person.days[0]).toMatchObject({
      completedSeconds: 2700,
      holidayName: "지정 휴일",
    });
    expect(person.days[0].segments[0].breakSeconds).toBe(900);
    expect(week.completedSeconds).toBe(6300);
    const payroll = calculatePayroll(f.db, week.from, week.to);
    for (const person of week.employees)
      expect(person.completedSeconds).toBe(
        payroll.rows.find((row) => row.employeeId === person.id)?.seconds,
      );
    expect(week.days.reduce((s, d) => s + d.completedSeconds, 0)).toBe(
      week.completedSeconds,
    );
  } finally {
    await f.close();
  }
});
test("ongoing time stays provisional, stale open shifts are flagged and pending events never count", async () => {
  const f = await fixture();
  try {
    await f.policy();
    const id = await f.employee(),
      stale = await f.employee("퇴근 누락", "1234");
    await f.request("/admin/records", {
      employee_id: id,
      started_at: "2026-11-08T09:00:00+09:00",
      ended_at: null,
      break_minutes: 0,
      note: "",
      reason: "진행 테스트",
    });
    await f.request("/admin/records", {
      employee_id: stale,
      started_at: "2026-11-06T09:00:00+09:00",
      ended_at: null,
      break_minutes: 0,
      note: "",
      reason: "누락 테스트",
    });
    const token = await f.device();
    await f.request(
      "/kiosk/events",
      {
        id: crypto.randomUUID(),
        employee_id: id,
        action: "out",
        captured_at: "2026-11-08T10:00:00+09:00",
        offline: true,
      },
      "POST",
      "",
      token,
    );
    const now = Date.parse("2026-11-08T12:00:00+09:00");
    const week = attendanceWeek(f.db, "2026-11-08", now);
    const person = week.employees.find((e) => e.id === id)!;
    expect(person).toMatchObject({
      completedSeconds: 0,
      liveSeconds: 10800,
      pendingCount: 1,
      weeklyEligible: false,
    });
    expect(week.employees.find((e) => e.id === stale)).toMatchObject({
      liveSeconds: 0,
      warnings: ["퇴근 확인 필요"],
    });
    expect(week.workingCount).toBe(1);
    expect(week.attentionCount).toBe(2);
    const instant = attendanceWeek(
      f.db,
      "2026-11-08",
      Date.parse("2026-11-08T09:00:00+09:00"),
    );
    expect(instant.employees.find((e) => e.id === id)?.warnings).toEqual([]);
  } finally {
    await f.close();
  }
});
test("weekly threshold uses completed hours only and keeps exact irregular-break totals", async () => {
  const f = await fixture();
  try {
    await f.policy();
    const id = await f.employee();
    for (const date of ["02", "03", "04"])
      await f.shift(
        id,
        `2026-11-${date}T09:00:00+09:00`,
        `2026-11-${date}T14:01:00+09:00`,
        1,
      );
    const result = attendanceWeek(
      f.db,
      "2026-11-04",
      Date.parse("2026-11-08T12:00:00+09:00"),
    );
    expect(result.employees[0]).toMatchObject({
      completedSeconds: 54000,
      weeklyEligible: true,
      workedDays: 3,
    });
    const policy = JSON.parse(
      f.db.prepare("SELECT json FROM settings").get()!.json as string,
    );
    policy.confirmed = false;
    f.db.prepare("UPDATE settings SET json=?").run(JSON.stringify(policy));
    expect(attendanceWeek(f.db, "2026-11-04").employees[0].weeklyEligible).toBe(
      false,
    );
  } finally {
    await f.close();
  }
});
