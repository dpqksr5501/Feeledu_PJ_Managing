import { useState, type FormEvent } from "react";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_HINT,
  PASSWORD_INPUT_PATTERN,
} from "../../shared/password-format.ts";
import type {
  Admin,
  Employee,
  Shift,
  ShiftBreak,
  ReviewEvent,
} from "../../shared/types.ts";
import { seoulDate, money, hours } from "../../shared/time.ts";
import { Alert, Field, Help } from "../ui.tsx";
import { useAdmin } from "./context.tsx";
import { localDateTime, toShiftInstant } from "./shift-form-time.ts";
import { rateMonthVersion } from "../../shared/rate-month.ts";
export { localDateTime } from "./shift-form-time.ts";

export function ActionForm({
  children,
  submit,
  label = "저장하기",
}: {
  children: React.ReactNode;
  submit: (form: FormData) => Promise<boolean>;
  label?: string;
}) {
  const { close } = useAdmin();
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      if (await submit(new FormData(event.currentTarget))) close();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="form-body">
      {children}
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={close}
        >
          취소
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? "저장 중…" : label}
        </button>
      </div>
    </form>
  );
}
export function EmployeeForm({ employee }: { employee?: Employee }) {
  const { mutate, data } = useAdmin();
  const [last4, setLast4] = useState(employee?.phone_last4 || "");
  const duplicate = data.employees.some(
    (e) => e.id !== employee?.id && e.active && e.phone_last4 === last4,
  );
  return (
    <ActionForm
      submit={(form) =>
        mutate(
          employee ? `/admin/employees/${employee.id}` : "/admin/employees",
          {
            name: form.get("name"),
            phone_last4: form.get("phone_last4"),
            active: form.has("active"),
            note: form.get("note"),
            weekly_enabled: form.has("weekly_enabled"),
            holiday_multiplier:
              form.get("holiday_multiplier") === ""
                ? null
                : Number(form.get("holiday_multiplier")),
            ...(employee ? { revision: employee.revision } : {}),
            ...(!employee
              ? {
                  hourly_rate: Number(form.get("hourly_rate")),
                  effective_from: form.get("effective_month") + "-01",
                }
              : {}),
          },
          employee ? "PATCH" : "POST",
        )
      }
    >
      <div className="form-grid">
        <Field label="이름">
          <input
            name="name"
            defaultValue={employee?.name}
            required
            maxLength={100}
          />
        </Field>
        <Field label="휴대전화 뒷자리">
          <input
            name="phone_last4"
            value={last4}
            onChange={(e) =>
              setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            inputMode="numeric"
            pattern="[0-9]{4}"
            required
          />
        </Field>
      </div>
      {duplicate && (
        <Alert>
          같은 뒷자리의 직원이 있습니다. 태블릿에서 본인 이름을 선택하게 됩니다.
          동명이인이라면 구분되는 표시 이름을 사용해 주세요.
        </Alert>
      )}
      {!employee && (
        <div className="form-grid">
          <Field label="기본 시급 (원)">
            <input
              name="hourly_rate"
              type="number"
              min="1"
              max="1000000"
              step="1"
              required
              placeholder="예: 12000"
            />
          </Field>
          <Field label="최초 시급 적용 월">
            <input
              name="effective_month"
              type="month"
              defaultValue={seoulDate().slice(0, 7)}
              required
            />
          </Field>
        </div>
      )}
      <Field label="개인별 휴일 근무 배율" hint="비워두면 공통 기준">
        <input
          name="holiday_multiplier"
          type="number"
          step="0.1"
          min="1"
          max="5"
          defaultValue={employee?.holiday_multiplier ?? ""}
          placeholder="공통 기준 사용"
        />
      </Field>
      <Field label="메모">
        <textarea
          name="note"
          defaultValue={employee?.note}
          maxLength={500}
          rows={3}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          name="weekly_enabled"
          defaultChecked={employee ? !!employee.weekly_enabled : true}
        />{" "}
        주휴수당 계산 대상
      </label>
      <label className="check">
        <input
          type="checkbox"
          name="active"
          defaultChecked={employee ? !!employee.active : true}
        />{" "}
        재직 중 · 태블릿에 표시
      </label>
      {employee && (
        <Help title="시급·퇴사 안내">
          <p className="muted small">
            ‘월 시급’에서 적용 월과 사유를 지정해 변경합니다. 하루 예외는 ‘하루
            시급’에서 관리합니다. 퇴사 처리해도 과거 기록은 보존됩니다.
          </p>
        </Help>
      )}
    </ActionForm>
  );
}
export function RateForm({ employee }: { employee: Employee }) {
  return <RateEditor employee={employee} isDay={false} />;
}
export function DayRateForm({ employee }: { employee: Employee }) {
  return <RateEditor employee={employee} isDay />;
}
function RateEditor({
  employee,
  isDay,
}: {
  employee: Employee;
  isDay: boolean;
}) {
  const { mutate, close } = useAdmin();
  const [selection, setSelection] = useState(
    isDay ? seoulDate() : seoulDate().slice(0, 7),
  );
  const effective = isDay ? selection : selection + "-01";
  const monthRates = (employee.rates ?? [])
    .filter((rate) => rate.effective_from.startsWith(selection + "-"))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const existing = isDay
    ? employee.day_rates?.find((r) => r.date === effective)
    : (monthRates.find((rate) => rate.effective_from === effective) ??
      monthRates[0]);
  const baseRate = employee.rates
    ?.filter((r) => r.effective_from <= effective)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
    .at(-1)?.hourly_rate;
  return (
    <ActionForm
      submit={(form) =>
        mutate(
          `/admin/employees/${employee.id}/${isDay ? "day-rates" : "month-rates"}`,
          {
            ...(isDay
              ? { date: effective, expectedRate: existing?.hourly_rate ?? null }
              : {
                  month: selection,
                  expected: rateMonthVersion(employee.rates ?? [], selection),
                }),
            hourly_rate: Number(form.get("hourly_rate")),
            reason: form.get("reason"),
          },
        )
      }
    >
      <Alert>
        {isDay
          ? "선택한 하루만 적용 · 다음 날은 기본 시급"
          : "선택 월 1일부터 다음 시급 변경 전까지 적용 · 하루 시급 우선"}{" "}
        · 기존 확정본 유지
      </Alert>
      {!isDay &&
        monthRates.some((rate) => !rate.effective_from.endsWith("-01")) && (
          <Alert>
            이달의 기존 기본 시급 {monthRates.length}건을 월 시급 하나로
            통합합니다. 하루 시급은 유지됩니다.
          </Alert>
        )}
      {isDay && (
        <Help title="하루 시급 계산">
          <p className="small muted">
            선택한 날짜의 기본 시급을 바꿉니다. 휴일 배율과 주휴 계산에도 이
            시급을 적용합니다. 자정을 넘으면 각 날짜의 시급으로 나눠 계산합니다.
          </p>
        </Help>
      )}
      <div className="form-grid">
        <Field label={isDay ? "적용 날짜" : "적용 월"}>
          <input
            type={isDay ? "date" : "month"}
            required
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
          />
        </Field>
        <Field
          label={
            !isDay
              ? "월 시급 (원)"
              : existing
                ? "해당 일자 시급 정정 (원)"
                : "새 시급 (원)"
          }
        >
          <input
            key={String(isDay) + effective}
            name="hourly_rate"
            type="number"
            min="1"
            max="1000000"
            step="1"
            defaultValue={existing?.hourly_rate || baseRate || ""}
            required
          />
        </Field>
      </div>
      <Field label="변경 사유">
        <textarea
          name="reason"
          required
          minLength={2}
          maxLength={500}
          placeholder="예: 11월 1일자 시급 인상 소급 적용"
        />
      </Field>
      {isDay && existing && (
        <button
          type="button"
          className="button secondary danger"
          onClick={async (event) => {
            const form = event.currentTarget.form!;
            if (!form.reportValidity()) return;
            if (
              confirm(
                `${effective} 특별 시급을 해제하고 기본 시급으로 계산할까요?`,
              ) &&
              (await mutate(
                `/admin/employees/${employee.id}/day-rates/remove`,
                {
                  date: effective,
                  expectedRate: existing.hourly_rate,
                  reason: new FormData(form).get("reason"),
                },
              ))
            )
              close();
          }}
        >
          하루 시급 해제
        </button>
      )}
      <div className="rate-history">
        <strong>적용 이력</strong>
        {!isDay &&
          employee.rates?.map((rate) => (
            <div key={rate.id}>
              <span>
                {rate.effective_from.endsWith("-01")
                  ? rate.effective_from.slice(0, 7) + "월부터"
                  : rate.effective_from + "부터 (기존 이력)"}
              </span>
              <b>{money(rate.hourly_rate)}</b>
              <small>{rate.reason}</small>
            </div>
          ))}
        {isDay &&
          employee.day_rates?.map((rate) => (
            <div key={rate.id}>
              <span>{rate.date} 하루만</span>
              <b>{money(rate.hourly_rate)}</b>
              <small>{rate.reason}</small>
            </div>
          ))}
      </div>
    </ActionForm>
  );
}
export function ShiftForm({ shift }: { shift?: Shift }) {
  const { data, mutate } = useAdmin();
  const [start, setStart] = useState(
    localDateTime(shift?.started_at || new Date().toISOString()),
  );
  const [end, setEnd] = useState(
    shift?.ended_at ? localDateTime(shift.ended_at) : "",
  );
  const [error, setError] = useState("");
  const span =
    start && end
      ? Date.parse(toShiftInstant(end)!) - Date.parse(toShiftInstant(start)!)
      : null;
  const [preciseBreaks, setPreciseBreaks] = useState(!!shift?.breaks?.length);
  const [breaks, setBreaks] = useState<
    { start: string; end: string; original?: ShiftBreak }[]
  >(
    (shift?.breaks ?? []).map((item) => ({
      start: localDateTime(item.started_at),
      end: localDateTime(item.ended_at),
      original: item,
    })),
  );
  const breakMinutes = breaks.reduce(
    (sum, item) =>
      sum +
      (Date.parse(toShiftInstant(item.end) ?? "") -
        Date.parse(toShiftInstant(item.start) ?? "")) /
        60000,
    0,
  );
  return (
    <ActionForm
      submit={async (form) => {
        const startedAt = toShiftInstant(start, shift?.started_at)!;
        const endedAt = toShiftInstant(end, shift?.ended_at);
        const minutes = preciseBreaks
          ? breakMinutes
          : Number(form.get("break_minutes"));
        if (!Number.isInteger(minutes) || minutes < 0) {
          setError(
            "휴게 구간의 시작·종료를 입력해 주세요. 합계는 1분 단위여야 합니다.",
          );
          return false;
        }
        if (
          endedAt &&
          (Date.parse(endedAt) <= Date.parse(startedAt) ||
            Date.parse(endedAt) - Date.parse(startedAt) > 86400000)
        ) {
          setError(
            "퇴근 날짜·시간을 확인해 주세요. 근무 구간은 0시간 초과 24시간 이내입니다.",
          );
          return false;
        }
        if (
          endedAt &&
          minutes * 60000 >= Date.parse(endedAt) - Date.parse(startedAt)
        ) {
          setError("휴게시간은 전체 근무시간보다 짧아야 합니다.");
          return false;
        }
        setError("");
        return mutate(
          shift ? `/admin/records/${shift.id}` : "/admin/records",
          {
            employee_id: form.get("employee_id"),
            started_at: startedAt,
            ended_at: endedAt,
            break_minutes: minutes,
            breaks: preciseBreaks
              ? breaks.map((item) => ({
                  started_at: toShiftInstant(
                    item.start,
                    item.original?.started_at,
                  ),
                  ended_at: toShiftInstant(item.end, item.original?.ended_at),
                }))
              : [],
            note: form.get("note"),
            reason: form.get("reason"),
            ...(shift ? { revision: shift.revision } : {}),
          },
          shift ? "PATCH" : "POST",
        );
      }}
    >
      <Field label="직원">
        <select
          name="employee_id"
          defaultValue={shift?.employee_id || ""}
          required
        >
          <option value="" disabled>
            직원 선택
          </option>
          {data.employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
              {!employee.active ? " (퇴사)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="출근 시각 (한국 시간)">
          <input
            name="started_at"
            type="datetime-local"
            step="1"
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              setError("");
            }}
            required
          />
        </Field>
        <Field
          label="퇴근 시각 (한국 시간)"
          hint="근무 중이면 비움 · 새벽 퇴근은 다음 날 날짜 선택"
        >
          <input
            name="ended_at"
            type="datetime-local"
            step="1"
            value={end}
            onChange={(event) => {
              setEnd(event.target.value);
              setError("");
            }}
          />
        </Field>
      </div>
      {span !== null && span > 0 && span <= 86400000 && (
        <p className="small muted">
          {start.slice(0, 10) !== end.slice(0, 10) ? "다음 날 퇴근 · " : ""}
          {hours(span / 1000)} · 휴게 공제 전
        </p>
      )}
      {span !== null && span <= 0 && span > -86400000 && (
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            setEnd(
              localDateTime(
                new Date(
                  Date.parse(toShiftInstant(end)!) + 86400000,
                ).toISOString(),
              ),
            )
          }
        >
          퇴근을 다음 날로 변경
        </button>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      <label className="check">
        <input
          type="checkbox"
          checked={preciseBreaks}
          onChange={(event) => setPreciseBreaks(event.target.checked)}
        />
        실제 휴게 구간 입력
      </label>
      {preciseBreaks ? (
        <div className="form-section">
          {breaks.map((item, index) => (
            <div className="form-grid" key={index}>
              <Field label={`휴게 ${index + 1} 시작`}>
                <input
                  type="datetime-local"
                  step="1"
                  value={item.start}
                  required
                  onChange={(event) =>
                    setBreaks(
                      breaks.map((row, i) =>
                        i === index
                          ? { ...row, start: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field label={`휴게 ${index + 1} 종료`}>
                <input
                  type="datetime-local"
                  step="1"
                  value={item.end}
                  required
                  onChange={(event) =>
                    setBreaks(
                      breaks.map((row, i) =>
                        i === index ? { ...row, end: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <button
                type="button"
                className="text-button danger"
                onClick={() => setBreaks(breaks.filter((_, i) => i !== index))}
              >
                휴게 {index + 1} 삭제
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={breaks.length >= 10}
            onClick={() =>
              setBreaks([
                ...breaks,
                { start: "", end: "", original: undefined },
              ])
            }
          >
            휴게 구간 추가
          </button>
          <p className="small muted">
            합계 {Number.isFinite(breakMinutes) ? breakMinutes : "—"}분 · 한국
            시간 · 최대 10구간
          </p>
        </div>
      ) : (
        <Field
          label="실제 휴게시간 (분)"
          hint="실제 휴게만 입력 · 자동 공제 없음"
        >
          <input
            name="break_minutes"
            type="number"
            min="0"
            max="1440"
            step="1"
            defaultValue={shift?.break_minutes || 0}
            required
          />
        </Field>
      )}
      <Help title="휴게·야간수당 계산">
        <p className="small muted">
          실제 휴게만 공제합니다. 야간 근무에 휴게가 있다면 구간을 입력해
          주세요. 합계만 입력한 기존 기록은 날짜·야간 경계에서 비례 추정하며,
          금액이 달라질 수 있는 기록은 정산 전 확인이 필요합니다.
        </p>
      </Help>
      <Field label="근무 메모">
        <input name="note" maxLength={500} defaultValue={shift?.note} />
      </Field>
      <Field label="등록·정정 사유">
        <textarea
          name="reason"
          minLength={2}
          maxLength={500}
          required
          placeholder="수정 이유를 남겨 주세요."
        />
      </Field>
    </ActionForm>
  );
}
export function VoidForm({ shift }: { shift: Shift }) {
  const { mutate } = useAdmin();
  return (
    <ActionForm
      label="기록 무효 처리"
      submit={(form) =>
        mutate(`/admin/records/${shift.id}/void`, {
          reason: form.get("reason"),
          revision: shift.revision,
        })
      }
    >
      <Alert>
        {shift.name}님의 {seoulDate(shift.started_at)} 기록을 계산에서
        제외합니다. 원본과 변경 이력은 보존됩니다.
      </Alert>
      <Field label="무효 사유">
        <textarea name="reason" minLength={2} maxLength={500} required />
      </Field>
    </ActionForm>
  );
}
export function ReviewForm({
  event,
  approve,
}: {
  event: ReviewEvent;
  approve: boolean;
}) {
  const { mutate } = useAdmin();
  return (
    <ActionForm
      label={approve ? "기록 승인" : "기록 반려"}
      submit={(form) =>
        mutate(`/admin/reviews/${event.id}`, {
          approve,
          reason: form.get("reason"),
        })
      }
    >
      <Alert>
        {event.name} · {localDateTime(event.captured_at).replace("T", " ")} ·{" "}
        {event.action === "in" ? "출근" : "퇴근"}
        <br />
        {event.review_reason}
      </Alert>
      <p className="muted">
        {approve
          ? "기기 시각으로 반영 · 출근 → 퇴근 순으로 승인"
          : "계산에서 제외 · 기록과 사유 보존"}
      </p>
      <Field label="확인 사유">
        <textarea name="reason" required minLength={2} maxLength={500} />
      </Field>
    </ActionForm>
  );
}
export function AdjustmentForm() {
  const { data, mutate, to } = useAdmin();
  return (
    <ActionForm
      submit={(form) =>
        mutate("/admin/adjustments", {
          employee_id: form.get("employee_id"),
          date: form.get("date"),
          amount: Number(form.get("amount")),
          reason: form.get("reason"),
        })
      }
    >
      <Field label="직원">
        <select name="employee_id" required defaultValue="">
          <option value="" disabled>
            직원 선택
          </option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="귀속일">
          <input name="date" type="date" defaultValue={to} required />
        </Field>
        <Field label="수당·조정액 (원)" hint="추가 + / 차감 −">
          <input
            name="amount"
            type="number"
            min="-100000000"
            max="100000000"
            step="1"
            required
          />
        </Field>
      </div>
      <Field label="항목 및 사유">
        <textarea
          name="reason"
          minLength={2}
          maxLength={500}
          required
          placeholder="예: 시험기간 추가 업무 수당"
        />
      </Field>
    </ActionForm>
  );
}
export function SettlementForm() {
  const { data, mutate, from, to } = useAdmin();
  const p = data.payroll;
  return (
    <ActionForm
      label={p.settlement ? "차액 정산 확정" : "정산 확정"}
      submit={(form) =>
        mutate("/admin/settlements", {
          from,
          to,
          fingerprint: p.fingerprint,
          reason: form.get("reason"),
        })
      }
    >
      <Alert>
        {from} ~ {to}
        <br />
        현재 계산 합계 <strong>{money(p.total)}</strong>
        {p.settlement && (
          <>
            <br />
            이전 확정 {money(p.settlement.total)} · 차액{" "}
            {money(p.difference || 0)}
          </>
        )}
      </Alert>
      <p>확정본 보존 · 실제 이체는 별도</p>
      <Field label="확정 사유">
        <textarea
          name="reason"
          minLength={2}
          maxLength={500}
          required
          placeholder="예: 10월 근무내역 검토 완료"
        />
      </Field>
    </ActionForm>
  );
}
export function AccountForm({ account }: { account?: Admin }) {
  const { mutate } = useAdmin();
  return (
    <ActionForm
      submit={(form) =>
        mutate(
          account ? `/admin/accounts/${account.id}` : "/admin/accounts",
          {
            name: form.get("name"),
            ...(account
              ? {
                  active: form.has("active"),
                  ...(form.get("password")
                    ? { password: form.get("password") }
                    : {}),
                }
              : {
                  username: form.get("username"),
                  password: form.get("password"),
                }),
          },
          account ? "PATCH" : "POST",
        )
      }
    >
      <Field label="이름">
        <input
          name="name"
          defaultValue={account?.name}
          maxLength={100}
          required
        />
      </Field>
      {!account && (
        <Field label="아이디" hint="영문·숫자·밑줄·마침표·하이픈, 3~40자">
          <input
            name="username"
            pattern="[a-zA-Z0-9_.-]{3,40}"
            required
            autoComplete="off"
          />
        </Field>
      )}
      <Field
        label={account ? "비밀번호 재설정 (선택)" : "비밀번호"}
        hint={PASSWORD_HINT}
      >
        <input
          name="password"
          type="password"
          minLength={MIN_PASSWORD_LENGTH}
          pattern={PASSWORD_INPUT_PATTERN}
          title={PASSWORD_HINT}
          maxLength={128}
          required={!account}
          autoComplete="new-password"
        />
      </Field>
      {account && (
        <label className="check">
          <input
            type="checkbox"
            name="active"
            defaultChecked={!!account.active}
          />{" "}
          계정 활성화
        </label>
      )}
      <Help title="계정 권한·변경 안내">
        <p className="muted small">
          관리자는 직원·시급·근무·수당·정산을 수정할 수 있습니다. 계정
          관리·태블릿 연결·전체 백업은 개발자 전용입니다. 계정 수정 시 기존
          로그인은 해제됩니다.
        </p>
      </Help>
    </ActionForm>
  );
}
export function ProfileForm() {
  const { admin, mutate } = useAdmin();
  return (
    <ActionForm
      submit={(form) =>
        mutate(
          "/admin/profile",
          { name: form.get("name"), expectedName: admin.name },
          "PATCH",
        )
      }
    >
      <Field label="표시 이름">
        <input
          name="name"
          defaultValue={admin.name}
          required
          maxLength={100}
          autoComplete="name"
        />
      </Field>
      <p className="small muted">아이디·권한·비밀번호·로그인은 유지됩니다.</p>
    </ActionForm>
  );
}
export function PasswordForm() {
  const { mutate } = useAdmin();
  return (
    <ActionForm
      submit={(form) =>
        mutate("/admin/password", {
          current: form.get("current"),
          password: form.get("password"),
        })
      }
    >
      <Field label="현재 비밀번호">
        <input
          name="current"
          type="password"
          required
          autoComplete="current-password"
        />
      </Field>
      <Field label="새 비밀번호" hint={PASSWORD_HINT}>
        <input
          name="password"
          type="password"
          minLength={MIN_PASSWORD_LENGTH}
          pattern={PASSWORD_INPUT_PATTERN}
          title={PASSWORD_HINT}
          maxLength={128}
          required
          autoComplete="new-password"
        />
      </Field>
    </ActionForm>
  );
}
