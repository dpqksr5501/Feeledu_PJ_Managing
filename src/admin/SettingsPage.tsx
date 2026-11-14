import { useEffect, useRef, useState, type FormEvent } from "react";
import { inspectSnapshot } from "../../shared/snapshot-format.ts";
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Plus,
  ShieldCheck,
  Tablet,
  Trash2,
  UserPlus,
} from "lucide-react";
import { formatTime, seoulDate } from "../../shared/time.ts";
import type { Policy } from "../../shared/types.ts";
import { api, ApiError } from "../api.ts";
import { Alert, Empty, Field, Help } from "../ui.tsx";
import { useAdmin } from "./context.tsx";
import { AccountForm, PasswordForm, ProfileForm } from "./forms.tsx";
import { adminRoleLabel } from "../../shared/admin-role.ts";
import HolidayCalendarPanel from "./HolidayCalendarPanel.tsx";

export default function SettingsPage() {
  const { admin, data, mutate, open } = useAdmin();
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [pairError, setPairError] = useState("");
  const [pairBusy, setPairBusy] = useState(false);
  const [holidayYear, setHolidayYear] = useState(
    Number(seoulDate().slice(0, 4)),
  );
  const holidays = data.holidays.filter((holiday) =>
    holiday.date.startsWith(String(holidayYear) + "-"),
  );
  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPairBusy(true);
    setPairError("");
    try {
      const result = await api<{ code: string; expiresAt: string }>(
        "/admin/pairings",
        {
          method: "POST",
          body: JSON.stringify({ name: new FormData(form).get("name") }),
        },
      );
      setPairing(result);
      form.reset();
    } catch (err) {
      setPairError((err as Error).message);
    } finally {
      setPairBusy(false);
    }
  }
  return (
    <div className="settings-stack">
      <PolicyForm key={JSON.stringify(data.policy)} initial={data.policy} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>휴일·공휴일</h2>
          </div>
        </div>
        <HolidayCalendarPanel year={holidayYear} setYear={setHolidayYear} />
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fields = new FormData(form);
            if (
              await mutate("/admin/holidays", {
                date: fields.get("date"),
                name: fields.get("name"),
              })
            )
              form.reset();
          }}
        >
          <Field label="날짜">
            <input name="date" type="date" required />
          </Field>
          <Field label="휴일 이름">
            <input
              name="name"
              required
              maxLength={100}
              placeholder="예: 설날 / 학원 지정 휴일"
            />
          </Field>
          <button className="button primary">
            <Plus size={16} /> 휴일 등록
          </button>
        </form>
        <Help title="휴일 등록 기준">
          <p className="small muted inset">
            학원 자체 휴일이나 공식 자료에 아직 반영되지 않은 날짜를 수동 추가할
            수 있습니다. 공식 자료와 주말·수동 휴일이 겹쳐도 가산은 한 번
            적용합니다. 기념일 전체를 공휴일로 취급하지 않습니다.
          </p>
        </Help>
        {holidays.length ? (
          <div className="holiday-list">
            {holidays.map((h) => (
              <div className="holiday-row" key={h.id}>
                <span>{h.date}</span>
                <strong>{h.name}</strong>
                <span className="badge">
                  {h.source === "official"
                    ? "공식"
                    : h.source === "both"
                      ? "공식·수동"
                      : "수동"}
                </span>
                {h.source !== "official" && (
                  <button
                    className="icon-button danger"
                    aria-label={`${h.name} 삭제`}
                    onClick={() => {
                      if (
                        confirm(
                          h.source === "both"
                            ? `${h.date} 수동 등록을 삭제할까요? 공식 공휴일은 유지됩니다.`
                            : `${h.date} ${h.name} 휴일을 삭제할까요? 해당 날짜의 예상 급여가 다시 계산됩니다.`,
                        )
                      )
                        void mutate(
                          `/admin/holidays/${h.id}`,
                          undefined,
                          "DELETE",
                        );
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty>등록된 휴일 없음</Empty>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>내 계정 보안</h2>
            <p>
              {admin.name} · {admin.username} · {adminRoleLabel(admin.role)}
            </p>
          </div>
          <div className="row">
            <button
              className="button secondary"
              onClick={() => open("내 이름 변경", <ProfileForm />)}
            >
              이름 변경
            </button>
            <button
              className="button secondary"
              onClick={() => open("내 비밀번호 변경", <PasswordForm />)}
            >
              <KeyRound size={16} /> 비밀번호 변경
            </button>
          </div>
        </div>
      </section>
      {admin.role === "owner" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>관리자 계정</h2>
              </div>
              <button
                className="button secondary"
                onClick={() => open("학원 관리자 등록", <AccountForm />)}
              >
                <UserPlus size={17} /> 관리자 추가
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>아이디</th>
                    <th>권한</th>
                    <th>상태</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <b>{a.name}</b>
                      </td>
                      <td>{a.username}</td>
                      <td>{adminRoleLabel(a.role)}</td>
                      <td>
                        <span className={`badge ${a.active ? "green" : ""}`}>
                          {a.active ? "활성" : "비활성"}
                        </span>
                      </td>
                      <td>
                        {a.role !== "owner" ? (
                          <button
                            className="text-button"
                            onClick={() =>
                              open(
                                `${a.name} · 계정 관리`,
                                <AccountForm account={a} />,
                              )
                            }
                          >
                            계정 수정
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  <Tablet size={20} /> 태블릿 연결
                </h2>
                <p>10분 · 1회 사용</p>
              </div>
            </div>
            <form className="inline-form" onSubmit={pair}>
              <Field label="태블릿 이름">
                <input
                  name="name"
                  required
                  maxLength={100}
                  placeholder="예: 학원 데스크 태블릿"
                />
              </Field>
              <button className="button primary" disabled={pairBusy}>
                <Plus size={16} /> 연결 코드 발급
              </button>
            </form>
            {pairError && (
              <div className="inset">
                <Alert kind="error">{pairError}</Alert>
              </div>
            )}
            {pairing && (
              <div className="pairing-code">
                <span>태블릿에서 입력할 연결 코드</span>
                <strong>
                  {pairing.code.slice(0, 4)} {pairing.code.slice(4)}
                </strong>
                <small>{formatTime(pairing.expiresAt)}까지 유효</small>
                <button
                  className="text-button"
                  onClick={() =>
                    void navigator.clipboard?.writeText(pairing.code)
                  }
                >
                  <Copy size={14} /> 코드 복사
                </button>
              </div>
            )}
            {data.devices.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>기기</th>
                      <th>상태</th>
                      <th>최근 접속</th>
                      <th>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.devices.map((d) => (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td>
                          <span className={`badge ${d.active ? "green" : ""}`}>
                            {d.active ? "연결됨" : "해제됨"}
                          </span>
                        </td>
                        <td>
                          {d.last_seen
                            ? seoulDate(d.last_seen) +
                              " " +
                              formatTime(d.last_seen)
                            : "접속 기록 없음"}
                        </td>
                        <td>
                          {!!d.active && (
                            <button
                              className="text-button danger"
                              onClick={() => {
                                if (
                                  confirm(
                                    "태블릿의 전송 대기가 0건인지 먼저 확인해 주세요. 연결을 해제하면 이 기기의 출퇴근 전송이 차단됩니다. 해제할까요?",
                                  )
                                )
                                  void mutate(
                                    `/admin/devices/${d.id}`,
                                    undefined,
                                    "DELETE",
                                  );
                              }}
                            >
                              연결 해제
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>연결된 태블릿 없음</Empty>
            )}
          </section>
          <BackupPanel />
        </>
      )}
    </div>
  );
}
function BackupPanel() {
  const { revision, open } = useAdmin();
  const [status, setStatus] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    api<{ createdAt: string | null }>("/admin/backup/status", {
      signal: controller.signal,
    })
      .then((value) => {
        if (current) {
          setStatus(value.createdAt);
          setError("");
        }
      })
      .catch(() => {
        if (current) setError("백업 생성 이력을 조회하지 못했습니다.");
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [revision]);
  return (
    <section className="panel form-stack">
      <div className="panel-heading">
        <div>
          <h2>
            <ShieldCheck size={19} /> 데이터 백업
          </h2>
          <p>
            최근 생성 ·{" "}
            {status === undefined
              ? "조회 중"
              : status
                ? `${seoulDate(status)} ${formatTime(status)}`
                : "없음"}
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => open("전체 백업", <BackupForm />)}
        >
          <Download size={17} /> 전체 백업 받기
        </button>
      </div>
      {status !== undefined &&
        (!status || Date.now() - Date.parse(status) > 30 * 86400000) && (
          <Alert>백업 파일을 받아 별도 보관해 주세요.</Alert>
        )}
      <small>
        계정·급여 정보 포함 · 다운로드 완료와 저장 위치를 확인하세요.
      </small>
      <Field label="백업 파일 검사 (JSON)">
        <input
          type="file"
          accept=".json,application/json"
          disabled={checking}
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setError("");
            setResult("");
            setChecking(true);
            try {
              if (file.size > 50 * 1024 * 1024)
                throw new Error("50MB 이하의 JSON 백업을 선택해 주세요.");
              const checked = await inspectSnapshot(
                JSON.parse(await file.text()),
              );
              setResult(
                `검사값 정상 · ${seoulDate(checked.createdAt)} · 직원 ${checked.employees}명 · 근무 ${checked.shifts}건 · 출퇴근 ${checked.events}건`,
              );
            } catch (err) {
              setError(
                err instanceof Error &&
                  /검사값|활성 (운영자|개발자)|50MB/.test(err.message)
                  ? err.message
                  : "올바른 필에듀 JSON 백업 파일을 선택해 주세요.",
              );
            } finally {
              setChecking(false);
            }
          }}
        />
      </Field>
      <small>
        이 기기에서만 검사 · 서버 전송 없음 · 복원 시 연결 관계도 별도
        검사합니다.
      </small>
      {checking && <span>검사 중…</span>}
      {result && <Alert kind="success">{result}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
    </section>
  );
}
export function BackupForm() {
  const { close, refresh } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/backup", {
        method: "POST",
        credentials: "same-origin",
        signal: AbortSignal.timeout(60000),
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "Feeledu",
        },
        body: JSON.stringify({ current: new FormData(form).get("current") }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(
          body.error || "백업을 받지 못했습니다.",
          response.status,
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `feeledu-${seoulDate()}.${response.headers.get("Content-Type")?.includes("json") ? "json" : "db"}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      form.reset();
      refresh(["audit"]);
      close();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) refresh();
      setError((error as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <Field label="현재 비밀번호">
        <input
          name="current"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          required
          autoFocus
        />
      </Field>
      {error && <Alert kind="error">{error}</Alert>}
      <button className="button primary" disabled={busy}>
        <Download size={17} /> {busy ? "준비 중…" : "백업 받기"}
      </button>
    </form>
  );
}
function PolicyForm({ initial }: { initial: Policy }) {
  const { mutate } = useAdmin();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const number = (
    key: keyof Policy,
    label: string,
    min: number,
    max: number,
    step = "1",
  ) => (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        required
        value={value[key] as number}
        onChange={(e) => setValue({ ...value, [key]: Number(e.target.value) })}
      />
    </Field>
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>학원 공통 계산 기준</h2>
        </div>
        <span className={`badge ${initial.confirmed ? "green" : "amber"}`}>
          {initial.confirmed ? "확인 완료" : "확인 필요"}
        </span>
      </div>
      <form
        className="policy-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await mutate(
              "/admin/settings",
              { ...value, confirmed: true, expected: JSON.stringify(initial) },
              "PUT",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="학원 이름">
          <input
            required
            maxLength={100}
            value={value.academyName}
            onChange={(e) =>
              setValue({ ...value, academyName: e.target.value })
            }
          />
        </Field>
        <div className="form-section">
          <h3>주휴수당 · 해당 주 실제 근무 기준</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={value.weeklyEnabled}
              onChange={(e) =>
                setValue({ ...value, weeklyEnabled: e.target.checked })
              }
            />{" "}
            주휴수당 계산 사용
          </label>
          <div className="form-grid three">
            {number(
              "weeklyThresholdHours",
              "지급 기준 주 근무시간",
              1,
              168,
              "0.5",
            )}
            {number("weeklyCapHours", "주 근무시간 상한", 1, 168, "0.5")}
            {number("weeklyDivisor", "유급시간 계산 나눗수", 1, 7, "0.5")}
          </div>
          <Field label="한 주의 시작 요일">
            <select
              value={value.weekStartsOn}
              onChange={(e) =>
                setValue({ ...value, weekStartsOn: Number(e.target.value) })
              }
            >
              {[
                "일요일",
                "월요일",
                "화요일",
                "수요일",
                "목요일",
                "금요일",
                "토요일",
              ].map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <div className="formula-note">
            <strong>
              주휴 = min(실근무, {value.weeklyCapHours}) ÷ {value.weeklyDivisor}{" "}
              × 평균 시급
            </strong>
            <Help title="주휴 산정 기준">
              <p>
                주 실근무 {value.weeklyThresholdHours}시간 이상 · 휴게 제외 · 주
                마지막 날 귀속. 시급 변경이 있으면 해당 주 기본급의 가중평균
                시급을 적용합니다.
              </p>
            </Help>
          </div>
        </div>
        <div className="form-section">
          <h3>휴일에 실제 근무한 시간</h3>
          {number("holidayMultiplier", "공통 휴일 근무 배율", 1, 5, "0.1")}
          <p className="small muted">
            {value.holidayMultiplier}배 · 추가 가산{" "}
            {Math.round((value.holidayMultiplier - 1) * 100)}% · 개인 설정 우선
          </p>
          <Field label="매주 반복되는 수당 적용 휴일">
            <div className="weekday-picker">
              {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
                <label
                  key={d}
                  className={
                    value.holidayWeekdays.includes(i) ? "selected" : ""
                  }
                >
                  <input
                    type="checkbox"
                    checked={value.holidayWeekdays.includes(i)}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        holidayWeekdays: e.target.checked
                          ? [...value.holidayWeekdays, i].sort()
                          : value.holidayWeekdays.filter((day) => day !== i),
                      })
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
          </Field>
          <Help title="휴일 계산 기준">
            <p className="small muted">
              선택하지 않으면 아래에 등록한 날짜만 휴일 가산 대상입니다.
              근무하지 않은 날의 유급휴일 임금·유급휴가는 이 계산에 포함하지
              않습니다.
            </p>
          </Help>
        </div>
        <div className="form-section">
          <h3>야간근로 · 22:00~다음 날 06:00</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={value.nightEnabled}
              onChange={(e) =>
                setValue({ ...value, nightEnabled: e.target.checked })
              }
            />
            야간수당 계산 사용
          </label>
          <Field label="야간 추가 가산 (%)">
            <input
              type="number"
              min="50"
              max="500"
              step="5"
              required
              value={Math.round(value.nightPremiumRate * 100)}
              onChange={(event) =>
                setValue({
                  ...value,
                  nightPremiumRate: Number(event.target.value) / 100,
                })
              }
            />
          </Field>
          <p className="small muted">
            실제 야간 근로 × 해당 날짜 시급 ×{" "}
            {Math.round(value.nightPremiumRate * 100)}% · 휴일가산과 별도 합산
          </p>
          <Help title="야간수당 기준·근거">
            <p className="small muted">
              등록된 월·하루 시급을 야간 가산 기준 시급으로 사용합니다. 고정수당
              등으로 통상시급이 다르면 지급 전 확인이 필요합니다. 학원 지급
              정책으로 적용하며 직원 수로 자동 제외하지 않습니다.{" "}
              <a
                href="https://1350.moel.go.kr/rtmview.do?id=1000320245"
                target="_blank"
                rel="noreferrer"
              >
                고용노동부 제56조 안내
              </a>
            </p>
          </Help>
        </div>
        <Alert>
          변경 시 과거 예상 급여도 재계산됩니다. 기존 확정본은 유지됩니다.
        </Alert>
        <label className="check confirmation">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            required
          />{" "}
          위 산식과 적용 조건을 확인했습니다.
        </label>
        <button className="button primary" disabled={busy || !confirmed}>
          <Check size={17} />
          {busy ? "저장 중…" : "계산 기준 저장"}
        </button>
      </form>
    </section>
  );
}
