import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { audit, transaction, type Db } from "./database.ts";
import { dayStart, seoulDate } from "../shared/time.ts";
import type {
  CalendarDay,
  CalendarYear,
  HolidayCalendarStatus,
} from "../shared/types.ts";

const ENDPOINT =
  "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const daySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(1).max(300),
});
const hash = (days: CalendarDay[]) =>
  createHash("sha256").update(JSON.stringify(days)).digest("hex");
const savedDays = (db: Db, year: number) =>
  db
    .prepare(
      "SELECT date,name FROM official_holidays WHERE date BETWEEN ? AND ? ORDER BY date",
    )
    .all(`${year}-01-01`, `${year}-12-31`) as CalendarDay[];
const changes = (before: CalendarDay[], after: CalendarDay[]) => ({
  added: after.filter(
    (day) => !before.some((prior) => prior.date === day.date),
  ),
  removed: before.filter(
    (day) => !after.some((next) => next.date === day.date),
  ),
  changed: after.filter((day) =>
    before.some((prior) => prior.date === day.date && prior.name !== day.name),
  ),
});
class CalendarError extends Error {}
const invalid = () =>
  new CalendarError("공휴일 자료 검증 실패 · 기존 자료를 유지합니다.");

/** Complete month only: gateway failures, partial pages and malformed dates are errors. */
export function parseHolidayPage(
  text: string,
  year: number,
  month: number,
  page: number,
) {
  if (text.length > 65536 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw invalid();
  let data;
  try {
    if (text.trimStart().startsWith("{")) data = JSON.parse(text);
    else {
      if (XMLValidator.validate(text) !== true) throw invalid();
      data = new XMLParser({ parseTagValue: false, trimValues: true }).parse(
        text,
      );
    }
  } catch {
    throw invalid();
  }
  const code = String(data?.response?.header?.resultCode ?? "");
  if (!["00", "0"].includes(code))
    throw new CalendarError(
      "공휴일 API 인증·활용승인 및 서비스 상태를 확인해 주세요.",
    );
  const body = data?.response?.body;
  const total =
    typeof body?.totalCount === "number" ||
    (typeof body?.totalCount === "string" && /^\d+$/.test(body.totalCount))
      ? Number(body.totalCount)
      : NaN;
  if (
    !Number.isInteger(total) ||
    total < 0 ||
    total > 200 ||
    Number(body.pageNo) !== page ||
    Number(body.numOfRows) !== 100
  )
    throw invalid();
  const raw = body.items?.item;
  const items = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (items.length !== Math.max(0, Math.min(100, total - (page - 1) * 100)))
    throw invalid();
  const days: CalendarDay[] = [];
  for (const item of items) {
    const value = String(item.locdate ?? "");
    const expectedMonth = `${year}${String(month).padStart(2, "0")}`;
    if (
      !/^\d{8}$/.test(value) ||
      !value.startsWith(expectedMonth) ||
      !["Y", "N"].includes(item.isHoliday)
    )
      throw invalid();
    const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    if (!Number.isFinite(dayStart(date)) || seoulDate(dayStart(date)) !== date)
      throw invalid();
    if (item.isHoliday === "Y")
      days.push(daySchema.parse({ date, name: item.dateName }));
  }
  return { total, days };
}

async function responseText(response: Response) {
  if (!response.ok)
    throw new CalendarError(
      response.status === 429
        ? "공휴일 API 호출 한도 초과 · 기존 자료를 유지합니다."
        : "공휴일 API 연결 실패 · 기존 자료를 유지합니다.",
    );
  if (
    Number(response.headers.get("Content-Length") || 0) > 65536 ||
    !response.body
  )
    throw invalid();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) throw invalid();
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export class HolidayCalendarService {
  private running = new Set<number>();
  private db: Db;
  private key: () => string | undefined;
  private fetcher: typeof fetch;
  constructor(
    db: Db,
    key: () => string | undefined,
    fetcher: typeof fetch = fetch,
  ) {
    this.db = db;
    this.key = key;
    this.fetcher = fetcher;
  }
  get configured() {
    return Boolean(this.key()?.trim());
  }
  status(): HolidayCalendarStatus {
    return {
      configured: this.configured,
      years: this.db
        .prepare("SELECT * FROM holiday_calendars ORDER BY year DESC")
        .all()
        .map((row): CalendarYear => {
          const year = Number(row.year),
            days = savedDays(this.db, year);
          return {
            year,
            synced_at: row.synced_at as string | null,
            attempted_at: row.attempted_at as string | null,
            checked_at: row.checked_at as string | null,
            error: String(row.error),
            fingerprint: String(row.fingerprint),
            count: days.length,
            pending: row.pending_json
              ? {
                  hash: String(row.pending_hash),
                  ...changes(days, JSON.parse(String(row.pending_json))),
                }
              : null,
          };
        }),
    };
  }
  private apply(year: number, days: CalendarDay[], actor: string) {
    const before = savedDays(this.db, year),
      diff = changes(before, days),
      now = new Date().toISOString();
    // Upsert only changed rows. A daily refresh must not rewrite unchanged calendars.
    for (const day of diff.removed)
      this.db
        .prepare("DELETE FROM official_holidays WHERE date=?")
        .run(day.date);
    for (const day of [...diff.added, ...diff.changed])
      this.db
        .prepare(
          "INSERT INTO official_holidays VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET name=excluded.name",
        )
        .run(day.date, day.name, year);
    this.db
      .prepare(
        "UPDATE holiday_calendars SET synced_at=?,checked_at=NULL,error='',fingerprint=?,pending_json=NULL,pending_hash=NULL WHERE year=?",
      )
      .run(now, hash(days), year);
    if (diff.added.length || diff.removed.length || diff.changed.length)
      audit(this.db, actor, "calendar.sync", String(year), diff);
    return diff;
  }
  async sync(year: number, actor = "system:calendar") {
    if (
      !Number.isInteger(year) ||
      year < 2000 ||
      year > Number(seoulDate().slice(0, 4)) + 1
    )
      throw new CalendarError("조회 연도는 2000년부터 내년까지 선택해 주세요.");
    if (!this.configured)
      throw new CalendarError(
        "서버에 KASI_SERVICE_KEY 인증키를 등록해 주세요.",
      );
    const prior = this.db
      .prepare("SELECT attempted_at FROM holiday_calendars WHERE year=?")
      .get(year);
    if (
      this.running.has(year) ||
      (prior?.attempted_at &&
        Date.now() - Date.parse(String(prior.attempted_at)) < 5 * 60000)
    )
      throw new CalendarError("같은 연도의 갱신은 5분 후 다시 시도해 주세요.");
    this.running.add(year);
    this.db
      .prepare(
        "INSERT INTO holiday_calendars(year,attempted_at) VALUES(?,?) ON CONFLICT(year) DO UPDATE SET attempted_at=excluded.attempted_at",
      )
      .run(year, new Date().toISOString());
    try {
      let key = this.key()!.trim();
      if (/%[0-9a-f]{2}/i.test(key)) key = decodeURIComponent(key);
      if (!key || key.length > 512 || /[\r\n\s]/.test(key)) throw invalid();
      const byMonth: CalendarDay[][] = [];
      // Bound concurrency, timeout and pagination; no caller-provided URL is used.
      for (let start = 1; start <= 12; start += 3) {
        byMonth.push(
          ...(await Promise.all(
            [start, start + 1, start + 2].map(async (month) => {
              const days: CalendarDay[] = [];
              let total = 0;
              for (let page = 1; page <= 2; page++) {
                const url = new URL(ENDPOINT);
                url.search = new URLSearchParams({
                  ServiceKey: key,
                  solYear: String(year),
                  solMonth: String(month).padStart(2, "0"),
                  pageNo: String(page),
                  numOfRows: "100",
                  _type: "json",
                }).toString();
                const result = parseHolidayPage(
                  await responseText(
                    await this.fetcher(url, {
                      signal: AbortSignal.timeout(8000),
                      redirect: "error",
                    }),
                  ),
                  year,
                  month,
                  page,
                );
                if (page > 1 && result.total !== total) throw invalid();
                total = result.total;
                days.push(...result.days);
                if (page * 100 >= total) break;
              }
              return days;
            }),
          )),
        );
      }
      const grouped = new Map<string, Set<string>>();
      for (const day of byMonth.flat())
        grouped.set(
          day.date,
          new Set([...(grouped.get(day.date) ?? []), day.name]),
        );
      const days = [...grouped]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, names]) => ({
          date,
          name: [...names].sort().join(" · "),
        }));
      z.array(daySchema).parse(days);
      // An unpublished/empty/partial year must never silently become ordinary days.
      if (
        days.length < 8 ||
        days.length > 120 ||
        !grouped.has(`${year}-01-01`) ||
        !grouped.has(`${year}-12-25`)
      )
        throw new CalendarError(
          "연간 공휴일 자료가 미공개이거나 불완전합니다. 기존 자료를 유지합니다.",
        );
      return transaction(this.db, () => {
        const diff = changes(savedDays(this.db, year), days);
        if (diff.removed.length) {
          this.db
            .prepare(
              "UPDATE holiday_calendars SET error='',pending_json=?,pending_hash=? WHERE year=?",
            )
            .run(JSON.stringify(days), hash(days), year);
          audit(this.db, actor, "calendar.pending", String(year), diff);
          return { pending: true, ...diff };
        }
        return { pending: false, ...this.apply(year, days, actor) };
      });
    } catch (error) {
      // Never persist provider responses, URLs, credentials or raw exception text.
      const message =
        error instanceof CalendarError
          ? error.message
          : "공휴일 API 연결 또는 자료 검증 실패 · 기존 자료를 유지합니다.";
      this.db
        .prepare("UPDATE holiday_calendars SET error=? WHERE year=?")
        .run(message, year);
      throw new CalendarError(message);
    } finally {
      this.running.delete(year);
    }
  }
  approve(year: number, expected: string, reason: string, actor: string) {
    return transaction(this.db, () => {
      const row = this.db
        .prepare(
          "SELECT pending_hash,pending_json FROM holiday_calendars WHERE year=?",
        )
        .get(year);
      if (!row?.pending_json || row.pending_hash !== expected)
        throw new CalendarError(
          "검토할 공휴일 자료가 변경됐습니다. 새로고침해 주세요.",
        );
      const days = z
        .array(daySchema)
        .parse(JSON.parse(String(row.pending_json)));
      if (hash(days) !== expected) throw invalid();
      const diff = this.apply(year, days, actor);
      audit(this.db, actor, "calendar.approve", String(year), {
        reason,
        ...diff,
      });
    });
  }
  confirm(year: number, expected: string, reason: string, actor: string) {
    transaction(this.db, () => {
      const row = this.db
        .prepare(
          "SELECT synced_at,fingerprint,pending_json FROM holiday_calendars WHERE year=?",
        )
        .get(year);
      if (!row?.synced_at || row.fingerprint !== expected || row.pending_json)
        throw new CalendarError(
          "공휴일 자료가 변경됐거나 검토가 필요합니다. 새로고침해 주세요.",
        );
      this.db
        .prepare("UPDATE holiday_calendars SET checked_at=? WHERE year=?")
        .run(new Date().toISOString(), year);
      audit(this.db, actor, "calendar.confirm", String(year), {
        fingerprint: expected,
        reason,
      });
    });
  }
  async refreshCurrentYears() {
    if (!this.configured) return;
    const year = Number(seoulDate().slice(0, 4));
    for (const target of [year - 1, year, year + 1]) {
      const previous = this.db
        .prepare(
          "SELECT attempted_at,error FROM holiday_calendars WHERE year=?",
        )
        .get(target);
      if (
        previous?.attempted_at &&
        Date.now() - Date.parse(String(previous.attempted_at)) <
          (previous.error ? 3600000 : 23 * 3600000)
      )
        continue;
      try {
        await this.sync(target);
      } catch {
        /* Sanitized status is available to administrators. */
      }
    }
  }
}
