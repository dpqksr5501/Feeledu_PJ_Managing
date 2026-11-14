import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Tablet,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { Admin, Payroll, PayrollRow, Shift } from "../../shared/types.ts";
import {
  addDays,
  formatTime,
  hours,
  money,
  seoulDate,
  weekday,
} from "../../shared/time.ts";
import { api, ApiError, download } from "../api.ts";
import { Alert, Brand, Empty, Help, Loading, Modal } from "../ui.tsx";
import { AdminContext, type AdminResource } from "./context.tsx";
import { resourcesAfterMutation, useAdminData } from "./useAdminData.ts";
import {
  AdjustmentForm,
  EmployeeForm,
  RateForm,
  DayRateForm,
  ReviewForm,
  SettlementForm,
  ShiftForm,
  VoidForm,
} from "./forms.tsx";
import SettingsPage, { BackupForm } from "./SettingsPage.tsx";
import WeeklyAttendance from "./WeeklyAttendance.tsx";
import { UpdateHistoryButton } from "../UpdateCenter.tsx";
import { holidayName, workedDates } from "../../shared/workdays.ts";
import { adminRoleLabel } from "../../shared/admin-role.ts";

const navigation = [
  { id: "overview", label: "대시보드", icon: LayoutDashboard },
  { id: "records", label: "근무기록", icon: ClipboardList },
  { id: "employees", label: "직원·시급", icon: Users },
  { id: "payroll", label: "급여·수당", icon: Wallet },
  { id: "audit", label: "변경 이력", icon: Activity },
  { id: "settings", label: "설정", icon: Settings2 },
];
const actionLabels: Record<string, string> = {
  setup: "개발자 설정",
  login: "로그인",
  "employee.create": "직원 등록",
  "employee.update": "직원 수정",
  "rate.update": "시급 변경",
  "rate.month": "월 시급 변경",
  "dayrate.update": "하루 시급 변경",
  "dayrate.remove": "하루 시급 해제",
  "shift.create": "근무 등록",
  "shift.update": "근무 정정",
  "shift.void": "근무 무효",
  "clock.review": "출퇴근 확인",
  "clock.recover": "미전송 기록 복구",
  "policy.update": "계산 기준 수정",
  "holiday.create": "휴일 등록",
  "holiday.delete": "휴일 삭제",
  "calendar.sync": "공식 공휴일 반영",
  "calendar.pending": "공휴일 변경 검토 대기",
  "calendar.approve": "공휴일 변경 승인",
  "calendar.confirm": "공휴일 직접 확인",
  "adjustment.create": "수당 등록",
  "adjustment.delete": "수당 삭제",
  "settlement.create": "정산 확정",
  "account.create": "관리자 등록",
  "account.update": "관리자 변경",
  "profile.update": "내 이름 변경",
  "password.change": "비밀번호 변경",
  "device.pairing": "연결 코드 발급",
  "device.paired": "태블릿 연결",
  "device.revoke": "태블릿 연결 해제",
  "backup.download": "백업 다운로드",
  "testdata.cleanup": "테스트 데이터 정리",
};
export default function AdminApp({
  admin,
  expired,
  logout,
  changed,
}: {
  admin: Admin;
  expired: () => void;
  logout: () => Promise<void>;
  changed: (admin: Admin) => void;
}) {
  const today = seoulDate();
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState("overview");
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [modal, setModal] = useState<{
    title: string;
    content: ReactNode;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [recordFilter, setRecordFilter] = useState("all");
  const [recordEmployeeId, setRecordEmployeeId] = useState("");
  const {
    data,
    loading,
    fetching,
    loadError,
    refresh: refreshResources,
  } = useAdminData({
    admin,
    tab,
    from,
    to,
    expired,
    failed: (text) => setNotice({ text, error: true }),
  });
  const refresh = useCallback(
    (resources?: AdminResource[]) => {
      refreshResources(resources);
      setRevision((value) => value + 1);
    },
    [refreshResources],
  );
  const close = useCallback(() => setModal(null), []);
  const open = (title: string, content: ReactNode) =>
    setModal({ title, content });
  useEffect(() => {
    if (modal || tab !== "records") return;
    const timer = setInterval(() => {
      if (!document.hidden && navigator.onLine) refresh(["records", "reviews"]);
    }, 60000);
    return () => clearInterval(timer);
  }, [refresh, modal, tab]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => setNotice(null),
      notice.error ? 12000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [notice]);
  async function mutate(path: string, body?: unknown, method = "POST") {
    try {
      const result = await api<Admin>(path, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (path === "/admin/profile") changed(result);
      refresh(resourcesAfterMutation(path));
      setNotice({ text: "저장 완료", error: false });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expired();
      else setNotice({ text: (err as Error).message, error: true });
      return false;
    }
  }
  const navigate = (next: string) => {
    setTab(next);
    setSearch("");
    setRecordEmployeeId("");
    window.scrollTo(0, 0);
  };
  const setPeriod = (start: string, finish: string) => {
    if (
      !start ||
      !finish ||
      start > finish ||
      Date.parse(finish) - Date.parse(start) > 366 * 86400000
    ) {
      setNotice({
        text: "조회 기간은 시작일 ≤ 종료일, 최대 1년으로 선택해 주세요.",
        error: true,
      });
      return;
    }
    setFrom(start);
    setTo(finish);
  };
  const holidayDates = (shift: Shift) =>
    data
      ? workedDates(shift, from, to).filter((date) =>
          holidayName(date, data.holidays, data.policy),
        )
      : [];
  const specialDates = (shift: Shift) =>
    data
      ? workedDates(shift, from, to).filter((date) =>
          data.employees
            .find((employee) => employee.id === shift.employee_id)
            ?.day_rates?.some((rate) => rate.date === date),
        )
      : [];
  const records =
    data?.records.filter(
      (r) =>
        !r.voided &&
        r.name.includes(search) &&
        (!recordEmployeeId || r.employee_id === recordEmployeeId) &&
        (tab !== "records" ||
          recordFilter === "all" ||
          (recordFilter === "holiday" && holidayDates(r).length > 0) ||
          (recordFilter === "special" && specialDates(r).length > 0) ||
          (recordFilter === "open" && !r.ended_at)),
    ) || [];
  const employees =
    data?.employees.filter(
      (e) => e.name.includes(search) || e.phone_last4.includes(search),
    ) || [];
  const active = data?.employees.filter((e) => e.active).length || 0;
  const ctx = data && {
    admin,
    data,
    revision,
    refresh,
    mutate,
    open,
    close,
    from,
    to,
    setPeriod,
    navigate,
  };
  const exportPayroll = () => {
    if (!data) return;
    const csvCell = (v: unknown) => {
      const text = String(v ?? "");
      return (
        '"' +
        (/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""') +
        '"'
      );
    };
    const saved = new Map(
      data.payroll.settlement?.snapshot.rows.map((r) => [
        r.employeeId,
        r.total,
      ]) || [],
    );
    const rows = [
      [
        "기간 시작",
        "기간 종료",
        "직원",
        "근무시간",
        "기본급",
        "휴일가산",
        "야간시간",
        "야간가산",
        "주휴수당",
        "기타수당·조정",
        "계산합계",
        "이전 확정",
        "차액",
      ],
      ...data.payroll.rows.map((r) => [
        from,
        to,
        r.name,
        r.seconds / 3600,
        r.base,
        r.holiday,
        (r.nightSeconds ?? 0) / 3600,
        r.night ?? 0,
        r.weekly,
        r.adjustment,
        r.total,
        saved.get(r.employeeId) ?? "",
        saved.has(r.employeeId) ? r.total - saved.get(r.employeeId)! : "",
      ]),
    ];
    download(
      `급여-${from}-${to}.csv`,
      "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
  };
  function payrollDetail(row: PayrollRow) {
    open(
      `${row.name} · 급여 계산 내역`,
      <div className="form-body">
        <div className="pay-detail">
          <span>근무시간</span>
          <b>{hours(row.seconds)}</b>
          <span>기본급</span>
          <b>{money(row.base)}</b>
          <span>휴일 추가 가산</span>
          <b>{money(row.holiday)}</b>
          <span>야간 추가 가산 · {hours(row.nightSeconds ?? 0)}</span>
          <b>{money(row.night ?? 0)}</b>
          <span>주휴수당</span>
          <b>{money(row.weekly)}</b>
          <span>기타 수당·조정</span>
          <b>{money(row.adjustment)}</b>
          <strong>합계</strong>
          <strong>{money(row.total)}</strong>
        </div>
        {row.weeklyDetails.length > 0 && (
          <div className="rate-history">
            <strong>주휴 계산 근거</strong>
            {row.weeklyDetails.map((w) => (
              <div key={w.date}>
                <span>{w.date} 귀속</span>
                <b>{money(w.amount)}</b>
                <small>
                  해당 주 실근무 {w.hours.toFixed(2)}시간 · 기본급 가중평균 시급
                  적용
                </small>
              </div>
            ))}
          </div>
        )}
        {!!row.dailyDetails?.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>시간</th>
                  <th>시급</th>
                  <th>기본급</th>
                  <th>휴일가산</th>
                  <th>야간시간</th>
                  <th>야간가산</th>
                </tr>
              </thead>
              <tbody>
                {row.dailyDetails.map((day) => (
                  <tr key={day.date}>
                    <td>
                      {day.date}
                      {day.holidayName && (
                        <small className="cell-note">{day.holidayName}</small>
                      )}
                    </td>
                    <td>{hours(day.seconds)}</td>
                    <td>
                      {money(day.hourlyRate)}
                      {day.specialRate && (
                        <small className="cell-note">하루 시급</small>
                      )}
                    </td>
                    <td>{money(Math.round(day.base))}</td>
                    <td>{money(Math.round(day.holiday))}</td>
                    <td>{hours(day.nightSeconds ?? 0)}</td>
                    <td>{money(Math.round(day.night ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted inset">
              일별 표시는 참고 금액 · 총액은 항목별 합산 후 반올림
            </p>
          </div>
        )}
        {row.warnings.map((w) => (
          <Alert key={w}>{w}</Alert>
        ))}
        <Help title="계산 기준">
          <p className="small muted">
            기본급·휴일가산·야간가산·주휴수당을 각각 합산한 뒤 원 단위
            반올림합니다. 야간은 22:00~06:00 실제 근로만 계산하며 휴일가산과
            더합니다. 세전 금액이며 세금·보험 공제와 실제 지급은 포함하지
            않습니다.
          </p>
        </Help>
      </div>,
    );
  }
  async function savedPayroll(id: string) {
    try {
      const saved = await api<Payroll>(`/admin/settlements/${id}`);
      open(
        "보존된 확정 정산",
        <div className="form-body">
          <Alert kind="success">
            {saved.from} ~ {saved.to} · 확정 합계 {money(saved.total)}
          </Alert>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>직원</th>
                  <th>기본급</th>
                  <th>휴일</th>
                  <th>야간</th>
                  <th>주휴</th>
                  <th>기타</th>
                  <th>확정 합계</th>
                </tr>
              </thead>
              <tbody>
                {saved.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td>{r.name}</td>
                    <td>{money(r.base)}</td>
                    <td>{money(r.holiday)}</td>
                    <td>{money(r.night ?? 0)}</td>
                    <td>{money(r.weekly)}</td>
                    <td>{money(r.adjustment)}</td>
                    <td>{money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>확정 당시 기준</p>
        </div>,
      );
    } catch (err) {
      setNotice({ text: (err as Error).message, error: true });
    }
  }
  const periodControl = (
    <div className="period-control">
      <CalendarDays size={16} />
      <input
        aria-label="조회 시작일"
        type="date"
        value={from}
        onChange={(e) => setPeriod(e.target.value, to)}
      />
      <span>—</span>
      <input
        aria-label="조회 종료일"
        type="date"
        value={to}
        onChange={(e) => setPeriod(from, e.target.value)}
      />
    </div>
  );
  function recordTable(items: Shift[], compact = false) {
    const recordDate = (instant: string) => {
      const date = seoulDate(instant);
      const day = ["일", "월", "화", "수", "목", "금", "토"][weekday(date)];
      const showYear =
        from.slice(0, 4) !== to.slice(0, 4) ||
        date.slice(0, 4) !== from.slice(0, 4);
      const holiday = data?.holidays.find((item) => item.date === date);
      const tone =
        holiday || weekday(date) === 0
          ? "red"
          : weekday(date) === 6
            ? "blue"
            : "";
      return (
        <time
          dateTime={date}
          className={tone ? `calendar-date-${tone}` : undefined}
          title={`${date}(${day})${holiday ? " · " + holiday.name : ""}`}
          aria-label={`${date}(${day})${holiday ? " · " + holiday.name : ""}`}
        >
          {showYear ? date : date.slice(5)}({day})
        </time>
      );
    };
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>직원</th>
              <th>근무일</th>
              <th>출근</th>
              <th>퇴근</th>
              {!compact && (
                <>
                  <th>휴게</th>
                  <th>근무시간</th>
                </>
              )}
              <th>상태</th>
              {!compact && <th>관리</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>
                  <span className="person-cell">
                    <span className="avatar">{s.name.slice(0, 1)}</span>
                    <b>{s.name}</b>
                  </span>
                </td>
                <td>
                  {recordDate(s.started_at)}
                  {!compact &&
                    holidayDates(s).map((date) => (
                      <small key={date} className="cell-note">
                        {date === seoulDate(s.started_at) ? "" : date + " "}
                        {holidayName(date, data!.holidays, data!.policy)}
                      </small>
                    ))}
                  {!compact &&
                    specialDates(s).map((date) => (
                      <small key={date} className="cell-note">
                        {date === seoulDate(s.started_at) ? "" : date + " "}하루
                        시급
                      </small>
                    ))}
                </td>
                <td>{formatTime(s.started_at)}</td>
                <td>
                  {s.ended_at ? (
                    <>
                      {seoulDate(s.ended_at) !== seoulDate(s.started_at) && (
                        <small className="date-prefix">
                          {recordDate(s.ended_at)}{" "}
                        </small>
                      )}
                      {formatTime(s.ended_at)}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                {!compact && (
                  <>
                    <td>
                      {s.break_minutes}분
                      {!!s.breaks?.length && (
                        <small className="cell-note">구간 입력</small>
                      )}
                    </td>
                    <td>
                      {s.ended_at
                        ? hours(
                            Math.max(
                              0,
                              (Date.parse(s.ended_at) -
                                Date.parse(s.started_at)) /
                                1000 -
                                s.break_minutes * 60,
                            ),
                          )
                        : "—"}
                    </td>
                  </>
                )}
                <td>
                  <span className={`badge ${s.ended_at ? "" : "green"}`}>
                    {s.ended_at ? "퇴근 완료" : "근무 중"}
                  </span>
                </td>
                {!compact && (
                  <td>
                    <div className="row">
                      <button
                        className="text-button"
                        onClick={() =>
                          open("근무기록 정정", <ShiftForm shift={s} />)
                        }
                      >
                        정정
                      </button>
                      <button
                        className="text-button danger"
                        onClick={() =>
                          open("근무기록 무효 처리", <VoidForm shift={s} />)
                        }
                      >
                        무효
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty>근무기록 없음</Empty>}
      </div>
    );
  }
  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <Brand />

        <nav>
          {navigation.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              {item.label}
              {item.id === "records" && !!data?.reviews.length && (
                <span className="nav-count">{data.reviews.length}</span>
              )}
            </button>
          ))}
        </nav>
        <a
          className="tablet-link"
          href="/kiosk"
          target={admin.shared_tablet ? undefined : "_blank"}
          rel="noreferrer"
          onClick={(event) => {
            if (!admin.shared_tablet || admin.persistent_login) return;
            event.preventDefault();
            void logout()
              .then(() => {
                location.href = "/kiosk";
              })
              .catch((err: Error) =>
                setNotice({ text: err.message, error: true }),
              );
          }}
        >
          <Tablet size={19} />
          <span>출퇴근 화면</span>
          <ArrowRight size={16} />
        </a>
        <div className="sidebar-user">
          <span className="avatar">{admin.name.slice(0, 1)}</span>
          <div>
            <strong>{admin.name}</strong>
            <small>{adminRoleLabel(admin.role)}</small>
          </div>
          <button
            aria-label="로그아웃"
            className="icon-button"
            onClick={() =>
              void logout().catch((err) =>
                setNotice({ text: err.message, error: true }),
              )
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="topbar">
          <span>
            {data?.policy.academyName || "필에듀"}{" "}
            <span className="divider">/</span> 근무 관리
          </span>
          <div className="row">
            <span className="today-label">
              {new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                month: "long",
                day: "numeric",
                weekday: "short",
              }).format(new Date())}
            </span>
            <UpdateHistoryButton />
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <h1>{navigation.find((n) => n.id === tab)?.label}</h1>
            </div>
            <div className="row">
              {admin.role === "owner" && data && (
                <button
                  className="button secondary"
                  onClick={() => open("전체 백업", <BackupForm />)}
                >
                  <ArrowDownToLine size={16} /> 백업
                </button>
              )}
              <button
                className="button secondary"
                onClick={() => refresh()}
                disabled={fetching}
              >
                <RefreshCw
                  size={16}
                  className={loading || fetching ? "spin" : ""}
                />{" "}
                새로고침
              </button>
            </div>
          </div>
          {(tab === "records" || tab === "payroll") && (
            <div className="toolbar">{periodControl}</div>
          )}
          {data && ctx && !loading ? (
            <AdminContext.Provider value={ctx}>
              {!data.policy.confirmed && tab !== "settings" && (
                <Alert>
                  수당 기준 확인 필요 · 정산 확정 전 설정하세요.{" "}
                  <button
                    className="text-button"
                    onClick={() => navigate("settings")}
                  >
                    기준 설정하기 <ArrowRight size={14} />
                  </button>
                </Alert>
              )}
              {tab === "overview" && (
                <>
                  <WeeklyAttendance
                    refreshKey={revision}
                    expired={expired}
                    onAdd={() => open("조교 등록", <EmployeeForm />)}
                    onRecords={(a, b, id) => {
                      if (
                        id &&
                        !data.employees.some((employee) => employee.id === id)
                      )
                        refresh(["employees"]);
                      setPeriod(a, b);
                      navigate("records");
                      setRecordEmployeeId(id || "");
                      setRecordFilter("all");
                    }}
                  />
                </>
              )}
              {tab === "records" && (
                <>
                  {!!data.reviews.length && (
                    <section className="panel review-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            승인 대기{" "}
                            <span className="badge amber">
                              {data.reviews.length}건
                            </span>
                          </h2>
                          <p>출근 → 퇴근 순으로 승인</p>
                        </div>
                      </div>
                      {data.reviews.map((event) => (
                        <div className="review-row" key={event.id}>
                          <span className="avatar">
                            {event.name.slice(0, 1)}
                          </span>
                          <div>
                            <strong>
                              {event.name} ·{" "}
                              {event.action === "in" ? "출근" : "퇴근"}
                            </strong>
                            <small>
                              {seoulDate(event.captured_at)}{" "}
                              {formatTime(event.captured_at)} ·{" "}
                              {event.device_name} · {event.review_reason}
                            </small>
                          </div>
                          <div className="row">
                            <button
                              className="button small secondary"
                              onClick={() =>
                                open(
                                  "출퇴근 기록 반려",
                                  <ReviewForm event={event} approve={false} />,
                                )
                              }
                            >
                              반려
                            </button>
                            <button
                              className="button small primary"
                              onClick={() =>
                                open(
                                  "출퇴근 기록 승인",
                                  <ReviewForm event={event} approve />,
                                )
                              }
                            >
                              확인·승인
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}
                  <div className="toolbar">
                    <div className="row">
                      <select
                        aria-label="근무 직원 필터"
                        value={recordEmployeeId}
                        onChange={(e) => setRecordEmployeeId(e.target.value)}
                      >
                        <option value="">전체 직원</option>
                        {data.employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="근무기록 필터"
                        value={recordFilter}
                        onChange={(event) =>
                          setRecordFilter(event.target.value)
                        }
                      >
                        <option value="all">전체 근무</option>
                        <option value="holiday">휴일·공휴일 근무</option>
                        <option value="special">하루 시급 적용</option>
                        <option value="open">퇴근 누락</option>
                      </select>
                      <label className="button secondary">
                        복구 파일 가져오기
                        <input
                          type="file"
                          accept="application/json,.json"
                          hidden
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            void file
                              .text()
                              .then((text) => {
                                const events = JSON.parse(text);
                                if (!Array.isArray(events))
                                  throw new Error(
                                    "출퇴근 기록 배열이 필요합니다.",
                                  );
                                return mutate("/admin/recover-events", {
                                  events,
                                });
                              })
                              .catch((err) =>
                                setNotice({
                                  text: "복구 파일 확인: " + err.message,
                                  error: true,
                                }),
                              );
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <SearchBox value={search} set={setSearch} />
                      <button
                        className="button primary"
                        onClick={() => open("근무기록 추가", <ShiftForm />)}
                      >
                        <Plus size={17} /> 출퇴근 직접 입력
                      </button>
                    </div>
                  </div>
                  <section className="panel">{recordTable(records)}</section>
                  {data.records.some((s) => s.voided) && (
                    <Help title="무효 기록 안내">
                      <p className="small muted">
                        무효 처리한 기록은 이 목록에서 제외되며 변경 이력에서
                        원본을 확인할 수 있습니다.
                      </p>
                    </Help>
                  )}
                </>
              )}
              {tab === "employees" && (
                <>
                  <div className="toolbar">
                    <span className="muted">
                      재직 {active}명 · 전체 {data.employees.length}명
                    </span>
                    <div className="row">
                      <SearchBox value={search} set={setSearch} />
                      <button
                        className="button primary"
                        onClick={() => open("조교 등록", <EmployeeForm />)}
                      >
                        <Plus size={17} /> 조교 등록
                      </button>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>직원</th>
                            <th>출퇴근 번호</th>
                            <th>현재 시급</th>
                            <th>주휴 계산</th>
                            <th>휴일 배율</th>
                            <th>상태</th>
                            <th>관리</th>
                          </tr>
                        </thead>
                        <tbody>
                          {employees.map((e) => (
                            <tr key={e.id}>
                              <td>
                                <span className="person-cell">
                                  <span className="avatar">
                                    {e.name.slice(0, 1)}
                                  </span>
                                  <span>
                                    <b>{e.name}</b>
                                    {e.note && (
                                      <small className="cell-note">
                                        {e.note}
                                      </small>
                                    )}
                                  </span>
                                </span>
                              </td>
                              <td>
                                <span className="mono">{e.phone_last4}</span>
                              </td>
                              <td>
                                <b>
                                  {e.current_rate
                                    ? money(e.current_rate)
                                    : "적용 시급 없음"}
                                </b>
                              </td>
                              <td>{e.weekly_enabled ? "대상" : "제외"}</td>
                              <td>
                                {e.holiday_multiplier ??
                                  data.policy.holidayMultiplier}
                                배
                                {e.holiday_multiplier === null && (
                                  <small className="cell-note">공통 기준</small>
                                )}
                              </td>
                              <td>
                                <span
                                  className={`badge ${e.active ? "green" : ""}`}
                                >
                                  {e.active ? "재직" : "퇴사"}
                                </span>
                              </td>
                              <td>
                                <div className="row">
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      open(
                                        `${e.name} · 직원 정보`,
                                        <EmployeeForm employee={e} />,
                                      )
                                    }
                                  >
                                    정보 수정
                                  </button>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      open(
                                        `${e.name} · 월 시급`,
                                        <RateForm employee={e} />,
                                      )
                                    }
                                  >
                                    월 시급
                                  </button>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      open(
                                        `${e.name} · 하루 시급`,
                                        <DayRateForm employee={e} />,
                                      )
                                    }
                                  >
                                    하루 시급
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!employees.length && (
                        <Empty>
                          조교를 등록하면 출퇴근과 급여 관리를 시작할 수
                          있습니다.
                        </Empty>
                      )}
                    </div>
                  </section>
                </>
              )}
              {tab === "payroll" && (
                <>
                  <div className="toolbar">
                    <div className="row">
                      <button
                        className="button secondary"
                        onClick={exportPayroll}
                      >
                        <ArrowDownToLine size={16} /> CSV 내보내기
                      </button>
                      <button
                        className="button primary"
                        onClick={() => open("정산 확인", <SettlementForm />)}
                        disabled={
                          data.payroll.warnings.length > 0 ||
                          data.payroll.rows.some((r) => r.warnings.length) ||
                          !data.payroll.rows.length ||
                          to >= today
                        }
                      >
                        정산 확정
                      </button>
                    </div>
                  </div>
                  {data.payroll.warnings.map((w) => (
                    <Alert key={w}>{w}</Alert>
                  ))}
                  <div className="payroll-summary">
                    <div>
                      <p>예상 급여 · 세전</p>
                      <strong>{money(data.payroll.total)}</strong>
                    </div>
                    <div className="summary-side">
                      <span>
                        {data.payroll.rows.length}명 ·{" "}
                        {hours(
                          data.payroll.rows.reduce((n, r) => n + r.seconds, 0),
                        )}
                      </span>
                      <span className="badge">
                        {data.payroll.settlement
                          ? `확정본 v${data.payroll.settlement.version} 보존 중`
                          : "미확정"}
                      </span>
                      {data.payroll.settlement && (
                        <>
                          <small>
                            이전 확정 {money(data.payroll.settlement.total)}
                          </small>
                          <b>
                            재계산 차액 {money(data.payroll.difference || 0)}
                          </b>
                        </>
                      )}
                    </div>
                  </div>
                  <section className="panel">
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>직원</th>
                            <th>근무시간</th>
                            <th>기본급</th>
                            <th>휴일가산</th>
                            <th>야간가산</th>
                            <th>주휴수당</th>
                            <th>기타·조정</th>
                            <th>합계</th>
                            <th>상세</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.payroll.rows.map((r) => (
                            <tr key={r.employeeId}>
                              <td>
                                <b>{r.name}</b>
                                {!!r.warnings.length && (
                                  <span className="cell-note danger">
                                    확인 필요
                                  </span>
                                )}
                              </td>
                              <td>{hours(r.seconds)}</td>
                              <td>{money(r.base)}</td>
                              <td>{money(r.holiday)}</td>
                              <td>
                                {money(r.night ?? 0)}
                                <small className="cell-note">
                                  {hours(r.nightSeconds ?? 0)}
                                </small>
                              </td>
                              <td>{money(r.weekly)}</td>
                              <td>{money(r.adjustment)}</td>
                              <td>
                                <strong className="accent-text">
                                  {money(r.total)}
                                </strong>
                              </td>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() => payrollDetail(r)}
                                >
                                  계산 내역
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!data.payroll.rows.length && (
                        <Empty>계산할 근무기록이 없습니다.</Empty>
                      )}
                    </div>
                  </section>
                  <Help title="계산 기준">
                    <p className="small muted">
                      주휴수당은 설정한 한 주의 마지막 날에 귀속됩니다. 월
                      경계를 넘는 주도 전체 주의 실근무로 계산합니다. 세금·보험
                      공제 및 자동 이체는 포함하지 않습니다.
                    </p>
                  </Help>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>개인별 수당·조정</h2>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() =>
                          open("개인별 수당·조정 추가", <AdjustmentForm />)
                        }
                      >
                        <Plus size={16} /> 수당 추가
                      </button>
                    </div>
                    {data.adjustments.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>귀속일</th>
                              <th>직원</th>
                              <th>항목·사유</th>
                              <th>금액</th>
                              <th>관리</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.adjustments.map((a) => (
                              <tr key={a.id}>
                                <td>{a.date}</td>
                                <td>{a.name}</td>
                                <td>{a.reason}</td>
                                <td>{money(a.amount)}</td>
                                <td>
                                  <button
                                    className="text-button danger"
                                    onClick={() => {
                                      if (
                                        confirm(
                                          "이 수당을 삭제할까요? 변경 이력은 남습니다.",
                                        )
                                      )
                                        void mutate(
                                          `/admin/adjustments/${a.id}`,
                                          undefined,
                                          "DELETE",
                                        );
                                    }}
                                  >
                                    삭제
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty>추가 수당 없음</Empty>
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>확정한 정산</h2>
                      </div>
                    </div>
                    {data.settlements.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>기간</th>
                              <th>버전</th>
                              <th>확정 합계</th>
                              <th>확정자</th>
                              <th>사유</th>
                              <th>관리</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.settlements.map((s) => (
                              <tr key={s.id}>
                                <td>
                                  {s.date_from} ~ {s.date_to}
                                </td>
                                <td>v{s.version}</td>
                                <td>{money(s.total)}</td>
                                <td>{s.name}</td>
                                <td>{s.reason}</td>
                                <td>
                                  <div className="row">
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        setPeriod(s.date_from, s.date_to)
                                      }
                                    >
                                      기간 조회
                                    </button>
                                    <button
                                      className="text-button"
                                      onClick={() => void savedPayroll(s.id)}
                                    >
                                      확정본
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty>확정 내역 없음</Empty>
                    )}
                  </section>
                </>
              )}
              {tab === "audit" && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>최근 변경 이력</h2>
                      <p>최근 200건</p>
                    </div>
                    <ShieldCheck size={22} className="accent-text" />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>시각</th>
                          <th>수행자</th>
                          <th>변경 내용</th>
                          <th>상세</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.audit.map((a) => (
                          <tr key={a.id}>
                            <td>
                              {seoulDate(a.created_at)}{" "}
                              {formatTime(a.created_at)}
                            </td>
                            <td>{a.actor_name || "태블릿"}</td>
                            <td>{actionLabels[a.action] || a.action}</td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() =>
                                  open(
                                    "변경 이력 상세",
                                    <div className="form-body">
                                      <p>
                                        {actionLabels[a.action] || a.action} ·{" "}
                                        {a.actor_name || "태블릿"}
                                      </p>
                                      <pre className="audit-json">
                                        {JSON.stringify(
                                          JSON.parse(a.detail),
                                          null,
                                          2,
                                        )}
                                      </pre>
                                    </div>,
                                  )
                                }
                              >
                                변경 전후 보기
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {tab === "settings" && <SettingsPage />}
              {modal && (
                <Modal title={modal.title} close={close}>
                  {modal.content}
                </Modal>
              )}
            </AdminContext.Provider>
          ) : loading && !loadError ? (
            <Loading />
          ) : (
            <div className="panel">
              <Empty>데이터를 불러오지 못했습니다. 새로고침해 주세요.</Empty>
            </div>
          )}
        </main>
      </div>
      {notice && (
        <div
          role={notice.error ? "alert" : "status"}
          className={`toast ${notice.error ? "error" : ""}`}
        >
          <span>{notice.text}</span>
          <button
            aria-label="알림 닫기"
            className="icon-button"
            onClick={() => setNotice(null)}
          >
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
function SearchBox({
  value,
  set,
}: {
  value: string;
  set: (value: string) => void;
}) {
  return (
    <label className="search-box">
      <Search size={16} />
      <input
        aria-label="직원 검색"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder="직원 검색"
      />
    </label>
  );
}
