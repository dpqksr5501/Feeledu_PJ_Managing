import { createHash } from "node:crypto";
import { audit, transaction, type Db } from "./database.ts";

export const isTestEmployee = (name: string) =>
  /\[\s*테\s*스\s*트\s*\]/u.test(name.normalize("NFKC"));

export function testDataPlan(db: Db) {
  const employees = db
    .prepare("SELECT id,name,revision FROM employees ORDER BY id")
    .all()
    .filter((row) => isTestEmployee(String(row.name)));
  const ids = new Set(employees.map((row) => String(row.id)));
  const counts = {
    employees: employees.length,
    shifts: 0,
    events: 0,
    rates: 0,
    dayRates: 0,
    adjustments: 0,
  };
  for (const employee of employees) {
    for (const [field, table] of Object.entries({
      shifts: "shifts",
      events: "clock_events",
      rates: "rates",
      dayRates: "day_rates",
      adjustments: "adjustments",
    })) {
      counts[field as Exclude<keyof typeof counts, "employees">] += Number(
        db
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE employee_id=?`)
          .get(String(employee.id))!.n,
      );
    }
  }
  const blockedSettlements: string[] = [];
  for (const row of db.prepare("SELECT id,snapshot FROM settlements").all()) {
    const saved = JSON.parse(String(row.snapshot)) as {
      rows: { employeeId: string }[];
    };
    if (saved.rows.some((person) => ids.has(person.employeeId)))
      blockedSettlements.push(String(row.id));
  }
  const foreignEvents = db
    .prepare(
      "SELECT c.employee_id,s.employee_id AS shift_employee FROM clock_events c JOIN shifts s ON s.id=c.shift_id WHERE c.employee_id<>s.employee_id",
    )
    .all()
    .filter(
      (row) =>
        ids.has(String(row.shift_employee)) &&
        !ids.has(String(row.employee_id)),
    ).length;
  const plan = { employees, counts, blockedSettlements, foreignEvents };
  return {
    ...plan,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(plan))
      .digest("hex"),
  };
}

export function removeTestData(
  db: Db,
  expected: string,
  actor: string,
  reason: string,
) {
  return transaction(db, () => {
    const plan = testDataPlan(db);
    if (!plan.employees.length || plan.fingerprint !== expected)
      return {
        conflict: "삭제 대상이 변경됐습니다. 목록을 다시 확인해 주세요.",
      };
    if (plan.blockedSettlements.length || plan.foreignEvents)
      return {
        conflict:
          "확정 정산 또는 다른 직원의 출퇴근 기록과 연결돼 있어 삭제하지 않았습니다.",
      };
    for (const table of [
      "clock_events",
      "shifts",
      "rates",
      "day_rates",
      "adjustments",
    ]) {
      for (const employee of plan.employees)
        db.prepare(`DELETE FROM ${table} WHERE employee_id=?`).run(
          String(employee.id),
        );
    }
    for (const employee of plan.employees)
      db.prepare("DELETE FROM employees WHERE id=?").run(String(employee.id));
    audit(db, actor, "testdata.cleanup", "test-employees", {
      employees: plan.employees,
      counts: plan.counts,
      reason,
    });
    return { removed: plan.counts };
  });
}
