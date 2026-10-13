// Europe/London wall-clock helpers. Intl handles the GMT/BST switch.

export interface LondonTime {
  /** YYYY-MM-DD */
  date: string;
  hour: number;
  minute: number;
  /** Minutes since local midnight. */
  minutes: number;
  /** e.g. FRIDAY */
  weekday: string;
  /** e.g. 09 OCT */
  dayMonth: string;
  /** HH:MM */
  hhmm: string;
}

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Sept: "09", Oct: "10", Nov: "11", Dec: "12",
};

export function londonTime(at: Date): LondonTime {
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(at)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const month = parts.month.replace(".", "");
  return {
    date: `${parts.year}-${MONTHS[month] ?? "01"}-${parts.day}`,
    hour,
    minute,
    minutes: hour * 60 + minute,
    weekday: parts.weekday.toUpperCase(),
    dayMonth: `${parts.day} ${month.slice(0, 3).toUpperCase()}`,
    hhmm: `${pad2(hour)}:${pad2(minute)}`,
  };
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "HH:MM" to minutes since midnight, or null if it isn't a time. */
export function parseHhmm(s: unknown): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatMinutes(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/**
 * Minutes from `now` until a clock time, picking whichever day puts it
 * within 12 hours either side (so 00:10 seen at 23:50 is +20, not -1420).
 */
export function minutesUntil(clock: number, now: number): number {
  let diff = clock - now;
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}
