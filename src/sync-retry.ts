import { ApiError } from "./api.ts";

/** Shared gate for automatic and user-triggered sends; clicks cannot bypass it. */
export class SyncRetry {
  private failures = 0;
  private retryAt = 0;
  private stopped = false;
  ready(now = Date.now()) {
    return !this.stopped && now >= this.retryAt;
  }
  success() {
    this.failures = 0;
    this.retryAt = 0;
  }
  fail(error: unknown, now = Date.now()) {
    if (error instanceof ApiError && error.status === 401) this.stopped = true;
    const permanent =
      error instanceof ApiError && [400, 403, 404, 409].includes(error.status);
    const delay = permanent
      ? 300000
      : Math.min(300000, 15000 * 2 ** Math.min(this.failures++, 5));
    this.retryAt =
      now + Math.max(delay, error instanceof ApiError ? error.retryAfterMs : 0);
  }
}
