import { DurableObject } from "cloudflare:workers";
import { handleAsNodeRequest } from "cloudflare:node";
import { createServer, type Server } from "node:http";
import express from "express";
import type { RequestHandler } from "express";
import { createHttpApp } from "../server/http.ts";
import {
  initializeDb,
  audit,
  transaction,
  type Db,
} from "../server/database.ts";
import { registerRoutes } from "../server/routes.ts";
import {
  exportSnapshot,
  importSnapshotIntoEmptyDatabase,
} from "../server/snapshot.ts";
import { seoulDate } from "../shared/time.ts";
import { durableDatabase } from "./database.ts";
import * as security from "./security.ts";
import { androidDownload } from "../shared/android-download.ts";
import { HolidayCalendarService } from "../server/holiday-calendar.ts";

interface Env {
  ACADEMY: DurableObjectNamespace<Academy>;
  ASSETS: Fetcher;
  SETUP_TOKEN: string;
  MIGRATION_TOKEN?: string;
  KASI_SERVICE_KEY?: string;
}
export class Academy extends DurableObject<Env> {
  private db: Db;
  private server?: Server;
  private port = 0;
  private calendar: HolidayCalendarService;
  private nextCalendarCheck = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = durableDatabase(ctx.storage);
    initializeDb(this.db);
    this.calendar = new HolidayCalendarService(
      this.db,
      () => this.env.KASI_SERVICE_KEY,
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS cloud_rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS cloud_limits_expiry ON cloud_rate_limits(expires_at)",
    );
  }
  private limit(
    name: string,
    maximum: number,
    windowMs: number,
  ): RequestHandler {
    return (req, res, next) => {
      const key = security.hash(
        name + ":" + (req.headers["x-feeledu-client-ip"] || "local"),
      );
      const now = Date.now();
      let remaining = 0;
      let expiresAt = now + windowMs;
      transaction(this.db, () => {
        this.db
          .prepare("DELETE FROM cloud_rate_limits WHERE expires_at<=?")
          .run(now);
        const entry = this.db
          .prepare("SELECT count,expires_at FROM cloud_rate_limits WHERE key=?")
          .get(key);
        if (entry) expiresAt = Number(entry.expires_at);
        remaining = maximum - Number(entry?.count ?? 0) - 1;
        // Rejected bursts must not consume additional write quota.
        if (remaining >= 0)
          this.db
            .prepare(
              "INSERT INTO cloud_rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
            )
            .run(key, expiresAt);
      });
      if (remaining < 0) {
        res
          .set(
            "Retry-After",
            String(Math.max(1, Math.ceil((expiresAt - now) / 1000))),
          )
          .status(429)
          .json({ error: "시도 횟수가 많습니다. 잠시 후 다시 시도해 주세요." });
        return;
      }
      next();
    };
  }
  private serve(origin: string) {
    const app = createHttpApp({ production: true, publicOrigin: origin });
    registerRoutes(app, {
      db: this.db,
      setupToken: this.env.SETUP_TOKEN,
      security,
      sensitiveLimit: this.limit("sensitive", 20, 15 * 60000),
      kioskLimit: this.limit("kiosk", 180, 60000),
      router: () => express.Router(),
      secureCookie: true,
      calendar: this.calendar,
      downloadBackup: async (req, res) => {
        audit(
          this.db,
          (req as express.Request & { admin: { id: string } }).admin.id,
          "backup.download",
          "database",
          { format: "json" },
        );
        res
          .attachment(`feeledu-${seoulDate()}.json`)
          .json(exportSnapshot(this.db));
      },
    });
    this.server = createServer(app);
    this.server.listen(0);
    this.port = (this.server.address() as { port: number }).port;
  }
  async fetch(request: Request): Promise<Response> {
    if (!this.env.SETUP_TOKEN)
      return Response.json(
        { error: "운영 설정이 완료되지 않았습니다." },
        { status: 503 },
      );
    const url = new URL(request.url);
    if (url.pathname === "/api/deployment/import") {
      if (
        request.method !== "POST" ||
        !this.env.MIGRATION_TOKEN ||
        !security.secureEqual(
          request.headers.get("Authorization") || "",
          "Bearer " + this.env.MIGRATION_TOKEN,
        )
      )
        return Response.json(
          { error: "허용되지 않은 요청입니다." },
          { status: 403 },
        );
      if (this.db.prepare("SELECT id FROM admins LIMIT 1").get())
        return Response.json(
          { error: "이미 운영 중인 DB입니다." },
          { status: 409 },
        );
      const declared = Number(request.headers.get("Content-Length") || 0);
      if (declared > 10 * 1024 * 1024)
        return Response.json(
          { error: "이전 파일이 너무 큽니다." },
          { status: 413 },
        );
      try {
        const text = await request.text();
        if (text.length > 10 * 1024 * 1024)
          return Response.json(
            { error: "이전 파일이 너무 큽니다." },
            { status: 413 },
          );
        const counts = importSnapshotIntoEmptyDatabase(
          this.db,
          JSON.parse(text),
        );
        await this.ctx.storage.sync();
        return Response.json({ ok: true, counts });
      } catch {
        return Response.json(
          { error: "이전 파일 검증에 실패했습니다. 원본 기록은 유지됩니다." },
          { status: 400 },
        );
      }
    }
    if (this.calendar.configured && Date.now() >= this.nextCalendarCheck) {
      this.nextCalendarCheck = Date.now() + 3600000;
      this.ctx.waitUntil(this.calendar.refreshCurrentYears());
    }
    if (!this.server) this.serve(url.origin);
    const response = await handleAsNodeRequest(this.port, request);
    await this.ctx.storage.sync();
    return response;
  }
  async refreshHolidays() {
    await this.calendar.refreshCurrentYears();
  }
}
export default {
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    if (env.KASI_SERVICE_KEY)
      ctx.waitUntil(
        env.ACADEMY.getByName("feeledu-primary", {
          locationHint: "apac",
        }).refreshHolidays(),
      );
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/downloads/"))
      return androidDownload(request, env.ASSETS);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const headers = new Headers(request.headers);
    headers.set(
      "x-feeledu-client-ip",
      request.headers.get("CF-Connecting-IP") || "local",
    );
    // A single academy is one consistent SQL database. Its ID is fixed in code.
    return env.ACADEMY.getByName("feeledu-primary", {
      locationHint: "apac",
    }).fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;
