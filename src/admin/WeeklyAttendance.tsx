import "./attendance.css";
import { useEffect, useState, type CSSProperties } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutGrid,
  RefreshCw,
  Search,
  Table2,
  Users,
} from "lucide-react";
import type {
  AttendanceDay,
  EmployeeAttendance,
  WeeklyAttendance as Week,
} from "../../shared/types.ts";
import {
  addDays,
  formatTime,
  seoulDate,
  weekday,
  weekStart,
} from "../../shared/time.ts";
import { api, ApiError, download } from "../api.ts";
import { Alert, Empty, Help, Loading, Modal } from "../ui.tsx";

export function duration(seconds: number) {
  if (seconds > 0 && seconds < 60) return "1분 미만";
  const minutes = Math.floor(seconds / 60),
    h = Math.floor(minutes / 60),
    m = minutes % 60;
  return h ? `${h}시간${m ? ` ${m}분` : ""}` : `${m}분`;
}
const dayLabel = (date: string) =>
  ["일", "월", "화", "수", "목", "금", "토"][weekday(date)];
const csv = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
const timeWithSeconds = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

export default function WeeklyAttendance({
  refreshKey,
  expired,
  onRecords,
  onAdd,
}: {
  refreshKey: number;
  expired: () => void;
  onRecords: (from: string, to: string, employeeId?: string) => void;
  onAdd: () => void;
}) {
  const [anchor, setAnchor] = useState("");
  const [week, setWeek] = useState<Week | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("cards");
  const [selected, setSelected] = useState<{
    person?: EmployeeAttendance;
    day: AttendanceDay;
  } | null>(null);
  useEffect(() => {
    let active = true,
      fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      setBusy(true);
      try {
        const result = await api<Week>(
          "/admin/attendance-week" + (anchor ? "?date=" + anchor : ""),
        );
        if (active) {
          setWeek(result);
          setError("");
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) expired();
        else setError("연결을 확인해 주세요. 마지막 조회 기록을 표시합니다.");
      } finally {
        fetching = false;
        if (active) setBusy(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 60000);
    const resumed = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", resumed);
    window.addEventListener("online", resumed);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resumed);
      window.removeEventListener("online", resumed);
    };
    // Parent callbacks are intentionally excluded: changing them must not restart polling.
  }, [anchor, refreshKey, reload]);
  if (!week)
    return (
      <>
        {error ? (
          <Alert kind="error">
            {error}
            <button
              className="text-button"
              onClick={() => setReload((v) => v + 1)}
            >
              다시 조회
            </button>
          </Alert>
        ) : (
          <Loading />
        )}
      </>
    );
  const today = seoulDate(week.generatedAt);
  const current = week.from === weekStart(today, week.weekStartsOn);
  const people = week.employees.filter(
    (e) =>
      e.name.includes(search) &&
      (filter === "all" ||
        (filter === "working" && e.workingSince && !e.warnings.length) ||
        (filter === "attention" && (e.pendingCount || e.warnings.length))),
  );
  const personMax = Math.max(
    4,
    ...week.employees.flatMap((e) =>
      e.days.map((d) => (d.completedSeconds + d.liveSeconds) / 3600),
    ),
  );
  const chartMax = Math.ceil(personMax / 2) * 2;
  const totalMax = Math.max(
    4,
    Math.ceil(
      Math.max(
        ...week.days.map((d) => (d.completedSeconds + d.liveSeconds) / 3600),
      ) / 2,
    ) * 2,
  );
  const status = (person: EmployeeAttendance) =>
    person.warnings.length
      ? "퇴근·시간 확인"
      : person.workingSince
        ? "근무 중"
        : person.pendingCount
          ? "확인 대기"
          : person.completedSeconds
            ? "퇴근"
            : "근무 없음";
  function chart(
    days: AttendanceDay[],
    maximum: number,
    person?: EmployeeAttendance,
  ) {
    return (
      <div
        className="attendance-chart"
        style={{ "--chart-max": maximum } as CSSProperties}
      >
        <div className="attendance-axis" aria-hidden="true">
          <span>{maximum}h</span>
          <span>{maximum / 2}h</span>
          <span>0</span>
        </div>
        <div className="attendance-plot">
          {days.map((day) => {
            const total = day.completedSeconds + day.liveSeconds;
            return (
              <button
                key={day.date}
                className={`attendance-column ${day.date === today ? "is-today" : ""} ${day.holidayName ? "is-holiday" : ""}`}
                aria-label={`${person?.name || "전체"} ${day.date} 근무 ${duration(day.completedSeconds)}${day.liveSeconds ? `, 진행 ${duration(day.liveSeconds)}` : ""}`}
                onClick={() =>
                  setSelected({
                    person,
                    day: person
                      ? day
                      : {
                          ...day,
                          segments: week!.employees.flatMap(
                            (e) =>
                              e.days.find((d) => d.date === day.date)
                                ?.segments || [],
                          ),
                        },
                  })
                }
              >
                <span className="attendance-value">
                  {total
                    ? total < 60
                      ? "<1분"
                      : (total / 3600).toLocaleString("ko-KR", {
                          maximumFractionDigits: 1,
                        }) + "h"
                    : "—"}
                </span>
                <span className="attendance-bar-space">
                  <span
                    className="attendance-bar-stack"
                    style={{
                      height: total
                        ? `${Math.max(2, (total / 3600 / maximum) * 100)}%`
                        : "2px",
                    }}
                  >
                    {day.liveSeconds > 0 && (
                      <span
                        className="attendance-live-bar"
                        style={{ flex: day.liveSeconds }}
                      />
                    )}
                    {day.completedSeconds > 0 && (
                      <span
                        className="attendance-done-bar"
                        style={{ flex: day.completedSeconds }}
                      />
                    )}
                    {!total && <span className="attendance-zero-bar" />}
                  </span>
                </span>
                <span className="attendance-day-name">
                  {dayLabel(day.date)}
                </span>
                <small>{day.date.slice(5).replace("-", ".")}</small>
                {day.holidayName && (
                  <span
                    className="holiday-point"
                    title={day.holidayName}
                    aria-label={day.holidayName}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  function exportWeek() {
    const rows: unknown[][] = [
      [
        "주 시작",
        "주 종료",
        "직원",
        ...week!.days.map((d) => d.date),
        "완료 시간",
        "진행 중 시간",
        "확인 대기",
      ],
    ];
    for (const p of people)
      rows.push([
        week!.from,
        week!.to,
        p.name,
        ...p.days.map((d) => (d.completedSeconds / 3600).toFixed(5)),
        (p.completedSeconds / 3600).toFixed(5),
        (p.liveSeconds / 3600).toFixed(5),
        p.pendingCount,
      ]);
    download(
      `주간근무-${week!.from}-${week!.to}.csv`,
      "\uFEFF" + rows.map((row) => row.map(csv).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
  }
  return (
    <section
      className="weekly-attendance"
      aria-label="직원별 주간 근무"
      aria-busy={busy}
    >
      <div className="attendance-heading">
        <div>
          <h2>주간 근무</h2>
          <p>
            {week.from.replaceAll("-", ".")} <span>—</span>{" "}
            {week.to.slice(5).replace("-", ".")}
          </p>
        </div>
        <div className="attendance-week-controls">
          <button
            className="icon-button"
            aria-label="이전 주"
            onClick={() => setAnchor(addDays(week.from, -7))}
          >
            <ChevronLeft size={20} />
          </button>
          <input
            aria-label="주간 기준 날짜"
            type="date"
            value={anchor || today}
            onChange={(e) => {
              if (e.target.value) setAnchor(e.target.value);
            }}
          />
          <button
            className="icon-button"
            aria-label="다음 주"
            disabled={week.from >= weekStart(today, week.weekStartsOn)}
            onClick={() => setAnchor(addDays(week.from, 7))}
          >
            <ChevronRight size={20} />
          </button>
          <button
            className="button secondary small"
            disabled={current && !anchor}
            onClick={() => setAnchor("")}
          >
            이번 주
          </button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="stats-grid attendance-stats">
        <div className="stat accent">
          <div className="stat-heading">
            완료 근무
            <Clock3 size={18} />
          </div>
          <strong>{duration(week.completedSeconds)}</strong>
          <small>휴게 제외 · 진행 중 별도</small>
        </div>
        <div className="stat">
          <div className="stat-heading">
            근무 중<Users size={18} />
          </div>
          <strong>
            {week.workingCount}
            <em>명</em>
          </strong>
          <small>
            {week.liveSeconds
              ? `진행 ${duration(week.liveSeconds)}`
              : "현재 근무 중인 직원 없음"}
          </small>
        </div>
        <div className="stat">
          <div className="stat-heading">
            참여 직원
            <Users size={18} />
          </div>
          <strong>
            {week.employees.filter((e) => e.workedDays).length}
            <em>명</em>
          </strong>
          <small>이번 조회 주간</small>
        </div>
        <div
          className={`stat ${week.attentionCount ? "attendance-needs-review" : ""}`}
        >
          <div className="stat-heading">
            확인 필요
            <Clock3 size={18} />
          </div>
          <strong>
            {week.attentionCount}
            <em>건</em>
          </strong>
          <small>미확인 출퇴근·시간 오류</small>
        </div>
      </div>
      <div className="attendance-summary-grid">
        <section className="panel attendance-overview">
          <div className="panel-heading">
            <h3>요일별 전체 근무</h3>
            <span className="attendance-legend">
              <i /> 완료 <i className="live" /> 진행
            </span>
          </div>
          {chart(week.days, totalMax)}
        </section>
        <section className="panel attendance-ranking">
          <div className="panel-heading">
            <h3>직원별 합계</h3>
            <span className="small muted">완료 기준</span>
          </div>
          <div className="attendance-ranks">
            {[...week.employees]
              .sort(
                (a, b) =>
                  b.completedSeconds - a.completedSeconds ||
                  a.name.localeCompare(b.name, "ko"),
              )
              .map((person) => (
                <button
                  key={person.id}
                  onClick={() => onRecords(week.from, week.to, person.id)}
                >
                  <span>{person.name}</span>
                  <strong>{duration(person.completedSeconds)}</strong>
                  <span className="rank-track">
                    <i
                      style={{
                        width: `${(person.completedSeconds / Math.max(1, ...week.employees.map((e) => e.completedSeconds))) * 100}%`,
                      }}
                    />
                  </span>
                </button>
              ))}
          </div>
          {!week.employees.length && <Empty>직원 등록 후 표시됩니다.</Empty>}
        </section>
      </div>
      <div className="attendance-people-toolbar">
        <div>
          <h3>직원별 근무</h3>
          <span className="small muted">
            {formatTime(week.generatedAt)} 기준
          </span>
          {busy && <RefreshCw size={13} className="spin" />}
        </div>
        <div className="attendance-filters">
          <label className="attendance-search">
            <Search size={15} />
            <input
              aria-label="주간 직원 검색"
              placeholder="직원 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="주간 상태 필터"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">전체 상태</option>
            <option value="working">근무 중</option>
            <option value="attention">확인 필요</option>
          </select>
          <div className="attendance-view-switch" aria-label="주간 보기 방식">
            <button
              aria-label="직원별 카드 보기"
              aria-pressed={view === "cards"}
              onClick={() => setView("cards")}
            >
              <LayoutGrid size={17} />
            </button>
            <button
              aria-label="주간 표 보기"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              <Table2 size={17} />
            </button>
          </div>
          <button className="button secondary small" onClick={exportWeek}>
            <ArrowDownToLine size={15} /> CSV
          </button>
        </div>
      </div>
      {people.length ? (
        view === "cards" ? (
          <div className="attendance-person-grid">
            {people.map((person) => (
              <article
                className="panel attendance-person-card"
                key={person.id}
                aria-label={`${person.name} 주간 근무`}
              >
                <header>
                  <span className="avatar">{person.name.slice(0, 1)}</span>
                  <div>
                    <h3>{person.name}</h3>
                    <span
                      className={`badge ${person.warnings.length || person.pendingCount ? "amber" : person.workingSince ? "green" : ""}`}
                    >
                      {status(person)}
                    </span>
                  </div>
                  <div className="person-week-total">
                    <strong>{duration(person.completedSeconds)}</strong>
                    <small>
                      {person.liveSeconds > 0
                        ? `진행 +${duration(person.liveSeconds)}`
                        : `${person.workedDays}일 근무`}
                    </small>
                  </div>
                </header>
                {chart(person.days, chartMax, person)}
                <footer>
                  {person.weeklyThresholdSeconds && week.policyConfirmed ? (
                    <div className="attendance-threshold">
                      <div>
                        <span>주휴 시간 기준</span>
                        <b>
                          {person.weeklyEligible
                            ? "시간 기준 충족"
                            : `${duration(person.completedSeconds)} / ${duration(person.weeklyThresholdSeconds)}`}
                        </b>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`${person.name} 주휴 시간 기준`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(
                          100,
                          Math.floor(
                            (person.completedSeconds /
                              person.weeklyThresholdSeconds) *
                              100,
                          ),
                        )}
                      >
                        <i
                          style={{
                            width: `${Math.min(100, (person.completedSeconds / person.weeklyThresholdSeconds) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="small muted">
                      {person.weeklyThresholdSeconds
                        ? "수당 기준 확인 필요"
                        : "주휴 제외"}
                    </span>
                  )}
                  {(person.pendingCount > 0 || person.warnings.length > 0) && (
                    <span className="attention-note">
                      {person.warnings[0] ||
                        `확인 대기 ${person.pendingCount}건`}
                    </span>
                  )}
                  <button
                    className="text-button"
                    onClick={() => onRecords(week.from, week.to, person.id)}
                  >
                    기록 <ArrowRight size={14} />
                  </button>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <section className="panel table-wrap attendance-week-table">
            <table>
              <caption className="sr-only">
                직원별 주간 완료 근무시간. 각 날짜를 누르면 상세 기록을
                확인합니다.
              </caption>
              <thead>
                <tr>
                  <th scope="col">직원</th>
                  {week.days.map((d) => (
                    <th scope="col" key={d.date}>
                      {dayLabel(d.date)}
                      <small>{d.date.slice(5)}</small>
                    </th>
                  ))}
                  <th scope="col">완료 합계</th>
                  <th scope="col">상태</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">{p.name}</th>
                    {p.days.map((d) => (
                      <td key={d.date}>
                        <button
                          className="day-table-cell"
                          onClick={() => setSelected({ person: p, day: d })}
                          aria-label={`${p.name} ${d.date} 상세`}
                        >
                          {duration(d.completedSeconds)}
                          {d.liveSeconds > 0 && (
                            <small>+{duration(d.liveSeconds)} 진행</small>
                          )}
                        </button>
                      </td>
                    ))}
                    <td>
                      <strong>{duration(p.completedSeconds)}</strong>
                    </td>
                    <td>{status(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      ) : (
        <section className="panel">
          <Empty>
            {week.employees.length
              ? "조건에 맞는 직원 없음"
              : "등록된 직원 없음"}
          </Empty>
          {!week.employees.length && (
            <div className="attendance-empty-action">
              <button className="button primary" onClick={onAdd}>
                직원 등록
              </button>
            </div>
          )}
        </section>
      )}
      <Help title="근무시간 표시 기준">
        <p className="small muted">
          완료 근무는 실제 휴게를 제외합니다. 진행 중 시간은 별도 표시하며
          급여·주휴 시간 기준에 합산하지 않습니다. 자정을 넘으면 날짜별로
          나누고, 24시간을 넘긴 미완료 근무는 확인 대상으로 표시합니다. 확인
          대기 기록과 무효 기록은 합계에 넣지 않습니다. 주휴의 최종 계산은 급여
          화면에서 확인하세요.
        </p>
      </Help>
      {selected && (
        <Modal
          title={`${selected.person?.name || "전체"} · ${selected.day.date} 근무`}
          close={() => setSelected(null)}
        >
          <div className="form-body">
            <div className="attendance-detail-totals">
              <div>
                <small>완료</small>
                <strong>{duration(selected.day.completedSeconds)}</strong>
              </div>
              <div>
                <small>진행</small>
                <strong>{duration(selected.day.liveSeconds)}</strong>
              </div>
              {selected.day.holidayName && (
                <span className="badge amber">{selected.day.holidayName}</span>
              )}
            </div>
            {selected.day.segments.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {!selected.person && <th>직원</th>}
                      <th>출근</th>
                      <th>퇴근</th>
                      <th>휴게</th>
                      <th>근무</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.day.segments.map((segment) => (
                      <tr key={segment.shiftId}>
                        {!selected.person && (
                          <td>
                            {
                              week.employees.find((e) =>
                                e.days.some((d) =>
                                  d.segments.some(
                                    (s) => s.shiftId === segment.shiftId,
                                  ),
                                ),
                              )?.name
                            }
                          </td>
                        )}
                        <td>{timeWithSeconds(segment.startedAt)}</td>
                        <td>
                          {segment.ongoing
                            ? "근무 중"
                            : timeWithSeconds(segment.endedAt)}
                          {!segment.ongoing &&
                            seoulDate(segment.endedAt) !==
                              selected.day.date && (
                              <small className="cell-note">다음 날</small>
                            )}
                        </td>
                        <td>{duration(segment.breakSeconds)}</td>
                        <td>{duration(segment.seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>이 날짜의 완료·진행 근무 없음</Empty>
            )}
            <button
              className="button secondary"
              onClick={() => {
                onRecords(
                  selected.day.date,
                  selected.day.date,
                  selected.person?.id,
                );
                setSelected(null);
              }}
            >
              근무기록에서 보기 <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
