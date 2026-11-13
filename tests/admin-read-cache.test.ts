import { test, expect } from "vitest";
import { AdminReadCache } from "../src/admin/read-cache.ts";
import {
  resourcesAfterMutation,
  resourcesForView,
} from "../src/admin/useAdminData.ts";
test("same-key concurrent reads share a request, expire on time and keep different periods separate", async () => {
  let now = 0,
    calls = 0;
  const cache = new AdminReadCache(() => now);
  const load = async () => ++calls;
  expect(
    await Promise.all([
      cache.get("records:A", load),
      cache.get("records:A", load),
    ]),
  ).toEqual([1, 1]);
  expect(await cache.get("records:A", load)).toBe(1);
  expect(await cache.get("records:B", load)).toBe(2);
  now = 60001;
  expect(await cache.get("records:A", load)).toBe(3);
});
test("invalidated/obsolete late responses cannot overwrite newer results or survive logout", async () => {
  const cache = new AdminReadCache();
  let finish!: (value: string) => void;
  const old = cache.get(
    "records:A",
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  cache.invalidate(["records"]);
  await cache.get("records:A", async () => "new");
  finish("old");
  await old;
  expect(cache.peek("records:A")).toBe("new");
  let aborted = false;
  const slow = cache.get(
    "records:B",
    (signal) =>
      new Promise<string>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve("obsolete");
        });
      }),
  );
  await Promise.resolve();
  cache.retain(["records:A"]);
  await slow;
  expect(aborted).toBe(true);
  expect(cache.peek("records:B")).toBeUndefined();
  cache.clear();
  expect(cache.peek("records:A")).toBeUndefined();
});
test("record changes refresh affected calculations without reloading staff, and caches are bounded", async () => {
  let staff = 0,
    records = 0;
  const cache = new AdminReadCache(Date.now, 4);
  await cache.get("employees:", async () => ++staff);
  await cache.get("records:A", async () => ++records);
  cache.invalidate(resourcesAfterMutation("/admin/records/id"));
  await cache.get("employees:", async () => ++staff);
  await cache.get("records:A", async () => ++records);
  expect(staff).toBe(1);
  expect(records).toBe(2);
  expect(resourcesAfterMutation("/admin/employees/id/day-rates")).toContain(
    "payroll",
  );
  expect(resourcesForView("overview", true)).toEqual(["policy"]);
  expect(resourcesForView("settings", false)).not.toContain("accounts");
  for (let i = 0; i < 20; i++) await cache.get("records:" + i, async () => i);
  expect(cache.size).toBe(4);
});
