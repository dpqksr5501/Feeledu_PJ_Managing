import { afterEach, beforeEach, expect, test } from "vitest";
import { scryptSync } from "node:crypto";
import { fixture } from "./helpers.ts";
import * as native from "../server/security.ts";
import * as cloud from "../cloudflare/security.ts";

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f.close();
});

test("rejects malformed hashes and upgrades existing scrypt credentials after successful login", async () => {
  for (const value of [
    "",
    ":",
    "a:b",
    "a".repeat(32) + ":" + "g".repeat(128),
    "scrypt-v2:x:y",
  ]) {
    expect(native.passwordMatches("test", value)).toBe(false);
    expect(cloud.passwordMatches("test", value)).toBe(false);
  }
  const password = "test-only-password-123",
    salt = "a".repeat(32);
  const legacy = salt + ":" + scryptSync(password, salt, 64).toString("hex");
  expect(cloud.passwordMatches(password, legacy)).toBe(true);
  f.db
    .prepare("UPDATE admins SET password_hash=? WHERE username=?")
    .run(legacy, "test-owner");
  expect(
    (await f.request("/login", { username: "test-owner", password })).status,
  ).toBe(200);
  const stored = f.db.prepare("SELECT password_hash FROM admins").get()!
    .password_hash as string;
  expect(stored.startsWith("scrypt-v2:")).toBe(true);
  expect(native.passwordMatches(password, stored)).toBe(true);
  expect(cloud.passwordMatches(password, stored)).toBe(true);
});

test("uses the same account backoff for known and unknown usernames without extending it on blocked requests", async () => {
  for (const username of ["test-owner", "unknown-owner"]) {
    for (let i = 0; i < 5; i++)
      expect(
        (await f.request("/login", { username, password: "wrong" })).status,
      ).toBe(401);
    const key = native.hash("login:" + username);
    const before = f.db
      .prepare("SELECT * FROM auth_failures WHERE key=?")
      .get(key);
    const blocked = await f.request("/login", {
      username,
      password: "test-only-password-123",
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.response.headers.get("Retry-After"))).toBeGreaterThan(
      0,
    );
    expect(
      f.db.prepare("SELECT * FROM auth_failures WHERE key=?").get(key),
    ).toEqual(before);
  }
});

test("requires owner password for full backup and shares proof backoff with password changes", async () => {
  expect((await f.request("/admin/backup")).status).toBe(403);
  for (let i = 0; i < 5; i++)
    expect(
      (await f.request("/admin/backup", { current: "wrong" })).status,
    ).toBe(403);
  expect(
    (
      await f.request("/admin/password", {
        current: "test-only-password-123",
        password: "replacement-password-123",
      })
    ).status,
  ).toBe(429);
  f.db.prepare("DELETE FROM auth_failures").run();
  const manager = await f.request("/admin/accounts", {
    username: "manager",
    name: "테스트",
    password: "manager-password-123",
  });
  expect(manager.status).toBe(201);
  const login = await f.request("/login", {
    username: "manager",
    password: "manager-password-123",
  });
  const cookie = login.response.headers.get("set-cookie")!.split(";")[0];
  expect(
    (
      await f.request(
        "/admin/backup",
        { current: "manager-password-123" },
        "POST",
        cookie,
      )
    ).status,
  ).toBe(403);
});

test("PC reads do not renew idle sessions and activity cannot exceed the absolute deadline", async () => {
  const tokenHash = native.hash(f.cookie.split("=")[1]);
  const expiry = new Date(Date.now() + 10000).toISOString();
  f.db
    .prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?")
    .run(expiry, tokenHash);
  expect((await f.request("/admin/me")).status).toBe(200);
  expect(
    f.db
      .prepare("SELECT expires_at FROM sessions WHERE token_hash=?")
      .get(tokenHash)!.expires_at,
  ).toBe(expiry);
  const deadline = new Date(Date.now() + 20000).toISOString();
  f.db
    .prepare(
      "UPDATE session_deadlines SET absolute_expires_at=? WHERE token_hash=?",
    )
    .run(deadline, tokenHash);
  expect((await f.request("/admin/activity", {})).status).toBe(200);
  expect(
    f.db
      .prepare("SELECT expires_at FROM sessions WHERE token_hash=?")
      .get(tokenHash)!.expires_at,
  ).toBe(deadline);
  f.db
    .prepare("UPDATE session_deadlines SET absolute_expires_at=?")
    .run(new Date(Date.now() - 1).toISOString());
  expect((await f.request("/admin/activity", {})).status).toBe(401);
});

test("rejects cross-origin writes even with an authenticated cookie", async () => {
  const response = await fetch(f.base + "/api/admin/activity", {
    method: "POST",
    headers: {
      Cookie: f.cookie,
      Origin: "https://other.invalid",
      "X-Requested-With": "Feeledu",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  expect(response.status).toBe(403);
});
