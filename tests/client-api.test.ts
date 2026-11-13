import { afterEach, test, expect, vi } from "vitest";
import { api, ApiError } from "../src/api.ts";
afterEach(() => vi.unstubAllGlobals());
test("older Chrome without AbortSignal.any still supports cancellation and releases listeners", async () => {
  const original = AbortSignal;
  vi.stubGlobal("AbortSignal", {
    timeout: original.timeout.bind(original),
    any: undefined,
  });
  let supplied: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_path, options) => {
      supplied = options.signal;
      if (supplied!.aborted) throw supplied!.reason;
      return Response.json({ ok: true });
    }),
  );
  const external = new AbortController();
  await expect(
    api("/admin/settings", { signal: external.signal }),
  ).resolves.toEqual({ ok: true });
  external.abort();
  expect(supplied!.aborted).toBe(false);
  await expect(
    api("/admin/settings", { signal: external.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});
test("an HTML/empty success response cannot acknowledge or erase a queued clock event", async () => {
  for (const body of ["<html>proxy</html>", ""]) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );
    await expect(api("/kiosk/events", { method: "POST" })).rejects.toThrow(
      /서버 응답/,
    );
  }
});
test("client retains the server's retry window on overload", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response('{"error":"busy"}', {
        status: 429,
        headers: { "Retry-After": "120", "Content-Type": "application/json" },
      }),
    ),
  );
  try {
    await api("/kiosk/events", { method: "POST" });
    throw new Error("expected overload");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 120000 });
  }
});
