import type { Db } from "./database.ts";

// Split open and completed shifts so both branches seek by ended_at. A start-only
// index would scan all historical shifts for each recent-week/month request.
// Arguments: rangeEnd, rangeBegin, rangeEnd. Half-open interval [begin,end).
export function shiftRangeSql(withNames = false) {
  const select = withNames ? "s.*,e.name" : "s.*";
  const join = withNames ? "JOIN employees e ON e.id=s.employee_id" : "";
  const valid = withNames ? "" : "AND s.voided=0";
  return `SELECT ${select} FROM shifts s INDEXED BY shifts_end ${join}
    WHERE s.ended_at IS NULL AND s.started_at<? ${valid}
    UNION ALL
    SELECT ${select} FROM shifts s INDEXED BY shifts_end ${join}
    WHERE s.ended_at>? AND s.started_at<? ${valid}
    ORDER BY started_at ${withNames ? "DESC" : "ASC"}`;
}

export function overlappingShift(
  db: Db,
  employee: string,
  begin: string,
  end: string | null,
  except = "",
) {
  const finish = end ?? "9999-12-31T00:00:00.000Z";
  return (
    db
      .prepare(
        "SELECT id FROM shifts WHERE employee_id=? AND id<>? AND voided=0 AND ended_at IS NULL AND started_at<? LIMIT 1",
      )
      .get(employee, except, finish) ??
    db
      .prepare(
        "SELECT id FROM shifts INDEXED BY shifts_employee_end WHERE employee_id=? AND id<>? AND voided=0 AND ended_at>? AND started_at<? LIMIT 1",
      )
      .get(employee, except, begin, finish)
  );
}
