import { DEFAULT_JOB_ID, DEFAULT_JOB_NAME } from "../shared/jobs.ts";
import type { ClockEvent, RosterEntry } from "../shared/types.ts";

export const defaultJob = { id: DEFAULT_JOB_ID, name: DEFAULT_JOB_NAME };

export function projectRosterEntry(
  person: RosterEntry,
  queue: ClockEvent[],
): RosterEntry {
  const jobs = person.jobs ?? [defaultJob];
  let working = person.working;
  let shiftId = person.open_shift_id;
  let currentJob = person.open_job ?? (working ? defaultJob : null);
  const pending = person.pending ?? [];
  const events = new Map(pending.map((event) => [event.id, event]));
  for (const event of queue)
    if (event.employee_id === person.id && !events.has(event.id))
      events.set(event.id, event);
  for (const event of events.values()) {
    if (event.expected_shift_id && event.expected_shift_id !== shiftId)
      continue;
    if (event.action === "out") {
      working = false;
      shiftId = null;
      currentJob = null;
      continue;
    }
    if (event.action === "in" ? working : !working) continue;
    const jobId = event.job_id ?? DEFAULT_JOB_ID;
    const job =
      jobs.find((item) => item.id === jobId) ??
      (event.job_name ? { id: jobId, name: event.job_name } : null);
    if (!job) continue;
    working = true;
    shiftId = event.id;
    currentJob = job;
  }
  return {
    ...person,
    jobs,
    working,
    open_shift_id: shiftId,
    open_job: currentJob,
  };
}
