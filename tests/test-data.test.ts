import { test, expect } from "vitest";
import { fixture } from "./helpers.ts";
import { testDataPlan } from "../server/test-data.ts";

test("test cleanup requires owner proof, an unchanged plan, and preserves ordinary staff and their records", async () => {
  const f = await fixture();
  try {
    const ordinary = await f.employee("보존 직원", "1001");
    const first = await f.employee("[테스트] 첫 조교", "1002");
    const second = await f.employee("[테 스트] 두번째", "1003");
    const preserved = await f.shift(
      ordinary,
      "2026-11-01T22:00:00+09:00",
      "2026-11-02T04:00:00+09:00",
    );
    const marked = await f.shift(
      first,
      "2026-11-01T22:00:00+09:00",
      "2026-11-02T04:00:00+09:00",
    );
    const initial = (await f.request("/admin/test-data")).data;
    expect(initial.counts.employees).toBe(2);
    const body = {
      fingerprint: initial.fingerprint,
      current: "test-only-password-123",
      reason: "요청한 테스트 데이터 정리",
    };
    expect(
      (await f.request("/admin/test-data/cleanup", body, "POST", "")).status,
    ).toBe(401);
    expect(
      (
        await f.request("/admin/test-data/cleanup", {
          ...body,
          current: "incorrect",
        })
      ).status,
    ).toBe(403);
    await f.request("/admin/accounts", {
      username: "cleanup-manager",
      name: "부장님",
      password: "Manager-only1!",
    });
    const managerLogin = await f.request(
      "/login",
      { username: "cleanup-manager", password: "Manager-only1!" },
      "POST",
      "",
    );
    const managerCookie = managerLogin.response.headers
      .get("set-cookie")!
      .split(";")[0];
    expect(
      (await f.request("/admin/test-data", undefined, "GET", managerCookie))
        .status,
    ).toBe(403);
    expect(
      (await f.request("/admin/test-data/cleanup", body, "POST", managerCookie))
        .status,
    ).toBe(403);
    await f.shift(
      second,
      "2026-11-02T22:00:00+09:00",
      "2026-11-03T04:00:00+09:00",
    );
    expect((await f.request("/admin/test-data/cleanup", body)).status).toBe(
      409,
    );
    const fresh = testDataPlan(f.db);
    expect(
      (
        await f.request("/admin/test-data/cleanup", {
          ...body,
          fingerprint: fresh.fingerprint,
        })
      ).status,
    ).toBe(200);
    expect(f.db.prepare("SELECT id FROM employees").all()).toEqual([
      { id: ordinary },
    ]);
    expect(f.db.prepare("SELECT id FROM shifts").all()).toEqual([
      { id: preserved.data.id },
    ]);
    expect(
      f.db.prepare("SELECT id FROM shifts WHERE id=?").get(marked.data.id),
    ).toBeUndefined();
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      f.db
        .prepare("SELECT id FROM audit WHERE action='testdata.cleanup'")
        .all(),
    ).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("a saved settlement containing a marked employee prevents destructive cleanup", async () => {
  const f = await fixture();
  try {
    const id = await f.employee("[테스트] 정산 연결", "1004");
    const admin = f.db.prepare("SELECT id FROM admins").get()!;
    f.db
      .prepare(
        "INSERT INTO settlements VALUES('saved','2026-01-01','2026-01-31',1,0,?,'fingerprint','2026-02-01',?,'테스트 보존')",
      )
      .run(JSON.stringify({ rows: [{ employeeId: id }] }), String(admin.id));
    const plan = testDataPlan(f.db);
    expect(plan.blockedSettlements).toEqual(["saved"]);
    expect(
      (
        await f.request("/admin/test-data/cleanup", {
          fingerprint: plan.fingerprint,
          current: "test-only-password-123",
          reason: "정리 시도",
        })
      ).status,
    ).toBe(409);
    expect(
      f.db.prepare("SELECT id FROM employees WHERE id=?").get(id),
    ).toBeDefined();
    expect(f.db.prepare("SELECT id FROM settlements").all()).toHaveLength(1);
  } finally {
    await f.close();
  }
});
