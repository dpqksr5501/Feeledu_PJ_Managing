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
    "-f",
    "0x10200000",
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
const chromeInstalled = adb(
  "shell",
  "pm",
  "path",
  "com.android.chrome",
).includes("package:");
const chromeMajor = Number(result.browser?.split(".")[0] || 0);
const saveResult = () =>
  writeFileSync(
    "android-smoke/launch-results.json",
    JSON.stringify(result, null, 2),
  );
saveResult();
console.log(
  "Browser fixture:",
  JSON.stringify({ api, chromeInstalled, version: result.browser }),
);
async function recovery(name) {
  let xml = "";
  try {
    await expect
      .poll(
        () => {
          adb("shell", "uiautomator", "dump", "/sdcard/browser-required.xml");
          xml = adb("shell", "cat", "/sdcard/browser-required.xml");
          return (
            xml.includes("브라우저 확인 필요") && xml.includes("다시 시도")
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
  } finally {
    writeFileSync(`android-smoke/${name}.xml`, xml);
    adb("shell", "screencap", "-p", "/sdcard/browser-required.png");
    adb("pull", "/sdcard/browser-required.png", `android-smoke/${name}.png`);
  }
}
try {
  if (api >= 35 && (!chromeInstalled || chromeMajor < 103))
    throw new Error(
      "Modern Android fixtures must exercise the actual kiosk, not just a recovery screen",
    );
  if (chromeInstalled && chromeMajor >= 103) {
    result.stage = "browser-connection";
    saveResult();
    // Disposable emulator only: skip Chrome's welcome wizard, never TLS or origin verification.
    adb("shell", "am", "set-debug-app", "--persistent", "com.android.chrome");
    [device] = await android.devices({ omitDriverInstall: true });
    if (!device) throw new Error("No emulator connected");
    device.setDefaultTimeout(60000);
    context = await device.launchBrowser({ pkg: "com.android.chrome" });
    result.stage = "kiosk-launch";
    saveResult();
    for (const data of [null, null, "https://untrusted.invalid/phishing"]) {
      adb("shell", "input", "keyevent", "KEYCODE_HOME");
      await expect
        .poll(
          () =>
            /(?:mResumedActivity|topResumedActivity)[:=].*(?:com\.google\.android\.apps\.nexuslauncher|com\.android\.launcher3)\//.test(
              adb("shell", "dumpsys", "activity", "activities"),
            ),
          { timeout: 15000 },
        )
        .toBe(true);
      // Wait for the home transition to settle before simulating a launcher tap.
      adb("shell", "uiautomator", "dump", "/sdcard/home.xml");
      result.lastLaunch = launch(data);
      let xml = "";
      try {
        // Custom Tabs aren't consistently exposed as pages by older Chrome DevTools.
        // Inspect the real foreground Android accessibility tree instead of a background tab.
        await expect
          .poll(
            () => {
              adb("shell", "uiautomator", "dump", "/sdcard/kiosk.xml");
              xml = adb("shell", "cat", "/sdcard/kiosk.xml");
              return (
                xml.includes("태블릿 연결") && xml.includes("태블릿 연결 코드")
              );
            },
            { timeout: 60000 },
          )
          .toBe(true);
      } finally {
        writeFileSync(
          `android-smoke/kiosk-launch-${result.launches + 1}.xml`,
          xml,
        );
        adb("shell", "screencap", "-p", "/sdcard/kiosk-foreground.png");
        adb(
          "pull",
          "/sdcard/kiosk-foreground.png",
          `android-smoke/kiosk-foreground-${result.launches + 1}.png`,
        );
      }
      await expect
        .poll(
          () =>
            /(?:mResumedActivity|topResumedActivity)[:=].*com\.android\.chrome\//.test(
              adb("shell", "dumpsys", "activity", "activities"),
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      result.launches++;
    }
    result.kiosk = "PASS";
    await context.close();
    context = undefined;
  } else {
    result.kiosk = "NOT_RUN_UNSUPPORTED_IMAGE_BROWSER";
    launch();
    await recovery("unsupported-browser");
    result.unsupportedBrowser = "PASS";
  }
  adb("shell", "am", "force-stop", "kr.feeledu.attendance");
  if (chromeInstalled)
    adb("shell", "pm", "disable-user", "--user", "0", "com.android.chrome");
  launch();
  await recovery("browser-required");
  result.missingBrowser = "PASS";
  result.stage = "complete";
} finally {
  if (chromeInstalled) adb("shell", "pm", "enable", "com.android.chrome");
  adb("shell", "am", "clear-debug-app");
  await context?.close();
  await device?.close();
  saveResult();
}
console.log(JSON.stringify(result));
