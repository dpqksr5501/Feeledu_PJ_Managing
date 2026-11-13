export type Role = "owner" | "manager";
export type Admin = {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: number;
  shared_tablet?: number;
  persistent_login?: number;
};
export type Employee = {
  id: string;
  name: string;
  phone_last4: string;
  active: number;
  note: string;
  weekly_enabled: number;
  holiday_multiplier: number | null;
  current_rate: number | null;
  revision: number;
  rates?: Rate[];
  day_rates?: DayRate[];
};
export type DayRate = {
  id: string;
  employee_id: string;
  date: string;
  hourly_rate: number;
  reason: string;
};
export type Rate = {
  id: string;
  employee_id: string;
  effective_from: string;
  hourly_rate: number;
  reason: string;
};
export type Shift = {
  id: string;
  employee_id: string;
  name: string;
  started_at: string;
  ended_at: string | null;
  break_minutes: number;
  source: string;
  note: string;
  revision: number;
  voided: number;
};
export type ClockEvent = {
  id: string;
  employee_id: string;
  action: "in" | "out";
  captured_at: string;
  offline: boolean;
};
export type ReviewEvent = {
  id: string;
  name: string;
  action: "in" | "out";
  captured_at: string;
  received_at: string;
  status: string;
  review_reason: string;
  device_name: string;
};
export type Policy = {
  academyName: string;
  weeklyEnabled: boolean;
  weeklyThresholdHours: number;
  weeklyCapHours: number;
  weeklyDivisor: number;
  weekStartsOn: number;
  holidayMultiplier: number;
  holidayWeekdays: number[];
  confirmed: boolean;
};
export type Holiday = {
  id: string;
  date: string;
  name: string;
  source?: "manual" | "official" | "both";
};
export type CalendarDay = { date: string; name: string };
export type CalendarYear = {
  year: number;
  synced_at: string | null;
  attempted_at: string | null;
  checked_at: string | null;
  error: string;
  fingerprint: string;
  count: number;
  pending: null | {
    hash: string;
    added: CalendarDay[];
    removed: CalendarDay[];
    changed: CalendarDay[];
  };
};
export type HolidayCalendarStatus = {
  configured: boolean;
  years: CalendarYear[];
};
export type Adjustment = {
  id: string;
  employee_id: string;
  name: string;
  date: string;
  amount: number;
  reason: string;
};
export type PayrollRow = {
  employeeId: string;
  name: string;
  seconds: number;
  base: number;
  holiday: number;
  weekly: number;
  adjustment: number;
  total: number;
  warnings: string[];
  weeklyDetails: { date: string; hours: number; amount: number }[];
  dailyDetails?: {
    date: string;
    seconds: number;
    hourlyRate: number;
    base: number;
    holiday: number;
    specialRate: boolean;
    holidayName: string;
  }[];
};
export type Payroll = {
  from: string;
  to: string;
  rows: PayrollRow[];
  total: number;
  warnings: string[];
  policy: Policy;
  settlement: {
    id: string;
    version: number;
    total: number;
    created_at: string;
    created_by_name: string;
    snapshot: Payroll;
  } | null;
  difference: number | null;
  fingerprint: string;
};
export type RosterEntry = {
  id: string;
  name: string;
  phone_last4: string;
  working: boolean;
};
export type Device = {
  id: string;
  name: string;
  active: number;
  last_seen: string | null;
  created_at: string;
};
export type AttendanceSegment = {
  shiftId: string;
  startedAt: string;
  endedAt: string;
  seconds: number;
  breakSeconds: number;
  ongoing: boolean;
};
export type AttendanceDay = {
  date: string;
  completedSeconds: number;
  liveSeconds: number;
  holidayName: string;
  segments: AttendanceSegment[];
};
export type EmployeeAttendance = {
  id: string;
  name: string;
  active: boolean;
  days: AttendanceDay[];
  completedSeconds: number;
  liveSeconds: number;
  workedDays: number;
  pendingCount: number;
  warnings: string[];
  workingSince: string | null;
  weeklyEligible: boolean;
  weeklyThresholdSeconds: number | null;
};
export type WeeklyAttendance = {
  from: string;
  to: string;
  generatedAt: string;
  weekStartsOn: number;
  policyConfirmed: boolean;
  employees: EmployeeAttendance[];
  days: AttendanceDay[];
  completedSeconds: number;
  liveSeconds: number;
  workingCount: number;
  attentionCount: number;
};
