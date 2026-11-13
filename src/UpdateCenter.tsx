import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, RefreshCw, X } from "lucide-react";
import { appReleases } from "../shared/app-releases.ts";
import {
  canShowUpdateReceipt,
  cancelAppUpdate,
  closeUpdateHistory,
  openUpdateHistory,
  requestAppUpdate,
  useAppUpdate,
} from "./app-update.ts";
import { Modal } from "./ui.tsx";
import "./update-center.css";

export function UpdateHistoryButton() {
  const update = useAppUpdate();
  const count = update.receipt?.ids.length ?? 0;
  return (
    <button
      className="icon-button update-history-button"
      aria-label={count ? `업데이트 내역 · 미확인 ${count}개` : "업데이트 내역"}
      onClick={openUpdateHistory}
    >
      <Bell size={18} />
      {count > 0 && (
        <span className="update-count" aria-hidden="true">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

export default function UpdateCenter() {
  const update = useAppUpdate();
  const [receiptVisible, setReceiptVisible] = useState(false);
  const [readyDismissed, setReadyDismissed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [moreBelow, setMoreBelow] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    closeUpdateHistory(true);
    setReceiptVisible(false);
  }, []);
  const cancel = useCallback(() => cancelAppUpdate(), []);
  useEffect(() => {
    if (!update.ready) setReadyDismissed(false);
  }, [update.ready]);
  useEffect(() => {
    if (!update.receipt) {
      setReceiptVisible(false);
      return;
    }
    if (receiptVisible || update.applying || update.historyOpen) return;
    let active = true,
      checking = false;
    const show = async () => {
      if (checking || update.applying || update.historyOpen) return;
      checking = true;
      try {
        if ((await canShowUpdateReceipt()) && active) setReceiptVisible(true);
      } finally {
        checking = false;
      }
    };
    void show();
    const timer = setInterval(() => void show(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [update.receipt, update.applying, update.historyOpen, receiptVisible]);
  useEffect(() => {
    if (update.phase !== "announcing") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [update.phase]);
  const viewingCandidate =
    update.historyOpen &&
    !receiptVisible &&
    !update.receipt &&
    update.ready &&
    !!update.candidate;
  const info = viewingCandidate ? update.candidate : update.current;
  const notes =
    receiptVisible && update.receipt
      ? (info?.releases ?? appReleases).filter((note) =>
          update.receipt!.ids.includes(note.id),
        )
      : (info?.releases ?? appReleases);
  const visible = update.historyOpen || receiptVisible;
  useEffect(() => {
    if (!visible || !list.current) return;
    const element = list.current;
    element.scrollTop = 0;
    const measure = () =>
      setMoreBelow(
        element.scrollHeight - element.clientHeight - element.scrollTop > 12,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [visible, info, update.receipt]);
  if (update.phase === "announcing" || update.phase === "activating")
    return (
      <div className="update-notice-root">
        <Modal
          title={
            update.phase === "announcing"
              ? "업데이트가 있습니다"
              : "업데이트 적용 중"
          }
          close={cancel}
          dismissible={update.phase === "announcing"}
        >
          <div className="update-announcement" role="status" aria-live="polite">
            <RefreshCw
              className={update.phase === "activating" ? "spin" : ""}
              size={30}
            />
            <p>
              {update.phase === "announcing"
                ? `${Math.max(1, Math.ceil((update.announceUntil - now) / 1000))}초 후 업데이트를 적용합니다.`
                : "새 화면을 준비하고 있습니다."}
            </p>
            <small>화면이 잠시 새로고침됩니다. 출퇴근 기록은 유지됩니다.</small>
          </div>
          {update.phase === "announcing" && (
            <div className="update-actions">
              <button className="button secondary" onClick={cancel}>
                나중에
              </button>
            </div>
          )}
        </Modal>
      </div>
    );
  return (
    <div className="update-notice-root">
      {update.ready &&
        !readyDismissed &&
        !visible &&
        location.pathname !== "/download" && (
          <aside className="update-ready" role="status">
            <div>
              <strong>업데이트가 있습니다</strong>
              <small>
                {update.error || "입력과 저장을 마친 뒤 적용합니다."}
              </small>
            </div>
            <button
              className="button secondary small"
              onClick={openUpdateHistory}
            >
              변경 내역
            </button>
            <button
              className="button primary small"
              disabled={update.applying}
              onClick={() => void requestAppUpdate()}
            >
              적용
            </button>
            <button
              className="icon-button"
              aria-label="업데이트 안내 접기"
              onClick={() => setReadyDismissed(true)}
            >
              <X size={18} />
            </button>
          </aside>
        )}
      {visible && (
        <Modal
          title={
            receiptVisible
              ? "업데이트가 반영되었습니다"
              : viewingCandidate
                ? "적용할 업데이트"
                : "업데이트 내역"
          }
          close={viewingCandidate ? () => closeUpdateHistory(false) : close}
        >
          <div
            className="update-notes"
            ref={list}
            tabIndex={0}
            aria-label="업데이트 변경 내역"
            onScroll={(event) => {
              const e = event.currentTarget;
              setMoreBelow(e.scrollHeight - e.clientHeight - e.scrollTop > 12);
            }}
          >
            {!notes.length && <p>앱 파일이 최신 버전으로 갱신되었습니다.</p>}
            {notes.map((note) => (
              <article key={note.id}>
                <div className="update-release-label">
                  <time dateTime={note.date}>{note.date}</time>
                  <span>{note.id}</span>
                </div>
                <h3>{note.title}</h3>
                <ul>
                  {note.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className="update-actions">
            <small aria-hidden="true">
              {moreBelow ? "아래로 내려 더 보기 ↓" : ""}
            </small>
            {viewingCandidate ? (
              <>
                <button
                  className="button secondary"
                  onClick={() => closeUpdateHistory(false)}
                >
                  닫기
                </button>
                <button
                  className="button primary"
                  onClick={() => void requestAppUpdate()}
                >
                  업데이트 적용
                </button>
              </>
            ) : (
              <button className="button primary" onClick={close}>
                <Check size={17} /> 확인
              </button>
            )}
          </div>
          {update.error && (
            <p role="status" className="update-error">
              {update.error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
