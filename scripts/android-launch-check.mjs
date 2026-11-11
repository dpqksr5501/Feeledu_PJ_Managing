import { _android as android, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const adb = (...args) =>
  execFileSync("adb", args, { encoding: "utf8", timeout: 30000 });
const api = Number(adb("shell", "getprop", "ro.build.version.sdk").trim());
const component =
  "kr.feeledu.attendance/com.google.androidbrowserhelper.trusted.LauncherActivity";
const launch = (data) =>
  adb(
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.MAIN",
    "-c",
    "android.intent.category.LAUNCHER",
    "-n",
    component,
    ...(data ? ["-d", data] : []),
  );
const result = {
  api,
  browser: adb("shell", "dumpsys", "package", "com.android.chrome").match(
    /versionName=(.+)/,
  )?.[1],
  launches: 0,
};
let device, context;
try {
  if (api >= 29) {
    // Disposable emulator only: skip Chrome's welcome wizard, never TLS or origin verification.
    adb("shell", "am", "set-debug-app", "--persistent", "com.android.chrome");
    [device] = await android.devices({ omitDriverInstall: true });
    if (!device) throw new Error("No emulator connected");
    device.setDefaultTimeout(60000);
    context = await device.launchBrowser({ pkg: "com.android.chrome" });
    for (const data of [null, null, "https://untrusted.invalid/phishing"]) {
      adb("shell", "input", "keyevent", "KEYCODE_HOME");
      launch(data);
      await expect
        .poll(
          () =>
            context
              .pages()
              .filter((page) =>
                page
                  .url()
                  .startsWith(
                    "https://feeledu-attendance.feeledu-pj-managing.workers.dev/kiosk",
                  ),
              ).length,
          { timeout: 60000 },
        )
        .toBeGreaterThan(0);
      const page = context
        .pages()
        .find((page) =>
          page
            .url()
            .startsWith(
              "https://feeledu-attendance.feeledu-pj-managing.workers.dev/kiosk",
            ),
        );
      await expect(
        page.getByRole("heading", { name: "태블릿 연결", exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await expect(
        page.getByRole("textbox", { name: "태블릿 연결 코드" }),
      ).toBeVisible();
      await expect
        .poll(
          () =>
            /(?:mResumedActivity|topResumedActivity)[:=].*com\.android\.chrome\//.test(
              adb("shell", "dumpsys", "activity", "activities"),
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      await page.screenshot({
        path: `android-smoke/kiosk-launch-${result.launches + 1}.png`,
      });
      adb("shell", "screencap", "-p", "/sdcard/kiosk-foreground.png");
      adb(
        "pull",
        "/sdcard/kiosk-foreground.png",
        `android-smoke/kiosk-foreground-${result.launches + 1}.png`,
      );
      result.launches++;
    }
    result.kiosk = "PASS";
    await context.close();
    context = undefined;
  } else {
    result.kiosk = "NOT_RUN_LEGACY_CHROME";
  }
  adb("shell", "am", "force-stop", "kr.feeledu.attendance");
  adb("shell", "pm", "disable-user", "--user", "0", "com.android.chrome");
  launch();
  let xml = "";
  await expect
    .poll(
      () => {
        adb("shell", "uiautomator", "dump", "/sdcard/browser-required.xml");
        xml = adb("shell", "cat", "/sdcard/browser-required.xml");
        return xml.includes("브라우저 확인 필요") && xml.includes("다시 시도");
      },
      { timeout: 30000 },
    )
    .toBe(true);
  writeFileSync("android-smoke/browser-required.xml", xml);
  adb("shell", "screencap", "-p", "/sdcard/browser-required.png");
  adb(
    "pull",
    "/sdcard/browser-required.png",
    "android-smoke/browser-required.png",
  );
  result.missingBrowser = "PASS";
} finally {
  adb("shell", "pm", "enable", "com.android.chrome");
  adb("shell", "am", "clear-debug-app");
  await context?.close();
  await device?.close();
  writeFileSync(
    "android-smoke/launch-results.json",
    JSON.stringify(result, null, 2),
  );
}
console.log(JSON.stringify(result));
