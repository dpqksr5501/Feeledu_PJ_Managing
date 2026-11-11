import { test, expect } from "vitest";
import {
  androidDownload,
  APK_PATH,
  APK_TYPE,
  byteRange,
} from "../shared/android-download.ts";

const bytes = new Uint8Array([80, 75, 3, 4, 5, 6, 7, 8, 9, 10]);
const release = {
  version: "1.0.1",
  filename: "feeledu-attendance-1.0.1.apk",
  bytes: bytes.length,
  sha256: "a".repeat(64),
  releaseUrl:
    "https://github.com/dpqksr5501/Feeledu_PJ_Managing/releases/tag/android-v1.0.1",
};
const assets = {
  async fetch(request: Request) {
    return new URL(request.url).pathname.endsWith(".json")
      ? Response.json(release)
      : new Response(bytes, {
          headers: {
            "Content-Type": APK_TYPE,
            "Content-Length": String(bytes.length),
          },
        });
  },
};
const request = (
  headers: Record<string, string> = {},
  method = "GET",
  path = APK_PATH,
) => new Request("https://test.invalid" + path, { headers, method });

test("APK responses have an exact length, native type and attachment name; HEAD does not return bytes", async () => {
  const response = await androidDownload(request(), assets);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-length")).toBe("10");
  expect(response.headers.get("content-type")).toBe(APK_TYPE);
  expect(response.headers.get("content-disposition")).toContain(
    "feeledu-attendance-1.0.1.apk",
  );
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  const head = await androidDownload(request({}, "HEAD"), assets);
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe("10");
  expect((await head.arrayBuffer()).byteLength).toBe(0);
});

test("APK downloads resume with correct partial length and content range", async () => {
  for (const [range, expected] of [
    ["bytes=3-6", bytes.slice(3, 7)],
    ["bytes=6-", bytes.slice(6)],
    ["bytes=-3", bytes.slice(-3)],
  ] as const) {
    const response = await androidDownload(request({ Range: range }), assets);
    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(Number(response.headers.get("content-length"))).toBe(
      expected.length,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
  }
  expect(
    (
      await androidDownload(request({ Range: "bytes=3-6" }), assets)
    ).headers.get("content-range"),
  ).toBe("bytes 3-6/10");
});

test("invalid ranges fail explicitly and changing APKs restart a resumed download", async () => {
  expect(
    (
      await androidDownload(
        request({ Range: "bytes=4-", "If-Match": '"old-file"' }),
        assets,
      )
    ).status,
  ).toBe(412);
  expect(
    (
      await androidDownload(
        request({ Range: "bytes=4-", "If-Match": `"${release.sha256}"` }),
        assets,
      )
    ).status,
  ).toBe(206);
  for (const value of [
    "bytes=99-",
    "bytes=4-2",
    "bytes=-0",
    "bytes=0-1,3-4",
    "bytes=-",
  ]) {
    const response = await androidDownload(request({ Range: value }), assets);
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  }
  const changed = await androidDownload(
    request({ Range: "bytes=4-", "If-Range": '"old-file"' }),
    assets,
  );
  expect(changed.status).toBe(200);
  expect(new Uint8Array(await changed.arrayBuffer())).toEqual(bytes);
  expect(byteRange("bytes=0-900", 10)).toEqual({ start: 0, end: 9 });
});

test("APK validators return 304 and incorrect files never become an HTML APK download", async () => {
  expect(
    (
      await androidDownload(
        request({ "If-None-Match": `"${release.sha256}"` }),
        assets,
      )
    ).status,
  ).toBe(304);
  const html = {
    async fetch() {
      return new Response("<!doctype html>", {
        headers: { "Content-Type": "text/html" },
      });
    },
  };
  expect((await androidDownload(request(), html)).status).toBe(503);
  const wrongFile = {
    async fetch(req: Request) {
      return new URL(req.url).pathname.endsWith(".json")
        ? Response.json(release)
        : new Response("html", { headers: { "Content-Type": "text/html" } });
    },
  };
  expect((await androidDownload(request(), wrongFile)).status).toBe(503);
  const wrongLength = {
    async fetch(req: Request) {
      return new URL(req.url).pathname.endsWith(".json")
        ? Response.json(release)
        : new Response(bytes, {
            headers: { "Content-Type": APK_TYPE, "Content-Length": "999" },
          });
    },
  };
  expect((await androidDownload(request(), wrongLength)).status).toBe(503);
  expect((await androidDownload(request({}, "POST"), assets)).status).toBe(405);
  expect(
    (await androidDownload(request({}, "GET", "/downloads/no.apk"), assets))
      .status,
  ).toBe(404);
});
