import { test, expect } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";

test("ten years of history keeps indexed Cloudflare row reads bounded and results unchanged", async () => {
  const bundled = await build({
    entryPoints: ["tests/fixtures/query-cost.worker.mjs"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    external: ["cloudflare:*", "node:*"],
    target: "es2023",
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: "2026-11-08",
      compatibilityFlags: ["nodejs_compat"],
      outboundService: async (request) => {
        const url = new URL(request.url);
        expect(url.origin + url.pathname).toBe(
          "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo",
        );
        const month = url.searchParams.get("solMonth")!;
        const dates = [
          "01-01",
          "03-01",
          "05-05",
          "06-06",
          "08-15",
          "10-03",
          "10-09",
          "12-25",
        ].filter((date) => date.startsWith(month));
        const items = dates
          .map(
            (date) =>
              `<item><locdate>2026${date.replace("-", "")}</locdate><dateName>공휴일</dateName><isHoliday>Y</isHoliday></item>`,
          )
          .join("");
        return new Response(
          `<response><header><resultCode>00</resultCode></header><body><items>${items}</items><pageNo>1</pageNo><numOfRows>100</numOfRows><totalCount>${dates.length}</totalCount></body></response>`,
        );
      },
      durableObjects: {
        BENCHMARK: { className: "QueryBenchmark", useSQLite: true },
      },
    }),
  );
  try {
    const response = await mf.dispatchFetch("http://localhost/benchmark");
    expect(
      response.status,
      response.ok ? undefined : await response.clone().text(),
    ).toBe(200);
    const result = (await response.json()) as {
      equivalent: boolean;
      calendarSynced: boolean;
      before: Record<string, { reads: number; writes: number }>;
      after: Record<string, { reads: number; writes: number }>;
    };
    console.info("Isolated Workerd SQL row costs:", JSON.stringify(result));
    mkdirSync(".tmp", { recursive: true });
    writeFileSync(".tmp/query-cost.json", JSON.stringify(result, null, 2));
    expect(result.equivalent).toBe(true);
    expect(result.calendarSynced).toBe(true);
    for (const key of [
      "overlap",
      "week",
      "payroll",
      "records",
      "reviews",
      "audit",
    ]) {
      expect(result.after[key].reads).toBeLessThan(
        result.before[key].reads / 10,
      );
      expect(result.after[key].writes).toBe(0);
    }
  } finally {
    await mf.dispose();
  }
}, 60000);
