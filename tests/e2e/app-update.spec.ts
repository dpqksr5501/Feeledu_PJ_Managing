import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

test("an installed shell preserves its offline queue across a safe idle update", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !!baseURL?.includes(":4175"),
    "Cloudflare asset watcher reloads on local file edits; the shared SW protocol is exercised on Node.",
  );
  test.setTimeout(60000);
  const original = readFileSync("dist/sw.js", "utf8");
  try {
    await page.goto("/download");
    await expect(
      page.getByRole("heading", { name: "필에듀 출퇴근", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "FEEL EDU 앱 아이콘" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "APK 다운로드", exact: true }),
    ).toHaveAttribute(
      "href",
      "https://github.com/dpqksr5501/Feeledu_PJ_Managing/releases/latest/download/feeledu-attendance.apk",
    );
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".tmp/qa-download-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/kiosk");
    await expect(
      page.getByRole("link", { name: "앱 다운로드" }),
    ).toHaveAttribute("href", "/download");
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    const association = await page.request.get("/.well-known/assetlinks.json");
    expect(association.status()).toBe(200);
    expect((await association.json())[0].target.package_name).toBe(
      "kr.feeledu.attendance",
    );
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("feeledu-kiosk-v1", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(["queue", "meta"], "readwrite");
      tx.objectStore("queue").put({ id: "update-queue-test", seq: 1 });
      tx.objectStore("meta").put("preserve-this", "qa-update-marker");
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    });
    writeFileSync("dist/sw.js", original + "\n// update-test-" + randomUUID());
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())!.update();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting,
        ),
      )
      .toBe(true);
    // Advance the page's idle timer; a durable queued event must prevent activation/reload.
    await page.clock.install();
    await page.clock.runFor(65000);
    expect(
      await page.evaluate(
        async () =>
          !!(await navigator.serviceWorker.getRegistration())?.waiting,
      ),
    ).toBe(true);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("feeledu-kiosk-v1", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction("queue", "readwrite");
      tx.objectStore("queue").delete("update-queue-test");
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    });
    const reload = page.waitForEvent("load");
    await page.clock.runFor(6000);
    await reload;
    await expect(
      page.getByRole("heading", { name: "태블릿 연결", exact: true }),
    ).toBeVisible();
    const marker = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("feeledu-kiosk-v1", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const value = await new Promise((resolve) => {
        const request = db
          .transaction("meta")
          .objectStore("meta")
          .get("qa-update-marker");
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return value;
    });
    expect(marker).toBe("preserve-this");
  } finally {
    writeFileSync("dist/sw.js", original);
  }
});
