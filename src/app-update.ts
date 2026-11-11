import { useSyncExternalStore } from "react";

type UpdateState = {
  ready: boolean;
  applying: boolean;
  checking: boolean;
  error: string;
};
let state: UpdateState = {
  ready: false,
  applying: false,
  checking: false,
  error: "",
};
let registration: ServiceWorkerRegistration | undefined;
let started = false;
let lastCheck = 0;
const listeners = new Set<() => void>();
function publish(change: Partial<UpdateState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}
function watch(worker: ServiceWorker | null) {
  worker?.addEventListener("statechange", () => {
    if (worker.state === "installed")
      publish({ ready: !!registration?.waiting });
    if (worker.state === "activated")
      publish({ ready: !!registration?.waiting });
  });
}
export function startAppUpdates() {
  if (started || !import.meta.env.PROD || !("serviceWorker" in navigator))
    return;
  started = true;
  // Register before rendering; do not race window.load against a component's getRegistration().
  void navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .then((reg) => {
      registration = reg;
      publish({ ready: !!reg.waiting });
      watch(reg.installing);
      reg.addEventListener("updatefound", () => watch(reg.installing));
      void checkAppUpdate();
    })
    .catch(() => publish({ error: "앱 업데이트 연결을 확인해 주세요." }));
  const resume = () => {
    if (!document.hidden && Date.now() - lastCheck > 60000)
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
    publish({ ready: !!registration.waiting });
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
export async function applyAppUpdate(canReload: () => Promise<boolean>) {
  if (!registration?.waiting || state.applying) return false;
  // Lock new clock input before checking the durable queue, including in-flight writes.
  publish({ applying: true, error: "" });
  try {
    if (!(await canReload())) {
      publish({ applying: false });
      return false;
    }
    const worker = registration.waiting;
    if (!worker) {
      publish({ applying: false, ready: false });
      return false;
    }
    const changed = () => {
      clearTimeout(timer);
      location.reload();
    };
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      publish({
        applying: false,
        error: "업데이트가 지연됩니다. 잠시 후 다시 적용해 주세요.",
      });
    }, 15000);
    navigator.serviceWorker.addEventListener("controllerchange", changed, {
      once: true,
    });
    worker.postMessage("SKIP_WAITING");
    return true;
  } catch {
    publish({
      applying: false,
      error: "기록 저장 상태를 확인한 뒤 다시 적용해 주세요.",
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
