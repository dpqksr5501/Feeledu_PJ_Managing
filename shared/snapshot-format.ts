import { z } from "zod";
export const legacySnapshotTables = [
  "admins",
  "employees",
  "rates",
  "day_rates",
  "devices",
  "shifts",
  "clock_events",
  "settings",
  "holidays",
  "adjustments",
  "settlements",
  "audit",
] as const;
export const snapshotTables = [
  ...legacySnapshotTables,
  "holiday_calendars",
  "official_holidays",
  "shift_breaks",
] as const;
const row = z.record(
  z.string(),
  z.union([z.string(), z.number().finite(), z.null()]),
);
export const snapshotSchema = z
  .object({
    format: z.literal("feeledu-snapshot"),
    version: z.literal(1),
    schema: z.union([z.literal(3), z.literal(4), z.literal(5)]),
    created_at: z.iso.datetime(),
    tables: z
      .object({
        ...(Object.fromEntries(
          legacySnapshotTables.map((table) => [
            table,
            z.array(row).max(100000),
          ]),
        ) as Record<
          (typeof legacySnapshotTables)[number],
          z.ZodArray<typeof row>
        >),
        holiday_calendars: z.array(row).max(100000).optional(),
        official_holidays: z.array(row).max(100000).optional(),
        shift_breaks: z.array(row).max(100000).optional(),
      })
      .strict(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine(
    (value) =>
      (value.schema >= 4
        ? value.tables.holiday_calendars !== undefined &&
          value.tables.official_holidays !== undefined
        : value.tables.holiday_calendars === undefined &&
          value.tables.official_holidays === undefined) &&
      (value.schema === 5
        ? value.tables.shift_breaks !== undefined
        : value.tables.shift_breaks === undefined),
    "백업의 스키마별 테이블 구성이 올바르지 않습니다.",
  );

/** Runs locally in the browser. The file never leaves the device. */
export async function inspectSnapshot(input: unknown) {
  const snapshot = snapshotSchema.parse(input);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(snapshot.tables)),
  );
  const checksum = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (checksum !== snapshot.checksum)
    throw new Error("백업의 검사값이 일치하지 않습니다.");
  if (
    !snapshot.tables.admins.some(
      (admin) => admin.active === 1 && admin.role === "owner",
    )
  )
    throw new Error("활성 개발자 계정이 없는 백업입니다.");
  return {
    createdAt: snapshot.created_at,
    employees: snapshot.tables.employees.length,
    shifts: snapshot.tables.shifts.length,
    events: snapshot.tables.clock_events.length,
  };
}
