export const DEFAULT_JOB_ID = "00000000-0000-4000-8000-000000000001";
export const DEFAULT_JOB_NAME = "조교";

export type Job = { id: string; name: string };
export type JobRole = Job & {
  active: number;
  revision: number;
  rates: JobRate[];
};
export type JobAssignment = Job & {
  active: number;
  assigned: number;
  is_default: number;
  rates: JobRate[];
};
export type JobRate = {
  id: string;
  job_id: string;
  employee_id: string | null;
  kind: "monthly" | "day";
  date: string;
  hourly_rate: number | null;
  reason: string;
  revision: number;
};
export type ClockAction = "in" | "out" | "switch";
export const clockActionLabel: Record<ClockAction, string> = {
  in: "출근",
  out: "퇴근",
  switch: "직무 전환",
};
