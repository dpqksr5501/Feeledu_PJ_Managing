import type { CalendarDay, Holiday } from "../shared/types.ts";
import type { Db } from "./database.ts";

export function getHolidays(
  db: Db,
  from = "0000-01-01",
  to = "9999-12-31",
): Holiday[] {
  const official = db
    .prepare(
      "SELECT date,name FROM official_holidays WHERE date BETWEEN ? AND ? ORDER BY date",
    )
    .all(from, to) as CalendarDay[];
  const manual = db
    .prepare("SELECT * FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date")
    .all(from, to) as Holiday[];
  const dates = new Map<string, Holiday>(
    official.map((day) => [
      day.date,
      { ...day, id: "kasi:" + day.date, source: "official" },
    ]),
  );
  for (const day of manual) {
    const prior = dates.get(day.date);
    dates.set(day.date, {
      ...day,
      source: prior ? "both" : "manual",
      name:
        prior && prior.name !== day.name
          ? prior.name + " · " + day.name
          : day.name,
    });
  }
  return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function calendarWarnings(
  db: Db,
  from: string,
  to: string,
  configured = false,
) {
  const years = db
    .prepare("SELECT * FROM holiday_calendars WHERE year BETWEEN ? AND ?")
    .all(Number(from.slice(0, 4)), Number(to.slice(0, 4)));
  if (
    !configured &&
    !years.length &&
    !db
      .prepare(
        "SELECT 1 AS found FROM holiday_calendars WHERE synced_at IS NOT NULL LIMIT 1",
      )
      .get()
  )
    return [];
  const warnings: string[] = [];
  for (
    let year = Number(from.slice(0, 4));
    year <= Number(to.slice(0, 4));
    year++
  ) {
    const entry = years.find((entry) => entry.year === year);
    if (!entry?.synced_at)
      warnings.push(`${year}년 공휴일 자료 미확인 · 설정에서 동기화해 주세요.`);
    else if (entry.pending_json)
      warnings.push(
        `${year}년 공휴일 변경 검토 필요 · 설정에서 확인해 주세요.`,
      );
    else {
      const checked = Math.max(
        Date.parse(String(entry.synced_at)),
        Date.parse(String(entry.checked_at ?? entry.synced_at)),
      );
      if (!Number.isFinite(checked) || Date.now() - checked > 7 * 86400000)
        warnings.push(
          `${year}년 공휴일 자료 확인 후 7일 경과 · 설정에서 갱신 또는 확인해 주세요.`,
        );
    }
  }
  return warnings;
}
