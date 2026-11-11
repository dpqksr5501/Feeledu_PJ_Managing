import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("operator administration, paired tablet, offline reload and manager access", async ({
  browser,
}) => {
  test.setTimeout(90000);
  mkdirSync(".tmp", { recursive: true });
  const errors: string[] = [];
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const admin = await adminContext.newPage();
  admin.on("pageerror", (error) => errors.push(error.message));
  await admin.goto("/");
  await admin.getByLabel("초기 설정 코드").fill("test-only-setup-token");
  await admin.getByLabel("운영자 이름").fill("테스트 운영자");
  await admin.getByLabel("아이디", { exact: true }).fill("qa-owner");
  await admin
    .getByLabel("비밀번호", { exact: true })
    .fill("qa-owner-password-123");
  await admin.getByRole("button", { name: "운영자 계정 만들기" }).click();
  await expect(
    admin.getByRole("heading", { name: "대시보드", exact: true }),
  ).toBeVisible();
  await admin.getByRole("button", { name: "직원·시급", exact: true }).click();
  await admin.getByRole("button", { name: "조교 등록", exact: true }).click();
  let dialog = admin.getByRole("dialog");
  await dialog.getByLabel("이름", { exact: true }).fill("김조교");
  await dialog.getByLabel("휴대전화 뒷자리").fill("0012");
  await dialog.getByLabel("기본 시급 (원)").fill("12000");
  await dialog.getByLabel("시급 적용 시작일").fill("2026-01-01");
  await dialog.getByRole("button", { name: "저장하기" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(admin.getByText("0012", { exact: true })).toBeVisible();
  await admin.getByRole("button", { name: "정보 수정", exact: true }).click();
  dialog = admin.getByRole("dialog");
  await dialog.getByLabel("메모").fill("데스크 조교");
  await dialog.getByRole("button", { name: "저장하기" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(admin.getByText("데스크 조교", { exact: true })).toBeVisible();
  await admin.getByRole("button", { name: "시급 이력", exact: true }).click();
  dialog = admin.getByRole("dialog");
  await expect(dialog.getByText("최초 등록", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).click();
  await admin.getByRole("button", { name: "설정", exact: true }).click();
  await admin.getByLabel("위 산식과 적용 조건을 확인했습니다.").check();
  await admin.getByRole("button", { name: "계산 기준 저장" }).click();
  await expect(admin.getByText("확인 완료", { exact: true })).toBeVisible();
  await admin.getByRole("button", { name: "관리자 추가" }).click();
  dialog = admin.getByRole("dialog");
  await dialog.getByLabel("이름", { exact: true }).fill("테스트 부장님");
  await dialog.getByLabel("아이디").fill("qa-manager");
  await dialog
    .getByLabel("비밀번호", { exact: true })
    .fill("qa-manager-password-123");
  await dialog.getByRole("button", { name: "저장하기" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(admin.getByText("qa-manager", { exact: true })).toBeVisible();
  await admin.getByLabel("태블릿 이름").fill("데스크 태블릿");
  await admin.getByRole("button", { name: "연결 코드 발급" }).click();
  const code = (
    await admin.locator(".pairing-code strong").innerText()
  ).replaceAll(" ", "");
  const kioskContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "allow",
  });
  const kiosk = await kioskContext.newPage();
  kiosk.on("pageerror", (error) => errors.push(error.message));
  await kiosk.goto("/kiosk");
  await kiosk.getByLabel("태블릿 연결 코드").fill(code);
  await kiosk.getByRole("button", { name: "연결" }).click();
  await expect(
    kiosk.getByRole("heading", { name: "휴대전화 뒷자리" }),
  ).toBeVisible();
  async function selectPerson() {
    for (const digit of "0012")
      await kiosk.getByRole("button", { name: digit, exact: true }).click();
    await kiosk.getByRole("button", { name: "김조교" }).click();
  }
  await expect
    .poll(async () =>
      (await adminContext.request.get("/api/admin/devices"))
        .json()
        .then((d) => d.length),
    )
    .toBe(1);
  await expect
    .poll(async () =>
      kiosk.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);
  await selectPerson();
  await kiosk.getByRole("button", { name: "출근" }).click();
  await expect(kiosk.getByText("출근 완료", { exact: true })).toBeVisible();
  await expect(kiosk.getByText("전송 대기 0건", { exact: true })).toBeVisible();
  await selectPerson();
  await kiosk.getByRole("button", { name: "퇴근" }).click();
  await expect(kiosk.getByText("퇴근 완료", { exact: true })).toBeVisible();
  await expect(kiosk.getByText("전송 대기 0건", { exact: true })).toBeVisible();
  await kiosk.screenshot({
    path: ".tmp/qa-kiosk-landscape.png",
    fullPage: true,
  });
  await kiosk.setViewportSize({ width: 800, height: 1280 });
  expect(
    await kiosk.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await kiosk.screenshot({
    path: ".tmp/qa-kiosk-portrait.png",
    fullPage: true,
  });
  await kioskContext.setOffline(true);
  await kiosk.reload();
  await expect(kiosk.getByText("오프라인", { exact: true })).toBeVisible();
  await selectPerson();
  await kiosk.getByRole("button", { name: "출근" }).click();
  await expect(kiosk.getByText("전송 대기 1건", { exact: true })).toBeVisible();
  await kiosk.reload();
  await expect(kiosk.getByText("전송 대기 1건", { exact: true })).toBeVisible();
  await selectPerson();
  await kiosk.getByRole("button", { name: "퇴근" }).click();
  await expect(kiosk.getByText("전송 대기 2건", { exact: true })).toBeVisible();
  await kioskContext.setOffline(false);
  await expect(kiosk.getByText("전송 대기 0건", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await admin.getByRole("button", { name: "근무기록", exact: true }).click();
  await admin.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(admin.locator(".review-row")).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await admin
      .locator(".review-row")
      .first()
      .getByRole("button", { name: "확인·승인" })
      .click();
    dialog = admin.getByRole("dialog");
    await dialog.getByLabel("확인 사유").fill("네트워크 장애 시각 확인");
    await dialog
      .getByRole("button", { name: "기록 승인", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(admin.locator(".review-row")).toHaveCount(1 - i);
  }
  await expect(admin.locator("tbody tr")).toHaveCount(2);
  await admin.getByRole("button", { name: "기록 추가", exact: true }).click();
  dialog = admin.getByRole("dialog");
  await dialog
    .getByLabel("직원", { exact: true })
    .selectOption({ label: "김조교" });
  await dialog.getByLabel("출근 시각 (한국 시간)").fill("2026-10-26T09:00");
  await dialog.getByLabel("퇴근 시각 (한국 시간)").fill("2026-10-26T14:00");
  await dialog.getByLabel("등록·정정 사유").fill("이전 근무 누락 등록");
  await dialog.getByRole("button", { name: "저장하기" }).click();
  await expect(dialog).not.toBeVisible();
  await admin.getByRole("button", { name: "급여·수당", exact: true }).click();
  await admin.getByLabel("조회 시작일").fill("2026-10-26");
  await admin.getByLabel("조회 종료일").fill("2026-11-01");
  await expect(admin.locator(".payroll-summary strong")).toHaveText("60,000원");
  await admin.getByRole("button", { name: "수당 추가", exact: true }).click();
  dialog = admin.getByRole("dialog");
  await dialog
    .getByLabel("직원", { exact: true })
    .selectOption({ label: "김조교" });
  await dialog.getByLabel("수당·조정액 (원)").fill("10000");
  await dialog.getByLabel("항목 및 사유").fill("시험기간 추가 업무");
  await dialog.getByRole("button", { name: "저장하기" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(admin.locator(".payroll-summary strong")).toHaveText("70,000원");
  await admin.getByRole("button", { name: "정산 확정", exact: true }).click();
  dialog = admin.getByRole("dialog");
  await dialog.getByLabel("확정 사유").fill("최초 정산 검토 완료");
  await dialog.getByRole("button", { name: "정산 확정", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    admin.getByText("확정본 v1 보존 중", { exact: true }),
  ).toBeVisible();
  await admin.getByRole("button", { name: "직원·시급", exact: true }).click();
  await admin.getByRole("button", { name: "시급 이력", exact: true }).click();
  dialog = admin.getByRole("dialog");
  await dialog.getByLabel("적용 시작일").fill("2026-10-26");
  await dialog.getByLabel("새 시급 (원)").fill("13000");
  await dialog.getByLabel("변경 사유").fill("지난주 시급 인상 소급");
  await dialog.getByRole("button", { name: "저장하기" }).click();
  await expect(dialog).not.toBeVisible();
  await admin.getByRole("button", { name: "급여·수당", exact: true }).click();
  await expect(admin.locator(".payroll-summary strong")).toHaveText("75,000원");
  await expect(
    admin.getByText("재계산 차액 5,000원", { exact: true }),
  ).toBeVisible();
  await admin.getByRole("button", { name: "정산 확정", exact: true }).click();
  dialog = admin.getByRole("dialog");
  await dialog.getByLabel("확정 사유").fill("시급 인상 차액 정산");
  await dialog
    .getByRole("button", { name: "차액 정산 확정", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    admin.getByText("확정본 v2 보존 중", { exact: true }),
  ).toBeVisible();
  await admin
    .getByRole("button", { name: "확정본", exact: true })
    .last()
    .click();
  dialog = admin.getByRole("dialog");
  await expect(dialog.getByText(/확정 합계 70,000원/)).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).click();
  const downloading = admin.waitForEvent("download");
  await admin.getByRole("button", { name: "CSV 내보내기" }).click();
  expect((await downloading).suggestedFilename()).toContain(
    "2026-10-26-2026-11-01",
  );
  await admin.evaluate(() => scrollTo(0, 0));
  await admin.screenshot({ path: ".tmp/qa-payroll.png", fullPage: true });
  await admin.getByRole("button", { name: "대시보드", exact: true }).click();
  await admin.screenshot({ path: ".tmp/qa-admin.png", fullPage: true });
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await manager.goto("/");
  await manager.getByLabel("아이디", { exact: true }).fill("qa-manager");
  await manager
    .getByLabel("비밀번호", { exact: true })
    .fill("qa-manager-password-123");
  await manager.getByRole("button", { name: "로그인", exact: true }).click();
  await manager.getByRole("button", { name: "설정", exact: true }).click();
  await expect(
    manager.getByRole("heading", { name: "학원 공통 계산 기준" }),
  ).toBeVisible();
  await expect(
    manager.getByRole("button", { name: "관리자 추가" }),
  ).toHaveCount(0);
  expect(
    (await managerContext.request.get("/api/admin/accounts")).status(),
  ).toBe(403);
  // The server commits the event, but its response never reaches the tablet.
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const recordsUrl = `/api/admin/records?from=${today}&to=${today}`;
  const countBefore = (
    await (await adminContext.request.get(recordsUrl)).json()
  ).length;
  await kiosk.route(
    "**/api/kiosk/events",
    async (route) => {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.abort("connectionreset");
    },
    { times: 1 },
  );
  await selectPerson();
  await kiosk.getByRole("button", { name: "출근" }).click();
  await expect(kiosk.getByText("전송 대기 1건", { exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await adminContext.request.get(recordsUrl)).json()).length,
    )
    .toBe(countBefore + 1);
  await kiosk.reload();
  await expect(kiosk.getByText("전송 대기 0건", { exact: true })).toBeVisible();
  expect(
    (await (await adminContext.request.get(recordsUrl)).json()).length,
  ).toBe(countBefore + 1);
  expect(
    await (await adminContext.request.get("/api/admin/reviews")).json(),
  ).toHaveLength(0);
  await selectPerson();
  await kiosk.getByRole("button", { name: "퇴근" }).click();
  await expect(kiosk.getByText("퇴근 완료", { exact: true })).toBeVisible();
  await expect(kiosk.getByText("전송 대기 0건", { exact: true })).toBeVisible();
  expect(
    (await (await adminContext.request.get(recordsUrl)).json()).filter(
      (record: { ended_at: string | null }) => !record.ended_at,
    ),
  ).toHaveLength(0);
  const cachedUrls = await kiosk.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys())
        urls.push(request.url);
    return urls;
  });
  expect(cachedUrls.length).toBeGreaterThan(0);
  expect(
    cachedUrls.some((url) => new URL(url).pathname.startsWith("/api/")),
  ).toBe(false);
  // Daily overrides are separate from effective-from raises and remain visible
  // alongside holiday work on both desktop and a shared administration tablet.
  await admin.getByRole("button", { name: "직원·시급", exact: true }).click();
  await admin.getByRole("button", { name: "시급 이력", exact: true }).click();
  dialog = admin.getByRole("dialog");
  await dialog.getByLabel("적용 범위").selectOption("day");
  await dialog.getByLabel("적용 날짜").fill("2026-10-26");
  await dialog.getByLabel("새 시급 (원)").fill("20000");
  await dialog.getByLabel("변경 사유").fill("하루 특별 근무 시급");
  await dialog.getByRole("button", { name: "저장하기" }).click();
  await expect(dialog).not.toBeVisible();
  await admin.getByRole("button", { name: "설정", exact: true }).click();
  await admin.getByLabel("날짜", { exact: true }).fill("2026-10-26");
  await admin.getByLabel("휴일 이름").fill("학원 지정 휴일");
  await admin.getByRole("button", { name: "휴일 등록", exact: true }).click();
  await expect(
    admin.getByText("학원 지정 휴일", { exact: true }),
  ).toBeVisible();
  await admin.getByRole("button", { name: "근무기록", exact: true }).click();
  await admin.getByLabel("근무기록 필터").selectOption("holiday");
  await expect(admin.locator("tbody tr")).toHaveCount(1);
  await expect(admin.locator("tbody tr")).toContainText("하루 시급");
  await admin.getByLabel("근무기록 필터").selectOption("special");
  await expect(admin.locator("tbody tr")).toHaveCount(1);
  await admin.getByRole("button", { name: "급여·수당", exact: true }).click();
  await expect(admin.locator(".payroll-summary strong")).toHaveText(
    "160,000원",
  );
  await admin
    .getByRole("button", { name: "계산 내역", exact: true })
    .first()
    .click();
  dialog = admin.getByRole("dialog");
  await expect(dialog.getByText("하루 시급", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("학원 지정 휴일", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).click();
  const tabletAdminContext = await browser.newContext({
    viewport: { width: 800, height: 1280 },
    hasTouch: true,
    isMobile: true,
  });
  const tabletAdmin = await tabletAdminContext.newPage();
  tabletAdmin.on("pageerror", (error) => errors.push(error.message));
  await tabletAdmin.clock.install();
  await tabletAdmin.goto("/admin");
  await tabletAdmin.getByLabel("아이디", { exact: true }).fill("qa-manager");
  await tabletAdmin
    .getByLabel("비밀번호", { exact: true })
    .fill("qa-manager-password-123");
  await expect(
    tabletAdmin.getByRole("checkbox", { name: /공용 태블릿/ }),
  ).toBeChecked();
  await tabletAdmin
    .getByRole("button", { name: "로그인", exact: true })
    .click();
  await expect(
    tabletAdmin.getByRole("heading", { name: "대시보드", exact: true }),
  ).toBeVisible();
  expect(
    (await (await tabletAdminContext.request.get("/api/admin/me")).json())
      .shared_tablet,
  ).toBe(1);
  await tabletAdmin
    .getByRole("button", { name: "근무기록", exact: true })
    .click();
  await tabletAdmin.getByLabel("조회 시작일").fill("2026-10-26");
  await tabletAdmin.getByLabel("조회 종료일").fill("2026-11-01");
  await tabletAdmin.getByLabel("근무기록 필터").selectOption("holiday");
  await expect(tabletAdmin.locator("tbody tr")).toHaveCount(1);
  expect(
    await tabletAdmin.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await tabletAdmin.screenshot({
    path: ".tmp/qa-tablet-admin.png",
    fullPage: true,
  });
  await tabletAdmin.clock.fastForward(121000);
  await expect(
    tabletAdmin.getByRole("heading", { name: "관리자 로그인", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await tabletAdminContext.request.get("/api/admin/me")).status(),
    )
    .toBe(401);
  expect((await adminContext.request.get("/api/admin/me")).status()).toBe(200);
  await tabletAdminContext.close();
  async function demoEmployee(name: string, last4: string) {
    const response = await adminContext.request.post("/api/admin/employees", {
      data: {
        name,
        phone_last4: last4,
        active: true,
        note: "브라우저 테스트",
        weekly_enabled: true,
        holiday_multiplier: null,
        hourly_rate: 12000,
        effective_from: "2026-01-01",
      },
      headers: { "X-Requested-With": "Feeledu" },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).id as string;
  }
  const demo2 = await demoEmployee("이조교", "0022"),
    demo3 = await demoEmployee("박조교", "0033");
  const primary = (
    await (await adminContext.request.get("/api/admin/employees")).json()
  ).find((e: { name: string }) => e.name === "김조교").id;
  for (const [id, date, start, end] of [
    [primary, "02", "09:00", "14:30"],
    [primary, "04", "09:00", "13:00"],
    [demo2, "02", "11:00", "15:00"],
    [demo2, "04", "11:00", "15:00"],
    [demo2, "06", "11:00", "16:00"],
    [demo3, "03", "14:00", "19:00"],
    [demo3, "05", "14:00", "20:00"],
    [demo3, "07", "14:00", "18:00"],
  ]) {
    const saved = await adminContext.request.post("/api/admin/records", {
      headers: { "X-Requested-With": "Feeledu" },
      data: {
        employee_id: id,
        started_at: `2026-11-${date}T${start}:00+09:00`,
        ended_at: `2026-11-${date}T${end}:00+09:00`,
        break_minutes: 0,
        note: "",
        reason: "주간 시각화 테스트",
      },
    });
    expect(saved.status()).toBe(201);
  }
  await admin.getByRole("button", { name: "대시보드", exact: true }).click();
  await admin.getByLabel("주간 기준 날짜").fill("2026-11-04");
  await expect(
    admin.getByRole("article", { name: "김조교 주간 근무" }),
  ).toContainText("9시간 30분");
  await expect(
    admin.getByRole("article", { name: "이조교 주간 근무" }),
  ).toContainText("13시간");
  await expect(
    admin.getByRole("article", { name: "박조교 주간 근무" }),
  ).toContainText("시간 기준 충족");
  await admin
    .getByRole("article", { name: "이조교 주간 근무" })
    .getByRole("button", { name: /2026-11-02 근무/ })
    .click();
  dialog = admin.getByRole("dialog");
  await expect(dialog.getByText("11:00:00", { exact: true })).toBeVisible();
  await expect(dialog.getByText("15:00:00", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).click();
  await admin.getByRole("button", { name: "주간 표 보기" }).click();
  await expect(admin.locator(".attendance-week-table tbody tr")).toHaveCount(3);
  const weeklyDownload = admin.waitForEvent("download");
  await admin.getByRole("button", { name: "CSV", exact: true }).click();
  expect((await weeklyDownload).suggestedFilename()).toBe(
    "주간근무-2026-11-02-2026-11-08.csv",
  );
  await admin.getByRole("button", { name: "직원별 카드 보기" }).click();
  await admin.getByLabel("주간 직원 검색").fill("이조교");
  await expect(admin.locator(".attendance-person-card")).toHaveCount(1);
  await admin.getByLabel("주간 직원 검색").fill("");
  await admin.screenshot({
    path: ".tmp/qa-weekly-dashboard.png",
    fullPage: true,
  });
  await admin.setViewportSize({ width: 800, height: 1280 });
  expect(
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await admin.screenshot({ path: ".tmp/qa-weekly-tablet.png", fullPage: true });
  await admin
    .getByRole("article", { name: "이조교 주간 근무" })
    .getByRole("button", { name: "기록", exact: true })
    .click();
  await expect(admin.getByLabel("근무 직원 필터")).toHaveValue(demo2);
  await expect(admin.locator("tbody tr")).toHaveCount(3);
  await admin.getByRole("button", { name: "설정", exact: true }).click();
  await admin.getByRole("button", { name: "전체 백업 받기", exact: true }).click();
  dialog = admin.getByRole("dialog");
  await dialog.getByLabel("현재 비밀번호").fill("incorrect-password");
  await dialog.getByRole("button", { name: "백업 받기", exact: true }).click();
  await expect(dialog.getByText("현재 비밀번호가 일치하지 않습니다.")).toBeVisible();
  await dialog.getByLabel("현재 비밀번호").fill("qa-owner-password-123");
  const backupDownload = admin.waitForEvent("download");
  await dialog.getByRole("button", { name: "백업 받기", exact: true }).click();
  const backup = await backupDownload;
  expect(await backup.failure()).toBeNull();
  expect(backup.suggestedFilename()).toMatch(/^feeledu-\d{4}-\d{2}-\d{2}\.(db|json)$/);
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
  await managerContext.close();
  await kioskContext.close();
  await adminContext.close();
});
