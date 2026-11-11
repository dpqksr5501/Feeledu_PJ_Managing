import type { RequestHandler } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  androidDownload,
  APK_PATH,
  APK_TYPE,
} from "../shared/android-download.ts";

export const serveAndroidDownload: RequestHandler = async (req, res, next) => {
  try {
    const headers = new Headers();
    for (const name of ["Range", "If-Range", "If-Match", "If-None-Match"]) {
      const value = req.get(name);
      if (value) headers.set(name, value);
    }
    const response = await androidDownload(
      new Request("https://local.invalid" + req.originalUrl, {
        method: req.method,
        headers,
      }),
      {
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (![APK_PATH, "/android-release.json"].includes(path))
            return new Response(null, { status: 404 });
          try {
            const bytes = new Uint8Array(readFileSync(resolve("dist" + path)));
            return new Response(bytes, {
              headers: {
                "Content-Type": path.endsWith(".json")
                  ? "application/json"
                  : APK_TYPE,
                "Content-Length": String(bytes.byteLength),
              },
            });
          } catch {
            return new Response(null, { status: 404 });
          }
        },
      },
    );
    res.status(response.status);
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (response.body) res.end(Buffer.from(await response.arrayBuffer()));
    else res.end();
  } catch (error) {
    if (res.headersSent) res.destroy();
    else next(error);
  }
};
