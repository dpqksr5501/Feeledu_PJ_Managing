export const APK_PATH = "/downloads/feeledu-attendance.apk";
export const APK_TYPE = "application/vnd.android.package-archive";
export type AndroidRelease = {
  version: string;
  bytes: number;
  sha256: string;
  filename: string;
  releaseUrl: string;
};

export function parseAndroidRelease(value: unknown): AndroidRelease {
  const row = value as Partial<AndroidRelease> | null;
  if (
    !row ||
    !/^\d+\.\d+\.\d+$/.test(row.version || "") ||
    !Number.isSafeInteger(row.bytes) ||
    row.bytes! < 4 ||
    row.bytes! > 25 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(row.sha256 || "") ||
    row.filename !== `feeledu-attendance-${row.version}.apk` ||
    row.releaseUrl !==
      `https://github.com/dpqksr5501/Feeledu_PJ_Managing/releases/tag/android-v${row.version}`
  )
    throw new Error("Invalid Android release metadata");
  return row as AndroidRelease;
}

export function byteRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    end < start ||
    (!match[1] && Number(match[2]) <= 0)
  )
    return null;
  return { start, end };
}

/** First-party APK delivery: explicit length, strong validator and resumable single ranges. */
export async function androidDownload(
  request: Request,
  assets: { fetch(request: Request): Promise<Response> },
): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const url = new URL(request.url);
  if (url.pathname !== APK_PATH)
    return new Response("Not found", { status: 404 });
  try {
    const metadataResponse = await assets.fetch(
      new Request(new URL("/android-release.json", url)),
    );
    if (
      !metadataResponse.ok ||
      !metadataResponse.headers
        .get("content-type")
        ?.includes("application/json")
    )
      throw new Error("Missing release");
    const release = parseAndroidRelease(await metadataResponse.json());
    const etag = `"${release.sha256}"`;
    const headers = new Headers({
      "Content-Type": APK_TYPE,
      "Content-Disposition": `attachment; filename="${release.filename}"`,
      "Content-Length": String(release.bytes),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=0, must-revalidate, no-transform",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
    });
    const ifMatch = request.headers.get("If-Match");
    if (
      ifMatch &&
      ifMatch !== "*" &&
      !ifMatch
        .split(",")
        .map((value) => value.trim())
        .includes(etag)
    ) {
      headers.set("Content-Length", "0");
      return new Response(null, { status: 412, headers });
    }
    if (
      request.headers.get("If-None-Match") === "*" ||
      request.headers
        .get("If-None-Match")
        ?.split(",")
        .map((s) => s.trim().replace(/^W\//, ""))
        .includes(etag)
    ) {
      headers.delete("Content-Length");
      return new Response(null, { status: 304, headers });
    }
    const rangeHeader =
      request.method === "GET" &&
      (!request.headers.has("If-Range") ||
        request.headers.get("If-Range") === etag)
        ? request.headers.get("Range")
        : null;
    const range = rangeHeader ? byteRange(rangeHeader, release.bytes) : null;
    if (rangeHeader && !range) {
      headers.set("Content-Range", `bytes */${release.bytes}`);
      headers.set("Content-Length", "0");
      return new Response(null, { status: 416, headers });
    }
    const file = await assets.fetch(
      new Request(new URL(APK_PATH, url), {
        headers: { "Accept-Encoding": "identity" },
      }),
    );
    if (
      file.status !== 200 ||
      ![APK_TYPE, "application/octet-stream"].some((type) =>
        file.headers.get("Content-Type")?.startsWith(type),
      ) ||
      (file.headers.has("Content-Length") &&
        Number(file.headers.get("Content-Length")) !== release.bytes)
    )
      throw new Error("Missing or inconsistent APK");
    if (request.method === "HEAD") {
      await file.body?.cancel();
      return new Response(null, { headers });
    }
    if (range) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength !== release.bytes) throw new Error("Truncated APK");
      headers.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${release.bytes}`,
      );
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(bytes.slice(range.start, range.end + 1), {
        status: 206,
        headers,
      });
    }
    return new Response(file.body, { headers });
  } catch {
    return new Response(
      "앱 파일을 준비하지 못했습니다. 다운로드 화면의 GitHub 릴리즈를 이용해 주세요.",
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      },
    );
  }
}
