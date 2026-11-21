import type { DayRate, Employee, Rate } from "../shared/types.ts";
import { seoulDate } from "../shared/time.ts";
import type { Db } from "./database.ts";
import { employeeJobDirectory } from "./jobs.ts";
import { groupRows } from "./group-rows.ts";

export function employeeDirectory(db: Db, today = seoulDate()): Employee[] {
  const employees = db
    .prepare("SELECT * FROM employees ORDER BY active DESC,name")
    .all() as unknown as Employee[];
  const rates = db
    .prepare("SELECT * FROM rates ORDER BY effective_from DESC")
    .all() as unknown as Rate[];
  const dayRates = db
    .prepare("SELECT * FROM day_rates ORDER BY date DESC")
    .all() as unknown as DayRate[];
  const ratesByEmployee = groupRows(rates, (rate) => rate.employee_id);
  const dayRatesByEmployee = groupRows(dayRates, (rate) => rate.employee_id);
  const jobsFor = employeeJobDirectory(db);
  return employees.map((employee) => {
    const rates = ratesByEmployee.get(employee.id) ?? [];
    const dayRates = dayRatesByEmployee.get(employee.id) ?? [];
    return {
      ...employee,
      current_rate:
        dayRates.find((rate) => rate.date === today)?.hourly_rate ??
        rates.find((rate) => rate.effective_from <= today)?.hourly_rate ??
        null,
      rates,
      day_rates: dayRates,
      jobs: jobsFor(employee.id),
    };
  });
}
