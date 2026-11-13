import { addDays, dayStart, seoulDate } from "./time.ts";

/** Seoul local time, [22:00, 06:00); split at midnight for rate/calendar changes. */
export function workSegmentEnd(cursor: number, end: number) {
  const day = dayStart(seoulDate(cursor));
  return Math.min(
    end,
    [
      day + 6 * 3600000,
      day + 22 * 3600000,
      dayStart(addDays(seoulDate(cursor), 1)),
    ].find((time) => time > cursor)!,
  );
}
export function isNightTime(time: number) {
  const offset = time - dayStart(seoulDate(time));
  return offset < 6 * 3600000 || offset >= 22 * 3600000;
}
