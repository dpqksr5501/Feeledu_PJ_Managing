import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { fixture } from "./helpers.ts";
import { DEFAULT_JOB_ID } from "../shared/jobs.ts";
import { calculatePayroll } from "../server/payroll.ts";
import { openDb } from "../server/db.ts";
import {
  exportSnapshot,
  importSnapshotIntoEmptyDatabase,
} from "../server/snapshot.ts";
import { projectRosterEntry } from "../src/kiosk-jobs.ts";
import type { ClockEvent, RosterEntry } from "../shared/types.ts";

test("assigns only permitted jobs, protects concurrent edits and archives jobs without losing history", async () => {
  const f = await fixture();
  try {
    const employee = await f.employee();
    const token = await f.device();
    const job = await f.request("/admin/jobs", {
      name: "데스크",
      hourly_rate: 13000,
      date: "2026-10-01",
    });
    expect(job.status).toBe(201);
    const id = job.data.id as string;
    expect(
      (
        await f.request("/admin/jobs", {
          name: "  데스크  ",
          hourly_rate: 13000,
          date: "2026-10-01",
        })
      ).status,
    ).toBe(409);
    const change = { job_ids: [id], default_job_id: id, revision: 1 };
    const assign = (input = change) =>
      f.request(`/admin/employees/${employee}/jobs`, input, "PUT");
    expect(
      (await assign({ ...change, default_job_id: DEFAULT_JOB_ID })).status,
    ).toBe(400);
    expect((await assign()).status).toBe(200);
    expect((await assign()).status).toBe(409);
    const roster = async () =>
      (await f.request("/kiosk/roster", undefined, "GET", "", token)).data
        .employees[0];
    expect((await roster()).jobs).toEqual([{ id, name: "데스크" }]);
    const start = {
      id: randomUUID(),
      employee_id: employee,
      action: "in",
      captured_at: new Date().toISOString(),
      job_id: id,
      offline: false,
    };
    const post = (
      body: typeof start | (typeof start & { expected_shift_id?: string }),
    ) => f.request("/kiosk/events", body, "POST", "", token);
    expect(
      (await post({ ...start, id: randomUUID(), job_id: DEFAULT_JOB_ID })).data
        .status,
    ).toBe("pending");
    const reviews = await f.request("/admin/reviews");
    await f.request(`/admin/reviews/${reviews.data[0].id}`, {
      approve: false,
      reason: "미배정 직무 확인",
    });
    expect((await post(start)).data.status).toBe("accepted");
    expect((await post(start)).data.status).toBe("accepted");
    expect((await post({ ...start, job_id: DEFAULT_JOB_ID })).status).toBe(409);
    const editJob = (active: boolean, name = "데스크", revision = 1) =>
      f.request(`/admin/jobs/${id}`, { name, active, revision }, "PATCH");
    expect((await editJob(false)).status).toBe(409);
    expect(
      (
        await assign({
          job_ids: [DEFAULT_JOB_ID],
          default_job_id: DEFAULT_JOB_ID,
          revision: 2,
        })
      ).status,
    ).toBe(200);
    expect((await editJob(false)).status).toBe(409);
    expect((await roster()).open_job).toEqual({ id, name: "데스크" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      (
        await post({
          ...start,
          id: randomUUID(),
          action: "out",
          expected_shift_id: start.id,
          captured_at: new Date().toISOString(),
        })
      ).data.status,
    ).toBe("accepted");
    expect((await editJob(true, "안내 데스크")).status).toBe(200);
    expect((await editJob(false, "안내 데스크", 2)).status).toBe(200);
    expect((await editJob(true, "안내 데스크", 3)).status).toBe(200);
    expect((await roster()).jobs).toEqual([
      { id: DEFAULT_JOB_ID, name: "조교" },
    ]);
    expect(
      f.db
        .prepare("SELECT job_id FROM shift_jobs WHERE shift_id=?")
        .get(start.id)?.job_id,
    ).toBe(id);
  } finally {
    await f.close();
  }
});

test("preserves an offline switch as one atomic event and calculates one payroll across midnight", async () => {
  const f = await fixture();
  const restored = openDb(":memory:");
  try {
    await f.policy({ weeklyThresholdHours: 10 });
    const employee = await f.employee();
    const create = async (name: string, hourly_rate: number) =>
      (
        await f.request("/admin/jobs", {
          name,
          hourly_rate,
          date: "2026-09-01",
        })
      ).data.id as string;
    const desk = await create("데스크", 12000);
    const study = await create("필스터디", 14000);
    expect(
      (
        await f.request(
          `/admin/employees/${employee}/jobs`,
          {
            job_ids: [desk, study],
            default_job_id: desk,
            revision: 1,
          },
          "PUT",
        )
      ).status,
    ).toBe(200);
    const price = (
      job: string,
      date: string,
      hourly_rate: number | null,
      kind: "monthly" | "day",
      employee_id: string | null = employee,
    ) =>
      f.request(
        `/admin/jobs/${job}/rates`,
        {
          employee_id,
          kind,
          date,
          hourly_rate,
          expected_id: null,
          revision: null,
          reason: "테스트 시급",
        },
        "PUT",
      );
    expect((await price(desk, "2026-10-01", 12500, "monthly")).status).toBe(
      200,
    );
    expect((await price(study, "2026-10-31", 15000, "day")).status).toBe(200);
    expect(
      (await price(study, "2026-11-01", 16000, "monthly", null)).status,
    ).toBe(200);
    const inId = randomUUID(),
      switchId = randomUUID(),
      outId = randomUUID();
    const events: ClockEvent[] = [
      {
        id: inId,
        employee_id: employee,
        action: "in",
        captured_at: "2026-10-31T16:00:00+09:00",
        job_id: desk,
        offline: true,
      },
      {
        id: switchId,
        employee_id: employee,
        action: "switch",
        captured_at: "2026-10-31T20:00:00+09:00",
        expected_shift_id: inId,
        job_id: study,
        offline: true,
      },
      {
        id: outId,
        employee_id: employee,
        action: "out",
        captured_at: "2026-11-01T02:00:00+09:00",
        expected_shift_id: switchId,
        offline: true,
      },
    ];
    expect(
      (await f.request("/admin/recover-events", { events })).data.imported,
    ).toBe(3);
    expect(
      (await f.request("/admin/recover-events", { events })).data.existing,
    ).toBe(3);
    const approve = (id: string, job_id?: string) =>
      f.request(`/admin/reviews/${id}`, {
        approve: true,
        job_id,
        reason: "기기 시각 확인",
      });
    expect((await approve(switchId)).status).toBe(409);
    expect((await approve(inId)).status).toBe(200);
    expect((await approve(switchId, desk)).status).toBe(409);
    expect(
      f.db.prepare("SELECT ended_at FROM shifts WHERE id=?").get(inId)
        ?.ended_at,
    ).toBeNull();
    expect((await approve(switchId)).status).toBe(200);
    expect((await approve(outId)).status).toBe(200);
    const row = calculatePayroll(f.db, "2026-10-31", "2026-11-01").rows[0];
    expect(row).toMatchObject({
      seconds: 36000,
      base: 142000,
      night: 31000,
      weekly: 28400,
      total: 201400,
    });
    expect(row.dailyDetails).toMatchObject([
      {
        date: "2026-10-31",
        jobName: "데스크",
        hourlyRate: 12500,
        seconds: 14400,
      },
      {
        date: "2026-10-31",
        jobName: "필스터디",
        hourlyRate: 15000,
        seconds: 14400,
        specialRate: true,
      },
      {
        date: "2026-11-01",
        jobName: "필스터디",
        hourlyRate: 16000,
        seconds: 7200,
        specialRate: false,
      },
    ]);
    importSnapshotIntoEmptyDatabase(restored, exportSnapshot(f.db));
    expect(
      calculatePayroll(restored, "2026-10-31", "2026-11-01").rows[0],
    ).toEqual(row);
  } finally {
    restored.close();
    await f.close();
  }
});

test("an outdated concurrent switch cannot close the newer job", async () => {
  const f = await fixture();
  try {
    const employee_id = await f.employee();
    const job = await f.request("/admin/jobs", {
      name: "영어조교",
      hourly_rate: 14000,
      date: "2026-10-01",
    });
    const job_id = job.data.id as string;
    const secondJob = await f.request("/admin/jobs", {
      name: "필스터디",
      hourly_rate: 14500,
      date: "2026-10-01",
    });
    await f.request(
      `/admin/employees/${employee_id}/jobs`,
      {
        job_ids: [DEFAULT_JOB_ID, job_id, secondJob.data.id],
        default_job_id: DEFAULT_JOB_ID,
        revision: 1,
      },
      "PUT",
    );
    const first = await f.device(),
      second = await f.device();
    const send = (token: string, values: Partial<ClockEvent>) =>
      f.request(
        "/kiosk/events",
        {
          id: randomUUID(),
          employee_id,
          captured_at: new Date().toISOString(),
          offline: false,
          ...values,
        },
        "POST",
        "",
        token,
      );
    const start = randomUUID();
    expect(
      (await send(first, { id: start, action: "in", job_id: DEFAULT_JOB_ID }))
        .data.status,
    ).toBe("accepted");
    const a = randomUUID(),
      b = randomUUID();
    const results = await Promise.all([
      send(first, {
        id: a,
        action: "switch",
        expected_shift_id: start,
        job_id,
      }),
      send(second, {
        id: b,
        action: "switch",
        expected_shift_id: start,
        job_id: secondJob.data.id,
      }),
    ]);
    expect(results.map((result) => result.data.status).sort()).toEqual([
      "accepted",
      "pending",
    ]);
    const shifts = f.db
      .prepare("SELECT id,started_at,ended_at FROM shifts ORDER BY started_at")
      .all();
    expect(shifts).toHaveLength(2);
    expect(shifts[1].started_at).toBe(shifts[0].ended_at);
    expect(shifts[1].ended_at).toBeNull();
  } finally {
    await f.close();
  }
});

test("combines cached pending and queued transitions without repeating a transition", () => {
  const jobs = [
    { id: DEFAULT_JOB_ID, name: "조교" },
    { id: "desk", name: "데스크" },
  ];
  const person: RosterEntry = {
    id: "employee",
    name: "직원",
    phone_last4: "0012",
    working: false,
    jobs,
    pending: [{ id: "in", action: "in", job_id: DEFAULT_JOB_ID }],
  };
  const base = {
    employee_id: person.id,
    captured_at: "2026-11-01T00:00:00Z",
    offline: true,
  };
  const queue: ClockEvent[] = [
    { ...base, id: "in", action: "in", job_id: DEFAULT_JOB_ID },
    {
      ...base,
      id: "switch",
      action: "switch",
      job_id: "desk",
      expected_shift_id: "in",
    },
    { ...base, id: "wrong-out", action: "out", expected_shift_id: "in" },
  ];
  expect(projectRosterEntry(person, queue)).toMatchObject({
    working: true,
    open_job: jobs[1],
    open_shift_id: "switch",
  });
  expect(
    projectRosterEntry(person, [
      ...queue,
      { ...base, id: "out", action: "out", expected_shift_id: "switch" },
    ]).working,
  ).toBe(false);
});
