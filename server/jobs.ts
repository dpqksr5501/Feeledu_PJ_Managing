import { DEFAULT_JOB_ID, DEFAULT_JOB_NAME } from "../shared/jobs.ts";
import type { Job, JobAssignment, JobRate, JobRole } from "../shared/jobs.ts";
import type { ClockEvent, RosterEntry } from "../shared/types.ts";
import type { Db } from "./database.ts";
import { groupRows } from "./group-rows.ts";

const defaultJob: Job = { id: DEFAULT_JOB_ID, name: DEFAULT_JOB_NAME };
const defaultAssignment = {
  ...defaultJob,
  active: 1,
  assigned: 1,
  is_default: 1,
};
type AssignmentRow = Omit<JobAssignment, "rates"> & { employee_id: string };
const assignmentSelect = `SELECT ej.employee_id,j.id,j.name,j.active,ej.active AS assigned,ej.is_default
  FROM employee_jobs ej JOIN job_roles j ON j.id=ej.job_id`;
const assignmentOrder = "ORDER BY ej.is_default DESC,j.name,j.id";

export function jobCatalog(db: Db): JobRole[] {
  const roles = db
    .prepare("SELECT * FROM job_roles ORDER BY active DESC,name,id")
    .all();
  const rates = db
    .prepare(
      "SELECT * FROM job_rates WHERE employee_id IS NULL ORDER BY date DESC",
    )
    .all() as unknown as JobRate[];
  const byJob = groupRows(rates, (rate) => rate.job_id);
  return roles.map((role) => ({
    ...(role as unknown as Omit<JobRole, "rates">),
    rates: byJob.get(String(role.id)) ?? [],
  }));
}

export function employeeJobAssignments(
  db: Db,
  employeeId: string,
): Omit<JobAssignment, "rates">[] {
  const rows = db
    .prepare(`${assignmentSelect} WHERE ej.employee_id=? ${assignmentOrder}`)
    .all(employeeId) as unknown as AssignmentRow[];
  return rows.length
    ? rows.map(({ id, name, active, assigned, is_default }) => ({
        id,
        name,
        active,
        assigned,
        is_default,
      }))
    : [defaultAssignment];
}

export function assignedJobs(db: Db, employeeId: string): Job[] {
  return employeeJobAssignments(db, employeeId)
    .filter((job) => job.assigned && job.active)
    .map(({ id, name }) => ({ id, name }));
}

export function employeeJobDirectory(db: Db) {
  const assignments = db
    .prepare(`${assignmentSelect} ${assignmentOrder}`)
    .all() as unknown as AssignmentRow[];
  const rates = db
    .prepare(
      "SELECT * FROM job_rates WHERE employee_id IS NOT NULL ORDER BY date DESC",
    )
    .all() as unknown as JobRate[];
  const byEmployee = groupRows(assignments, (row) => row.employee_id);
  const byAssignment = groupRows(
    rates,
    (rate) => rate.employee_id + ":" + rate.job_id,
  );
  return (employeeId: string): JobAssignment[] =>
    (byEmployee.get(employeeId) ?? [defaultAssignment]).map(
      ({ id, name, active, assigned, is_default }) => ({
        id,
        name,
        active,
        assigned,
        is_default,
        rates: byAssignment.get(employeeId + ":" + id) ?? [],
      }),
    );
}

export function rosterJobs(db: Db, deviceId: string): RosterEntry[] {
  const employees = db
    .prepare(
      `SELECT e.id,e.name,e.phone_last4,s.id AS shift_id,j.id AS job_id,j.name AS job_name
       FROM employees e LEFT JOIN shifts s ON s.employee_id=e.id AND s.ended_at IS NULL AND s.voided=0
       LEFT JOIN shift_jobs sj ON sj.shift_id=s.id LEFT JOIN job_roles j ON j.id=sj.job_id
       WHERE e.active=1 ORDER BY e.name,e.id`,
    )
    .all();
  const assignments = db
    .prepare(
      `SELECT ej.employee_id,j.id,j.name,ej.active AND j.active AS enabled
       FROM employee_jobs ej JOIN employees e ON e.id=ej.employee_id AND e.active=1
       JOIN job_roles j ON j.id=ej.job_id ORDER BY ej.is_default DESC,j.name,j.id`,
    )
    .all();
  const byEmployee = new Map<string, Job[]>();
  for (const row of assignments) {
    const id = String(row.employee_id);
    const jobs = byEmployee.get(id) ?? [];
    if (row.enabled) jobs.push({ id: String(row.id), name: String(row.name) });
    byEmployee.set(id, jobs);
  }
  const pending = db
    .prepare(
      `SELECT c.id,c.employee_id,c.action,cj.job_id,cj.expected_shift_id,j.name AS job_name
       FROM clock_events c LEFT JOIN clock_event_jobs cj ON cj.event_id=c.id
       LEFT JOIN job_roles j ON j.id=cj.job_id
       WHERE c.status='pending' AND c.device_id=? ORDER BY c.captured_at,c.received_at,c.rowid`,
    )
    .all(deviceId);
  const pendingByEmployee = new Map<
    string,
    NonNullable<RosterEntry["pending"]>
  >();
  for (const row of pending) {
    const id = String(row.employee_id);
    const events = pendingByEmployee.get(id) ?? [];
    events.push({
      id: String(row.id),
      action: row.action as ClockEvent["action"],
      ...(row.job_id
        ? {
            job_id: String(row.job_id),
            job_name: row.job_name as string | null,
          }
        : {}),
      ...(row.expected_shift_id
        ? { expected_shift_id: String(row.expected_shift_id) }
        : {}),
    });
    pendingByEmployee.set(id, events);
  }
  return employees.map((row) => {
    const id = String(row.id);
    return {
      id,
      name: String(row.name),
      phone_last4: String(row.phone_last4),
      working: !!row.shift_id,
      jobs: byEmployee.get(id) ?? [defaultJob],
      open_shift_id: row.shift_id as string | null,
      open_job: row.shift_id
        ? {
            id: String(row.job_id ?? DEFAULT_JOB_ID),
            name: String(row.job_name ?? DEFAULT_JOB_NAME),
          }
        : null,
      pending: pendingByEmployee.get(id) ?? [],
    };
  });
}

export function jobRatesForPeriod(db: Db, first: string, last: string) {
  const rates = db
    .prepare(
      `SELECT r.* FROM job_roles j JOIN job_rates r ON r.id=(
         SELECT p.id FROM job_rates p WHERE p.job_id=j.id AND p.employee_id IS NULL
           AND p.kind='monthly' AND p.date<=? ORDER BY p.date DESC LIMIT 1)
       UNION ALL
       SELECT r.* FROM employee_jobs ej JOIN job_rates r ON r.id=(
         SELECT p.id FROM job_rates p WHERE p.job_id=ej.job_id AND p.employee_id=ej.employee_id
           AND p.kind='monthly' AND p.date<=? ORDER BY p.date DESC LIMIT 1)
       UNION ALL SELECT * FROM job_rates WHERE date>? AND date<=?
       UNION ALL SELECT * FROM job_rates WHERE kind='day' AND date=? ORDER BY date`,
    )
    .all(first, first, first, last, first) as unknown as JobRate[];
  const byJob = new Map<string, JobRate[]>();
  for (const rate of rates) {
    const key = (rate.employee_id ?? "") + ":" + rate.job_id;
    const list = byJob.get(key) ?? [];
    list.push(rate);
    byJob.set(key, list);
  }
  return {
    forEmployee: (employee: string, job: string) =>
      byJob.get(employee + ":" + job) ?? [],
    common: (job: string) => byJob.get(":" + job) ?? [],
  };
}
