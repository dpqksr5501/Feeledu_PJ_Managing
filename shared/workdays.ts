import { addDays, dayStart, seoulDate, weekday } from "./time.ts";
import type { Holiday, Policy, Shift } from "./types.ts";

/** Dates with actual working time; an end exactly at midnight excludes that day. */
export function workedDates(
  shift: Pick<Shift, "started_at" | "ended_at">,
  from: string,
  to: string,
  now = Date.now(),
) {
  const start = Math.max(Date.parse(shift.started_at), dayStart(from));
  const end = Math.min(
    shift.ended_at ? Date.parse(shift.ended_at) : now,
    dayStart(addDays(to, 1)),
  );
  const dates: string[] = [];
  for (
    let cursor = start;
    cursor < end;
    cursor = dayStart(addDays(seoulDate(cursor), 1))
  )
    dates.push(seoulDate(cursor));
  return dates;
}
export function holidayName(
  date: string,
  holidays: Holiday[],
  policy: Pick<Policy, "holidayWeekdays">,
) {
  return (
    holidays.find((holiday) => holiday.date === date)?.name ||
    (policy.holidayWeekdays.includes(weekday(date)) ? "정기 휴일" : "")
  );
}
