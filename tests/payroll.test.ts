import { afterEach, beforeEach, expect, test } from "vitest";
import { fixture } from "./helpers.ts";
import { calculatePayroll } from "../server/payroll.ts";
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
  await f.policy();
});
afterEach(async () => {
  await f.close();
});
test("retroactive rate changes recompute weekly/holiday pay but preserve prior settlement snapshots", async () => {
  const id = await f.employee();
  for (const day of ["26", "27", "28"])
    await f.shift(
      id,
      `2026-10-${day}T09:00:00+09:00`,
      `2026-10-${day}T14:00:00+09:00`,
    );
  await f.request("/admin/holidays", { date: "2026-10-26", name: "지정 휴일" });
  const original = calculatePayroll(f.db, "2026-10-26", "2026-11-01");
  expect(original.rows[0]).toMatchObject({
    seconds: 54000,
    base: 180000,
    holiday: 30000,
    weekly: 36000,
    total: 246000,
  });
  const saved = await f.request("/admin/settlements", {
    from: original.from,
    to: original.to,
    fingerprint: original.fingerprint,
    reason: "최초 확정",
  });
  expect(saved.status).toBe(201);
  const rate = {
    effective_from: "2026-10-28",
    hourly_rate: 15000,
    reason: "인상 소급",
    expectedRate: null,
  };
  expect((await f.request(`/admin/employees/${id}/rates`, rate)).status).toBe(
    200,
  );
  expect((await f.request(`/admin/employees/${id}/rates`, rate)).status).toBe(
    409,
  );
  const revised = calculatePayroll(f.db, original.from, original.to);
  expect(revised.rows[0]).toMatchObject({
    base: 195000,
    holiday: 30000,
    weekly: 39000,
    total: 264000,
  });
  expect(revised.settlement!.snapshot.total).toBe(246000);
  expect(revised.difference).toBe(18000);
  expect(
    (
      await f.request("/admin/settlements", {
        from: revised.from,
        to: revised.to,
        fingerprint: original.fingerprint,
        reason: "오래된 화면",
      })
    ).status,
  ).toBe(409);
  const second = await f.request("/admin/settlements", {
    from: revised.from,
    to: revised.to,
    fingerprint: revised.fingerprint,
    reason: "차액 확정",
  });
  expect(second.status).toBe(201);
  expect(
    (await f.request(`/admin/settlements/${saved.data.id}`)).data.total,
  ).toBe(246000);
  expect((await f.request("/admin/settlements")).data).toHaveLength(2);
});
test("splits midnight/month/rate/holiday boundaries and proportionally allocates actual break time", async () => {
  const id = await f.employee();
  await f.request(`/admin/employees/${id}/rates`, {
    effective_from: "2026-11-01",
    hourly_rate: 15000,
    reason: "시급 변경",
    expectedRate: null,
  });
  await f.request("/admin/holidays", { date: "2026-11-01", name: "지정 휴일" });
  await f.shift(
    id,
    "2026-10-31T23:00:00+09:00",
    "2026-11-01T02:00:00+09:00",
    30,
  );
  const all = calculatePayroll(f.db, "2026-10-31", "2026-11-01");
  expect(all.rows[0]).toMatchObject({
    seconds: 9000,
    base: 35000,
    holiday: 12500,
    weekly: 0,
    night: 17500,
    total: 65000,
  });
  expect(calculatePayroll(f.db, "2026-10-31", "2026-10-31").rows[0].base).toBe(
    10000,
  );
  expect(calculatePayroll(f.db, "2026-11-01", "2026-11-01").rows[0].base).toBe(
    25000,
  );
});
test("attributes a cross-month weekly allowance to week end even after employee retirement", async () => {
  const id = await f.employee();
  for (const day of ["26", "27", "28"])
    await f.shift(
      id,
      `2026-10-${day}T09:00:00+09:00`,
      `2026-10-${day}T14:00:00+09:00`,
    );
  const info = (await f.request("/admin/employees")).data[0];
  await f.request(
    `/admin/employees/${id}`,
    { ...info, active: false, weekly_enabled: true },
    "PATCH",
  );
  const october = calculatePayroll(f.db, "2026-10-01", "2026-10-31");
  expect(october.rows[0].weekly).toBe(0);
  const november = calculatePayroll(f.db, "2026-11-01", "2026-11-01");
  expect(november.rows).toHaveLength(1);
  expect(november.rows[0]).toMatchObject({
    seconds: 0,
    weekly: 36000,
    total: 36000,
  });
});
test("uses personal holiday multiplier without double premium and applies signed adjustments", async () => {
  const id = await f.employee();
  const info = (await f.request("/admin/employees")).data[0];
  await f.request(
    `/admin/employees/${id}`,
    { ...info, active: true, weekly_enabled: false, holiday_multiplier: 2 },
    "PATCH",
  );
  await f.policy({ holidayWeekdays: [1] });
  await f.request("/admin/holidays", {
    date: "2026-10-26",
    name: "겹치는 휴일",
  });
  await f.shift(id, "2026-10-26T09:00:00+09:00", "2026-10-26T14:00:00+09:00");
  await f.request("/admin/adjustments", {
    employee_id: id,
    date: "2026-10-26",
    amount: 10000,
    reason: "업무 수당",
  });
  await f.request("/admin/adjustments", {
    employee_id: id,
    date: "2026-10-26",
    amount: -3000,
    reason: "금액 정정",
  });
  expect(
    calculatePayroll(f.db, "2026-10-26", "2026-11-01").rows[0],
  ).toMatchObject({
    base: 60000,
    holiday: 60000,
    weekly: 0,
    adjustment: 7000,
    total: 127000,
  });
});
test("keeps exact weekly eligibility after proportionally allocating irregular break times", async () => {
  const id = await f.employee();
  for (const day of ["26", "27", "28"])
    await f.shift(
      id,
      `2026-10-${day}T09:03:00+09:00`,
      `2026-10-${day}T14:08:00+09:00`,
      5,
    );
  expect(
    calculatePayroll(f.db, "2026-10-26", "2026-11-01").rows[0],
  ).toMatchObject({ seconds: 54000, base: 180000, weekly: 36000 });
});
