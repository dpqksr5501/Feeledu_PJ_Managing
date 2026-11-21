import { expect, test } from "vitest";
import { migrationText } from "../cloudflare/migration-body.ts";

test("bounds streamed UTF-8 migration requests by bytes and preserves split characters", async () => {
  const chars = new TextEncoder().encode("조교");
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(chars.subarray(0, 2));
      controller.enqueue(chars.subarray(2));
      controller.close();
    },
  });
  expect(await migrationText({ body, headers: new Headers() }, 6)).toBe("조교");
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(chars);
    },
    cancel() {
      cancelled = true;
    },
  });
  expect(
    await migrationText({ body: oversized, headers: new Headers() }, 5),
  ).toBeNull();
  expect(cancelled).toBe(true);
  await expect(
    migrationText(new Response(new Uint8Array([0xff])), 5),
  ).rejects.toThrow();
});
