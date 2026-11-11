import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpRight } from "lucide-react";
import { androidDownloadUrl, androidReleaseUrl } from "./app-update.ts";
import "./download.css";
import {
  parseAndroidRelease,
  type AndroidRelease,
} from "../shared/android-download.ts";

export default function DownloadApp() {
  const [release, setRelease] = useState<AndroidRelease | null>(null);
  useEffect(() => {
    document.title = "필에듀 출퇴근 · 앱 다운로드";
    const controller = new AbortController();
    void fetch("/android-release.json", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Release unavailable");
        return response.json();
      })
      .then((value) => setRelease(parseAndroidRelease(value)))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <main className="app-download-page">
      <section className="app-download-card" aria-labelledby="download-title">
        <img
          className="app-download-icon"
          src="/icon-512.png"
          alt="FEEL EDU 앱 아이콘"
          width="144"
          height="144"
        />
        <h1 id="download-title">필에듀 출퇴근</h1>
        <p className="muted">
          {release
            ? `v${release.version} · ${(release.bytes / 1024 / 1024).toFixed(2)} MB`
            : "Android 태블릿용"}
        </p>
        <a className="button primary full" href={androidReleaseUrl}>
          <ArrowUpRight size={19} /> GitHub 릴리즈 열기
        </a>
        <a
          className="button secondary full"
          href={`${androidReleaseUrl}/download/feeledu-attendance.apk`}
        >
          <ArrowDownToLine size={19} /> 최신 APK 받기
        </a>
        <ol>
          <li>릴리즈의 Assets에서 feeledu-attendance.apk 선택</li>
          <li>다운로드한 파일을 열어 설치·업데이트</li>
          <li>홈 화면의 필에듀 출퇴근 실행</li>
          <li>관리자에게 받은 8자리 코드로 연결</li>
        </ol>
        <div className="app-download-links">
          <a href={androidDownloadUrl} download>
            보조 다운로드 <ArrowDownToLine size={14} />
          </a>
          <a href="/admin">
            관리자 화면 <ArrowUpRight size={14} />
          </a>
        </div>
      </section>
    </main>
  );
}
