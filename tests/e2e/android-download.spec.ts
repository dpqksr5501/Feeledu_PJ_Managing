import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("installed TWA hides the download promotion across reloads while a normal Android browser keeps it", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/142.0.0.0 Mobile Safari/537.36",
  });
  await page.goto("/kiosk");
  await expect(
    page.getByRole("link", { name: "앱 다운로드", exact: true }),
  ).toBeVisible();
  await page.addInitScript(() =>
    Object.defineProperty(document, "referrer", {
      configurable: true,
      get: () => "android-app://kr.feeledu.attendance/",
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "태블릿 연결", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "앱 다운로드", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "태블릿 연결", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "앱 다운로드", exact: true }),
  ).toHaveCount(0);
});

test("Chrome finishes the first-party APK download and HTTP byte ranges resume the same file", async ({
  page,
}) => {
  const metadata = await page.request
    .get("/android-release.json")
    .then((r) => r.json());
  await page.goto("/download");
  await expect(
    page.getByRole("link", { name: "GitHub 릴리즈 열기", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://github.com/dpqksr5501/Feeledu_PJ_Managing/releases/latest",
  );
  await expect(
    page.getByRole("link", { name: "최신 APK 받기", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://github.com/dpqksr5501/Feeledu_PJ_Managing/releases/latest/download/feeledu-attendance.apk",
  );
  const completed = page.waitForEvent("download");
  await page.getByRole("link", { name: "보조 다운로드", exact: true }).click();
  const download = await completed;
  const path = await download.path();
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toBe(metadata.filename);
  expect(new URL(download.url()).origin).toBe(new URL(page.url()).origin);
  const bytes = readFileSync(path!);
  expect(bytes.length).toBe(metadata.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    metadata.sha256,
  );
  const range = await page.request.get("/downloads/feeledu-attendance.apk", {
    headers: { Range: "bytes=0-127", "If-Match": `"${metadata.sha256}"` },
  });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-length"]).toBe("128");
  expect(await range.body()).toEqual(bytes.subarray(0, 128));
  const head = await page.request.head("/downloads/feeledu-attendance.apk");
  expect(head.headers()["content-length"]).toBe(String(bytes.length));
  expect(head.headers()["content-type"]).toBe(
    "application/vnd.android.package-archive",
  );
  const wrong = await page.request.get("/downloads/not-an-apk.apk");
  expect(wrong.status()).toBe(404);
});
