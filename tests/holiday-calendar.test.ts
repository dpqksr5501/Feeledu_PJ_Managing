import { test, expect, vi } from "vitest";
import { openDb } from "../server/db.ts";
import {
  HolidayCalendarService,
  parseHolidayPage,
} from "../server/holiday-calendar.ts";
import { calendarWarnings, getHolidays } from "../server/holidays.ts";
import { calculatePayroll } from "../server/payroll.ts";
import { fixture } from "./helpers.ts";
import {
  exportSnapshot,
  importSnapshotIntoEmptyDatabase,
} from "../server/snapshot.ts";
import {
  legacySnapshotTables,
  inspectSnapshot,
} from "../shared/snapshot-format.ts";
import { createHash } from "node:crypto";
const anchors = [
  "01-01",
  "03-01",
  "05-05",
  "06-06",
  "08-15",
  "10-03",
  "10-09",
  "12-25",
];
function page(
  year: number,
  month: number,
  dates: string[],
  extras: unknown[] = [],
) {
  const items = dates
    .filter((value) => Number(value.slice(0, 2)) === month)
    .map((date) => ({
      locdate: `${year}${date.replace("-", "")}`,
      isHoliday: "Y",
      dateName:
        date === "11-02"
          ? "임시공휴일"
          : date === "05-25"
            ? "대체공휴일"
            : `공휴일 ${date}`,
    }));
  return {
    response: {
      header: { resultCode: "00" },
      body: {
        pageNo: 1,
        numOfRows: 100,
        totalCount: items.length + extras.length,
        items: { item: [...items, ...extras] },
      },
    },
  };
}
function provider() {
  const state = { dates: [...anchors], badMonth: 0, year: 2026 };
  const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe(
      "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo",
    );
    expect(url.searchParams.get("ServiceKey")).toBe("test/key+=");
    const year = Number(url.searchParams.get("solYear")),
      month = Number(url.searchParams.get("solMonth"));
    if (month === state.badMonth)
      throw new Error("upstream echoed a secret: test/key+=");
    return Response.json(page(year, month, state.dates));
  });
  return { state, fetcher: fetcher as typeof fetch & typeof fetcher };
}
const permitRefresh = (db: ReturnType<typeof openDb>) =>
  db
    .prepare(
      "UPDATE holiday_calendars SET attempted_at='2000-01-01T00:00:00.000Z'",
    )
    .run();

test("automatic refresh fills adjacent years once and survives service restarts without redundant provider calls", async () => {
  const db = openDb(":memory:"),
    { fetcher } = provider();
  try {
    await new HolidayCalendarService(
      db,
      () => undefined,
      fetcher,
    ).refreshCurrentYears();
    expect(fetcher).not.toHaveBeenCalled();
    const service = new HolidayCalendarService(db, () => "test/key+=", fetcher);
    await service.refreshCurrentYears();
    expect(fetcher).toHaveBeenCalledTimes(36);
    expect(service.status().years).toHaveLength(3);
    await new HolidayCalendarService(
      db,
      () => "test/key+=",
      fetcher,
    ).refreshCurrentYears();
    expect(fetcher).toHaveBeenCalledTimes(36);
    expect(getHolidays(db)).toHaveLength(24);
  } finally {
    db.close();
  }
});

test("parses zero/single/multiple XML and JSON rows and rejects failed or partial responses", () => {
  expect(
    parseHolidayPage(JSON.stringify(page(2026, 2, [])), 2026, 2, 1).days,
  ).toEqual([]);
  for (const totalCount of [null, "", " ", false]) {
    const invalid = page(2026, 2, []);
    Object.assign(invalid.response.body, { totalCount });
    expect(() =>
      parseHolidayPage(JSON.stringify(invalid), 2026, 2, 1),
    ).toThrow();
  }
  const xml =
    "<response><header><resultCode>00</resultCode></header><body><items><item><locdate>20260525</locdate><dateName>대체공휴일 &amp; 확인</dateName><isHoliday>Y</isHoliday></item></items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>1</totalCount></body></response>";
  expect(parseHolidayPage(xml, 2026, 5, 1).days).toEqual([
    { date: "2026-05-25", name: "대체공휴일 & 확인" },
  ]);
  expect(
    parseHolidayPage(
      JSON.stringify(
        page(
          2026,
          5,
          ["05-05", "05-25"],
          [{ locdate: 20260508, dateName: "기념일", isHoliday: "N" }],
        ),
      ),
      2026,
      5,
      1,
    ).days,
  ).toHaveLength(2);
  for (const invalid of [
    "",
    "<html>error</html>",
    "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>",
    '<!DOCTYPE response [<!ENTITY x "value">]>' + xml,
    xml.replace("20260525", "20260230"),
    xml.replace("<totalCount>1", "<totalCount>2"),
    xml.replace("<pageNo>1", "<pageNo>2"),
  ])
    expect(() => parseHolidayPage(invalid, 2026, 5, 1)).toThrow();
});

test("complete calendars merge manual dates, serialize retries and avoid rewriting unchanged holidays", async () => {
  const db = openDb(":memory:"),
    { state, fetcher } = provider();
  const service = new HolidayCalendarService(
    db,
    () => "test%2Fkey%2B%3D",
    fetcher,
  );
  try {
    state.dates.push("05-25", "11-02");
    db.prepare(
      "INSERT INTO holidays VALUES('manual','2026-11-02','학원 특별일')",
    ).run();
    const results = await Promise.allSettled([
      service.sync(2026),
      service.sync(2026),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(
      getHolidays(db).find((day) => day.date === "2026-11-02"),
    ).toMatchObject({
      id: "manual",
      source: "both",
      name: "임시공휴일 · 학원 특별일",
    });
    expect(calendarWarnings(db, "2026-01-01", "2026-12-31", true)).toEqual([]);
    const rows = db
      .prepare("SELECT rowid,* FROM official_holidays ORDER BY date")
      .all();
    permitRefresh(db);
    await service.sync(2026);
    expect(
      db.prepare("SELECT rowid,* FROM official_holidays ORDER BY date").all(),
    ).toEqual(rows);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM audit WHERE action='calendar.sync'")
        .get()!.n,
    ).toBe(1);
    expect(JSON.stringify(exportSnapshot(db))).not.toContain("test/key");
  } finally {
    db.close();
  }
});

test("network/partial/empty-year failures preserve old data; withdrawals require versioned review", async () => {
  const db = openDb(":memory:"),
    { state, fetcher } = provider();
  const service = new HolidayCalendarService(db, () => "test/key+=", fetcher);
  try {
    state.dates.push("11-02");
    await service.sync(2026);
    const original = getHolidays(db);
    state.badMonth = 6;
    permitRefresh(db);
    await expect(service.sync(2026)).rejects.toThrow(/기존 자료/);
    expect(getHolidays(db)).toEqual(original);
    expect(service.status().years[0].error).not.toContain("test/key");
    state.badMonth = 0;
    state.dates = [];
    permitRefresh(db);
    await expect(service.sync(2026)).rejects.toThrow(/미공개|불완전/);
    expect(getHolidays(db)).toEqual(original);
    state.dates = [...anchors];
    permitRefresh(db);
    expect((await service.sync(2026)).pending).toBe(true);
    expect(getHolidays(db)).toEqual(original);
    expect(
      calendarWarnings(db, "2026-11-01", "2026-11-30", true).join(),
    ).toContain("변경 검토");
    const pending = service.status().years[0].pending!;
    expect(() =>
      service.approve(2026, "0".repeat(64), "검토", "owner"),
    ).toThrow();
    service.approve(2026, pending.hash, "관보 확인", "owner");
    expect(getHolidays(db)).toHaveLength(anchors.length);
    expect(service.status().years[0].pending).toBeNull();
    db.prepare(
      "UPDATE holiday_calendars SET synced_at='2020-01-01T00:00:00.000Z'",
    ).run();
    expect(
      calendarWarnings(db, "2026-11-01", "2026-11-30", true).join(),
    ).toContain("7일");
    service.confirm(
      2026,
      service.status().years[0].fingerprint,
      "공식 목록 직접 확인",
      "owner",
    );
    expect(calendarWarnings(db, "2026-11-01", "2026-11-30", true)).toEqual([]);
    expect(
      calendarWarnings(db, "2026-12-31", "2027-01-01", true).join(),
    ).toContain("2027년");
    expect(
      calendarWarnings(db, "2027-01-01", "2027-01-01", false).join(),
    ).toContain("2027년");
  } finally {
    db.close();
  }
});

test("API authorization and retroactive holiday/day-rate/weekend overlap preserve settlements", async () => {
  const { state, fetcher } = provider();
  let service!: HolidayCalendarService;
  const f = await fixture(
    (db) =>
      (service = new HolidayCalendarService(db, () => "test/key+=", fetcher)),
  );
  try {
    expect(
      (await f.request("/admin/holiday-calendar", undefined, "GET", "")).status,
    ).toBe(401);
    expect(
      (
        await f.request(
          "/admin/holiday-calendar/sync",
          { year: 2026 },
          "POST",
          "",
        )
      ).status,
    ).toBe(401);
    expect(
      (await f.request("/admin/holiday-calendar/sync", { year: 2026 })).status,
    ).toBe(200);
    await f.policy({ weeklyEnabled: false });
    const employee = await f.employee();
    await f.shift(
      employee,
      "2026-11-02T09:00:00+09:00",
      "2026-11-02T11:00:00+09:00",
    );
    const original = calculatePayroll(f.db, "2026-11-02", "2026-11-02", true);
    expect(original.total).toBe(24000);
    expect(
      (
        await f.request("/admin/settlements", {
          from: original.from,
          to: original.to,
          fingerprint: original.fingerprint,
          reason: "변경 전 확정",
        })
      ).status,
    ).toBe(201);
    state.dates.push("11-02");
    permitRefresh(f.db);
    await service.sync(2026);
    await f.request("/admin/holidays", {
      date: "2026-11-02",
      name: "학원 휴일",
    });
    await f.policy({ holidayWeekdays: [1] });
    await f.request(`/admin/employees/${employee}/day-rates`, {
      date: "2026-11-02",
      hourly_rate: 20000,
      expectedRate: null,
      reason: "하루 시급",
    });
    const result = (
      await f.request("/admin/payroll?from=2026-11-02&to=2026-11-02")
    ).data;
    expect(result.total).toBe(60000);
    expect(result.difference).toBe(36000);
    expect(result.settlement.snapshot.total).toBe(24000);
    expect(result.rows[0].dailyDetails[0].holidayName).toContain("임시공휴일");
    const token = await f.device(),
      calls = fetcher.mock.calls.length;
    expect(
      (
        await f.request(
          "/kiosk/events",
          {
            id: crypto.randomUUID(),
            employee_id: employee,
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
    expect(fetcher.mock.calls.length).toBe(calls);
    expect(
      (await f.request("/admin/holidays/kasi:2026-11-02", undefined, "DELETE"))
        .status,
    ).toBe(400);
  } finally {
    await f.close();
  }
});

test("calendar backups restore cached/pending data and old schema-3 backups remain valid", async () => {
  const source = openDb(":memory:"),
    restored = openDb(":memory:"),
    legacyTarget = openDb(":memory:");
  try {
    source
      .prepare(
        "INSERT INTO admins VALUES('owner','owner','운영자','test-hash','owner',1,'2026-01-01')",
      )
      .run();
    const { state, fetcher } = provider(),
      service = new HolidayCalendarService(source, () => "test/key+=", fetcher);
    state.dates.push("11-02");
    await service.sync(2026);
    state.dates = [...anchors];
    permitRefresh(source);
    await service.sync(2026);
    const snapshot = exportSnapshot(source);
    await expect(inspectSnapshot(snapshot)).resolves.toMatchObject({
      employees: 0,
    });
    expect(
      importSnapshotIntoEmptyDatabase(restored, snapshot).official_holidays,
    ).toBe(9);
    expect(
      new HolidayCalendarService(restored, () => undefined).status().years[0]
        .pending?.removed,
    ).toHaveLength(1);
    const tables = Object.fromEntries(
      legacySnapshotTables.map((table) => [table, snapshot.tables[table]]),
    );
    const legacy = {
      ...snapshot,
      schema: 3,
      tables,
      checksum: createHash("sha256")
        .update(JSON.stringify(tables))
        .digest("hex"),
    };
    await expect(inspectSnapshot(legacy)).resolves.toMatchObject({
      employees: 0,
    });
    expect(
      importSnapshotIntoEmptyDatabase(legacyTarget, legacy).official_holidays,
    ).toBe(0);
    expect(
      legacyTarget.prepare("PRAGMA integrity_check").get()!.integrity_check,
    ).toBe("ok");
  } finally {
    source.close();
    restored.close();
    legacyTarget.close();
  }
});
