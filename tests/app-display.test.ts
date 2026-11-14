import { afterEach, expect, test, vi } from "vitest";
import { isAppDisplay } from "../src/app-display.ts";
afterEach(() => vi.unstubAllGlobals());

test.each([
  "standalone",
  "minimal-ui",
  "fullscreen",
  "window-controls-overlay",
])("installed display mode %s hides installation promotion", (mode) => {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches: query === `(display-mode: ${mode})`,
    }),
  });
  vi.stubGlobal("document", { referrer: "" });
  vi.stubGlobal("navigator", {});
  expect(isAppDisplay()).toBe(true);
});
test.each([
  ["android-app://kr.feeledu.attendance", true],
  ["android-app://kr.feeledu.attendance/", true],
  ["android-app://kr.feeledu.attendance.other", false],
  ["android-app://other.app", false],
  ["https://example.com/?android-app://kr.feeledu.attendance", false],
  ["", false],
])("native referrer allow-list: %s", (referrer, installed) => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("document", { referrer });
  vi.stubGlobal("navigator", { userAgent: "Android Chrome" });
  expect(isAppDisplay()).toBe(installed);
});
