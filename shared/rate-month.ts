import type { Rate } from "./types.ts";

export function rateMonthVersion(rates: Rate[], month: string) {
  return JSON.stringify(
    rates
      .filter((rate) => rate.effective_from.startsWith(month + "-"))
      .map(({ id, effective_from, hourly_rate, reason }) => ({
        id,
        effective_from,
        hourly_rate,
        reason,
      }))
      .sort(
        (a, b) =>
          a.effective_from.localeCompare(b.effective_from) ||
          a.id.localeCompare(b.id),
      ),
  );
}
