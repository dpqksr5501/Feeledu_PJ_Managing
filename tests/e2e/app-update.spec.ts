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
    await page.clock.install();
    await page.goto("/download");
    await expect(
      page.getByRole("heading", { name: "필에듀 출퇴근", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "FEEL EDU 앱 아이콘" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "보조 다운로드", exact: true }),
    ).toHaveAttribute("href", "/downloads/feeledu-attendance.apk");
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
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), {
        timeout: 15000,
      })
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const history = JSON.parse(
            localStorage.getItem("feeledu-app-updates-v1") || "{}",
          );
          return Boolean(history.seen?.revision);
        }),
      )
      .toBe(true);
    // First-install claiming and repeated same-controller events are not updates.
    await page.evaluate(async () => {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await expect(
      page.getByRole("button", { name: "적용", exact: true }),
    ).not.toBeVisible();
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
    const metadata = JSON.parse(readFileSync("dist/app-release.json", "utf8"));
    const revision = randomUUID().replaceAll("-", "").slice(0, 16);
    const notes = [2, 1].map((number) => ({
      id: "qa-update-" + number,
      date: "2026-11-13",
      title: `테스트 업데이트 ${number}`,
      changes: Array.from(
        { length: 10 },
        (_, index) =>
          `변경 ${index + 1}: 여러 항목의 업데이트 내역을 안전하게 확인합니다.`,
      ),
    }));
    const next = {
      ...metadata,
      revision,
      releaseId: notes[0].id,
      releases: [...notes, ...metadata.releases],
    };
    writeFileSync(
      "dist/sw.js",
      original
        .replace(/const CACHE='[^']+';/, `const CACHE='feeledu-${revision}';`)
        .replace(
          /const RELEASE=.*;\n/,
          "const RELEASE=" + JSON.stringify(next) + ";\n",
        ),
    );
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
    await page.clock.runFor(65000);
    expect(
      await page.evaluate(
        async () =>
          !!(await navigator.serviceWorker.getRegistration())?.waiting,
      ),
    ).toBe(true);
    const editing = await page.context().newPage();
    await editing.goto("/admin");
    await editing.getByLabel("개발자 이름").fill("작성 중인 관리자 양식");
    await editing.getByRole("button", { name: "적용", exact: true }).click();
    await expect(
      editing.getByText(/작성 중인 화면을 저장하거나 닫고/),
    ).toBeVisible();
    await expect(
      editing.getByRole("dialog", { name: "업데이트가 있습니다", exact: true }),
    ).not.toBeVisible();
    await page.bringToFront();
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
    await page.clock.runFor(6000);
    let notice = page.getByRole("dialog", {
      name: "업데이트가 있습니다",
      exact: true,
    });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "나중에", exact: true }).click();
    await page.clock.runFor(65000);
    await expect(notice).not.toBeVisible();
    expect(
      await page.evaluate(
        async () =>
          !!(await navigator.serviceWorker.getRegistration())?.waiting,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "적용", exact: true }).click();
    await expect(notice).toBeVisible();
    const reload = page.waitForEvent("load");
    await page.clock.runFor(6000);
    await reload;
    notice = page.getByRole("dialog", {
      name: "업데이트가 반영되었습니다",
      exact: true,
    });
    await expect(notice).toBeVisible();
    // Another tab's activation must not reload a dirty administrator form.
    await expect(editing.getByLabel("개발자 이름")).toHaveValue(
      "작성 중인 관리자 양식",
    );
    await editing.close();
    await expect(
      notice.getByRole("heading", { name: "테스트 업데이트 2" }),
    ).toBeVisible();
    await expect(
      notice.getByRole("heading", { name: "테스트 업데이트 1" }),
    ).toBeAttached();
    await page.setViewportSize({ width: 375, height: 667 });
    const scroller = notice.getByLabel("업데이트 변경 내역");
    expect(
      await scroller.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".tmp/qa-update-notice.png",
      fullPage: true,
    });
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await notice.getByRole("button", { name: "확인", exact: true }).click();
    await page.reload();
    await expect(notice).not.toBeVisible();
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
