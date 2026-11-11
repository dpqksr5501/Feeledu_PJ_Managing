import React, { useEffect, useState } from "react";
import { ArrowRight, Tablet } from "lucide-react";
import type { Admin } from "../shared/types.ts";
import { api, send, ApiError } from "./api.ts";
import { Alert, Brand, Field, Loading } from "./ui.tsx";
import Kiosk from "./Kiosk.tsx";
import AdminApp from "./admin/AdminApp.tsx";
import DownloadApp from "./DownloadApp.tsx";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_HINT,
  PASSWORD_INPUT_PATTERN,
} from "../shared/password-format.ts";

function Auth({ setup, done }: { setup: boolean; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await send(setup ? "/setup" : "/login", {
        ...Object.fromEntries(form),
        sharedTablet: form.has("sharedTablet"),
      });
      done();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-form">
        <div className="auth-card">
          <Brand />
          <h1>{setup ? "운영자 등록" : "관리자 로그인"}</h1>
          <form onSubmit={submit}>
            {setup && (
              <>
                <Field label="초기 설정 코드" hint="서버 터미널의 설정 코드">
                  <input name="token" required autoComplete="off" />
                </Field>
                <Field label="운영자 이름">
                  <input
                    name="name"
                    required
                    maxLength={100}
                    autoComplete="name"
                  />
                </Field>
              </>
            )}
            <Field
              label="아이디"
              hint={setup ? "영문·숫자·밑줄·마침표·하이픈, 3~40자" : undefined}
            >
              <input
                name="username"
                required
                pattern={setup ? "[a-zA-Z0-9_.-]{3,40}" : undefined}
                maxLength={40}
                autoComplete="username"
                placeholder="관리자 아이디"
              />
            </Field>
            <Field label="비밀번호" hint={setup ? PASSWORD_HINT : undefined}>
              <input
                name="password"
                type="password"
                minLength={setup ? MIN_PASSWORD_LENGTH : undefined}
                pattern={setup ? PASSWORD_INPUT_PATTERN : undefined}
                title={setup ? PASSWORD_HINT : undefined}
                maxLength={128}
                required
                autoComplete={setup ? "new-password" : "current-password"}
                placeholder="비밀번호"
              />
            </Field>
            {error && <Alert kind="error">{error}</Alert>}
            <label className="checkbox-row">
              <input
                name="sharedTablet"
                type="checkbox"
                defaultChecked={matchMedia("(pointer: coarse)").matches}
              />
              공용 태블릿 · 2분 미사용 시 잠금
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? "확인 중…" : setup ? "운영자 계정 만들기" : "로그인"}
              <ArrowRight size={18} />
            </button>
          </form>
          <a className="auth-kiosk" href="/kiosk">
            <Tablet size={17} /> 출퇴근 화면
          </a>
        </div>
      </section>
    </main>
  );
}
export default function App() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [setup, setSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ needsSetup: boolean }>("/bootstrap");
      setSetup(result.needsSetup);
      if (!result.needsSetup)
        setAdmin(await api<Admin>("/admin/me").catch(() => null));
    } catch {
      setError("서버에 연결할 수 없습니다. 서버 실행 상태를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (
      !location.pathname.startsWith("/kiosk") &&
      location.pathname !== "/download"
    )
      void load();
  }, []);
  useEffect(() => {
    if (!admin) return;
    let timer: ReturnType<typeof setTimeout>;
    let lastPing = 0;
    let alive = true;
    const lock = () => {
      if (!alive) return;
      setAdmin(null);
      void api("/logout", {
        method: "POST",
        body: "{}",
        keepalive: true,
      }).catch(() => {});
    };
    const active = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, (admin.shared_tablet ? 2 : 30) * 60000);
      if (Date.now() - lastPing > 30000) {
        lastPing = Date.now();
        void send("/admin/activity", {}).catch((error: unknown) => {
          if (alive && error instanceof ApiError && error.status === 401)
            setAdmin(null);
        });
      }
    };
    const hidden = () => {
      if (document.hidden && admin.shared_tablet) lock();
    };
    window.addEventListener("pointerdown", active);
    window.addEventListener("keydown", active);
    document.addEventListener("visibilitychange", hidden);
    active();
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [admin]);
  if (location.pathname.startsWith("/kiosk")) return <Kiosk />;
  if (location.pathname === "/download") return <DownloadApp />;
  if (loading) return <Loading />;
  if (error)
    return (
      <div className="fatal">
        <Alert kind="error">{error}</Alert>
        <button className="button" onClick={() => void load()}>
          다시 연결
        </button>
      </div>
    );
  return admin ? (
    <AdminApp
      admin={admin}
      expired={() => setAdmin(null)}
      logout={async () => {
        await send("/logout", {});
        setAdmin(null);
      }}
    />
  ) : (
    <Auth setup={setup} done={() => void load()} />
  );
}
