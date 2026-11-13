import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type {
  CalendarYear,
  HolidayCalendarStatus,
} from "../../shared/types.ts";
import { formatTime, seoulDate } from "../../shared/time.ts";
import { api } from "../api.ts";
import { Alert, Field, Help } from "../ui.tsx";
import { useAdmin } from "./context.tsx";
import { ActionForm } from "./forms.tsx";
import "./holiday-calendar.css";

export default function HolidayCalendarPanel({
  year,
  setYear,
}: {
  year: number;
  setYear: (year: number) => void;
}) {
  const { data, revision, refresh, open } = useAdmin();
  const [status, setStatus] = useState<HolidayCalendarStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const lastVersion = useRef("");
  useEffect(() => {
    let active = true,
      fetching = false;
    const controller = new AbortController();
    const load = async () => {
      if (fetching || document.hidden || !navigator.onLine) return;
      fetching = true;
      try {
        const next = await api<HolidayCalendarStatus>(
          "/admin/holiday-calendar",
          { signal: controller.signal },
        );
        if (active) {
          const version = JSON.stringify(
            next.years.map((entry) => [
              entry.year,
              entry.fingerprint,
              entry.synced_at,
              entry.checked_at,
              entry.pending?.hash,
            ]),
          );
          const missingRows =
            next.years.reduce((sum, entry) => sum + entry.count, 0) !==
            data.holidays.filter(
              (day) => day.source === "official" || day.source === "both",
            ).length;
          const changed = lastVersion.current !== version;
          const refreshRows = changed && (!!lastVersion.current || missingRows);
          // Record the version before refreshing: stale rows can remain visible
          // while the replacement request is pending, and must not trigger a loop.
          lastVersion.current = version;
          if (refreshRows) refresh(["holidays", "payroll", "audit"]);
          setStatus(next);
          setError("");
        }
      } catch {
        if (active) setError("공휴일 연결 상태를 조회하지 못했습니다.");
      } finally {
        fetching = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5 * 60000);
    const resumed = () => void load();
    document.addEventListener("visibilitychange", resumed);
    window.addEventListener("online", resumed);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resumed);
      window.removeEventListener("online", resumed);
    };
  }, [revision]);
  const entry = status?.years.find((entry) => entry.year === year);
  const stale =
    entry?.synced_at &&
    Date.now() -
      Math.max(
        Date.parse(entry.synced_at),
        Date.parse(entry.checked_at ?? entry.synced_at),
      ) >
      7 * 86400000;
  return (
    <div className="holiday-calendar form-stack">
      <div className="row">
        <Field label="공휴일 조회 연도">
          <select
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          >
            {Array.from(
              { length: Number(seoulDate().slice(0, 4)) - 1998 },
              (_, i) => Number(seoulDate().slice(0, 4)) + 1 - i,
            ).map((value) => (
              <option key={value} value={value}>
                {value}년
              </option>
            ))}
          </select>
        </Field>
        <button
          className="button secondary"
          disabled={busy || !status?.configured}
          onClick={async () => {
            if (writing.current) return;
            writing.current = true;
            setBusy(true);
            setError("");
            try {
              await api(
                "/admin/holiday-calendar/sync",
                { method: "POST", body: JSON.stringify({ year }) },
                60000,
              );
            } catch (err) {
              setError((err as Error).message);
            } finally {
              writing.current = false;
              setBusy(false);
              refresh(["holidays", "payroll", "audit"]);
            }
          }}
        >
          <RefreshCw size={16} className={busy ? "spin" : ""} />{" "}
          {busy ? "동기화 중…" : "공휴일 동기화"}
        </button>
        <span
          className={`badge ${status?.configured && entry?.synced_at && !entry.error ? "green" : "amber"}`}
        >
          {status
            ? status.configured
              ? entry?.error
                ? "연결·자료 확인 필요"
                : entry?.synced_at
                  ? "자동 갱신 연결됨"
                  : "초기 동기화 대기"
              : "인증키 미등록"
            : "연결 확인 중"}
        </span>
      </div>
      <small>
        {entry?.synced_at
          ? `공식 자료 ${entry.count}일 · 최근 반영 ${seoulDate(entry.synced_at)} ${formatTime(entry.synced_at)}`
          : `${year}년 공식 자료 미확인`}
        {entry?.checked_at ? ` · 수동 확인 ${seoulDate(entry.checked_at)}` : ""}
      </small>
      {entry?.error && <Alert>{entry.error}</Alert>}
      {entry?.pending && (
        <Alert>
          공식 목록에서 기존 휴일이 빠졌습니다. 확인 전까지 기존 자료를
          유지합니다.{" "}
          <button
            className="text-button"
            onClick={() =>
              open(
                `${year}년 공휴일 변경 검토`,
                <CalendarReview entry={entry} action="approve" />,
              )
            }
          >
            변경 검토
          </button>
        </Alert>
      )}
      {stale && !entry?.pending && (
        <Alert>
          공휴일 자료 확인 후 7일이 지났습니다. 갱신하거나 공식 목록을 직접
          확인해 주세요.{" "}
          <button
            className="text-button"
            onClick={() =>
              open(
                `${year}년 공휴일 직접 확인`,
                <CalendarReview entry={entry} action="confirm" />,
              )
            }
          >
            목록 확인 기록
          </button>
        </Alert>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      <Help title="공휴일 자동 반영·인증키 설정">
        <p className="small muted">
          한국천문연구원 공식 목록을 서버에 저장해 사용합니다. 전년·올해·내년을
          매일 갱신하며, 과거 연도는 선택 후 동기화하세요. 대체·임시공휴일은
          공식 자료에 반영된 뒤 적용됩니다. 학원 수동 휴일과 확정 정산본은
          유지됩니다.
        </p>
        <p className="small muted">
          <a
            href="https://www.data.go.kr/data/15012690/openapi.do"
            target="_blank"
            rel="noreferrer"
          >
            공공데이터포털 활용신청
          </a>{" "}
          후 발급된 인증키를 Cloudflare Worker의 Secret{" "}
          <code>KASI_SERVICE_KEY</code>에 등록하세요. 키를 GitHub·채팅·APK에
          넣지 마세요.
        </p>
      </Help>
    </div>
  );
}

function CalendarReview({
  entry,
  action,
}: {
  entry: CalendarYear;
  action: "approve" | "confirm";
}) {
  const { mutate } = useAdmin();
  return (
    <ActionForm
      label={action === "approve" ? "변경 반영" : "확인 기록"}
      submit={(form) =>
        mutate(`/admin/holiday-calendar/${action}`, {
          year: entry.year,
          expected:
            action === "approve" ? entry.pending!.hash : entry.fingerprint,
          reason: form.get("reason"),
        })
      }
    >
      <Alert>
        {action === "approve"
          ? "아래 변경을 반영하면 해당 날짜의 예상 급여가 다시 계산됩니다. 기존 확정본은 유지됩니다."
          : "현재 목록을 공식 발표 자료와 직접 대조한 경우에만 확인해 주세요. 확인 이력은 7일 동안 유효합니다."}
      </Alert>
      {entry.pending && (
        <div className="rate-history">
          {(["removed", "added", "changed"] as const).flatMap((kind) =>
            entry.pending![kind].map((day) => (
              <div key={kind + day.date}>
                <span>
                  {kind === "removed"
                    ? "삭제"
                    : kind === "added"
                      ? "추가"
                      : "명칭 변경"}{" "}
                  · {day.date}
                </span>
                <b>{day.name}</b>
              </div>
            )),
          )}
        </div>
      )}
      <Field label="확인 사유">
        <textarea name="reason" required minLength={2} maxLength={500} />
      </Field>
    </ActionForm>
  );
}
