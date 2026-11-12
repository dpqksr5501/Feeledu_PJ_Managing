import { z } from "zod";
export const snapshotTables = [
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
const row = z.record(
  z.string(),
  z.union([z.string(), z.number().finite(), z.null()]),
);
export const snapshotSchema = z
  .object({
    format: z.literal("feeledu-snapshot"),
    version: z.literal(1),
    schema: z.literal(3),
    created_at: z.iso.datetime(),
    tables: z
      .object(
        Object.fromEntries(
          snapshotTables.map((table) => [table, z.array(row).max(100000)]),
        ) as Record<(typeof snapshotTables)[number], z.ZodArray<typeof row>>,
      )
      .strict(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

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
    throw new Error("활성 운영자 계정이 없는 백업입니다.");
  return {
    createdAt: snapshot.created_at,
    employees: snapshot.tables.employees.length,
    shifts: snapshot.tables.shifts.length,
    events: snapshot.tables.clock_events.length,
  };
}
