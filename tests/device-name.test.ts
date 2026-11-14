import { test, expect } from "vitest";
import { fixture } from "./helpers.ts";
import { randomUUID } from "node:crypto";

test("device rename preserves its token, active connection, clock records and other devices, and is developer-only", async () => {
  const f = await fixture();
  try {
    const employee_id = await f.employee();
    const token = await f.device();
    const otherToken = await f.device();
    await f.request("/kiosk/roster", undefined, "GET", "", token);
    expect(
      (
        await f.request(
          "/kiosk/events",
          {
            id: randomUUID(),
            employee_id,
            action: "in",
            captured_at: new Date().toISOString(),
            offline: false,
          },
          "POST",
          "",
          token,
        )
      ).data.status,
    ).toBe("accepted");
    const devices = f.db.prepare("SELECT * FROM devices ORDER BY rowid").all(),
      device = devices[0];
    const shifts = f.db.prepare("SELECT * FROM shifts").all(),
      events = f.db.prepare("SELECT * FROM clock_events").all();
    const path = `/admin/devices/${device.id}`,
      body = { name: "테스트", expectedName: device.name };
    expect((await f.request(path, body, "PATCH", "")).status).toBe(401);
    await f.request("/admin/accounts", {
      username: "device-manager",
      name: "부장님",
      password: "Manager-only1!",
    });
    const login = await f.request(
      "/login",
      { username: "device-manager", password: "Manager-only1!" },
      "POST",
      "",
    );
    const manager = login.response.headers.get("set-cookie")!.split(";")[0];
    expect((await f.request(path, body, "PATCH", manager)).status).toBe(403);
    expect(
      (await f.request(path, { ...body, active: false }, "PATCH")).status,
    ).toBe(400);
    expect((await f.request(path, body, "PATCH")).status).toBe(200);
    expect(f.db.prepare("SELECT * FROM devices ORDER BY rowid").all()).toEqual([
      { ...device, name: "테스트" },
      devices[1],
    ]);
    expect(f.db.prepare("SELECT * FROM shifts").all()).toEqual(shifts);
    expect(f.db.prepare("SELECT * FROM clock_events").all()).toEqual(events);
    expect(
      (await f.request(path, { ...body, name: "덮어쓰기" }, "PATCH")).status,
    ).toBe(409);
    expect(
      (await f.request(`/admin/devices/${randomUUID()}`, body, "PATCH")).status,
    ).toBe(404);
    expect(
      (await f.request("/kiosk/roster", undefined, "GET", "", token)).data
        .employees[0].working,
    ).toBe(true);
    expect(
      (await f.request("/kiosk/roster", undefined, "GET", "", otherToken))
        .status,
    ).toBe(200);
  } finally {
    await f.close();
  }
});
