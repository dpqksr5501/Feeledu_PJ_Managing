import type {
  Express,
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import { z } from "zod";
import { randomInt, randomUUID } from "node:crypto";
import { audit, getPolicy, transaction, type Db } from "./database.ts";
import { calculatePayroll } from "./payroll.ts";
import { employeeDirectory } from "./employees.ts";
import { attendanceWeek } from "./attendance.ts";
import { overlappingShift, shiftRangeSql } from "./shift-query.ts";
import { HolidayCalendarService } from "./holiday-calendar.ts";
import { getHolidays } from "./holidays.ts";
import {
  attachShiftBreaks,
  breakError,
  replaceShiftBreaks,
} from "./shift-breaks.ts";
import { testDataPlan, removeTestData } from "./test-data.ts";
import { addDays, dayStart, seoulDate } from "../shared/time.ts";
import type {
  Admin,
  ClockEvent,
  ClockResult,
  Device,
  Shift,
  Rate,
} from "../shared/types.ts";
import { rateMonthVersion } from "../shared/rate-month.ts";
import {
  DEFAULT_JOB_ID,
  DEFAULT_JOB_NAME,
  type JobRate,
} from "../shared/jobs.ts";
import {
  assignedJobs,
  employeeJobAssignments,
  jobCatalog,
  rosterJobs,
} from "./jobs.ts";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_SPECIAL_CHARACTER,
  USERNAME_INPUT_PATTERN,
} from "../shared/password-format.ts";
import {
  initializeAuthState,
  authBackoff,
  recordAuthFailure,
  clearAuthFailures,
  PC_IDLE_MS,
  TABLET_IDLE_MS,
  SESSION_MAX_MS,
  PERSISTENT_DEADLINE,
  PERSISTENT_COOKIE_MS,
} from "./auth-state.ts";
export type Security = {
  hash(value: string): string;
  passwordHash(password: string): string;
  passwordMatches(password: string, stored: string): boolean;
  passwordNeedsUpgrade(stored: string): boolean;
  secret(): string;
  secureEqual(a: string, b: string): boolean;
};
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
const idSchema = z.string().uuid();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => Number.isFinite(dayStart(v)) && seoulDate(dayStart(v)) === v,
    "올바른 날짜를 입력해 주세요.",
  );
const instant = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
const text = z.string().trim().min(1).max(100);
const hourlyRate = z.number().int().min(1).max(1000000);
const rateMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-01$/);
const jobName = z.string().trim().normalize().min(1).max(40);
const clockSchema = z.object({
  id: idSchema,
  employee_id: idSchema,
  action: z.enum(["in", "out", "switch"]),
  captured_at: instant,
  job_id: idSchema.optional(),
  expected_shift_id: idSchema.optional(),
});
const reason = z
  .string()
  .trim()
  .min(2, "사유를 두 글자 이상 입력해 주세요.")
  .max(500);
const password = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`,
  )
  .max(128)
  .regex(
    PASSWORD_SPECIAL_CHARACTER,
    "비밀번호에 특수문자를 1개 이상 포함해 주세요.",
  );
const account = z.object({
  username: z.string().regex(new RegExp(`^${USERNAME_INPUT_PATTERN}$`)),
  name: text,
  password,
});
const employeeSchema = z.object({
  name: text,
  phone_last4: z.string().regex(/^\d{4}$/),
  active: z.boolean(),
  note: z.string().max(500),
  weekly_enabled: z.boolean(),
  holiday_multiplier: z.number().min(1).max(5).nullable(),
});
const policySchema = z.object({
  academyName: text,
  weeklyEnabled: z.boolean(),
  weeklyThresholdHours: z.number().min(1).max(168),
  weeklyCapHours: z.number().min(1).max(168),
  weeklyDivisor: z.number().min(1).max(7),
  weekStartsOn: z.number().int().min(0).max(6),
  holidayMultiplier: z.number().min(1).max(5),
  holidayWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
  nightEnabled: z.boolean().default(true),
  nightPremiumRate: z.number().min(0.5).max(5).default(0.5),
  confirmed: z.literal(true),
});
const shiftSchema = z.object({
  employee_id: idSchema,
  job_id: idSchema.nullish(),
  started_at: instant,
  ended_at: instant.nullable(),
  break_minutes: z.number().int().min(0).max(1440),
  breaks: z
    .array(z.object({ started_at: instant, ended_at: instant }))
    .max(10)
    .optional(),
  note: z.string().max(500),
  reason,
  revision: z.number().int().optional(),
});
const period = z
  .object({ from: date, to: date })
  .refine(
    (v) =>
      v.from <= v.to && dayStart(v.to) - dayStart(v.from) <= 366 * 86400000,
    "기간은 순서대로 최대 1년까지 지정해 주세요.",
  );
type Authed = Request & {
  admin?: Admin;
  device?: Device;
  sessionHash?: string;
  sessionDeadline?: string;
};
const one = <T>(db: Db, sql: string, ...args: (string | number | null)[]) =>
  db.prepare(sql).get(...args) as T | undefined;

export function registerRoutes(
  app: Express,
  {
    db,
    setupToken,
    security,
    sensitiveLimit,
    kioskLimit,
    router,
    downloadBackup,
    secureCookie = true,
    calendar,
  }: {
    db: Db;
    setupToken: string;
    security: Security;
    sensitiveLimit: RequestHandler;
    kioskLimit: RequestHandler;
    router: () => Router;
    downloadBackup: (req: Request, res: Response) => Promise<void>;
    secureCookie?: boolean;
    calendar?: HolidayCalendarService;
  },
) {
  const {
    hash,
    passwordHash,
    passwordMatches,
    passwordNeedsUpgrade,
    secret,
    secureEqual,
  } = security;
  initializeAuthState(db);
  const holidayCalendar =
    calendar ?? new HolidayCalendarService(db, () => undefined);
  const dummyPasswordHash = passwordHash(secret());
  function sessionCookie(res: Response, token: string, persistent: boolean) {
    res.cookie("feeledu_session", token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "strict",
      maxAge: persistent ? PERSISTENT_COOKIE_MS : SESSION_MAX_MS,
      path: "/",
    });
  }
  function checkBackoff(res: Response, key: string) {
    const seconds = authBackoff(db, key);
    if (seconds) {
      res.setHeader("Retry-After", seconds);
      fail(429, "잠시 후 다시 시도해 주세요.");
    }
  }
  const requireAdmin = (req: Authed, res: Response, next: NextFunction) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("feeledu_session="))
      ?.slice("feeledu_session=".length);
    const row =
      token &&
      one<Admin & { session_expiry: string; absolute_deadline: string | null }>(
        db,
        "SELECT a.id,a.username,a.name,a.role,a.active,s.shared_tablet,s.expires_at AS session_expiry,b.absolute_expires_at AS absolute_deadline FROM sessions s JOIN admins a ON a.id=s.admin_id LEFT JOIN session_deadlines b ON b.token_hash=s.token_hash WHERE s.token_hash=? AND s.expires_at>? AND (b.absolute_expires_at IS NULL OR b.absolute_expires_at>?) AND a.active=1",
        hash(token),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    if (!row) return next(new HttpError(401, "관리자 로그인이 필요합니다."));
    const { session_expiry, absolute_deadline, ...admin } = row;
    req.sessionHash = hash(token!);
    req.sessionDeadline =
      absolute_deadline ||
      (admin.shared_tablet
        ? new Date(Date.now() + SESSION_MAX_MS).toISOString()
        : session_expiry);
    if (!absolute_deadline) {
      db.prepare("INSERT OR IGNORE INTO session_deadlines VALUES(?,?)").run(
        req.sessionHash,
        req.sessionDeadline,
      );
      db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(
        new Date(
          Math.min(
            Date.parse(session_expiry),
            Date.now() + (admin.shared_tablet ? TABLET_IDLE_MS : PC_IDLE_MS),
          ),
        ).toISOString(),
        req.sessionHash,
      );
    }
    const persistent = absolute_deadline === PERSISTENT_DEADLINE;
    req.admin = { ...admin, persistent_login: Number(persistent) };
    if (
      persistent &&
      Date.parse(session_expiry) <= Date.now() + PERSISTENT_COOKIE_MS - 86400000
    ) {
      db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(
        new Date(Date.now() + PERSISTENT_COOKIE_MS).toISOString(),
        req.sessionHash,
      );
      sessionCookie(res, token!, true);
    }
    next();
  };
  const owner = (req: Authed, _res: Response, next: NextFunction) => {
    if (req.admin?.role !== "owner")
      return next(new HttpError(403, "개발자 권한이 필요합니다."));
    next();
  };
  const requireDevice = (req: Authed, _res: Response, next: NextFunction) => {
    const token = /^Bearer ([^\s]+)$/i.exec(
      req.get("Authorization") ?? "",
    )?.[1];
    const device =
      token &&
      one<Device>(
        db,
        "SELECT id,name,active,last_seen,created_at FROM devices WHERE token_hash=? AND active=1",
        hash(token),
      );
    if (!device)
      return next(
        new HttpError(
          401,
          "태블릿 연결이 필요합니다. 관리자에게 연결 코드를 받아 주세요.",
        ),
      );
    req.device = device;
    if (
      !device.last_seen ||
      Date.now() - Date.parse(device.last_seen) >= 5 * 60000
    )
      db.prepare("UPDATE devices SET last_seen=? WHERE id=?").run(
        new Date().toISOString(),
        device.id,
      );
    next();
  };
  function login(
    res: Response,
    adminId: string,
    sharedTablet = false,
    persistent = false,
  ) {
    const token = secret();
    db.prepare("DELETE FROM sessions WHERE expires_at<?").run(
      new Date().toISOString(),
    );
    db.prepare(
      "INSERT INTO sessions (token_hash,admin_id,expires_at,shared_tablet) VALUES(?,?,?,?)",
    ).run(
      hash(token),
      adminId,
      persistent
        ? new Date(Date.now() + PERSISTENT_COOKIE_MS).toISOString()
        : new Date(
            Date.now() + (sharedTablet ? TABLET_IDLE_MS : PC_IDLE_MS),
          ).toISOString(),
      Number(sharedTablet),
    );
    db.prepare("INSERT INTO session_deadlines VALUES(?,?)").run(
      hash(token),
      persistent
        ? PERSISTENT_DEADLINE
        : new Date(Date.now() + SESSION_MAX_MS).toISOString(),
    );
    sessionCookie(res, token, persistent);
  }
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, time: new Date().toISOString() }),
  );
  app.get("/api/bootstrap", (_req, res) =>
    res.json({ needsSetup: !one(db, "SELECT id FROM admins LIMIT 1") }),
  );
  app.post("/api/setup", sensitiveLimit, (req, res) => {
    if (one(db, "SELECT id FROM admins LIMIT 1"))
      fail(409, "초기 설정이 이미 완료됐습니다.");
    const body = account
      .extend({
        token: z.string().max(200),
        sharedTablet: z.boolean().optional().default(false),
        keepSignedIn: z.boolean().optional().default(false),
      })
      .parse(req.body);
    if (!secureEqual(body.token, setupToken))
      fail(403, "서버 터미널에 표시된 초기 설정 코드를 확인해 주세요.");
    const id = randomUUID();
    transaction(db, () => {
      db.prepare("INSERT INTO admins VALUES(?,?,?,?,?,?,?)").run(
        id,
        body.username,
        body.name,
        passwordHash(body.password),
        "owner",
        1,
        new Date().toISOString(),
      );
      audit(db, id, "setup", id, { username: body.username });
    });
    login(res, id, body.sharedTablet, body.keepSignedIn);
    res.status(201).json({ ok: true });
  });
  app.post("/api/login", sensitiveLimit, (req, res) => {
    const body = z
      .object({
        username: z.string().max(40),
        password: z.string().max(128),
        sharedTablet: z.boolean().optional().default(false),
        keepSignedIn: z.boolean().optional().default(false),
      })
      .parse(req.body);
    const attemptKey = hash("login:" + body.username);
    checkBackoff(res, attemptKey);
    const admin = one<Admin & { password_hash: string }>(
      db,
      "SELECT * FROM admins WHERE username=? AND active=1",
      body.username,
    );
    const match = passwordMatches(
      body.password,
      admin?.password_hash || dummyPasswordHash,
    );
    if (!admin || !match) {
      recordAuthFailure(db, attemptKey);
      fail(401, "아이디 또는 비밀번호를 확인해 주세요.");
    }
    clearAuthFailures(db, attemptKey);
    if (passwordNeedsUpgrade(admin.password_hash))
      db.prepare("UPDATE admins SET password_hash=? WHERE id=?").run(
        passwordHash(body.password),
        admin.id,
      );
    login(res, admin.id, body.sharedTablet, body.keepSignedIn);
    audit(db, admin.id, "login", admin.id, {});
    res.json({ ok: true });
  });
  app.post("/api/logout", requireAdmin, (req, res) => {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("feeledu_session="))
      ?.slice(16);
    if (cookie)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(cookie));
    res.clearCookie("feeledu_session");
    res.json({ ok: true });
  });
  const admin = router();
  app.use("/api/admin", requireAdmin, admin);
  admin.get("/me", (req: Authed, res) => res.json(req.admin));
  admin.patch("/profile", (req: Authed, res) => {
    const body = z
      .object({ name: text, expectedName: text })
      .strict()
      .parse(req.body);
    transaction(db, () => {
      const current = one<{ name: string }>(
        db,
        "SELECT name FROM admins WHERE id=?",
        req.admin!.id,
      )!;
      if (current.name !== body.expectedName)
        fail(409, "이름이 변경됐습니다. 새로고침 후 다시 확인해 주세요.");
      if (current.name !== body.name) {
        db.prepare("UPDATE admins SET name=? WHERE id=?").run(
          body.name,
          req.admin!.id,
        );
        audit(db, req.admin!.id, "profile.update", req.admin!.id, {
          before: current.name,
          after: body.name,
        });
      }
    });
    res.json({ ...req.admin!, name: body.name });
  });
  admin.post("/session/keep", (req: Authed, res) => {
    transaction(db, () => {
      db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(
        new Date(Date.now() + PERSISTENT_COOKIE_MS).toISOString(),
        req.sessionHash!,
      );
      db.prepare(
        "INSERT INTO session_deadlines VALUES(?,?) ON CONFLICT(token_hash) DO UPDATE SET absolute_expires_at=excluded.absolute_expires_at",
      ).run(req.sessionHash!, PERSISTENT_DEADLINE);
    });
    const token = req.headers
      .cookie!.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("feeledu_session="))!
      .slice("feeledu_session=".length);
    sessionCookie(res, token, true);
    res.json({ ...req.admin, persistent_login: 1 });
  });
  admin.get("/attendance-week", (req, res) => {
    const anchor =
      req.query.date === undefined ? seoulDate() : date.parse(req.query.date);
    res.json(attendanceWeek(db, anchor));
  });
  admin.post("/activity", (req: Authed, res) => {
    if (req.admin!.persistent_login) {
      res.json({ ok: true });
      return;
    }
    db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(
      new Date(
        Math.min(
          Date.now() + (req.admin!.shared_tablet ? TABLET_IDLE_MS : PC_IDLE_MS),
          Date.parse(req.sessionDeadline!),
        ),
      ).toISOString(),
      req.sessionHash!,
    );
    res.json({ ok: true });
  });
  function proveCurrentPassword(req: Authed, res: Response, current: string) {
    const key = hash("proof:" + req.admin!.id);
    checkBackoff(res, key);
    const stored = one<{ password_hash: string }>(
      db,
      "SELECT password_hash FROM admins WHERE id=?",
      req.admin!.id,
    )!;
    if (!passwordMatches(current, stored.password_hash)) {
      recordAuthFailure(db, key);
      fail(403, "현재 비밀번호가 일치하지 않습니다.");
    }
    clearAuthFailures(db, key);
  }
  admin.post("/password", sensitiveLimit, (req: Authed, res) => {
    const body = z
      .object({ current: z.string().max(128), password })
      .parse(req.body);
    proveCurrentPassword(req, res, body.current);
    transaction(db, () => {
      db.prepare("UPDATE admins SET password_hash=? WHERE id=?").run(
        passwordHash(body.password),
        req.admin!.id,
      );
      db.prepare("DELETE FROM sessions WHERE admin_id=?").run(req.admin!.id);
      audit(db, req.admin!.id, "password.change", req.admin!.id, {});
    });
    login(
      res,
      req.admin!.id,
      !!req.admin!.shared_tablet,
      !!req.admin!.persistent_login,
    );
    res.json({ ok: true });
  });
  admin.get("/employees", (_req, res) => res.json(employeeDirectory(db)));
  admin.post("/employees", (req: Authed, res) => {
    const body = employeeSchema
      .extend({
        hourly_rate: hourlyRate.optional(),
        effective_from: date,
        job_id: idSchema.default(DEFAULT_JOB_ID),
      })
      .parse(req.body);
    const id = randomUUID();
    transaction(db, () => {
      if (
        !one(
          db,
          "SELECT id FROM job_roles WHERE id=? AND active=1",
          body.job_id,
        )
      )
        fail(409, "사용 가능한 직무를 선택해 주세요.");
      if (
        body.hourly_rate === undefined &&
        !one(
          db,
          "SELECT id FROM job_rates WHERE job_id=? AND employee_id IS NULL AND date<=? LIMIT 1",
          body.job_id,
          body.effective_from,
        )
      )
        fail(
          400,
          "선택한 적용 월에 직무 시급이 없습니다. 최초 시급을 입력해 주세요.",
        );
      db.prepare(
        "INSERT INTO employees (id,name,phone_last4,active,note,weekly_enabled,holiday_multiplier,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        id,
        body.name,
        body.phone_last4,
        Number(body.active),
        body.note,
        Number(body.weekly_enabled),
        body.holiday_multiplier,
        new Date().toISOString(),
      );
      if (body.job_id !== DEFAULT_JOB_ID)
        db.prepare("INSERT INTO employee_jobs VALUES(?,?,1,1)").run(
          id,
          body.job_id,
        );
      if (body.job_id !== DEFAULT_JOB_ID && body.hourly_rate !== undefined)
        db.prepare(
          "INSERT INTO job_rates(id,job_id,employee_id,kind,date,hourly_rate,reason) VALUES(?,?,?,'monthly',?,?,?)",
        ).run(
          randomUUID(),
          body.job_id,
          id,
          rateMonth.parse(body.effective_from),
          body.hourly_rate,
          "최초 등록",
        );
      if (body.job_id === DEFAULT_JOB_ID && body.hourly_rate !== undefined)
        db.prepare("INSERT INTO rates VALUES(?,?,?,?,?,?)").run(
          randomUUID(),
          id,
          body.effective_from,
          body.hourly_rate,
          "최초 등록",
          new Date().toISOString(),
        );
      audit(db, req.admin!.id, "employee.create", id, { ...body });
    });
    res.status(201).json({ id });
  });
  admin.get("/jobs", (_req, res) => res.json(jobCatalog(db)));
  function ensureJobName(name: string, except = "") {
    if (
      one(
        db,
        "SELECT id FROM job_roles WHERE active=1 AND name=? COLLATE NOCASE AND id<>?",
        name,
        except,
      )
    )
      fail(409, "이미 사용 중인 직무 이름입니다.");
  }
  admin.post("/jobs", (req: Authed, res) => {
    const body = z
      .object({ name: jobName, hourly_rate: hourlyRate, date: rateMonth })
      .parse(req.body);
    const id = randomUUID();
    transaction(db, () => {
      ensureJobName(body.name);
      db.prepare("INSERT INTO job_roles(id,name) VALUES(?,?)").run(
        id,
        body.name,
      );
      db.prepare(
        "INSERT INTO job_rates(id,job_id,kind,date,hourly_rate,reason) VALUES(?,?,'monthly',?,?,?)",
      ).run(randomUUID(), id, body.date, body.hourly_rate, "최초 등록");
      audit(db, req.admin!.id, "job.create", id, body);
    });
    res.status(201).json({ id });
  });
  admin.patch("/jobs/:id", (req: Authed, res) => {
    const id = idSchema.parse(req.params.id);
    const body = z
      .object({
        name: jobName,
        active: z.boolean(),
        revision: z.number().int().positive(),
      })
      .parse(req.body);
    if (id === DEFAULT_JOB_ID)
      fail(400, "기본 직무 조교는 이름 변경하거나 보관할 수 없습니다.");
    transaction(db, () => {
      const before = one<{ name: string; active: number; revision: number }>(
        db,
        "SELECT * FROM job_roles WHERE id=?",
        id,
      );
      if (!before) fail(404, "직무를 찾을 수 없습니다.");
      if (before.revision !== body.revision)
        fail(409, "직무가 변경됐습니다. 새로고침해 주세요.");
      if (body.active) ensureJobName(body.name, id);
      else if (before.active) {
        if (
          one(
            db,
            `SELECT 1 FROM employee_jobs ej JOIN employees e ON e.id=ej.employee_id
            WHERE ej.job_id=? AND ej.active=1 AND e.active=1`,
            id,
          )
        )
          fail(
            409,
            "재직 직원에게 배정된 직무입니다. 직원·시급에서 배정을 먼저 해제해 주세요.",
          );
        if (
          one(
            db,
            `SELECT 1 FROM shifts s JOIN shift_jobs sj ON sj.shift_id=s.id
            WHERE sj.job_id=? AND s.voided=0 AND s.ended_at IS NULL`,
            id,
          )
        )
          fail(409, "이 직무의 진행 중인 근무를 먼저 마감해 주세요.");
        // Keep history available while preventing a restored role from silently reappearing.
        db.prepare(
          "UPDATE employees SET revision=revision+1 WHERE id IN (SELECT employee_id FROM employee_jobs WHERE job_id=? AND active=1)",
        ).run(id);
        db.prepare(
          "UPDATE employee_jobs SET active=0,is_default=0 WHERE job_id=?",
        ).run(id);
      }
      db.prepare(
        "UPDATE job_roles SET name=?,active=?,revision=revision+1 WHERE id=?",
      ).run(body.name, Number(body.active), id);
      audit(db, req.admin!.id, "job.update", id, { before, after: body });
    });
    res.json({ ok: true });
  });
  admin.put("/employees/:id/jobs", (req: Authed, res) => {
    const employeeId = idSchema.parse(req.params.id);
    const body = z
      .object({
        job_ids: z.array(idSchema).min(1).max(30),
        default_job_id: idSchema,
        revision: z.number().int().positive(),
      })
      .parse(req.body);
    const jobIds = [...new Set(body.job_ids)];
    if (!jobIds.includes(body.default_job_id))
      fail(400, "배정한 직무 중에 기본 직무를 선택해 주세요.");
    transaction(db, () => {
      const employee = one<{ revision: number }>(
        db,
        "SELECT revision FROM employees WHERE id=?",
        employeeId,
      );
      if (!employee) fail(404, "직원을 찾을 수 없습니다.");
      if (employee.revision !== body.revision)
        fail(409, "직원 정보가 변경됐습니다. 새로고침해 주세요.");
      const before = employeeJobAssignments(db, employeeId);
      if (
        jobIds.some(
          (id) =>
            !one(db, "SELECT id FROM job_roles WHERE id=? AND active=1", id),
        )
      )
        fail(409, "보관됐거나 없는 직무가 포함돼 있습니다. 새로고침해 주세요.");
      db.prepare(
        "UPDATE employee_jobs SET active=0,is_default=0 WHERE employee_id=?",
      ).run(employeeId);
      if (before.some((job) => job.id === DEFAULT_JOB_ID))
        db.prepare("INSERT OR IGNORE INTO employee_jobs VALUES(?,?,0,0)").run(
          employeeId,
          DEFAULT_JOB_ID,
        );
      const assign = db.prepare(`INSERT INTO employee_jobs VALUES(?,?,1,?)
        ON CONFLICT(employee_id,job_id) DO UPDATE SET active=1,is_default=excluded.is_default`);
      for (const id of jobIds)
        assign.run(employeeId, id, Number(id === body.default_job_id));
      db.prepare("UPDATE employees SET revision=revision+1 WHERE id=?").run(
        employeeId,
      );
      audit(db, req.admin!.id, "job.assign", employeeId, {
        before,
        after: body,
      });
    });
    res.json({ ok: true });
  });
  admin.put("/jobs/:id/rates", (req: Authed, res) => {
    const jobId = idSchema.parse(req.params.id);
    const body = z
      .object({
        employee_id: idSchema.nullable(),
        kind: z.enum(["monthly", "day"]),
        date,
        hourly_rate: hourlyRate.nullable(),
        expected_id: idSchema.nullable(),
        revision: z.number().int().positive().nullable(),
        reason,
      })
      .parse(req.body);
    if (body.kind === "monthly") rateMonth.parse(body.date);
    if (!body.employee_id && (body.kind === "day" || body.hourly_rate === null))
      fail(400, "직무 기본 시급은 적용 월과 금액이 필요합니다.");
    if (jobId === DEFAULT_JOB_ID && body.employee_id)
      fail(400, "조교 개인 시급은 직원·시급에서 변경해 주세요.");
    transaction(db, () => {
      if (!one(db, "SELECT id FROM job_roles WHERE id=?", jobId))
        fail(404, "직무를 찾을 수 없습니다.");
      if (
        body.employee_id &&
        !one(
          db,
          "SELECT 1 FROM employee_jobs WHERE employee_id=? AND job_id=?",
          body.employee_id,
          jobId,
        )
      )
        fail(409, "직원에게 이 직무를 먼저 배정해 주세요.");
      const before = one<JobRate>(
        db,
        "SELECT * FROM job_rates WHERE job_id=? AND employee_id IS ? AND kind=? AND date=?",
        jobId,
        body.employee_id,
        body.kind,
        body.date,
      );
      if (
        (before?.id ?? null) !== body.expected_id ||
        (before?.revision ?? null) !== body.revision
      )
        fail(409, "시급이 변경됐습니다. 새로고침 후 다시 확인해 주세요.");
      if (body.kind === "day" && body.hourly_rate === null) {
        if (!before) fail(404, "해제할 하루 시급이 없습니다.");
        db.prepare("DELETE FROM job_rates WHERE id=?").run(before.id);
      } else if (before) {
        db.prepare(
          "UPDATE job_rates SET hourly_rate=?,reason=?,revision=revision+1 WHERE id=?",
        ).run(body.hourly_rate, body.reason, before.id);
      } else {
        db.prepare(
          "INSERT INTO job_rates(id,job_id,employee_id,kind,date,hourly_rate,reason) VALUES(?,?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          jobId,
          body.employee_id,
          body.kind,
          body.date,
          body.hourly_rate,
          body.reason,
        );
      }
      audit(db, req.admin!.id, "job.rate", jobId, { before, after: body });
    });
    res.json({ ok: true });
  });
  admin.patch("/employees/:id", (req: Authed, res) => {
    const body = employeeSchema
      .extend({ revision: z.number().int().min(1) })
      .parse(req.body);
    const id = idSchema.parse(req.params.id);
    transaction(db, () => {
      const before =
        one<{ revision: number }>(
          db,
          "SELECT * FROM employees WHERE id=?",
          id,
        ) || fail(404, "직원을 찾을 수 없습니다.");
      if (before.revision !== body.revision)
        fail(409, "다른 관리자가 직원 정보를 수정했습니다. 새로고침해 주세요.");
      if (body.active && !assignedJobs(db, id).length)
        fail(409, "재직으로 변경하기 전에 사용 가능한 직무를 배정해 주세요.");
      if (
        !body.active &&
        one(
          db,
          "SELECT id FROM shifts WHERE employee_id=? AND ended_at IS NULL AND voided=0",
          id,
        )
      )
        fail(409, "근무 중인 기록을 퇴근 또는 정정한 후 퇴사 처리해 주세요.");
      db.prepare(
        "UPDATE employees SET name=?,phone_last4=?,active=?,note=?,weekly_enabled=?,holiday_multiplier=?,revision=revision+1 WHERE id=?",
      ).run(
        body.name,
        body.phone_last4,
        Number(body.active),
        body.note,
        Number(body.weekly_enabled),
        body.holiday_multiplier,
        id,
      );
      audit(db, req.admin!.id, "employee.update", id, { before, after: body });
    });
    res.json({ ok: true });
  });
  admin.post("/employees/:id/month-rates", (req: Authed, res) => {
    const body = z
      .object({
        month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
        hourly_rate: z.number().int().min(1).max(1000000),
        reason,
        expected: z.string().max(30000),
      })
      .parse(req.body);
    const employeeId = idSchema.parse(req.params.id);
    const from = date.parse(body.month + "-01");
    const until = addDays(from, 32).slice(0, 7) + "-01";
    transaction(db, () => {
      if (!one(db, "SELECT id FROM employees WHERE id=?", employeeId))
        fail(404, "직원을 찾을 수 없습니다.");
      const before = db
        .prepare(
          "SELECT * FROM rates WHERE employee_id=? AND effective_from>=? AND effective_from<? ORDER BY effective_from",
        )
        .all(employeeId, from, until) as unknown as Rate[];
      if (rateMonthVersion(before, body.month) !== body.expected)
        fail(
          409,
          "다른 관리자가 이달 시급을 변경했습니다. 새로고침 후 다시 확인해 주세요.",
        );
      db.prepare(
        "DELETE FROM rates WHERE employee_id=? AND effective_from>=? AND effective_from<?",
      ).run(employeeId, from, until);
      db.prepare("INSERT INTO rates VALUES(?,?,?,?,?,?)").run(
        randomUUID(),
        employeeId,
        from,
        body.hourly_rate,
        body.reason,
        new Date().toISOString(),
      );
      audit(db, req.admin!.id, "rate.month", employeeId, {
        month: body.month,
        before,
        hourly_rate: body.hourly_rate,
        reason: body.reason,
      });
    });
    res.json({ ok: true });
  });
  // Retain the date-based endpoint for already-open older clients and old history.
  admin.post("/employees/:id/rates", (req: Authed, res) => {
    const body = z
      .object({
        effective_from: date,
        hourly_rate: z.number().int().min(1).max(1000000),
        reason,
        expectedRate: z.number().nullable(),
      })
      .parse(req.body);
    const employeeId = idSchema.parse(req.params.id);
    transaction(db, () => {
      if (!one(db, "SELECT id FROM employees WHERE id=?", employeeId))
        fail(404, "직원을 찾을 수 없습니다.");
      const before = one<{ id: string; hourly_rate: number }>(
        db,
        "SELECT * FROM rates WHERE employee_id=? AND effective_from=?",
        employeeId,
        body.effective_from,
      );
      if ((before?.hourly_rate ?? null) !== body.expectedRate)
        fail(
          409,
          "다른 관리자가 시급을 변경했습니다. 새로고침 후 다시 확인해 주세요.",
        );
      db.prepare(
        "INSERT INTO rates VALUES(?,?,?,?,?,?) ON CONFLICT(employee_id,effective_from) DO UPDATE SET hourly_rate=excluded.hourly_rate,reason=excluded.reason",
      ).run(
        randomUUID(),
        employeeId,
        body.effective_from,
        body.hourly_rate,
        body.reason,
        new Date().toISOString(),
      );
      audit(db, req.admin!.id, "rate.update", employeeId, {
        before,
        after: body,
      });
    });
    res.json({ ok: true });
  });
  admin.post("/employees/:id/day-rates", (req: Authed, res) => {
    const employeeId = idSchema.parse(req.params.id);
    const body = z
      .object({
        date,
        hourly_rate: z.number().int().min(1).max(1000000),
        reason,
        expectedRate: z.number().nullable(),
      })
      .parse(req.body);
    transaction(db, () => {
      if (!one(db, "SELECT id FROM employees WHERE id=?", employeeId))
        fail(404, "직원을 찾을 수 없습니다.");
      const before = one<{ hourly_rate: number }>(
        db,
        "SELECT * FROM day_rates WHERE employee_id=? AND date=?",
        employeeId,
        body.date,
      );
      if ((before?.hourly_rate ?? null) !== body.expectedRate)
        fail(409, "시급이 변경됐습니다. 새로고침 후 다시 확인해 주세요.");
      db.prepare(
        "INSERT INTO day_rates VALUES(?,?,?,?,?,?) ON CONFLICT(employee_id,date) DO UPDATE SET hourly_rate=excluded.hourly_rate,reason=excluded.reason",
      ).run(
        randomUUID(),
        employeeId,
        body.date,
        body.hourly_rate,
        body.reason,
        new Date().toISOString(),
      );
      audit(db, req.admin!.id, "dayrate.update", employeeId, {
        before,
        after: body,
      });
    });
    res.json({ ok: true });
  });
  admin.post("/employees/:id/day-rates/remove", (req: Authed, res) => {
    const employeeId = idSchema.parse(req.params.id);
    const body = z
      .object({ date, expectedRate: z.number(), reason })
      .parse(req.body);
    transaction(db, () => {
      const before = one<{ hourly_rate: number }>(
        db,
        "SELECT * FROM day_rates WHERE employee_id=? AND date=?",
        employeeId,
        body.date,
      );
      if (!before || before.hourly_rate !== body.expectedRate)
        fail(409, "시급이 변경됐습니다. 새로고침 후 다시 확인해 주세요.");
      db.prepare("DELETE FROM day_rates WHERE employee_id=? AND date=?").run(
        employeeId,
        body.date,
      );
      audit(db, req.admin!.id, "dayrate.remove", employeeId, {
        before,
        reason: body.reason,
      });
    });
    res.json({ ok: true });
  });
  admin.get("/records", (req, res) => {
    const { from, to } = period.parse(req.query);
    res.json(
      attachShiftBreaks(
        db,
        db
          .prepare(shiftRangeSql(true))
          .all(
            new Date(dayStart(addDays(to, 1))).toISOString(),
            new Date(dayStart(from)).toISOString(),
            new Date(dayStart(addDays(to, 1))).toISOString(),
          ) as unknown as Shift[],
      ),
    );
  });
  function validateShift(body: z.infer<typeof shiftSchema>, except = "") {
    const start = Date.parse(body.started_at),
      end = body.ended_at ? Date.parse(body.ended_at) : Infinity;
    if (end <= start || (Number.isFinite(end) && end - start > 24 * 3600000))
      fail(400, "근무 구간은 0시간 초과 24시간 이내여야 합니다.");
    if (
      start > Date.now() + 60000 ||
      (body.ended_at && end > Date.now() + 60000)
    )
      fail(400, "미래 시각의 근무기록은 등록할 수 없습니다.");
    if (body.break_minutes * 60000 >= end - start)
      fail(400, "휴게시간이 전체 근무시간보다 짧아야 합니다.");
    const invalidBreak = breakError(
      body.started_at,
      body.ended_at,
      body.break_minutes,
      body.breaks ?? [],
    );
    if (invalidBreak) fail(400, invalidBreak);
    const overlap = overlappingShift(
      db,
      body.employee_id,
      body.started_at,
      body.ended_at,
      except,
    );
    if (overlap) fail(409, "같은 직원의 다른 근무 구간과 겹칩니다.");
  }
  function shiftJob(shiftId: string) {
    return (
      one<{ job_id: string }>(
        db,
        "SELECT job_id FROM shift_jobs WHERE shift_id=?",
        shiftId,
      )?.job_id ?? DEFAULT_JOB_ID
    );
  }
  function setShiftJob(shiftId: string, jobId: string) {
    if (jobId === DEFAULT_JOB_ID)
      db.prepare("DELETE FROM shift_jobs WHERE shift_id=?").run(shiftId);
    else
      db.prepare(
        "INSERT INTO shift_jobs VALUES(?,?) ON CONFLICT(shift_id) DO UPDATE SET job_id=excluded.job_id",
      ).run(shiftId, jobId);
  }
  function resolveJob(
    employeeId: string,
    requested: string | null | undefined,
    historical: boolean,
  ) {
    const available = historical
      ? employeeJobAssignments(db, employeeId)
      : assignedJobs(db, employeeId);
    if (requested && available.some((job) => job.id === requested))
      return requested;
    if (
      !requested &&
      available.length === 1 &&
      available[0].id === DEFAULT_JOB_ID
    )
      return DEFAULT_JOB_ID;
    fail(409, "이 직원의 근무 직무를 확인해 주세요.");
  }
  admin.post("/records", (req: Authed, res) => {
    const body = shiftSchema.parse(req.body);
    const id = randomUUID();
    transaction(db, () => {
      if (!one(db, "SELECT id FROM employees WHERE id=?", body.employee_id))
        fail(404, "직원을 찾을 수 없습니다.");
      const jobId = resolveJob(body.employee_id, body.job_id, true);
      validateShift(body);
      db.prepare("INSERT INTO shifts VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        id,
        body.employee_id,
        body.started_at,
        body.ended_at,
        body.break_minutes,
        "manual",
        body.note,
        1,
        0,
        new Date().toISOString(),
      );
      setShiftJob(id, jobId);
      audit(db, req.admin!.id, "shift.create", id, { ...body, job_id: jobId });
      replaceShiftBreaks(db, id, body.breaks ?? []);
    });
    res.status(201).json({ id });
  });
  admin.patch("/records/:id", (req: Authed, res) => {
    const id = idSchema.parse(req.params.id);
    const body = shiftSchema.parse(req.body);
    transaction(db, () => {
      const before =
        one<Shift>(db, "SELECT * FROM shifts WHERE id=? AND voided=0", id) ||
        fail(404, "수정할 기록을 찾을 수 없습니다.");
      if (before.revision !== body.revision)
        fail(409, "다른 관리자가 기록을 변경했습니다. 새로고침해 주세요.");
      if (!one(db, "SELECT id FROM employees WHERE id=?", body.employee_id))
        fail(404, "직원을 찾을 수 없습니다.");
      const savedBreaks = attachShiftBreaks(db, [before])[0].breaks!;
      const previousJob = shiftJob(id);
      const jobId =
        body.employee_id === before.employee_id && !body.job_id
          ? previousJob
          : resolveJob(body.employee_id, body.job_id, true);
      // An older open tab must not silently erase precise break information.
      if (body.breaks === undefined) body.breaks = savedBreaks;
      validateShift(body, id);
      db.prepare(
        "UPDATE shifts SET employee_id=?,started_at=?,ended_at=?,break_minutes=?,note=?,revision=revision+1 WHERE id=?",
      ).run(
        body.employee_id,
        body.started_at,
        body.ended_at,
        body.break_minutes,
        body.note,
        id,
      );
      replaceShiftBreaks(db, id, body.breaks);
      setShiftJob(id, jobId);
      audit(db, req.admin!.id, "shift.update", id, {
        before: { ...before, breaks: savedBreaks, job_id: previousJob },
        after: { ...body, job_id: jobId },
      });
    });
    res.json({ ok: true });
  });
  admin.post("/records/:id/void", (req: Authed, res) => {
    const id = idSchema.parse(req.params.id);
    const body = z
      .object({ reason, revision: z.number().int() })
      .parse(req.body);
    transaction(db, () => {
      const before =
        one<Shift>(db, "SELECT * FROM shifts WHERE id=? AND voided=0", id) ||
        fail(404, "기록을 찾을 수 없습니다.");
      if (before.revision !== body.revision)
        fail(409, "다른 관리자가 기록을 변경했습니다.");
      db.prepare(
        "UPDATE shifts SET voided=1,revision=revision+1 WHERE id=?",
      ).run(id);
      audit(db, req.admin!.id, "shift.void", id, {
        before,
        reason: body.reason,
      });
    });
    res.json({ ok: true });
  });
  admin.get("/reviews", (_req, res) =>
    res.json(
      db
        .prepare(
          `SELECT c.*,e.name,d.name AS device_name,cj.job_id,j.name AS job_name
           FROM clock_events c JOIN employees e ON e.id=c.employee_id
           JOIN devices d ON d.id=c.device_id LEFT JOIN clock_event_jobs cj ON cj.event_id=c.id
           LEFT JOIN job_roles j ON j.id=cj.job_id
           WHERE c.status='pending' ORDER BY c.captured_at,c.received_at,c.rowid`,
        )
        .all(),
    ),
  );
  admin.post("/recover-events", (req: Authed, res) => {
    const body = z
      .object({
        events: z.array(clockSchema).min(1).max(200),
      })
      .parse(req.body);
    let imported = 0,
      existing = 0;
    transaction(db, () => {
      let deviceId: string | null = null;
      const receivedAt = new Date().toISOString();
      const checkedEmployees = new Set<string>();
      const getEmployee = db.prepare("SELECT id FROM employees WHERE id=?");
      const getPrior = db.prepare(
        "SELECT fingerprint FROM clock_events WHERE id=?",
      );
      const insertEvent = db.prepare(
        "INSERT INTO clock_events VALUES(?,?,?,?,?,?,?,?,?,?)",
      );
      for (const event of body.events) {
        if (!checkedEmployees.has(event.employee_id)) {
          if (!getEmployee.get(event.employee_id))
            fail(
              400,
              "현재 학원에 없는 직원이 포함돼 있습니다. 파일을 확인해 주세요.",
            );
          checkedEmployees.add(event.employee_id);
        }
        const fingerprint = clockFingerprint(event);
        const prior = getPrior.get(event.id);
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            fail(
              409,
              "동일한 기록 번호에 다른 내용이 있습니다. 원본을 확인해 주세요.",
            );
          existing++;
          continue;
        }
        if (!deviceId) {
          deviceId = randomUUID();
          db.prepare("INSERT INTO devices VALUES(?,?,?,?,?,?)").run(
            deviceId,
            "관리자 복구 파일",
            hash(secret()),
            0,
            null,
            receivedAt,
          );
        }
        insertEvent.run(
          event.id,
          deviceId,
          event.employee_id,
          event.action,
          event.captured_at,
          receivedAt,
          "pending",
          "관리자가 미전송 파일에서 복구한 기록",
          fingerprint,
          null,
        );
        storeClockJob(event);
        imported++;
      }
      if (deviceId)
        audit(db, req.admin!.id, "clock.recover", deviceId, {
          imported,
          existing,
          ids: body.events.map((e) => e.id),
        });
    });
    res.json({ imported, existing });
  });
  function clockFingerprint(event: z.infer<typeof clockSchema>) {
    return hash(
      JSON.stringify({
        id: event.id,
        employee_id: event.employee_id,
        action: event.action,
        captured_at: event.captured_at,
        ...(event.job_id ? { job_id: event.job_id } : {}),
        ...(event.expected_shift_id
          ? { expected_shift_id: event.expected_shift_id }
          : {}),
      }),
    );
  }
  function storeClockJob(event: z.infer<typeof clockSchema>) {
    if (event.job_id || event.expected_shift_id)
      db.prepare("INSERT INTO clock_event_jobs VALUES(?,?,?)").run(
        event.id,
        event.job_id ?? null,
        event.expected_shift_id ?? null,
      );
  }
  function applyClock(
    event: z.infer<typeof clockSchema>,
    at: string,
    historical = false,
  ) {
    const { id, employee_id: employeeId, action } = event;
    const open = one<Shift>(
      db,
      "SELECT * FROM shifts WHERE employee_id=? AND ended_at IS NULL AND voided=0",
      employeeId,
    );
    if (action === "in" && open)
      fail(409, "이미 출근 중입니다. 기존 근무기록을 먼저 정정해 주세요.");
    if (action !== "in" && !open)
      fail(409, "출근 기록이 없습니다. 출근 기록부터 확인해 주세요.");
    if (
      (event.expected_shift_id || action === "switch") &&
      event.expected_shift_id !== open?.id
    )
      fail(
        409,
        "기기에서 선택한 근무와 현재 진행 중인 근무가 다릅니다. 근무기록을 확인해 주세요.",
      );
    const jobId =
      action === "out"
        ? null
        : resolveJob(employeeId, event.job_id, historical);
    if (action === "switch" && open && jobId === shiftJob(open.id))
      fail(409, "이미 같은 직무로 근무 중입니다.");
    if (jobId && one(db, "SELECT id FROM shifts WHERE id=?", id))
      fail(
        409,
        "이 기록 번호가 기존 근무에 사용 중입니다. 근무기록을 확인해 주세요.",
      );
    if (open)
      validateShift(
        {
          employee_id: employeeId,
          started_at: open.started_at,
          ended_at: at,
          break_minutes: open.break_minutes,
          breaks: attachShiftBreaks(db, [open])[0].breaks,
          note: open.note,
          reason: "근무 종료",
        },
        open.id,
      );
    if (jobId)
      validateShift(
        {
          employee_id: employeeId,
          started_at: at,
          ended_at: null,
          break_minutes: 0,
          note: "",
          reason: "근무 시작",
        },
        open?.id,
      );
    // Complete validation before writing. Both changes share the event transaction.
    if (open)
      db.prepare(
        "UPDATE shifts SET ended_at=?,revision=revision+1 WHERE id=?",
      ).run(at, open.id);
    if (!jobId) return open!.id;
    db.prepare("INSERT INTO shifts VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      id,
      employeeId,
      at,
      null,
      0,
      "kiosk",
      "",
      1,
      0,
      new Date().toISOString(),
    );
    if (jobId !== DEFAULT_JOB_ID) setShiftJob(id, jobId);
    return id;
  }
  admin.post("/reviews/:id", (req: Authed, res) => {
    const id = idSchema.parse(req.params.id);
    const body = z
      .object({ approve: z.boolean(), reason, job_id: idSchema.optional() })
      .parse(req.body);
    transaction(db, () => {
      const event =
        one<
          z.infer<typeof clockSchema> & {
            received_at: string;
            event_order: number;
          }
        >(
          db,
          `SELECT c.*,c.rowid AS event_order,cj.job_id,cj.expected_shift_id FROM clock_events c
            LEFT JOIN clock_event_jobs cj ON cj.event_id=c.id WHERE c.id=? AND c.status='pending'`,
          id,
        ) || fail(409, "이미 처리했거나 없는 기록입니다.");
      if (
        body.approve &&
        one(
          db,
          `SELECT id FROM clock_events WHERE employee_id=? AND status='pending'
          AND (captured_at,received_at,rowid)<(?,?,?) LIMIT 1`,
          event.employee_id,
          event.captured_at,
          event.received_at,
          event.event_order,
        )
      )
        fail(409, "같은 직원의 앞선 기록을 먼저 승인하거나 반려해 주세요.");
      const shiftId = body.approve
        ? applyClock(
            { ...event, job_id: body.job_id ?? event.job_id },
            event.captured_at,
            true,
          )
        : null;
      db.prepare("UPDATE clock_events SET status=?,shift_id=? WHERE id=?").run(
        body.approve ? "accepted" : "rejected",
        shiftId,
        id,
      );
      audit(db, req.admin!.id, "clock.review", id, { ...body, event });
    });
    res.json({ ok: true });
  });
  admin.get("/settings", (_req, res) => res.json(getPolicy(db)));
  admin.put("/settings", (req: Authed, res) => {
    const body = policySchema.parse(req.body);
    const expected = z.string().max(4000).parse(req.body.expected);
    transaction(db, () => {
      const before = getPolicy(db);
      if (JSON.stringify(before) !== expected)
        fail(409, "다른 관리자가 계산 기준을 변경했습니다. 새로고침해 주세요.");
      db.prepare("UPDATE settings SET json=? WHERE id=1").run(
        JSON.stringify(body),
      );
      audit(db, req.admin!.id, "policy.update", "1", { before, after: body });
    });
    res.json({ ok: true });
  });
  admin.get("/holiday-calendar", (_req, res) =>
    res.json(holidayCalendar.status()),
  );
  admin.post(
    "/holiday-calendar/sync",
    sensitiveLimit,
    async (req: Authed, res) => {
      const { year } = z
        .object({
          year: z
            .number()
            .int()
            .min(2000)
            .max(Number(seoulDate().slice(0, 4)) + 1),
        })
        .parse(req.body);
      try {
        res.json(await holidayCalendar.sync(year, req.admin!.id));
      } catch (error) {
        res.status(503).json({
          error: error instanceof Error ? error.message : "공휴일 갱신 실패",
        });
      }
    },
  );
  for (const action of ["approve", "confirm"] as const)
    admin.post(`/holiday-calendar/${action}`, (req: Authed, res) => {
      const body = z
        .object({
          year: z.number().int().min(2000).max(2100),
          expected: z.string().regex(/^[a-f0-9]{64}$/),
          reason,
        })
        .parse(req.body);
      try {
        holidayCalendar[action](
          body.year,
          body.expected,
          body.reason,
          req.admin!.id,
        );
        res.json({ ok: true });
      } catch {
        res.status(409).json({
          error:
            "공휴일 자료가 변경됐거나 검토가 필요합니다. 새로고침해 주세요.",
        });
      }
    });
  admin.get("/holidays", (_req, res) => res.json(getHolidays(db)));
  admin.post("/holidays", (req: Authed, res) => {
    const body = z.object({ date, name: text }).parse(req.body);
    const id = randomUUID();
    if (one(db, "SELECT id FROM holidays WHERE date=?", body.date))
      fail(409, "이미 등록된 휴일입니다.");
    transaction(db, () => {
      db.prepare("INSERT INTO holidays VALUES(?,?,?)").run(
        id,
        body.date,
        body.name,
      );
      audit(db, req.admin!.id, "holiday.create", id, body);
    });
    res.status(201).json({ id });
  });
  admin.delete("/holidays/:id", (req: Authed, res) => {
    const id = idSchema.parse(req.params.id);
    transaction(db, () => {
      const before =
        one(db, "SELECT * FROM holidays WHERE id=?", id) ||
        fail(404, "휴일을 찾을 수 없습니다.");
      db.prepare("DELETE FROM holidays WHERE id=?").run(id);
      audit(db, req.admin!.id, "holiday.delete", id, before);
    });
    res.json({ ok: true });
  });
  admin.get("/adjustments", (req, res) => {
    const { from, to } = period.parse(req.query);
    res.json(
      db
        .prepare(
          "SELECT a.*,e.name FROM adjustments a JOIN employees e ON e.id=a.employee_id WHERE date BETWEEN ? AND ? ORDER BY date DESC",
        )
        .all(from, to),
    );
  });
  admin.post("/adjustments", (req: Authed, res) => {
    const body = z
      .object({
        employee_id: idSchema,
        date,
        amount: z
          .number()
          .int()
          .min(-100000000)
          .max(100000000)
          .refine((v) => v !== 0),
        reason,
      })
      .parse(req.body);
    const id = randomUUID();
    if (!one(db, "SELECT id FROM employees WHERE id=?", body.employee_id))
      fail(404, "직원을 찾을 수 없습니다.");
    transaction(db, () => {
      db.prepare("INSERT INTO adjustments VALUES(?,?,?,?,?,?)").run(
        id,
        body.employee_id,
        body.date,
        body.amount,
        body.reason,
        new Date().toISOString(),
      );
      audit(db, req.admin!.id, "adjustment.create", id, body);
    });
    res.status(201).json({ id });
  });
  admin.delete("/adjustments/:id", (req: Authed, res) => {
    const id = idSchema.parse(req.params.id);
    transaction(db, () => {
      const before =
        one(db, "SELECT * FROM adjustments WHERE id=?", id) ||
        fail(404, "수당을 찾을 수 없습니다.");
      db.prepare("DELETE FROM adjustments WHERE id=?").run(id);
      audit(db, req.admin!.id, "adjustment.delete", id, before);
    });
    res.json({ ok: true });
  });
  admin.get("/payroll", (req, res) => {
    const { from, to } = period.parse(req.query);
    res.json(calculatePayroll(db, from, to, holidayCalendar.configured));
  });
  admin.post("/settlements", (req: Authed, res) => {
    const body = period
      .and(z.object({ fingerprint: z.string().length(64), reason }))
      .parse(req.body);
    const id = randomUUID();
    transaction(db, () => {
      const overlap = one(
        db,
        "SELECT id FROM settlements WHERE date_from<=? AND date_to>=? AND NOT(date_from=? AND date_to=?)",
        body.to,
        body.from,
        body.from,
        body.to,
      );
      if (overlap)
        fail(
          409,
          "다른 확정 기간과 겹칩니다. 기존 정산과 동일한 기간을 선택해 주세요.",
        );
      const payroll = calculatePayroll(
        db,
        body.from,
        body.to,
        holidayCalendar.configured,
      );
      if (payroll.fingerprint !== body.fingerprint)
        fail(409, "계산 기준이 변경됐습니다. 새로고침 후 다시 확인해 주세요.");
      if (
        payroll.warnings.length ||
        payroll.rows.some((row) => row.warnings.length)
      )
        fail(409, "미확인 기록과 계산 경고를 먼저 해결해 주세요.");
      if (body.to >= seoulDate())
        fail(409, "진행 중인 날짜가 포함된 정산은 확정할 수 없습니다.");
      if (payroll.settlement?.fingerprint === payroll.fingerprint)
        fail(409, "동일한 내용으로 이미 확정됐습니다.");
      const version = (payroll.settlement?.version || 0) + 1;
      db.prepare("INSERT INTO settlements VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        id,
        body.from,
        body.to,
        version,
        payroll.total,
        JSON.stringify({ ...payroll, settlement: null }),
        payroll.fingerprint,
        new Date().toISOString(),
        req.admin!.id,
        body.reason,
      );
      audit(db, req.admin!.id, "settlement.create", id, {
        from: body.from,
        to: body.to,
        version,
        total: payroll.total,
        difference: payroll.difference,
        reason: body.reason,
      });
    });
    res.status(201).json({ id });
  });
  admin.get("/settlements", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT s.id,s.date_from,s.date_to,s.version,s.total,s.created_at,s.reason,a.name FROM settlements s JOIN admins a ON a.id=s.created_by ORDER BY s.created_at DESC LIMIT 100",
        )
        .all(),
    ),
  );
  admin.get("/settlements/:id", (req, res) => {
    const row =
      one<{ snapshot: string }>(
        db,
        "SELECT snapshot FROM settlements WHERE id=?",
        idSchema.parse(req.params.id),
      ) || fail(404, "확정본을 찾을 수 없습니다.");
    res.json(JSON.parse(row.snapshot));
  });
  admin.get("/audit", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT au.*,a.name AS actor_name FROM audit au LEFT JOIN admins a ON a.id=au.actor ORDER BY au.created_at DESC LIMIT 200",
        )
        .all(),
    ),
  );
  admin.get("/accounts", owner, (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,username,name,role,active FROM admins ORDER BY created_at",
        )
        .all(),
    ),
  );
  admin.post("/accounts", owner, (req: Authed, res) => {
    const body = account.parse(req.body);
    const id = randomUUID();
    if (one(db, "SELECT id FROM admins WHERE username=?", body.username))
      fail(409, "이미 사용 중인 아이디입니다.");
    transaction(db, () => {
      db.prepare("INSERT INTO admins VALUES(?,?,?,?,?,?,?)").run(
        id,
        body.username,
        body.name,
        passwordHash(body.password),
        "manager",
        1,
        new Date().toISOString(),
      );
      audit(db, req.admin!.id, "account.create", id, {
        username: body.username,
        name: body.name,
      });
    });
    res.status(201).json({ id });
  });
  admin.patch("/accounts/:id", owner, (req: Authed, res) => {
    const id = idSchema.parse(req.params.id);
    const body = z
      .object({
        active: z.boolean(),
        name: text,
        password: password.optional(),
      })
      .parse(req.body);
    transaction(db, () => {
      const before =
        one<Admin>(db, "SELECT id,name,role FROM admins WHERE id=?", id) ||
        fail(404, "계정을 찾을 수 없습니다.");
      if (before.role === "owner")
        fail(
          403,
          "개발자 계정은 여기서 변경할 수 없습니다. 내 이름·비밀번호 변경을 이용해 주세요.",
        );
      db.prepare("UPDATE admins SET active=?,name=? WHERE id=?").run(
        Number(body.active),
        body.name,
        id,
      );
      if (body.password)
        db.prepare("UPDATE admins SET password_hash=? WHERE id=?").run(
          passwordHash(body.password),
          id,
        );
      db.prepare("DELETE FROM sessions WHERE admin_id=?").run(id);
      audit(db, req.admin!.id, "account.update", id, {
        active: body.active,
        name: body.name,
        passwordReset: !!body.password,
      });
    });
    res.json({ ok: true });
  });
  admin.get("/devices", owner, (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,name,active,last_seen,created_at FROM devices ORDER BY created_at DESC",
        )
        .all(),
    ),
  );
  admin.patch("/devices/:id", owner, (req: Authed, res) => {
    const id = idSchema.parse(req.params.id);
    const body = z
      .object({ name: text, expectedName: text })
      .strict()
      .parse(req.body);
    transaction(db, () => {
      const device =
        one<{ name: string }>(db, "SELECT name FROM devices WHERE id=?", id) ||
        fail(404, "기기를 찾을 수 없습니다.");
      if (device.name !== body.expectedName)
        fail(409, "기기 이름이 변경됐습니다. 새로고침 후 다시 확인해 주세요.");
      if (device.name !== body.name) {
        db.prepare("UPDATE devices SET name=? WHERE id=?").run(body.name, id);
        audit(db, req.admin!.id, "device.rename", id, {
          before: device.name,
          after: body.name,
        });
      }
    });
    res.json({ ok: true });
  });
  admin.post("/pairings", owner, (req: Authed, res) => {
    const body = z.object({ name: text }).parse(req.body);
    const code = String(randomInt(10000000, 100000000));
    const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
    db.prepare("DELETE FROM pairing_codes WHERE expires_at<?").run(
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO pairing_codes VALUES(?,?,?)").run(
      hash(code),
      body.name,
      expiresAt,
    );
    audit(db, req.admin!.id, "device.pairing", body.name, {});
    res.json({ code, expiresAt });
  });
  admin.delete("/devices/:id", owner, (req: Authed, res) => {
    const id = idSchema.parse(req.params.id);
    transaction(db, () => {
      db.prepare("UPDATE devices SET active=0 WHERE id=?").run(id);
      audit(db, req.admin!.id, "device.revoke", id, {});
    });
    res.json({ ok: true });
  });
  admin.get("/backup/status", owner, (_req, res) => {
    const last = one<{ created_at: string }>(
      db,
      "SELECT created_at FROM audit WHERE action='backup.download' ORDER BY created_at DESC LIMIT 1",
    );
    res.json({ createdAt: last?.created_at ?? null });
  });
  admin.get("/test-data", owner, (_req, res) => res.json(testDataPlan(db)));
  admin.post(
    "/test-data/cleanup",
    owner,
    sensitiveLimit,
    (req: Authed, res) => {
      const body = z
        .object({
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          current: z.string().min(1).max(128),
          reason,
        })
        .parse(req.body);
      proveCurrentPassword(req, res, body.current);
      const result = removeTestData(
        db,
        body.fingerprint,
        req.admin!.id,
        body.reason,
      );
      if (result.conflict) fail(409, result.conflict);
      res.json(result);
    },
  );
  admin.get("/backup", owner, () =>
    fail(403, "현재 비밀번호를 확인한 후 백업을 받을 수 있습니다."),
  );
  admin.post("/backup", owner, sensitiveLimit, async (req: Authed, res) => {
    const body = z
      .object({ current: z.string().min(1).max(128) })
      .parse(req.body);
    proveCurrentPassword(req, res, body.current);
    await downloadBackup(req, res);
  });
  app.post("/api/kiosk/pair", sensitiveLimit, (req, res) => {
    const body = z
      .object({ code: z.string().regex(/^\d{8}$/) })
      .parse(req.body);
    const token = secret();
    let name = "";
    transaction(db, () => {
      const pairing =
        one<{ name: string }>(
          db,
          "SELECT * FROM pairing_codes WHERE code_hash=? AND expires_at>?",
          hash(body.code),
          new Date().toISOString(),
        ) || fail(403, "연결 코드가 만료됐거나 일치하지 않습니다.");
      name = pairing.name;
      const id = randomUUID();
      db.prepare("INSERT INTO devices VALUES(?,?,?,?,?,?)").run(
        id,
        pairing.name,
        hash(token),
        1,
        null,
        new Date().toISOString(),
      );
      db.prepare("DELETE FROM pairing_codes WHERE code_hash=?").run(
        hash(body.code),
      );
      audit(db, id, "device.paired", id, {});
    });
    res.json({ token, name });
  });
  app.get(
    "/api/kiosk/roster",
    kioskLimit,
    requireDevice,
    (req: Authed, res) => {
      res.json({
        academyName: getPolicy(db).academyName,
        time: new Date().toISOString(),
        employees: rosterJobs(db, req.device!.id),
      });
    },
  );
  app.post(
    "/api/kiosk/events",
    kioskLimit,
    requireDevice,
    (req: Authed, res) => {
      const body = clockSchema
        .extend({ offline: z.boolean() })
        .parse(req.body) satisfies ClockEvent;
      const fingerprint = clockFingerprint(body);
      let result: ClockResult;
      transaction(db, () => {
        const existing = one<{
          status: ClockResult["status"];
          review_reason: string;
          shift_id: string | null;
          fingerprint: string;
          device_id: string;
        }>(db, "SELECT * FROM clock_events WHERE id=?", body.id);
        if (existing) {
          if (
            existing.fingerprint !== fingerprint ||
            existing.device_id !== req.device!.id
          )
            fail(409, "중복 기록의 내용이 일치하지 않습니다.");
          const open =
            existing.status === "accepted"
              ? one<{
                  id: string;
                  job_id: string | null;
                  job_name: string | null;
                }>(
                  db,
                  `SELECT s.id,sj.job_id,j.name AS job_name FROM shifts s
             LEFT JOIN shift_jobs sj ON sj.shift_id=s.id
             LEFT JOIN job_roles j ON j.id=sj.job_id
             WHERE s.employee_id=? AND s.ended_at IS NULL AND s.voided=0`,
                  body.employee_id,
                )
              : undefined;
          result = {
            status: existing.status,
            review_reason: existing.review_reason,
            shift_id: existing.shift_id,
            ...(existing.status === "accepted"
              ? {
                  open_shift: open
                    ? {
                        id: open.id,
                        job: {
                          id: open.job_id ?? DEFAULT_JOB_ID,
                          name: open.job_name ?? DEFAULT_JOB_NAME,
                        },
                      }
                    : null,
                }
              : {}),
          };
          return;
        }
        const employee =
          one<{ active: number }>(
            db,
            "SELECT active FROM employees WHERE id=?",
            body.employee_id,
          ) || fail(404, "직원을 찾을 수 없습니다.");
        const now = new Date().toISOString();
        let reviewReason = "";
        if (!employee.active) reviewReason = "비활성 직원의 기록";
        else if (body.offline) reviewReason = "인터넷 연결 중단 중 저장된 기록";
        else if (Math.abs(Date.now() - Date.parse(body.captured_at)) > 120000)
          reviewReason = "기기 시각 차이 또는 전송 지연";
        else if (
          one(
            db,
            "SELECT id FROM clock_events WHERE employee_id=? AND status='pending' AND captured_at<=? LIMIT 1",
            body.employee_id,
            body.captured_at,
          )
        )
          reviewReason = "먼저 확인할 출퇴근 기록이 있습니다.";
        let shiftId: string | null = null;
        if (!reviewReason) {
          try {
            shiftId = applyClock(body, now);
          } catch (error) {
            if (error instanceof HttpError) reviewReason = error.message;
            else throw error;
          }
        }
        const status = reviewReason ? "pending" : "accepted";
        db.prepare("INSERT INTO clock_events VALUES(?,?,?,?,?,?,?,?,?,?)").run(
          body.id,
          req.device!.id,
          body.employee_id,
          body.action,
          body.captured_at,
          now,
          status,
          reviewReason,
          fingerprint,
          shiftId,
        );
        storeClockJob(body);
        result = { status, review_reason: reviewReason, shift_id: shiftId };
      });
      res.json(result!);
    },
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "요청한 기능을 찾을 수 없습니다." }),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("\n"),
        });
      if (error instanceof HttpError)
        return res.status(error.status).json({ error: error.message });
      if (error && typeof error === "object" && "type" in error) {
        if (error.type === "entity.too.large")
          return res.status(413).json({ error: "요청 데이터가 너무 큽니다." });
        if (
          error.type === "encoding.unsupported" ||
          error.type === "charset.unsupported"
        )
          return res
            .status(415)
            .json({ error: "지원하지 않는 요청 인코딩입니다." });
      }
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: "요청 형식을 확인해 주세요." });
      console.error(error);
      res.status(500).json({
        error: "저장 중 오류가 발생했습니다. 관리자에게 문의해 주세요.",
      });
    },
  );
  return app;
}
