import { test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers.ts";
import { attendanceWeek } from "../server/attendance.ts";
import { calculatePayroll } from "../server/payroll.ts";
import { localDateTime, toShiftInstant } from "../src/admin/shift-form-time.ts";

test.each([
  ["2026-10-31", "2026-11-01"],
  ["2026-11-01", "2026-11-02"],
])(
  "22:00–04:00 survives midnight, reload, month/week changes: %s",
  async (startDay, endDay) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(startDay + "T22:00:00+09:00"));
    const f = await fixture();
    try {
      await f.policy({ weeklyEnabled: false });
      const id = await f.employee();
      const token = await f.device();
      const clock = (action: "in" | "out", uuid = randomUUID()) =>
        f.request(
          "/kiosk/events",
          {
            id: uuid,
            employee_id: id,
            action,
            captured_at: new Date().toISOString(),
            offline: false,
          },
          "POST",
          "",
          token,
        );
      expect((await clock("in")).data.status).toBe("accepted");
      vi.setSystemTime(new Date(endDay + "T00:01:00+09:00"));
      // A new roster request is also what a reloaded tablet uses.
      expect(
        (await f.request("/kiosk/roster", undefined, "GET", "", token)).data
          .employees[0].working,
      ).toBe(true);
      vi.setSystemTime(new Date(endDay + "T04:00:00+09:00"));
      const uuid = randomUUID();
      expect((await clock("out", uuid)).data.status).toBe("accepted");
      expect((await clock("out", uuid)).data.status).toBe("accepted");
      expect(
        (await f.request("/kiosk/roster", undefined, "GET", "", token)).data
          .employees[0].working,
      ).toBe(false);
      const shifts = f.db.prepare("SELECT * FROM shifts").all();
      expect(shifts).toHaveLength(1);
      expect(
        Date.parse(String(shifts[0].ended_at)) -
          Date.parse(String(shifts[0].started_at)),
      ).toBe(6 * 3600000);
      expect(calculatePayroll(f.db, startDay, endDay).rows[0].seconds).toBe(
        21600,
      );
      expect(calculatePayroll(f.db, startDay, startDay).rows[0].seconds).toBe(
        7200,
      );
      expect(calculatePayroll(f.db, endDay, endDay).rows[0].seconds).toBe(
        14400,
      );
      expect(
        attendanceWeek(f.db, startDay).employees[0].days.find(
          (day) => day.date === startDay,
        )?.completedSeconds,
      ).toBe(7200);
      expect(
        attendanceWeek(f.db, endDay).employees[0].days.find(
          (day) => day.date === endDay,
        )?.completedSeconds,
      ).toBe(14400);
    } finally {
      await f.close();
      vi.useRealTimers();
    }
  },
);

test("manual corrections preserve seconds and milliseconds when only notes or breaks change", () => {
  const original = "2026-11-01T13:00:27.321Z";
  expect(localDateTime(original)).toBe("2026-11-01T22:00:27");
  expect(toShiftInstant(localDateTime(original), original)).toBe(original);
  expect(toShiftInstant("2026-11-02T04:00")).toBe("2026-11-01T19:00:00.000Z");
  expect(toShiftInstant("2026-11-01T22:00", "2026-11-01T13:00:00.123Z")).toBe(
    "2026-11-01T13:00:00.123Z",
  );
  expect(toShiftInstant("")).toBeNull();
});
