import { test, expect } from "vitest";
import { SyncRetry } from "../src/sync-retry.ts";
import { ApiError } from "../src/api.ts";

test("repeated clicks cannot bypass backoff, server Retry-After or a revoked token", () => {
  const gate = new SyncRetry();
  gate.fail(new Error("network"), 0);
  expect(gate.ready(14999)).toBe(false);
  expect(gate.ready(15000)).toBe(true);
  gate.fail(new ApiError("busy", 429, 90000), 15000);
  expect(gate.ready(104999)).toBe(false);
  expect(gate.ready(105000)).toBe(true);
  gate.success();
  expect(gate.ready(105000)).toBe(true);
  gate.fail(new ApiError("conflict", 409), 105000);
  expect(gate.ready(404999)).toBe(false);
  expect(gate.ready(405000)).toBe(true);
  gate.fail(new ApiError("revoked", 401), 405000);
  expect(gate.ready(Number.MAX_SAFE_INTEGER)).toBe(false);
});

test("long outages cap retries at five minutes and a fresh pairing has its own gate", () => {
  const gate = new SyncRetry();
  for (let i = 0; i < 100; i++) gate.fail(new Error("network"), 0);
  expect(gate.ready(299999)).toBe(false);
  expect(gate.ready(300000)).toBe(true);
  expect(new SyncRetry().ready(0)).toBe(true);
});
