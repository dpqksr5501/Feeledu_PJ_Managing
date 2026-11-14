import { expect, test } from "vitest";
import { fixture } from "./helpers.ts";

test("self profile changes only the name, retains sessions/roles, rejects stale and foreign-field writes", async () => {
  const f = await fixture();
  try {
    const before = (await f.request("/admin/me")).data;
    await f.request("/admin/accounts", {
      username: "profile-manager",
      name: "부장님",
      password: "Manager-only1!",
    });
    const managerLogin = await f.request(
      "/login",
      { username: "profile-manager", password: "Manager-only1!" },
      "POST",
      "",
    );
    const managerCookie = managerLogin.response.headers
      .get("set-cookie")!
      .split(";")[0];
    const managerBefore = (
      await f.request("/admin/me", undefined, "GET", managerCookie)
    ).data;
    const body = { name: "개발자_조연우", expectedName: before.name };
    expect((await f.request("/admin/profile", body, "PATCH", "")).status).toBe(
      401,
    );
    for (const extra of [
      { role: "owner" },
      { id: before.id },
      { active: false },
      { password: "replacement1!" },
      { username: "other-user" },
    ])
      expect(
        (
          await f.request(
            "/admin/profile",
            { ...body, ...extra },
            "PATCH",
            managerCookie,
          )
        ).status,
      ).toBe(400);
    const result = await f.request("/admin/profile", body, "PATCH");
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ...before, name: body.name });
    expect((await f.request("/admin/me")).data).toEqual(result.data);
    expect(
      (await f.request("/admin/me", undefined, "GET", managerCookie)).data,
    ).toEqual(managerBefore);
    expect(
      (
        await f.request(
          "/admin/profile",
          { ...body, name: "오래된 화면" },
          "PATCH",
        )
      ).status,
    ).toBe(409);
    const renamedManager = await f.request(
      "/admin/profile",
      { name: "  학원 부장님  ", expectedName: managerBefore.name },
      "PATCH",
      managerCookie,
    );
    expect(renamedManager.status).toBe(200);
    expect(renamedManager.data).toEqual({
      ...managerBefore,
      name: "학원 부장님",
    });
    expect(
      (await f.request("/admin/accounts", undefined, "GET", managerCookie))
        .status,
    ).toBe(403);
    expect((await f.request("/admin/accounts")).status).toBe(200);
    expect(
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit WHERE action='profile.update'",
        )
        .get()!.n,
    ).toBe(2);
    expect(
      (
        await f.request(
          "/admin/profile",
          { name: body.name, expectedName: body.name },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.request(
          "/admin/profile",
          { name: "  ", expectedName: body.name },
          "PATCH",
        )
      ).status,
    ).toBe(400);
    expect(
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit WHERE action='profile.update'",
        )
        .get()!.n,
    ).toBe(2);
  } finally {
    await f.close();
  }
});
