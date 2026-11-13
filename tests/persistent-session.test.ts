import { test, expect, vi } from "vitest";
import { fixture } from "./helpers.ts";
import { PERSISTENT_DEADLINE } from "../server/auth-state.ts";

test("a retained login has no idle/12-hour lock, reuses its session, renews its cookie, and can be logged out", async () => {
  const f = await fixture();
  try {
    expect(
      (await f.request("/admin/session/keep", {}, "POST", "")).status,
    ).toBe(401);
    const count = f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()!.n;
    expect(
      (await f.request("/admin/session/keep", {})).data.persistent_login,
    ).toBe(1);
    expect((await f.request("/admin/session/keep", {})).status).toBe(200);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()!.n).toBe(
      count,
    );
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now + 14 * 3600000));
    expect((await f.request("/admin/me")).data.persistent_login).toBe(1);
    expect((await f.request("/admin/activity", {})).status).toBe(200);
    expect(
      Date.parse(
        String(
          f.db.prepare("SELECT expires_at FROM sessions").get()!.expires_at,
        ),
      ),
    ).toBeGreaterThan(Date.now() + 5 * 86400000);
    expect(
      f.db.prepare("SELECT absolute_expires_at FROM session_deadlines").get()!
        .absolute_expires_at,
    ).toBe(PERSISTENT_DEADLINE);
    vi.setSystemTime(new Date(now + 2 * 86400000));
    expect((await f.request("/admin/me")).status).toBe(200);
    vi.setSystemTime(new Date(now + 8 * 86400000));
    const renewed = await f.request("/admin/me");
    expect(renewed.status).toBe(200);
    expect(
      Boolean(
        renewed.response.headers.get("set-cookie")?.includes("Max-Age=604800"),
      ),
    ).toBe(true);
    expect((await f.request("/logout", {})).status).toBe(200);
    expect((await f.request("/admin/me")).status).toBe(401);
    const unused = await f.request(
      "/login",
      {
        username: "test-owner",
        password: "test-only-password-123",
        keepSignedIn: true,
      },
      "POST",
      "",
    );
    const unusedCookie = unused.response.headers
      .get("set-cookie")!
      .split(";")[0];
    vi.setSystemTime(new Date(now + 16 * 86400000));
    expect(
      (await f.request("/admin/me", undefined, "GET", unusedCookie)).status,
    ).toBe(401);
  } finally {
    vi.useRealTimers();
    await f.close();
  }
});

test("password resets and account deactivation invalidate retained manager sessions", async () => {
  const f = await fixture();
  try {
    const created = await f.request("/admin/accounts", {
      username: "retained-manager",
      name: "유지 관리자",
      password: "Manager-test1!",
    });
    const login = async (password: string) => {
      const result = await f.request(
        "/login",
        {
          username: "retained-manager",
          password,
          sharedTablet: true,
          keepSignedIn: true,
        },
        "POST",
        "",
      );
      expect(result.status).toBe(200);
      return result.response.headers.get("set-cookie")!.split(";")[0];
    };
    const cookie = await login("Manager-test1!");
    expect(
      (await f.request("/admin/me", undefined, "GET", cookie)).data,
    ).toMatchObject({ shared_tablet: 1, persistent_login: 1 });
    await f.request(
      `/admin/accounts/${created.data.id}`,
      { name: "유지 관리자", active: true, password: "New-manager2!" },
      "PATCH",
    );
    expect(
      (await f.request("/admin/me", undefined, "GET", cookie)).status,
    ).toBe(401);
    const updatedCookie = await login("New-manager2!");
    await f.request(
      `/admin/accounts/${created.data.id}`,
      { name: "유지 관리자", active: false },
      "PATCH",
    );
    expect(
      (await f.request("/admin/me", undefined, "GET", updatedCookie)).status,
    ).toBe(401);
  } finally {
    await f.close();
  }
});
