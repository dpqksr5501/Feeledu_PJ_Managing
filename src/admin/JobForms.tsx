import { useState } from "react";
import { Plus } from "lucide-react";
import {
  DEFAULT_JOB_ID,
  type Job,
  type JobAssignment,
  type JobRate,
  type JobRole,
} from "../../shared/jobs.ts";
import { money, seoulDate } from "../../shared/time.ts";
import type { Employee } from "../../shared/types.ts";
import { Field } from "../ui.tsx";
import { ActionForm } from "./forms.tsx";
import { useAdmin } from "./context.tsx";

export function currentJobRate(
  job: JobAssignment,
  employee: Employee,
  roles: JobRole[],
) {
  const today = seoulDate();
  const common = roles
    .find((role) => role.id === job.id)
    ?.rates.find((rate) => rate.date <= today)?.hourly_rate;
  if (job.id === DEFAULT_JOB_ID) return employee.current_rate ?? common;
  return (
    job.rates.find((rate) => rate.kind === "day" && rate.date === today)
      ?.hourly_rate ??
    job.rates.find((rate) => rate.kind === "monthly" && rate.date <= today)
      ?.hourly_rate ??
    common
  );
}

export function JobSettingsPanel() {
  const { data, open } = useAdmin();
  const today = seoulDate();
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>근무 직무</h2>
          <p>직무와 공통 시급을 등록하고 직원·시급에서 직원별로 배정하세요.</p>
        </div>
        <button
          className="button primary"
          onClick={() => open("직무 추가", <JobForm />)}
        >
          <Plus size={16} /> 직무 추가
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>직무</th>
              <th>현재 공통 시급</th>
              <th>상태</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {data.jobs.map((job) => {
              const rate = job.rates.find(
                (item) => item.date <= today,
              )?.hourly_rate;
              return (
                <tr key={job.id}>
                  <td>
                    <strong>{job.name}</strong>
                  </td>
                  <td>{rate ? money(rate) : "직원별 시급"}</td>
                  <td>{job.active ? "사용 중" : "보관됨"}</td>
                  <td>
                    <div className="row">
                      <button
                        className="text-button"
                        onClick={() =>
                          open(
                            `${job.name} · 공통 시급`,
                            <JobRateForm job={job} rates={job.rates} />,
                          )
                        }
                      >
                        공통 시급
                      </button>
                      {job.id !== DEFAULT_JOB_ID && (
                        <button
                          className="text-button"
                          onClick={() =>
                            open(
                              `${job.name} · 직무 수정`,
                              <JobForm job={job} />,
                            )
                          }
                        >
                          {job.active ? "수정·삭제" : "수정·복원"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function JobForm({ job }: { job?: JobRole }) {
  const { mutate } = useAdmin();
  return (
    <ActionForm
      submit={(form) =>
        job
          ? mutate(
              `/admin/jobs/${job.id}`,
              {
                name: form.get("name"),
                active: form.get("activity") === "active",
                revision: job.revision,
              },
              "PATCH",
            )
          : mutate("/admin/jobs", {
              name: form.get("name"),
              hourly_rate: Number(form.get("hourly_rate")),
              date: form.get("month") + "-01",
            })
      }
    >
      <Field label="직무 이름">
        <input
          name="name"
          defaultValue={job?.name}
          maxLength={40}
          required
          placeholder="예: 필스터디"
        />
      </Field>
      {job ? (
        <Field
          label="사용 상태"
          hint="삭제한 직무는 보관되며 과거 근무와 급여에서 계속 확인할 수 있습니다."
        >
          <select
            name="activity"
            defaultValue={job.active ? "active" : "archived"}
          >
            <option value="active">사용</option>
            <option value="archived">삭제 (보관)</option>
          </select>
        </Field>
      ) : (
        <div className="form-grid">
          <Field label="공통 시급 (원)">
            <input
              name="hourly_rate"
              type="number"
              min={1}
              max={1000000}
              required
            />
          </Field>
          <Field label="적용 월">
            <input
              name="month"
              type="month"
              defaultValue={seoulDate().slice(0, 7)}
              required
            />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function EmployeeJobsForm({ employee }: { employee: Employee }) {
  const { data, mutate } = useAdmin();
  const assignments = employee.jobs ?? [];
  const [jobIds, setJobIds] = useState(
    assignments
      .filter((job) => job.assigned && job.active)
      .map((job) => job.id),
  );
  const [defaultJobId, setDefaultJobId] = useState(
    assignments.find((job) => job.is_default)?.id ?? "",
  );
  return (
    <ActionForm
      submit={() =>
        mutate(
          `/admin/employees/${employee.id}/jobs`,
          {
            job_ids: jobIds,
            default_job_id: defaultJobId,
            revision: employee.revision,
          },
          "PUT",
        )
      }
    >
      <fieldset className="job-options">
        <legend>출근할 수 있는 직무</legend>
        {data.jobs
          .filter((job) => job.active)
          .map((job) => (
            <label key={job.id} className="check">
              <input
                type="checkbox"
                checked={jobIds.includes(job.id)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...jobIds, job.id]
                    : jobIds.filter((id) => id !== job.id);
                  setJobIds(next);
                  if (!next.includes(defaultJobId))
                    setDefaultJobId(next[0] ?? "");
                }}
              />
              {job.name}
            </label>
          ))}
      </fieldset>
      <Field
        label="기본 직무"
        hint="직무가 여러 개면 태블릿에서 첫 번째로 표시됩니다."
      >
        <select
          value={defaultJobId}
          onChange={(event) => setDefaultJobId(event.target.value)}
          required
        >
          <option value="" disabled>
            직무를 하나 이상 선택해 주세요
          </option>
          {data.jobs
            .filter((job) => jobIds.includes(job.id))
            .map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
        </select>
      </Field>
    </ActionForm>
  );
}

export function JobRateForm({
  job,
  rates,
  employeeId = null,
  kind = "monthly",
}: {
  job: Job;
  rates: JobRate[];
  employeeId?: string | null;
  kind?: JobRate["kind"];
}) {
  const { mutate } = useAdmin();
  const monthly = kind === "monthly";
  const [selection, setSelection] = useState(
    seoulDate().slice(0, monthly ? 7 : 10),
  );
  const date = monthly ? selection + "-01" : selection;
  const history = rates.filter((rate) => rate.kind === kind);
  const existing = history.find((rate) => rate.date === date);
  const [inherit, setInherit] = useState(false);
  return (
    <ActionForm
      submit={(form) =>
        mutate(
          `/admin/jobs/${job.id}/rates`,
          {
            employee_id: employeeId,
            kind,
            date,
            hourly_rate: inherit ? null : Number(form.get("hourly_rate")),
            expected_id: existing?.id ?? null,
            revision: existing?.revision ?? null,
            reason: form.get("reason"),
          },
          "PUT",
        )
      }
    >
      <Field
        label={monthly ? "적용 월" : "적용 날짜"}
        hint={
          monthly
            ? "선택한 달 1일부터 적용됩니다."
            : `선택한 날짜의 ${job.name} 근무에만 적용됩니다.`
        }
      >
        <input
          type={monthly ? "month" : "date"}
          value={selection}
          required
          onChange={(event) => {
            setSelection(event.target.value);
            setInherit(false);
          }}
        />
      </Field>
      {monthly && employeeId && (
        <label className="check">
          <input
            type="checkbox"
            checked={inherit}
            onChange={(event) => setInherit(event.target.checked)}
          />
          이 달부터 직무 공통 시급 사용
        </label>
      )}
      {!monthly && existing && (
        <label className="check">
          <input
            type="checkbox"
            checked={inherit}
            onChange={(event) => setInherit(event.target.checked)}
          />
          이 날의 하루 시급 해제
        </label>
      )}
      {!inherit && (
        <Field label={monthly ? "월 시급 (원)" : "하루 시급 (원)"}>
          <input
            key={date}
            name="hourly_rate"
            type="number"
            min={1}
            max={1000000}
            defaultValue={existing?.hourly_rate ?? ""}
            required
          />
        </Field>
      )}
      <Field label="변경 사유">
        <input name="reason" minLength={2} maxLength={500} required />
      </Field>
      {!!history.length && (
        <div className="rate-history">
          <strong>시급 이력</strong>
          {history.map((rate) => (
            <div key={rate.date}>
              <span>{rate.date.slice(0, monthly ? 7 : 10)}</span>
              <b>
                {rate.hourly_rate === null
                  ? "직무 공통 시급"
                  : money(rate.hourly_rate)}
              </b>
              <small>{rate.reason}</small>
            </div>
          ))}
        </div>
      )}
    </ActionForm>
  );
}
