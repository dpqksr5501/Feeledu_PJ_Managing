import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Delete,
  Download,
  Maximize,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { RosterEntry } from "../shared/types.ts";
import { api, ApiError, download } from "./api.ts";
import { kioskStore, type Roster } from "./kiosk-store.ts";
import { SyncRetry } from "./sync-retry.ts";
import { Alert, Brand } from "./ui.tsx";
import {
  useAppUpdate,
  checkAppUpdate,
  applyAppUpdate,
  isApplyingUpdate,
  registerUpdateGuard,
} from "./app-update.ts";
import { UpdateHistoryButton } from "./UpdateCenter.tsx";
import { useAppDisplay } from "./app-display.ts";
type KioskNotice = { kind: "success" | "review" | "local"; text: string };

export default function Kiosk() {
  const appDisplay = useAppDisplay();
  const [token, setToken] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState("");
  const [roster, setRoster] = useState<Roster>({
    employees: [],
    academyName: "필에듀",
    time: "",
  });
  const [digits, setDigits] = useState("");
  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [now, setNow] = useState(new Date());
  const [pending, setPending] = useState(0);
  const pendingCount = useRef(0);
  pendingCount.current = pending;
  const [error, setError] = useState("");
  const [message, setMessage] = useState<KioskNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const flushing = useRef(false);
  const lastRosterRead = useRef(0);
  const retry = useRef(new SyncRetry());
  const update = useAppUpdate();
  const lastActivity = useRef(Date.now());
  const writing = useRef(false);
  const safeToUpdate = useRef<() => Promise<boolean>>(async () => false);
  safeToUpdate.current = async () =>
    !writing.current &&
    !busy &&
    !flushing.current &&
    !digits &&
    !selected &&
    !code &&
    loaded &&
    (await kioskStore.queue()).length === 0;
  const [revoked, setRevoked] = useState(false);
  useEffect(() => registerUpdateGuard(() => safeToUpdate.current()), []);
  useEffect(() => {
    if (message?.kind !== "success" || pending > 0) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message, pending]);
  useEffect(() => {
    void (async () => {
      try {
        setToken((await kioskStore.get<string>("token")) || "");
        const saved = await kioskStore.get<Roster>("roster");
        if (saved) setRoster(saved);
        setPending((await kioskStore.queue()).length);
      } catch {
        setError(
          "기기 저장소를 사용할 수 없습니다. 일반 Chrome 창에서 열어 주세요.",
        );
      } finally {
        setLoaded(true);
      }
    })();
  }, []);
  const refreshRoster = useCallback(async () => {
    if (!token) return;
    const data = await api<Roster>("/kiosk/roster", {
      headers: { Authorization: "Bearer " + token },
    });
    setRoster(data);
    await kioskStore.set("roster", data);
    lastRosterRead.current = Date.now();
    setOnline(true);
  }, [token]);
  const flush = useCallback(async () => {
    if (
      !token ||
      flushing.current ||
      !navigator.onLine ||
      !retry.current.ready()
    )
      return;
    flushing.current = true;
    const synchronize = async () => {
      try {
        const queue = await kioskStore.queue();
        setPending(queue.length);
        const deferredEmployees = new Set<string>();
        let deferred = false,
          attempted = false;
        for (const item of queue) {
          if (
            (item.retry_after ?? 0) > Date.now() ||
            deferredEmployees.has(item.employee_id)
          ) {
            deferredEmployees.add(item.employee_id);
            deferred = true;
            continue;
          }
          attempted = true;
          try {
            const result = await api<{ status: string; review_reason: string }>(
              "/kiosk/events",
              {
                method: "POST",
                headers: { Authorization: "Bearer " + token },
                body: JSON.stringify(item),
              },
            );
            if (
              !["accepted", "pending", "rejected"].includes(result.status) ||
              typeof result.review_reason !== "string"
            )
              throw new Error("출퇴근 응답을 확인하지 못했습니다.");
            await kioskStore.remove(item.id);
            setPending((await kioskStore.queue()).length);
            setMessage({
              kind: result.status === "accepted" ? "success" : "review",
              text:
                result.status === "accepted"
                  ? `${item.action === "in" ? "출근" : "퇴근"} 완료`
                  : `관리자 확인 대기 · ${result.review_reason}`,
            });
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) {
              // Keep an orphaned event for recovery, but do not let it block
              // unrelated employees. Preserve per-employee event ordering.
              await kioskStore.deferUnknownEmployee(item.id);
              deferredEmployees.add(item.employee_id);
              deferred = true;
              continue;
            }
            retry.current.fail(err);
            if (err instanceof ApiError) {
              setError(err.message);
              if (err.status === 401) setRevoked(true);
              return;
            }
            await kioskStore.markOffline(item.id);
            setOnline(false);
            return;
          }
        }
        if (attempted || Date.now() - lastRosterRead.current >= 60000)
          await refreshRoster();
        setError(
          deferred
            ? "직원 정보 확인이 필요한 미전송 기록이 있습니다. ‘기록 보관’ 후 관리자에게 확인해 주세요."
            : "",
        );
        retry.current.success();
      } catch (err) {
        retry.current.fail(err);
        setOnline(false);
        if (err instanceof ApiError) {
          setError(err.message);
          if (err.status === 401) setRevoked(true);
        }
      }
    };
    try {
      // Two tabs share IndexedDB. Only one tab may drain its ordered queue.
      if (navigator.locks)
        await navigator.locks.request(
          "feeledu-clock-sync",
          { ifAvailable: true },
          async (lock) => {
            if (lock) await synchronize();
          },
        );
      else await synchronize();
    } finally {
      flushing.current = false;
    }
  }, [token, refreshRoster]);
  useEffect(() => {
    void flush();
    let polls = 0;
    const timer = setInterval(() => {
      if (!document.hidden && (++polls % 4 === 0 || pendingCount.current > 0))
        void flush();
    }, 15000);
    const connected = () => void flush();
    const resumed = () => {
      if (!document.hidden) void flush();
    };
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    document.addEventListener("visibilitychange", resumed);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
      document.removeEventListener("visibilitychange", resumed);
    };
  }, [flush]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const active = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener("pointerdown", active);
    window.addEventListener("keydown", active);
    return () => {
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
    };
  }, []);
  useEffect(() => {
    if (!update.ready) return;
    const timer = setInterval(() => {
      if (!document.hidden && Date.now() - lastActivity.current >= 60000)
        void applyAppUpdate(() => safeToUpdate.current(), { automatic: true });
    }, 5000);
    return () => clearInterval(timer);
  }, [update.ready]);
  useEffect(() => {
    if (!digits && !selected) return;
    const timer = setTimeout(() => {
      setDigits("");
      setSelected(null);
      setError("");
    }, 30000);
    return () => clearTimeout(timer);
  }, [digits, selected]);
  const input = useCallback((key: string) => {
    if (isApplyingUpdate()) return;
    setMessage(null);
    setError("");
    setSelected(null);
    setDigits((value) =>
      key === "delete"
        ? value.slice(0, -1)
        : key === "clear"
          ? ""
          : (value + key).slice(0, 4),
    );
  }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        document.querySelector('[aria-modal="true"]') ||
        (e.target instanceof HTMLElement &&
          (e.target.matches("input,textarea,select") ||
            e.target.isContentEditable))
      )
        return;
      if (!token || busy || selected) return;
      if (/^\d$/.test(e.key)) input(e.key);
      if (e.key === "Backspace") input("delete");
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [token, busy, selected, input]);
  async function pair(event: React.SubmitEvent) {
    event.preventDefault();
    if (writing.current || isApplyingUpdate()) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ token: string; name: string }>("/kiosk/pair", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      await kioskStore.set("token", data.token);
      await kioskStore.set("deviceName", data.name);
      setToken(data.token);
      retry.current = new SyncRetry();
      setCode("");
      setRevoked(false);
      void navigator.storage?.persist?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function clock(action: "in" | "out") {
    if (!selected || busy || revoked || writing.current || isApplyingUpdate())
      return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      await kioskStore.enqueue({
        id: crypto.randomUUID(),
        employee_id: selected.id,
        action,
        captured_at: new Date().toISOString(),
        offline: !online,
      });
      setPending((await kioskStore.queue()).length);
      setMessage({
        kind: "local",
        text: `${action === "in" ? "출근" : "퇴근"} 기기 저장 · ${online ? "전송 중" : "전송 대기"}`,
      });
      setSelected(null);
      setDigits("");
      await flush();
    } catch {
      setError("기기에 기록을 저장하지 못했습니다. 관리자에게 알려 주세요.");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const matches =
    digits.length === 4
      ? roster.employees.filter((e) => e.phone_last4 === digits)
      : [];
  async function reconnect() {
    if (
      !confirm(
        pending
          ? "먼저 미전송 기록을 보관하고 관리자에게 파일을 전달해 복구했는지 확인해 주세요. 복구가 완료됐다면 기기에 원본을 보관한 뒤 새 연결을 시작합니다. 계속할까요?"
          : "이 태블릿을 새 연결 코드로 다시 연결할까요?",
      )
    )
      return;
    const queue = await kioskStore.queue();
    if (queue.length)
      download("출퇴근-연결해제-복구기록.json", JSON.stringify(queue, null, 2));
    await kioskStore.archiveAndUnpair();
    setToken("");
    setPending(0);
    setRevoked(false);
    setError("");
    setDigits("");
    setSelected(null);
    setRoster({ employees: [], academyName: "필에듀", time: "" });
  }
  if (!loaded) return <div className="loading">불러오는 중</div>;
  if (!window.isSecureContext)
    return (
      <main className="kiosk">
        <div className="pair-card">
          <Brand />
          <h1>HTTPS 연결 필요</h1>
          <p>기록 저장을 위해 관리자에게 HTTPS 주소를 확인하세요.</p>
          <a href="/admin">관리자 화면</a>
        </div>
      </main>
    );
  return (
    <main className="kiosk">
      <header className="kiosk-top">
        <Brand />
        <div className="row">
          <UpdateHistoryButton />
          {!appDisplay && (
            <a
              className="text-button"
              href="/download"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download size={16} /> 앱 다운로드
            </a>
          )}
          <span className={`connection ${online ? "" : "offline"}`}>
            {online ? <Wifi size={16} /> : <WifiOff size={16} />}{" "}
            {online ? "연결됨" : "오프라인"}
          </span>
          <button
            className="icon-button"
            aria-label="전체 화면"
            onClick={() =>
              document.documentElement.requestFullscreen?.().catch(() => {})
            }
          >
            <Maximize size={19} />
          </button>
        </div>
      </header>
      {!token ? (
        <div className="pair-card">
          <h1>태블릿 연결</h1>
          <p>관리자 설정에서 발급한 8자리 코드</p>
          <form onSubmit={pair}>
            <input
              aria-label="태블릿 연결 코드"
              inputMode="numeric"
              pattern="[0-9]{8}"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="0000 0000"
              required
            />
            <button className="button primary" disabled={busy}>
              연결 <ArrowRight size={18} />
            </button>
          </form>
          {error && <Alert kind="error">{error}</Alert>}
          <a href="/admin">관리자 로그인</a>
        </div>
      ) : (
        <>
          <div className="kiosk-body">
            <section className="kiosk-intro">
              <h1>출퇴근</h1>
              <div className="clock">
                {now.toLocaleTimeString("ko-KR", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Seoul",
                })}
                <span>
                  {now
                    .toLocaleTimeString("ko-KR", {
                      second: "2-digit",
                      timeZone: "Asia/Seoul",
                    })
                    .replace(/\D/g, "")}
                </span>
              </div>
              <p className="kiosk-date">
                {now.toLocaleDateString("ko-KR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                  timeZone: "Asia/Seoul",
                })}
              </p>
            </section>
            <section className="keypad-card">
              {selected ? (
                <div className="clock-confirm">
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected(null);
                      setDigits("");
                    }}
                  >
                    <ArrowLeft size={16} /> 다시 입력
                  </button>
                  <div className="avatar large">
                    {selected.name.slice(0, 1)}
                  </div>
                  <h2>{selected.name}</h2>
                  <span className={`badge ${selected.working ? "green" : ""}`}>
                    최근 상태 · {selected.working ? "근무 중" : "퇴근"}
                  </span>
                  {(!online || pending > 0) && (
                    <p className="muted">마지막 전송 기준</p>
                  )}
                  <button
                    className="button primary big"
                    disabled={busy || revoked}
                    onClick={() => void clock("in")}
                  >
                    출근 <ArrowRight size={22} />
                  </button>
                  <button
                    className="button secondary big"
                    disabled={busy || revoked}
                    onClick={() => void clock("out")}
                  >
                    퇴근 <Check size={22} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="keypad-heading">
                    <h2>휴대전화 뒷자리</h2>
                    <span>4자리 입력</span>
                  </div>
                  <div
                    className="digit-boxes"
                    aria-label={`입력한 번호 ${digits || "없음"}`}
                  >
                    {Array.from({ length: 4 }, (_, i) => (
                      <span key={i} className={digits[i] ? "filled" : ""}>
                        {digits[i] || "—"}
                      </span>
                    ))}
                  </div>
                  <div className="keypad">
                    {[
                      "1",
                      "2",
                      "3",
                      "4",
                      "5",
                      "6",
                      "7",
                      "8",
                      "9",
                      "clear",
                      "0",
                      "delete",
                    ].map((key) => (
                      <button
                        key={key}
                        disabled={busy}
                        onClick={() => input(key)}
                        aria-label={
                          key === "delete"
                            ? "한 자리 지우기"
                            : key === "clear"
                              ? "전체 지우기"
                              : key
                        }
                      >
                        {key === "delete" ? (
                          <Delete size={26} />
                        ) : key === "clear" ? (
                          <span className="key-small">초기화</span>
                        ) : (
                          key
                        )}
                      </button>
                    ))}
                  </div>
                  {digits.length === 4 && (
                    <div className="matches">
                      {matches.length ? (
                        matches.map((person) => (
                          <button
                            key={person.id}
                            className="person-match"
                            onClick={() => setSelected(person)}
                          >
                            <span className="avatar">
                              {person.name.slice(0, 1)}
                            </span>
                            <strong>{person.name}</strong>
                            <ArrowRight size={20} />
                          </button>
                        ))
                      ) : (
                        <p className="error-text">등록되지 않은 번호입니다.</p>
                      )}
                      {matches.length > 1 && <small>본인 이름 선택</small>}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
          <div className="kiosk-messages">
            {revoked && (
              <Alert kind="error">
                연결 해제 · 미전송 기록은 보관 후 관리자에게 전달하세요.{" "}
                <button
                  className="text-button"
                  onClick={() => void reconnect()}
                >
                  복구 확인 후 재연결
                </button>
              </Alert>
            )}
            {error && <Alert kind="error">{error}</Alert>}
            {message && (
              <Alert kind={message.kind === "success" ? "success" : "warning"}>
                {message.text}
              </Alert>
            )}
            {!online && (
              <Alert>오프라인 · 기기에 저장 후 재전송 · 관리자 확인 필요</Alert>
            )}
          </div>
          <footer className="kiosk-footer">
            <div className="row">
              <span className={pending ? "pending-text" : ""}>
                전송 대기 {pending}건
              </span>
              {(pending > 0 || !online) && (
                <button className="text-button" onClick={() => void flush()}>
                  <RefreshCw size={14} /> 다시 전송
                </button>
              )}
              {pending > 0 && (
                <button
                  className="text-button"
                  onClick={() =>
                    void kioskStore
                      .queue()
                      .then((q) =>
                        download(
                          "출퇴근-미전송-기록.json",
                          JSON.stringify(q, null, 2),
                        ),
                      )
                  }
                >
                  <Download size={14} /> 기록 보관
                </button>
              )}
              <button
                className="text-button"
                disabled={update.checking || update.applying}
                onClick={() =>
                  void checkAppUpdate().then((ok) => {
                    if (ok)
                      setMessage({
                        kind: "local",
                        text: "업데이트 확인 완료 · 새 버전은 준비되면 자동 적용됩니다.",
                      });
                  })
                }
              >
                업데이트 확인
              </button>
              {update.error && <span role="status">{update.error}</span>}
              {update.ready && (
                <button
                  className="text-button"
                  disabled={
                    pending > 0 ||
                    busy ||
                    update.applying ||
                    !!digits ||
                    !!selected
                  }
                  onClick={() =>
                    void applyAppUpdate(() => safeToUpdate.current())
                  }
                >
                  {update.applying ? "업데이트 중…" : "업데이트 적용"}
                </button>
              )}
              <a href="/admin">관리자</a>
            </div>
          </footer>
        </>
      )}
    </main>
  );
}
