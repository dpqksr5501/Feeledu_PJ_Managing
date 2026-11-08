import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers.ts";
import { calculatePayroll } from "../server/payroll.ts";

describe("API integrity and permissions", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => {
    f = await fixture();
  });
  afterEach(async () => {
    await f.close();
  });
  test("requires authentication and gives managers payroll access without owner operations", async () => {
    expect(
      (await f.request("/admin/employees", undefined, "GET", "")).status,
    ).toBe(401);
    expect(
      (
        await f.request("/admin/accounts", {
          username: "manager",
          name: "부장님",
          password: "manager-password-123",
        })
      ).status,
    ).toBe(201);
    const login = await f.request(
      "/login",
      { username: "manager", password: "manager-password-123" },
      "POST",
      "",
    );
    const cookie = login.response.headers.get("set-cookie")!.split(";")[0];
    expect(
      (await f.request("/admin/employees", undefined, "GET", cookie)).status,
    ).toBe(200);
    expect(
      (await f.request("/admin/accounts", undefined, "GET", cookie)).status,
    ).toBe(403);
    expect(
      (
        await f.request(
          "/admin/pairings",
          { name: "forbidden" },
          "POST",
          cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await f.request("/admin/backup", undefined, "GET", cookie)).status,
    ).toBe(403);
    await f.request("/logout", {}, "POST", cookie);
    expect(
      (await f.request("/admin/me", undefined, "GET", cookie)).status,
    ).toBe(401);
    const csrf = await fetch(f.base + "/api/logout", {
      method: "POST",
      headers: { Cookie: f.cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(csrf.status).toBe(403);
  });
  test("preserves leading zeros, supports identical suffixes, validates dates and prevents overlaps/stale edits", async () => {
    const id = await f.employee();
    await f.employee("다른 조교", "0012");
    const employees = await f.request("/admin/employees");
    expect(employees.data[0].phone_last4).toBe("0012");
    expect(
      (
        await f.request("/admin/holidays", {
          date: "2026-02-30",
          name: "잘못된 날짜",
        })
      ).status,
    ).toBe(400);
    const shift = await f.shift(
      id,
      "2026-10-01T09:00:00+09:00",
      "2026-10-01T13:00:00+09:00",
    );
    expect(shift.status).toBe(201);
    expect(
      (
        await f.shift(
          id,
          "2026-10-01T12:00:00+09:00",
          "2026-10-01T14:00:00+09:00",
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await f.shift(
          id,
          "2026-10-02T09:00:00+09:00",
          "2026-10-02T13:00:00+09:00",
          240,
        )
      ).status,
    ).toBe(400);
    const body = {
      employee_id: id,
      started_at: "2026-10-01T09:00:00+09:00",
      ended_at: "2026-10-01T14:00:00+09:00",
      break_minutes: 30,
      note: "",
      reason: "시간 정정",
      revision: 1,
    };
    expect(
      (await f.request(`/admin/records/${shift.data.id}`, body, "PATCH"))
        .status,
    ).toBe(200);
    expect(
      (await f.request(`/admin/records/${shift.data.id}`, body, "PATCH"))
        .status,
    ).toBe(409);
    const audit = await f.request("/admin/audit");
    expect(
      audit.data.some(
        (entry: { action: string }) => entry.action === "shift.update",
      ),
    ).toBe(true);
  });
  test("records kiosk events once and retains conflicts/offline events for review", async () => {
    const employee_id = await f.employee();
    const token = await f.device();
    const event = {
      id: randomUUID(),
      employee_id,
      action: "in",
      captured_at: new Date().toISOString(),
      offline: false,
    };
    expect(
      (await f.request("/kiosk/events", event, "POST", "", token)).data.status,
    ).toBe("accepted");
    expect(
      (await f.request("/kiosk/events", event, "POST", "", token)).data.status,
    ).toBe("accepted");
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM shifts").get()!.n).toBe(1);
    expect(
      (
        await f.request(
          "/kiosk/events",
          { ...event, action: "out" },
          "POST",
          "",
          token,
        )
      ).status,
    ).toBe(409);
    const duplicate = await f.request(
      "/kiosk/events",
      { ...event, id: randomUUID() },
      "POST",
      "",
      token,
    );
    expect(duplicate.data.status).toBe("pending");
    const employees = (
      await f.request("/kiosk/roster", undefined, "GET", "", token)
    ).data.employees;
    expect(employees[0].working).toBe(true);
    expect(employees[0].hourly_rate).toBeUndefined();
    const device = f.db.prepare("SELECT id FROM devices").get()!;
    await f.request(`/admin/devices/${device.id}`, undefined, "DELETE");
    expect(
      (await f.request("/kiosk/roster", undefined, "GET", "", token)).status,
    ).toBe(401);
    expect(
      (await f.request("/admin/employees", undefined, "GET", "", token)).status,
    ).toBe(401);
  });
  test("approves offline in/out in order using captured time, without counting it before approval", async () => {
    const employee_id = await f.employee();
    const token = await f.device();
    const input = {
      id: randomUUID(),
      employee_id,
      action: "in",
      captured_at: "2026-10-27T09:00:00+09:00",
      offline: true,
    };
    const output = {
      ...input,
      id: randomUUID(),
      action: "out",
      captured_at: "2026-10-27T12:00:00+09:00",
    };
    await f.request("/kiosk/events", input, "POST", "", token);
    await f.request("/kiosk/events", output, "POST", "", token);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM shifts").get()!.n).toBe(0);
    expect(
      (
        await f.request(`/admin/reviews/${output.id}`, {
          approve: true,
          reason: "시각 확인",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request(`/admin/reviews/${input.id}`, {
          approve: true,
          reason: "시각 확인",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.request(`/admin/reviews/${output.id}`, {
          approve: true,
          reason: "시각 확인",
        })
      ).status,
    ).toBe(200);
    const shift = f.db.prepare("SELECT * FROM shifts").get()!;
    expect(shift.started_at).toBe("2026-10-27T00:00:00.000Z");
    expect(shift.ended_at).toBe("2026-10-27T03:00:00.000Z");
    expect((await f.request("/admin/reviews")).data).toHaveLength(0);
  });
  test("does not finalize with unconfirmed settings, open records, or overlapping settlement periods", async () => {
    const employee = await f.employee();
    await f.shift(
      employee,
      "2026-10-27T09:00:00+09:00",
      "2026-10-27T12:00:00+09:00",
    );
    let p = calculatePayroll(f.db, "2026-10-26", "2026-11-01");
    expect(
      (
        await f.request("/admin/settlements", {
          from: p.from,
          to: p.to,
          fingerprint: p.fingerprint,
          reason: "검토 완료",
        })
      ).status,
    ).toBe(409);
    await f.policy();
    p = calculatePayroll(f.db, p.from, p.to);
    expect(
      (
        await f.request("/admin/settlements", {
          from: p.from,
          to: p.to,
          fingerprint: p.fingerprint,
          reason: "검토 완료",
        })
      ).status,
    ).toBe(201);
    const other = calculatePayroll(f.db, "2026-10-27", "2026-11-02");
    expect(
      (
        await f.request("/admin/settlements", {
          from: other.from,
          to: other.to,
          fingerprint: other.fingerprint,
          reason: "겹친 기간",
        })
      ).status,
    ).toBe(409);
  });
  test("recovers queued files after device revocation without duplicates and rejects conflicting payloads", async () => {
    const employee_id = await f.employee();
    const token = await f.device();
    const event = {
      id: randomUUID(),
      employee_id,
      action: "in",
      captured_at: "2026-10-27T09:00:00+09:00",
      offline: true,
    };
    const device = f.db.prepare("SELECT id FROM devices").get()!;
    await f.request(`/admin/devices/${device.id}`, undefined, "DELETE");
    expect(
      (await f.request("/kiosk/events", event, "POST", "", token)).status,
    ).toBe(401);
    expect(
      (await f.request("/admin/recover-events", { events: [event] })).data,
    ).toMatchObject({ imported: 1, existing: 0 });
    expect(
      (await f.request("/admin/recover-events", { events: [event] })).data,
    ).toMatchObject({ imported: 0, existing: 1 });
    expect(
      (
        await f.request("/admin/recover-events", {
          events: [{ ...event, action: "out" }],
        })
      ).status,
    ).toBe(409);
    expect((await f.request("/admin/reviews")).data).toHaveLength(1);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM shifts").get()!.n).toBe(0);
  });
  test("protects employee and policy edits against stale administrator forms", async () => {
    await f.employee();
    const employee = (await f.request("/admin/employees")).data[0];
    const patch = {
      ...employee,
      name: "변경된 이름",
      active: true,
      weekly_enabled: true,
    };
    expect(
      (await f.request(`/admin/employees/${employee.id}`, patch, "PATCH"))
        .status,
    ).toBe(200);
    expect(
      (await f.request(`/admin/employees/${employee.id}`, patch, "PATCH"))
        .status,
    ).toBe(409);
    const policy = (await f.request("/admin/settings")).data;
    const body = {
      ...policy,
      confirmed: true,
      expected: JSON.stringify(policy),
    };
    expect((await f.request("/admin/settings", body, "PUT")).status).toBe(200);
    expect((await f.request("/admin/settings", body, "PUT")).status).toBe(409);
  });
  test("downloads a consistent SQLite backup that can be restored", async () => {
    await f.employee();
    const response = await fetch(f.base + "/api/admin/backup", {
      headers: { Cookie: f.cookie },
    });
    expect(response.status).toBe(200);
    const data = Buffer.from(await response.arrayBuffer());
    expect(data.subarray(0, 16).toString()).toBe("SQLite format 3\u0000");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, dirname, basename, resolve } = await import("node:path");
    const { openDb } = await import("../server/db.ts");
    const folder = mkdtempSync(join(tmpdir(), "feeledu-restore-"));
    try {
      const path = join(folder, "restored.db");
      writeFileSync(path, data);
      const restored = openDb(path);
      try {
        expect(
          restored.prepare("SELECT COUNT(*) AS n FROM employees").get()!.n,
        ).toBe(1);
        expect(
          restored.prepare("PRAGMA integrity_check").get()!.integrity_check,
        ).toBe("ok");
      } finally {
        restored.close();
      }
    } finally {
      if (
        dirname(folder) === resolve(tmpdir()) &&
        basename(folder).startsWith("feeledu-restore-")
      )
        rmSync(folder, { recursive: true, force: true });
    }
  });
  test("invalidates manager sessions after reset, rejects the old password, and respects session expiry", async () => {
    const created = await f.request("/admin/accounts", {
      username: "reset-manager",
      name: "부장님",
      password: "original-password-123",
    });
    expect(created.status).toBe(201);
    const logged = await f.request(
      "/login",
      { username: "reset-manager", password: "original-password-123" },
      "POST",
      "",
    );
    const cookie = logged.response.headers.get("set-cookie")!.split(";")[0];
    expect(
      (
        await f.request(
          `/admin/accounts/${created.data.id}`,
          {
            name: "부장님",
            active: true,
            password: "replacement-password-123",
          },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(
      (await f.request("/admin/me", undefined, "GET", cookie)).status,
    ).toBe(401);
    expect(
      (
        await f.request(
          "/login",
          { username: "reset-manager", password: "original-password-123" },
          "POST",
          "",
        )
      ).status,
    ).toBe(401);
    const replacement = await f.request(
      "/login",
      { username: "reset-manager", password: "replacement-password-123" },
      "POST",
      "",
    );
    expect(replacement.status).toBe(200);
    const freshCookie = replacement.response.headers
      .get("set-cookie")!
      .split(";")[0];
    f.db
      .prepare("UPDATE sessions SET expires_at=? WHERE admin_id=?")
      .run("2000-01-01T00:00:00.000Z", created.data.id);
    expect(
      (await f.request("/admin/me", undefined, "GET", freshCookie)).status,
    ).toBe(401);
  });
  test("expires pairing codes and consumes each successful code only once", async () => {
    const expired = await f.request("/admin/pairings", { name: "만료 테스트" });
    f.db
      .prepare("UPDATE pairing_codes SET expires_at=?")
      .run("2000-01-01T00:00:00.000Z");
    expect(
      (await f.request("/kiosk/pair", { code: expired.data.code }, "POST", ""))
        .status,
    ).toBe(403);
    const valid = await f.request("/admin/pairings", { name: "일회용 테스트" });
    expect(
      (await f.request("/kiosk/pair", { code: valid.data.code }, "POST", ""))
        .status,
    ).toBe(200);
    expect(
      (await f.request("/kiosk/pair", { code: valid.data.code }, "POST", ""))
        .status,
    ).toBe(403);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM devices").get()!.n).toBe(1);
  });
  test("uses server time, preserves acknowledgement-loss retries, and reviews skewed device timestamps", async () => {
    const employee_id = await f.employee();
    const token = await f.device();
    const early = Date.now();
    const input = {
      id: randomUUID(),
      employee_id,
      action: "in",
      captured_at: new Date(early + 30000).toISOString(),
      offline: false,
    };
    const results = await Promise.all([
      f.request("/kiosk/events", input, "POST", "", token),
      f.request("/kiosk/events", input, "POST", "", token),
    ]);
    expect(results.map((r) => r.data.status)).toEqual(["accepted", "accepted"]);
    const shift = f.db.prepare("SELECT * FROM shifts").get()!;
    expect(Date.parse(String(shift.started_at))).toBeGreaterThanOrEqual(early);
    expect(Date.parse(String(shift.started_at))).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(
      (
        await f.request(
          "/kiosk/events",
          { ...input, offline: true },
          "POST",
          "",
          token,
        )
      ).data.status,
    ).toBe("accepted");
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM shifts").get()!.n).toBe(1);
    const skewed = {
      ...input,
      id: randomUUID(),
      action: "out",
      captured_at: new Date(Date.now() + 3600000).toISOString(),
    };
    expect(
      (await f.request("/kiosk/events", skewed, "POST", "", token)).data.status,
    ).toBe("pending");
    expect(
      (
        await f.request(`/admin/reviews/${skewed.id}`, {
          approve: true,
          reason: "미래 시각 확인",
        })
      ).status,
    ).toBe(400);
    expect(
      f.db.prepare("SELECT ended_at FROM shifts").get()!.ended_at,
    ).toBeNull();
  });
  test("blocks payroll confirmation and retirement while a shift is open, then allows corrected completion", async () => {
    const employee_id = await f.employee();
    await f.policy();
    const created = await f.request("/admin/records", {
      employee_id,
      started_at: "2026-10-27T09:00:00+09:00",
      ended_at: null,
      break_minutes: 0,
      note: "",
      reason: "퇴근 누락 확인",
    });
    expect(created.status).toBe(201);
    const employee = (await f.request("/admin/employees")).data[0];
    expect(
      (
        await f.request(
          `/admin/employees/${employee_id}`,
          { ...employee, active: false, weekly_enabled: true },
          "PATCH",
        )
      ).status,
    ).toBe(409);
    const payroll = calculatePayroll(f.db, "2026-10-26", "2026-11-01");
    expect(payroll.rows[0].warnings).not.toHaveLength(0);
    expect(
      (
        await f.request("/admin/settlements", {
          from: payroll.from,
          to: payroll.to,
          fingerprint: payroll.fingerprint,
          reason: "누락 상태 정산",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request(
          `/admin/records/${created.data.id}`,
          {
            employee_id,
            started_at: "2026-10-27T09:00:00+09:00",
            ended_at: "2026-10-27T12:00:00+09:00",
            break_minutes: 0,
            note: "",
            reason: "퇴근 시각 확인 완료",
            revision: 1,
          },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(
      calculatePayroll(f.db, payroll.from, payroll.to).rows[0],
    ).toMatchObject({ base: 36000, warnings: [] });
  });
});
