import express from "express";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { backup } from "node:sqlite";
import { openDb } from "./db.ts";
import { secret } from "./security.ts";
import { createApp } from "./app.ts";
import { seoulDate } from "../shared/time.ts";
import { serveAndroidDownload } from "./android-download.ts";

const production = process.env.NODE_ENV === "production";
const dbPath = process.env.DB_PATH || "data/feeledu.db";
const db = openDb(dbPath);
const dataDir = dirname(resolve(dbPath));
const setupFile = resolve(dataDir, "setup-token");
let setupToken = process.env.SETUP_TOKEN || "";
if (!setupToken) {
  mkdirSync(dataDir, { recursive: true });
  setupToken = existsSync(setupFile)
    ? readFileSync(setupFile, "utf8").trim()
    : secret();
  if (!existsSync(setupFile))
    writeFileSync(setupFile, setupToken, { mode: 0o600 });
}
if (!db.prepare("SELECT id FROM admins LIMIT 1").get())
  console.log(
    `\n최초 운영자 설정 코드: ${setupToken}\n관리자 화면에서 이 코드를 입력해 주세요.\n`,
  );
const app = createApp({ db, setupToken, production });
app.all("/downloads/{*file}", serveAndroidDownload);
let devServer: { close: () => Promise<void> } | undefined;
if (production) {
  if (!existsSync("dist/index.html"))
    throw new Error("먼저 npm run build를 실행해 주세요.");
  app.get("/.well-known/assetlinks.json", (_req, res) =>
    res
      .type("application/json")
      .sendFile(resolve("dist/.well-known/assetlinks.json"), {
        dotfiles: "allow",
      }),
  );
  app.use(
    express.static(resolve("dist"), {
      index: false,
      setHeaders: (res, path) => {
        if (path.endsWith("sw.js") || path.endsWith("index.html"))
          res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configLoader: "native",
    server: { middlewareMode: true },
    appType: "spa",
  });
  devServer = vite;
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(
    `Feeledu: http://${host === "0.0.0.0" ? "localhost" : host}:${port}\n태블릿: /kiosk · 관리자: /admin`,
  ),
);
let backupRunning = false;
let activeBackup: Promise<unknown> | undefined;
async function dailyBackup() {
  if (backupRunning || process.env.DISABLE_BACKUPS === "1") return;
  backupRunning = true;
  try {
    const folder = resolve(dataDir, "backups");
    mkdirSync(folder, { recursive: true });
    const filename = `auto-${seoulDate()}.db`;
    if (!existsSync(resolve(folder, filename))) {
      activeBackup = backup(db, resolve(folder, filename));
      await activeBackup;
    }
    const files = readdirSync(folder)
      .filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .reverse();
    for (const file of files.slice(30)) unlinkSync(resolve(folder, file));
  } catch (error) {
    console.error("자동 백업 실패:", error);
  } finally {
    activeBackup = undefined;
    backupRunning = false;
  }
}
void dailyBackup();
const timer = setInterval(() => void dailyBackup(), 60 * 60 * 1000);
timer.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await devServer?.close();
  server.close(async () => {
    await activeBackup?.catch(() => {});
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
