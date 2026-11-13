import type { Db } from "./database.ts";
import type { Shift, ShiftBreak } from "../shared/types.ts";

/** At most one indexed read per batch, rather than a query per employee/shift. */
export function attachShiftBreaks(db: Db, shifts: Shift[]): Shift[] {
  const byId = new Map(
    shifts.map((shift) => [shift.id, { ...shift, breaks: [] as ShiftBreak[] }]),
  );
  const ids = [...byId.keys()];
  // Durable Object SQLite allows 100 bound parameters (also tested in Workerd).
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    for (const row of db
      .prepare(
        `SELECT shift_id,started_at,ended_at FROM shift_breaks WHERE shift_id IN (${batch.map(() => "?").join(",")}) ORDER BY started_at`,
      )
      .all(...batch))
      byId.get(String(row.shift_id))!.breaks.push({
        started_at: String(row.started_at),
        ended_at: String(row.ended_at),
      });
  }
  return [...byId.values()];
}

export function breakError(
  startedAt: string,
  endedAt: string | null,
  minutes: number,
  breaks: ShiftBreak[],
) {
  if (!breaks.length) return null;
  const start = Date.parse(startedAt),
    end = endedAt ? Date.parse(endedAt) : Date.now();
  const sorted = [...breaks].sort(
    (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
  );
  let previous = start,
    total = 0;
  for (const item of sorted) {
    const left = Date.parse(item.started_at),
      right = Date.parse(item.ended_at);
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(right) ||
      left < start ||
      right > end ||
      left < previous ||
      right <= left
    )
      return "휴게 구간은 근무시간 안에 겹치지 않게 입력해 주세요.";
    total += right - left;
    previous = right;
  }
  if (Math.abs(total - minutes * 60000) > 1)
    return "휴게 구간 합계와 실제 휴게시간이 일치하지 않습니다.";
  return null;
}

export function replaceShiftBreaks(db: Db, id: string, breaks: ShiftBreak[]) {
  db.prepare("DELETE FROM shift_breaks WHERE shift_id=?").run(id);
  for (const item of breaks)
    db.prepare("INSERT INTO shift_breaks VALUES(?,?,?)").run(
      id,
      item.started_at,
      item.ended_at,
    );
}
