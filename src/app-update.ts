import { useSyncExternalStore } from "react";
import { parseAppRelease, type AppRelease } from "../shared/app-releases.ts";
import { UpdateHistory, UPDATE_HISTORY_KEY } from "./update-history.ts";

type UpdateState = {
  ready: boolean;
  applying: boolean;
  checking: boolean;
  error: string;
  phase: "idle" | "checking" | "announcing" | "activating";
  current: AppRelease | null;
  candidate: AppRelease | null;
  receipt: { revision: string; ids: string[]; at: number } | null;
  historyOpen: boolean;
  announceUntil: number;
  deferredUntil: number;
};
let state: UpdateState = {
  ready: false,
  applying: false,
  checking: false,
  error: "",
  phase: "idle",
  current: null,
  candidate: null,
  receipt: null,
  historyOpen: false,
  announceUntil: 0,
  deferredUntil: 0,
};
let registration: ServiceWorkerRegistration | undefined;
let started = false,
  lastCheck = 0,
  attempt = 0,
  externalReady = false;
let safetyGuard: (() => Promise<boolean>) | undefined;
const history = new UpdateHistory();
const listeners = new Set<() => void>();
const dirtyForms = new WeakSet<HTMLFormElement>();
const versions = new WeakMap<ServiceWorker, Promise<AppRelease | null>>();
function publish(change: Partial<UpdateState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

export function hasOtherDialog() {
  return [...document.querySelectorAll('[aria-modal="true"]')].some(
    (dialog) => !dialog.closest(".update-notice-root"),
  );
}
export function isEditing() {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    !active.closest(".update-notice-root") &&
    (active.matches("input,select,textarea") || active.isContentEditable)
  );
}
async function safe(canReload = safetyGuard) {
  if (document.hidden || hasOtherDialog()) return false;
  if (canReload) return canReload();
  return (
    !isEditing() && ![...document.forms].some((form) => dirtyForms.has(form))
  );
}
export function registerUpdateGuard(guard: () => Promise<boolean>) {
  safetyGuard = guard;
  return () => {
    if (safetyGuard === guard) safetyGuard = undefined;
  };
}
export async function canShowUpdateReceipt() {
  return safe();
}

function readVersion(worker: ServiceWorker | null): Promise<AppRelease | null> {
  if (!worker) return Promise.resolve(null);
  const previous = versions.get(worker);
  if (previous) return previous;
  const pending = new Promise<AppRelease | null>((resolve) => {
    const channel = new MessageChannel();
    let done = false;
    const finish = (value: AppRelease | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 1500);
    channel.port1.onmessage = (event) => finish(parseAppRelease(event.data));
    try {
      worker.postMessage("GET_APP_RELEASE", [channel.port2]);
    } catch {
      finish(null);
    }
  });
  versions.set(worker, pending);
  return pending;
}
async function synchronizeVersions() {
  const waiting = registration?.waiting;
  const candidate = waiting
    ? await readVersion(waiting)
    : externalReady
      ? await readVersion(navigator.serviceWorker.controller)
      : null;
  if (!state.current && !state.applying) {
    const current = await readVersion(
      navigator.serviceWorker.controller ?? registration?.active ?? null,
    );
    if (current) publish({ current, receipt: history.arrive(current) });
  }
  publish({ ready: !!waiting || externalReady, candidate });
}
function watch(worker: ServiceWorker | null) {
  worker?.addEventListener("statechange", () => {
    if (["installed", "activated", "redundant"].includes(worker.state))
      void synchronizeVersions();
  });
}
export function startAppUpdates() {
  if (started || !import.meta.env.PROD || !("serviceWorker" in navigator))
    return;
  started = true;
  document.addEventListener(
    "input",
    (event) => {
      const form = (event.target as HTMLElement)?.closest?.("form");
      if (form) dirtyForms.add(form);
    },
    true,
  );
  document.addEventListener(
    "change",
    (event) => {
      const form = (event.target as HTMLElement)?.closest?.("form");
      if (form) dirtyForms.add(form);
    },
    true,
  );
  document.addEventListener(
    "reset",
    (event) => {
      if (event.target instanceof HTMLFormElement)
        dirtyForms.delete(event.target);
    },
    true,
  );
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (state.applying) return;
    if (state.current) externalReady = true;
    void synchronizeVersions();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === UPDATE_HISTORY_KEY && state.current) {
      const receipt = history.read().receipt;
      publish({
        receipt: receipt?.revision === state.current.revision ? receipt : null,
      });
    }
  });
  void navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .then(async (reg) => {
      registration = reg;
      watch(reg.installing);
      reg.addEventListener("updatefound", () => watch(reg.installing));
      await synchronizeVersions();
      if (!reg.installing && !reg.waiting) void checkAppUpdate();
    })
    .catch(() => publish({ error: "앱 업데이트 연결을 확인해 주세요." }));
  const resume = () => {
    if (!document.hidden && navigator.onLine && Date.now() - lastCheck > 60000)
      void checkAppUpdate();
  };
  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", resume);
  setInterval(resume, 5 * 60000);
}
export async function checkAppUpdate() {
  if (!registration || state.checking) return false;
  publish({ checking: true, error: "" });
  lastCheck = Date.now();
  try {
    await registration.update();
    await synchronizeVersions();
    return true;
  } catch {
    publish({ error: "서버에 연결한 뒤 다시 확인해 주세요." });
    return false;
  } finally {
    publish({ checking: false });
  }
}
export function isApplyingUpdate() {
  return state.applying;
}
export function cancelAppUpdate() {
  if (state.phase !== "announcing") return;
  attempt++;
  history.cancel();
  publish({
    applying: false,
    phase: "idle",
    deferredUntil: Date.now() + 10 * 60000,
  });
}
export function openUpdateHistory() {
  publish({ historyOpen: true });
}
export function closeUpdateHistory(acknowledge = false) {
  if (acknowledge && state.current) history.acknowledge(state.current);
  publish({ historyOpen: false, ...(acknowledge ? { receipt: null } : {}) });
}
export async function requestAppUpdate() {
  return applyAppUpdate(() => safe());
}
export async function applyAppUpdate(
  canReload: () => Promise<boolean>,
  options: { automatic?: boolean } = {},
) {
  if (
    (!registration?.waiting && !externalReady) ||
    state.applying ||
    (options.automatic && Date.now() < state.deferredUntil)
  )
    return false;
  const id = ++attempt;
  let cleanup = () => {};
  publish({ applying: true, phase: "checking", error: "" });
  try {
    if (!(await safe(canReload))) {
      publish({
        applying: false,
        phase: "idle",
        ...(!options.automatic
          ? {
              error:
                "작성 중인 화면을 저장하거나 닫고, 미전송 기록을 확인한 뒤 적용해 주세요.",
            }
          : {}),
      });
      return false;
    }
    const worker = registration?.waiting;
    let target =
      state.candidate ??
      (await readVersion(worker ?? navigator.serviceWorker.controller));
    if (!target) {
      try {
        target = parseAppRelease(
          await (
            await fetch("/app-release.json", {
              cache: "no-store",
              signal: AbortSignal.timeout(5000),
            })
          ).json(),
        );
      } catch {
        /* No false success without validated metadata. */
      }
    }
    if (!target) throw Error("metadata unavailable");
    publish({
      candidate: target,
      phase: "announcing",
      announceUntil: Date.now() + 5000,
      historyOpen: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    if (id !== attempt) return false;
    if (!(await safe(canReload))) {
      publish({
        applying: false,
        phase: "idle",
        error: "입력 또는 미전송 기록이 있어 업데이트를 미뤘습니다.",
      });
      return false;
    }
    history.begin(target, state.current ?? undefined);
    publish({ phase: "activating" });
    if (!worker && externalReady) {
      location.reload();
      return true;
    }
    if (!worker || worker.state === "redundant") throw Error("worker changed");
    const changed = () => {
      cleanup();
      location.reload();
    };
    const timer = setTimeout(() => {
      cleanup();
      history.cancel();
      publish({
        applying: false,
        phase: "idle",
        error:
          "업데이트가 지연됩니다. 기록은 유지되며 잠시 후 다시 적용할 수 있습니다.",
      });
    }, 15000);
    cleanup = () => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed, {
      once: true,
    });
    worker.postMessage("SKIP_WAITING");
    return true;
  } catch {
    cleanup();
    history.cancel();
    publish({
      applying: false,
      phase: "idle",
      error:
        "업데이트를 완료하지 못했습니다. 기록 저장 상태와 연결을 확인해 주세요.",
    });
    return false;
  }
}
export function useAppUpdate() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}
export const androidReleaseUrl =
  "https://github.com/dpqksr5501/Feeledu_PJ_Managing/releases/latest";
export const androidDownloadUrl = "/downloads/feeledu-attendance.apk";
