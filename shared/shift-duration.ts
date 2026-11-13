/** Preserve millisecond totals when a break is split over dates or weeks. */
export function paidMillisecondsInRange(
  shift: {
    started_at: string;
    ended_at: string | null;
    break_minutes: number;
    breaks?: { started_at: string; ended_at: string }[];
  },
  from: number,
  to: number,
  now = Date.now(),
) {
  const start = Date.parse(shift.started_at);
  const end = shift.ended_at ? Date.parse(shift.ended_at) : now;
  const duration = end - start;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    shift.break_minutes < 0 ||
    shift.break_minutes * 60000 >= duration
  )
    return 0;
  const left = Math.max(start, from),
    right = Math.min(end, to);
  if (right <= left) return 0;
  if (shift.breaks?.length) {
    return Math.max(
      0,
      right -
        left -
        shift.breaks.reduce(
          (sum, item) =>
            sum +
            Math.max(
              0,
              Math.min(right, Date.parse(item.ended_at)) -
                Math.max(left, Date.parse(item.started_at)),
            ),
          0,
        ),
    );
  }
  const ratio = (duration - shift.break_minutes * 60000) / duration;
  return (
    Math.round((right - start) * ratio) - Math.round((left - start) * ratio)
  );
}
