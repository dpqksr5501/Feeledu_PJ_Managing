import express, { type Request } from "express";
import { createHttpApp } from "./http.ts";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { backup } from "node:sqlite";
import { mkdirSync, unlink } from "node:fs";
import { resolve } from "node:path";
import { audit, type Db } from "./db.ts";
import * as security from "./security.ts";
import { registerRoutes } from "./routes.ts";
import { seoulDate } from "../shared/time.ts";
import { HolidayCalendarService } from "./holiday-calendar.ts";

export function createApp({
  db,
  setupToken,
  production = false,
  calendar = new HolidayCalendarService(db, () => process.env.KASI_SERVICE_KEY),
}: {
  db: Db;
  setupToken: string;
  production?: boolean;
  calendar?: HolidayCalendarService;
}) {
  const app = createHttpApp({
    production,
    publicOrigin: process.env.PUBLIC_ORIGIN,
    trustProxy: process.env.TRUST_PROXY === "1" ? 1 : undefined,
  });
  const sensitiveLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "시도 횟수가 많습니다. 15분 후 다시 시도해 주세요." },
  });
  const kioskLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "잠시 후 다시 시도해 주세요." },
  });
  registerRoutes(app, {
    db,
    setupToken,
    security,
    sensitiveLimit,
    kioskLimit,
    router: () => express.Router(),
    secureCookie: production && process.env.COOKIE_SECURE !== "false",
    calendar,
    downloadBackup: async (req, res) => {
      mkdirSync("data/backups", { recursive: true });
      const path = resolve("data/backups", `download-${randomUUID()}.db`);
      await backup(db as Parameters<typeof backup>[0], path);
      audit(
        db,
        (req as Request & { admin: { id: string } }).admin.id,
        "backup.download",
        "database",
        {},
      );
      res.download(path, `feeledu-${seoulDate()}.db`, () =>
        unlink(path, () => {}),
      );
    },
  });
  return app;
}
