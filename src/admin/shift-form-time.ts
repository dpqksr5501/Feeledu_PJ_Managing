export const localDateTime = (value: string) =>
  new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 19);

export function toShiftInstant(value: string, original?: string | null) {
  if (!value) return null;
  // Editing a note/break must not round an existing server timestamp.
  const normalized = value.length === 16 ? value + ":00" : value;
  if (original && normalized === localDateTime(original)) return original;
  const timestamp = Date.parse(normalized + "+09:00");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
