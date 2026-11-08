import { getPolicy, type Db } from "./database.ts";
import { addDays, dayStart, seoulDate, weekStart } from "../shared/time.ts";
import { paidMillisecondsInRange } from "../shared/shift-duration.ts";
import { holidayName } from "../shared/workdays.ts";
import type {
  AttendanceDay,
  Employee,
  EmployeeAttendance,
  Holiday,
  Shift,
  WeeklyAttendance,
} from "../shared/types.ts";

export function attendanceWeek(
  db: Db,
  anchor = seoulDate(),
  now = Date.now(),
): WeeklyAttendance {
  const policy = getPolicy(db);
  const from = weekStart(anchor, policy.weekStartsOn),
    to = addDays(from, 6);
  const begin = dayStart(from),
    finish = dayStart(addDays(to, 1));
  const holidays = db
    .prepare("SELECT * FROM holidays")
    .all() as unknown as Holiday[];
  const newDays = (): AttendanceDay[] =>
    Array.from({ length: 7 }, (_, i) => {
      const date = addDays(from, i);
      return {
        date,
        completedSeconds: 0,
        liveSeconds: 0,
        holidayName: holidayName(date, holidays, policy),
        segments: [],
      };
    });
  const shifts = db
    .prepare(
      "SELECT * FROM shifts WHERE voided=0 AND started_at<? AND (ended_at IS NULL OR ended_at>?) ORDER BY started_at",
    )
    .all(
      new Date(finish).toISOString(),
      new Date(begin).toISOString(),
    ) as unknown as Shift[];
  const pending = db
    .prepare(
      "SELECT employee_id,COUNT(*) AS n FROM clock_events WHERE status='pending' AND captured_at>=? AND captured_at<? GROUP BY employee_id",
    )
    .all(new Date(begin).toISOString(), new Date(finish).toISOString());
  const employees = (
    db
      .prepare("SELECT * FROM employees ORDER BY name,id")
      .all() as unknown as Employee[]
  )
    .map((employee): EmployeeAttendance => {
      const days = newDays(),
        warnings: string[] = [];
      let workingSince: string | null = null;
      for (const shift of shifts.filter((s) => s.employee_id === employee.id)) {
        const start = Date.parse(shift.started_at),
          end = shift.ended_at ? Date.parse(shift.ended_at) : now;
        if (!shift.ended_at) workingSince = shift.started_at;
        if (!shift.ended_at && end === start) continue;
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start > now ||
          end <= start
        ) {
          warnings.push("근무 시각 확인");
          continue;
        }
        if (end - start > 24 * 3600000) {
          warnings.push(shift.ended_at ? "근무시간 확인" : "퇴근 확인 필요");
          continue;
        }
        if (shift.break_minutes * 60000 >= end - start) {
          warnings.push("휴게시간 확인");
          continue;
        }
        for (const day of days) {
          const left = Math.max(start, dayStart(day.date)),
            right = Math.min(end, now, dayStart(addDays(day.date, 1)));
          if (right <= left) continue;
          const seconds =
            paidMillisecondsInRange(shift, left, right, now) / 1000;
          if (shift.ended_at) day.completedSeconds += seconds;
          else day.liveSeconds += seconds;
          day.segments.push({
            shiftId: shift.id,
            startedAt: new Date(left).toISOString(),
            endedAt: new Date(right).toISOString(),
            seconds,
            breakSeconds: (right - left) / 1000 - seconds,
            ongoing: !shift.ended_at,
          });
        }
      }
      const completedSeconds = days.reduce(
          (sum, d) => sum + d.completedSeconds,
          0,
        ),
        liveSeconds = days.reduce((sum, d) => sum + d.liveSeconds, 0);
      const threshold =
        policy.weeklyEnabled && employee.weekly_enabled
          ? policy.weeklyThresholdHours * 3600
          : null;
      return {
        id: employee.id,
        name: employee.name,
        active: !!employee.active,
        days,
        completedSeconds,
        liveSeconds,
        workedDays: days.filter((d) => d.completedSeconds + d.liveSeconds > 0)
          .length,
        pendingCount: Number(
          pending.find((p) => p.employee_id === employee.id)?.n || 0,
        ),
        warnings: [...new Set(warnings)],
        workingSince,
        weeklyEligible: !!(
          policy.confirmed &&
          threshold &&
          completedSeconds >= threshold
        ),
        weeklyThresholdSeconds: threshold,
      };
    })
    .filter(
      (e) =>
        e.active ||
        e.completedSeconds ||
        e.liveSeconds ||
        e.pendingCount ||
        e.workingSince,
    );
  const days = newDays();
  for (const employee of employees)
    employee.days.forEach((day, i) => {
      days[i].completedSeconds += day.completedSeconds;
      days[i].liveSeconds += day.liveSeconds;
    });
  return {
    from,
    to,
    generatedAt: new Date(now).toISOString(),
    weekStartsOn: policy.weekStartsOn,
    policyConfirmed: policy.confirmed,
    employees,
    days,
    completedSeconds: employees.reduce((sum, e) => sum + e.completedSeconds, 0),
    liveSeconds: employees.reduce((sum, e) => sum + e.liveSeconds, 0),
    workingCount: employees.filter((e) => e.workingSince && !e.warnings.length)
      .length,
    attentionCount: employees.reduce(
      (sum, e) => sum + e.pendingCount + e.warnings.length,
      0,
    ),
  };
}
