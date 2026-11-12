// Isolated Miniflare fixture only. Never imported by the deployed Worker.
import { DurableObject } from "cloudflare:workers";
import { initializeDb } from "../../server/database.ts";
import { durableDatabase } from "../../cloudflare/database.ts";
import { attendanceWeek } from "../../server/attendance.ts";
import { calculatePayroll } from "../../server/payroll.ts";
import { overlappingShift, shiftRangeSql } from "../../server/shift-query.ts";

export class QueryBenchmark extends DurableObject {
  async fetch() {
    const sql = this.ctx.storage.sql;
    const db = durableDatabase(this.ctx.storage);
    initializeDb(db);
    this.ctx.storage.transactionSync(() => {
      for (let i = 0; i < 20; i++) {
        db.prepare(
          "INSERT INTO employees(id,name,phone_last4,created_at) VALUES(?,?,?,?)",
        ).run(`e${i}`, `조교${i}`, String(i).padStart(4, "0"), "2016-01-01");
        db.prepare("INSERT INTO rates VALUES(?,?,?,?,?,?)").run(
          `r${i}`,
          `e${i}`,
          "2016-01-01",
          12000,
          "fixture",
          "2016-01-01",
        );
      }
      db.exec(`WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<29199)
        INSERT INTO shifts(id,employee_id,started_at,ended_at,source,created_at)
        SELECT 's'||i,'e'||(i%20),strftime('%Y-%m-%dT09:00:00.000Z','2016-11-15','+'||(i/8)||' days'),strftime('%Y-%m-%dT12:00:00.000Z','2016-11-15','+'||(i/8)||' days'),'kiosk','2016-01-01' FROM n;
        INSERT INTO devices(id,name,token_hash,created_at) VALUES('device','fixture','hash','2016-01-01');
        INSERT INTO clock_events SELECT 'in-'||id,'device',employee_id,'in',started_at,started_at,'accepted','','hash',id FROM shifts;
        INSERT INTO clock_events SELECT 'out-'||id,'device',employee_id,'out',ended_at,ended_at,'accepted','','hash',id FROM shifts;
        INSERT INTO day_rates SELECT 'dr-'||id,employee_id,substr(started_at,1,10),12000,'fixture','2016-01-01' FROM shifts;
        WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<19999)
        INSERT INTO audit SELECT 'a'||i,'fixture','shift.update','fixture','{}',strftime('%Y-%m-%dT00:00:00.000Z','2016-01-01','+'||(i/10)||' days') FROM n;`);
      db.prepare(
        "INSERT INTO shifts(id,employee_id,started_at,source,created_at) VALUES('open','e0','2026-11-10T09:00:00.000Z','kiosk','2026-11-10')",
      ).run();
      db.prepare(
        "INSERT INTO clock_events VALUES('pending','device','e1','in','2026-11-10T09:00:00.000Z','2026-11-10T09:00:01.000Z','pending','offline','hash',NULL)",
      ).run();
    });
    const measure = (legacy) => {
      let reads = 0,
        writes = 0;
      const measuredDb = {
        ...db,
        prepare(query) {
          return {
            all: (...args) => {
              if (legacy && query.includes("SELECT r.* FROM employees")) {
                query = "SELECT * FROM rates ORDER BY effective_from";
                args = [];
              }
              if (legacy && query.includes("SELECT * FROM day_rates WHERE")) {
                query = "SELECT * FROM day_rates ORDER BY date";
                args = [];
              }
              if (legacy && query.includes("INDEXED BY shifts_end")) {
                const names = query.includes("e.name");
                query = `SELECT s.*${names ? ",e.name" : ""} FROM shifts s ${names ? "JOIN employees e ON e.id=s.employee_id" : ""} WHERE ${names ? "" : "s.voided=0 AND"} s.started_at<? AND(s.ended_at IS NULL OR s.ended_at>?) ORDER BY s.started_at ${names ? "DESC" : "ASC"}`;
                args = args.slice(0, 2);
              }
              const cursor = sql.exec(query, ...args);
              const result = cursor.toArray();
              reads += cursor.rowsRead;
              writes += cursor.rowsWritten;
              return result;
            },
            get(...args) {
              return this.all(...args)[0];
            },
          };
        },
      };
      const run = (fn) => {
        reads = 0;
        writes = 0;
        const value = fn();
        return { reads, writes, value };
      };
      return {
        overlap: run(() =>
          legacy
            ? measuredDb
                .prepare(
                  "SELECT id FROM shifts WHERE employee_id=? AND id<>? AND voided=0 AND started_at<? AND(ended_at IS NULL OR ended_at>?)",
                )
                .get(
                  "e19",
                  "",
                  "9999-12-31T00:00:00.000Z",
                  "2026-11-12T09:00:00.000Z",
                )
            : overlappingShift(
                measuredDb,
                "e19",
                "2026-11-12T09:00:00.000Z",
                null,
              ),
        ),
        week: run(() =>
          attendanceWeek(
            measuredDb,
            "2026-11-11",
            Date.parse("2026-11-11T14:00:00Z"),
          ),
        ),
        payroll: run(() =>
          calculatePayroll(measuredDb, "2026-11-01", "2026-11-30"),
        ),
        records: run(() =>
          measuredDb
            .prepare(shiftRangeSql(true))
            .all(
              "2026-12-01T00:00:00.000Z",
              "2026-11-01T00:00:00.000Z",
              "2026-12-01T00:00:00.000Z",
            ),
        ),
        reviews: run(() =>
          measuredDb
            .prepare(
              "SELECT * FROM clock_events WHERE status='pending' ORDER BY captured_at,received_at",
            )
            .all(),
        ),
        audit: run(() =>
          measuredDb
            .prepare(
              "SELECT au.*,a.name AS actor_name FROM audit au LEFT JOIN admins a ON a.id=au.actor ORDER BY au.created_at DESC LIMIT 200",
            )
            .all(),
        ),
      };
    };
    db.exec(
      "DROP INDEX shifts_end; DROP INDEX shifts_employee_end; DROP INDEX clock_pending; DROP INDEX audit_recent; DROP INDEX audit_action_recent; DROP INDEX adjustments_date; DROP INDEX day_rates_date; DROP INDEX rates_effective;",
    );
    const before = measure(true);
    initializeDb(db);
    const after = measure(false);
    // SQL without a tie-breaker may reorder rows sharing an identical timestamp.
    const comparable = (key, value) =>
      ["records", "audit"].includes(key)
        ? [...value].sort((a, b) => a.id.localeCompare(b.id))
        : value;
    const different = Object.keys(before).filter(
      (key) =>
        JSON.stringify(comparable(key, before[key].value)) !==
        JSON.stringify(comparable(key, after[key].value)),
    );
    const equivalent = different.length === 0;
    for (const group of [before, after])
      for (const result of Object.values(group)) delete result.value;
    return Response.json({
      shifts: 29201,
      events: 58401,
      audit: 20000,
      equivalent,
      different,
      before,
      after,
    });
  }
}
export default {
  fetch(request, env) {
    return env.BENCHMARK.get(
      env.BENCHMARK.idFromName("isolated-query-benchmark"),
    ).fetch(request);
  },
};
