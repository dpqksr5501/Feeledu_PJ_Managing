import type { Server } from "node:http";
import { once } from "node:events";
import { openDb, getPolicy } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import type { Db } from "../server/database.ts";
import { HolidayCalendarService } from "../server/holiday-calendar.ts";
export async function fixture(
  calendarFactory?: (db: Db) => HolidayCalendarService,
) {
  const db = openDb(":memory:");
  const app = createApp({
    db,
    setupToken: "test-token",
    calendar:
      calendarFactory?.(db) ?? new HolidayCalendarService(db, () => undefined),
  });
  const server: Server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  let cookie = "";
  async function request(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    auth = cookie,
    token = "",
  ) {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Feeledu",
        ...(auth ? { Cookie: auth } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    return { status: response.status, data, response };
  }
  const setup = await request("/setup", {
    token: "test-token",
    username: "test-owner",
    name: "테스트 운영자",
    password: "test-only-password-123",
  });
  cookie = setup.response.headers.get("set-cookie")!.split(";")[0];
  async function employee(name = "테스트 조교", last4 = "0012", rate = 12000) {
    const result = await request("/admin/employees", {
      name,
      phone_last4: last4,
      active: true,
      note: "",
      weekly_enabled: true,
      holiday_multiplier: null,
      hourly_rate: rate,
      effective_from: "2026-01-01",
    });
    if (result.status !== 201) throw new Error(JSON.stringify(result.data));
    return result.data.id as string;
  }
  async function policy(changes = {}) {
    const initial = getPolicy(db);
    return request(
      "/admin/settings",
      {
        ...initial,
        confirmed: true,
        ...changes,
        expected: JSON.stringify(initial),
      },
      "PUT",
    );
  }
  async function shift(
    employeeId: string,
    start: string,
    end: string,
    breakMinutes = 0,
  ) {
    return request("/admin/records", {
      employee_id: employeeId,
      started_at: start,
      ended_at: end,
      break_minutes: breakMinutes,
      note: "",
      reason: "테스트 기록",
    });
  }
  async function device() {
    const pairing = await request("/admin/pairings", { name: "테스트 태블릿" });
    const result = await request(
      "/kiosk/pair",
      { code: pairing.data.code },
      "POST",
      "",
    );
    return result.data.token as string;
  }
  async function close() {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
  }
  return {
    db,
    base,
    request,
    employee,
    policy,
    shift,
    device,
    close,
    get cookie() {
      return cookie;
    },
  };
}
