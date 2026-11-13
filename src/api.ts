export class ApiError extends Error {
  status: number;
  retryAfterMs: number;
  constructor(message: string, status: number, retryAfterMs = 0) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Feeledu",
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => {
    // A proxy's HTML/empty 200 response is not a server acknowledgement.
    if (response.ok)
      throw new Error("서버 응답을 확인하지 못했습니다. 다시 연결합니다.");
    return {};
  });
  if (!response.ok)
    throw new ApiError(
      body.error || "요청을 처리하지 못했습니다.",
      response.status,
      Math.max(
        0,
        Math.min(
          3600000,
          Number(response.headers.get("Retry-After")) * 1000 || 0,
        ),
      ),
    );
  return body as T;
}
export function send<T>(path: string, body: unknown, method = "POST") {
  return api<T>(path, { method, body: JSON.stringify(body) });
}
export function download(
  name: string,
  text: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
