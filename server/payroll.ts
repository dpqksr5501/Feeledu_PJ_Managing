import { createHash } from "node:crypto";
import type {
  Adjustment,
  Employee,
  Holiday,
  Payroll,
  PayrollRow,
  Rate,
  Shift,
} from "../shared/types.ts";
import {
  addDays,
  dayStart,
  seoulDate,
  weekday,
  weekStart,
} from "../shared/time.ts";
import { getPolicy, type Db } from "./database.ts";
import { holidayName } from "../shared/workdays.ts";

export function calculatePayroll(db: Db, from: string, to: string): Payroll {
  const policy = getPolicy(db);
  const firstWeek = weekStart(from, policy.weekStartsOn);
  const end = dayStart(addDays(to, 1));
  const employees = db
    .prepare("SELECT * FROM employees ORDER BY name")
    .all() as unknown as Employee[];
  const shifts = db
    .prepare(
      "SELECT * FROM shifts WHERE voided=0 AND started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at",
    )
    .all(
      new Date(end).toISOString(),
      new Date(dayStart(firstWeek)).toISOString(),
    ) as unknown as Shift[];
  const rates = db
    .prepare("SELECT * FROM rates ORDER BY effective_from")
    .all() as unknown as Rate[];
  const holidayRows = db
    .prepare("SELECT * FROM holidays")
    .all() as unknown as Holiday[];
  const holidays = new Set(holidayRows.map((h) => h.date));
  const adjustments = db
    .prepare("SELECT * FROM adjustments WHERE date BETWEEN ? AND ? ORDER BY id")
    .all(from, to) as unknown as Adjustment[];
  const dayRates = db.prepare("SELECT * FROM day_rates ORDER BY date").all();
  const warnings: string[] = [];
  if (!policy.confirmed)
    warnings.push(
      "수당 기준이 아직 확인되지 않았습니다. 설정에서 확인 후 저장해 주세요.",
    );
  const pending = db
    .prepare(
      "SELECT COUNT(*) AS count FROM clock_events WHERE status='pending' AND captured_at >= ? AND captured_at < ?",
    )
    .get(
      new Date(dayStart(firstWeek)).toISOString(),
      new Date(end).toISOString(),
    ) as { count: number };
  if (pending.count)
    warnings.push(`확인이 필요한 출퇴근 기록 ${pending.count}건이 있습니다.`);
  const rows = employees
    .map((employee) => {
      const row: PayrollRow = {
        employeeId: employee.id,
        name: employee.name,
        seconds: 0,
        base: 0,
        holiday: 0,
        weekly: 0,
        adjustment: 0,
        total: 0,
        warnings: [],
        weeklyDetails: [],
        dailyDetails: [],
      };
      const weekly = new Map<string, { milliseconds: number; base: number }>();
      const employeeRates = rates.filter(
        (rate) => rate.employee_id === employee.id,
      );
      const rateAt = (date: string) =>
        (dayRates.find(
          (rate) => rate.employee_id === employee.id && rate.date === date,
        )?.hourly_rate as number | undefined) ??
        employeeRates.filter((rate) => rate.effective_from <= date).at(-1)
          ?.hourly_rate;
      for (const shift of shifts.filter((s) => s.employee_id === employee.id)) {
        if (!shift.ended_at) {
          row.warnings.push(
            `${seoulDate(shift.started_at)} 퇴근 기록이 없습니다.`,
          );
          continue;
        }
        const start = Date.parse(shift.started_at),
          finish = Date.parse(shift.ended_at);
        const duration = (finish - start) / 1000;
        if (duration <= 0 || shift.break_minutes * 60 >= duration) {
          row.warnings.push("근무시간 또는 휴게시간을 확인해 주세요.");
          continue;
        }
        // An entered total break is allocated proportionally across date/rate segments.
        const paidRatio = (duration - shift.break_minutes * 60) / duration;
        for (
          let cursor = Math.max(start, dayStart(firstWeek));
          cursor < Math.min(finish, end);
        ) {
          const date = seoulDate(cursor);
          const next = Math.min(finish, end, dayStart(addDays(date, 1)));
          const paidMilliseconds =
            Math.round((next - start) * paidRatio) -
            Math.round((cursor - start) * paidRatio);
          const seconds = paidMilliseconds / 1000;
          const rate = rateAt(date);
          if (!rate) {
            row.warnings.push(`${date} 적용 시급이 없습니다.`);
            cursor = next;
            continue;
          }
          const base = (seconds / 3600) * rate;
          const key = weekStart(date, policy.weekStartsOn);
          const week = weekly.get(key) ?? { milliseconds: 0, base: 0 };
          week.milliseconds += paidMilliseconds;
          week.base += base;
          weekly.set(key, week);
          if (date >= from && date <= to) {
            row.seconds += seconds;
            row.base += base;
            let holiday = 0;
            if (
              holidays.has(date) ||
              policy.holidayWeekdays.includes(weekday(date))
            )
              holiday =
                base *
                ((employee.holiday_multiplier ?? policy.holidayMultiplier) - 1);
            row.holiday += holiday;
            const daily = row.dailyDetails!.find((day) => day.date === date);
            if (daily) {
              daily.seconds += seconds;
              daily.base += base;
              daily.holiday += holiday;
            } else
              row.dailyDetails!.push({
                date,
                seconds,
                hourlyRate: rate,
                base,
                holiday,
                specialRate: dayRates.some(
                  (r) => r.employee_id === employee.id && r.date === date,
                ),
                holidayName: holidayName(date, holidayRows, policy),
              });
          }
          cursor = next;
        }
      }
      if (policy.weeklyEnabled && employee.weekly_enabled)
        for (const [start, week] of weekly) {
          const date = addDays(start, 6);
          const weekHours = week.milliseconds / 3600000;
          if (
            date >= from &&
            date <= to &&
            week.milliseconds >= policy.weeklyThresholdHours * 3600000
          ) {
            const amount =
              (Math.min(weekHours, policy.weeklyCapHours) /
                policy.weeklyDivisor) *
              (week.base / weekHours);
            row.weekly += amount;
            row.weeklyDetails.push({
              date,
              hours: weekHours,
              amount: Math.round(amount),
            });
          }
        }
      row.base = Math.round(row.base);
      row.holiday = Math.round(row.holiday);
      row.weekly = Math.round(row.weekly);
      row.seconds = Math.round(row.seconds);
      row.adjustment = adjustments
        .filter((a) => a.employee_id === employee.id)
        .reduce((sum, a) => sum + a.amount, 0);
      row.total = row.base + row.holiday + row.weekly + row.adjustment;
      row.warnings = [...new Set(row.warnings)];
      return row;
    })
    .filter(
      (r) =>
        r.seconds ||
        r.adjustment ||
        r.weekly ||
        r.holiday ||
        r.warnings.length ||
        employees.find((e) => e.id === r.employeeId)?.active,
    );
  const latest = db
    .prepare(
      "SELECT s.*,a.name AS created_by_name FROM settlements s JOIN admins a ON a.id=s.created_by WHERE date_from=? AND date_to=? ORDER BY version DESC LIMIT 1",
    )
    .get(from, to) as
    | {
        id: string;
        version: number;
        total: number;
        created_at: string;
        created_by_name: string;
        snapshot: string;
      }
    | undefined;
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ from, to, rows, policy, warnings }))
    .digest("hex");
  return {
    from,
    to,
    rows,
    total,
    warnings,
    policy,
    fingerprint,
    difference: latest ? total - latest.total : null,
    settlement: latest
      ? {
          id: latest.id,
          version: latest.version,
          total: latest.total,
          created_at: latest.created_at,
          created_by_name: latest.created_by_name,
          snapshot: JSON.parse(latest.snapshot),
        }
      : null,
  };
}
