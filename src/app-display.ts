import { useEffect, useState } from "react";

const modes = [
  "standalone",
  "minimal-ui",
  "fullscreen",
  "window-controls-overlay",
];
const nativeReferrer = "android-app://kr.feeledu.attendance";

/** Presentation only; never use installation detection for authentication. */
export function isAppDisplay() {
  const referrer = document.referrer;
  return (
    referrer === nativeReferrer ||
    referrer.startsWith(nativeReferrer + "/") ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    modes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
  );
}

export function useAppDisplay() {
  const [installed, setInstalled] = useState(isAppDisplay);
  useEffect(() => {
    const queries = modes.map((mode) =>
      window.matchMedia(`(display-mode: ${mode})`),
    );
    const changed = () => setInstalled(isAppDisplay());
    const installed = () => setInstalled(true);
    for (const query of queries) query.addEventListener("change", changed);
    window.addEventListener("appinstalled", installed);
    return () => {
      for (const query of queries) query.removeEventListener("change", changed);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  return installed;
}
