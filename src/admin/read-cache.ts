export class AdminReadCache {
  private values = new Map<string, { value: unknown; expires: number }>();
  private pending = new Map<
    string,
    { promise: Promise<unknown>; controller: AbortController }
  >();
  constructor(now: () => number = Date.now, limit = 32) {
    this.now = now;
    this.limit = limit;
  }
  private now: () => number;
  private limit: number;
  peek<T>(key: string): T | undefined {
    return this.values.get(key)?.value as T | undefined;
  }
  get<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    ttl = 60000,
  ): Promise<T> {
    const saved = this.values.get(key);
    if (saved && saved.expires > this.now()) {
      this.values.delete(key);
      this.values.set(key, saved);
      return Promise.resolve(saved.value as T);
    }
    const current = this.pending.get(key);
    if (current) return current.promise as Promise<T>;
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => load(controller.signal))
      .then((value) => {
        if (
          this.pending.get(key)?.promise === promise &&
          !controller.signal.aborted
        ) {
          this.values.delete(key);
          this.values.set(key, { value, expires: this.now() + ttl });
          while (this.values.size > this.limit)
            this.values.delete(this.values.keys().next().value!);
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(key)?.promise === promise)
          this.pending.delete(key);
      });
    this.pending.set(key, { promise, controller });
    return promise;
  }
  invalidate(resources?: string[]) {
    const matches = (key: string) =>
      !resources || resources.some((name) => key.startsWith(name + ":"));
    for (const [key, value] of this.values) if (matches(key)) value.expires = 0;
    for (const [key, value] of this.pending)
      if (matches(key)) {
        this.pending.delete(key);
        value.controller.abort();
      }
  }
  retain(keys: string[]) {
    for (const [key, value] of this.pending)
      if (!keys.includes(key)) {
        this.pending.delete(key);
        value.controller.abort();
      }
  }
  clear() {
    for (const value of this.pending.values()) value.controller.abort();
    this.pending.clear();
    this.values.clear();
  }
  get size() {
    return this.values.size;
  }
}
