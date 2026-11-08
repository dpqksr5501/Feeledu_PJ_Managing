const OFFSET = 9 * 60 * 60 * 1000;
export function seoulDate(value: string | number | Date = Date.now()): string {
  return new Date(new Date(value).getTime() + OFFSET)
    .toISOString()
    .slice(0, 10);
}
export function dayStart(date: string): number {
  return Date.parse(`${date}T00:00:00+09:00`);
}
export function addDays(date: string, count: number): string {
  return seoulDate(dayStart(date) + count * 86400000);
}
export function weekStart(date: string, startsOn = 1): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday - startsOn + 7) % 7));
}
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
export function formatTime(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "근무 중";
}
export function money(value: number): string {
  return Math.round(value).toLocaleString("ko-KR") + "원";
}
export function hours(seconds: number): string {
  return (
    (seconds / 3600).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) +
    "시간"
  );
}
