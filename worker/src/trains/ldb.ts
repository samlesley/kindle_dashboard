// Rail Data Marketplace "Live Departure Board" (LDBWS REST, 2022-01-20 schema)
// client, and conversion of a board into the rows the dashboard shows.

import { formatMinutes, minutesUntil, parseHhmm } from "../time";
import { upstreamJson } from "../upstream";

export interface LdbLocation {
  locationName?: string;
  crs?: string;
  via?: string | null;
}

export interface LdbCallingPoint {
  locationName?: string;
  crs?: string;
  st?: string;
  et?: string;
}

export interface LdbService {
  std?: string;
  etd?: string;
  platform?: string;
  operator?: string;
  isCancelled?: boolean;
  origin?: LdbLocation[];
  destination?: LdbLocation[];
  subsequentCallingPoints?: { callingPoint?: LdbCallingPoint[] }[] | null;
  cancelReason?: string | null;
  delayReason?: string | null;
  serviceID?: string;
}

export interface LdbBoard {
  generatedAt?: string;
  locationName?: string;
  crs?: string;
  filterLocationName?: string;
  filtercrs?: string;
  filterCrs?: string;
  trainServices?: LdbService[] | null;
  nrccMessages?: (string | { Value?: string; value?: string; message?: string })[] | null;
}

export type TrainStatus = "on-time" | "late" | "delayed" | "cancelled" | "other";

export interface Departure {
  scheduled: string;
  status: TrainStatus;
  /** ON TIME, EXP 07:03, DELAYED, CANCELLED, or the feed's own wording. */
  statusText: string;
  /** Expected (or scheduled) time minus the walk; null when cancelled. */
  leaveBy: string | null;
  destination: string;
}

export interface BoardOptions {
  filterCrs: string;
  walkMinutes: number;
  /** Minutes since local midnight. */
  now: number;
  max?: number;
}

export async function fetchLiveBoard(
  baseUrl: string,
  stationCrs: string,
  filterCrs: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<LdbBoard> {
  const url = new URL(`${baseUrl}/${encodeURIComponent(stationCrs)}`);
  url.searchParams.set("numRows", "10");
  url.searchParams.set("filterCrs", filterCrs);
  url.searchParams.set("filterType", "to");
  url.searchParams.set("timeWindow", "120");
  return upstreamJson<LdbBoard>("RAIL DATA", fetchFn, url.toString(), {
    headers: { "x-apikey": apiKey, accept: "application/json", "user-agent": "kindle-dashboard/1.0" },
  });
}

function callsAt(service: LdbService, crs: string): boolean | null {
  if (service.destination?.some((d) => d.crs?.toUpperCase() === crs)) return true;
  const lists = service.subsequentCallingPoints;
  if (!lists) return null;
  return lists.some((l) => l.callingPoint?.some((p) => p.crs?.toUpperCase() === crs));
}

export function buildDepartures(board: LdbBoard, opts: BoardOptions): Departure[] {
  const max = opts.max ?? 3;
  const filter = opts.filterCrs.toUpperCase();
  const serverFiltered = (board.filtercrs ?? board.filterCrs ?? "").toUpperCase() === filter;

  const rows: { due: number; dep: Departure }[] = [];
  for (const s of board.trainServices ?? []) {
    const std = parseHhmm(s.std);
    if (std === null) continue;
    // Keep services the API filtered for us, or that we can see call at the
    // filter station. With no calling-point data either way, keep them.
    if (!serverFiltered && callsAt(s, filter) === false) continue;

    const etdRaw = (s.etd ?? "").trim();
    const etd = etdRaw.toLowerCase();
    const cancelled = s.isCancelled === true || etd.includes("cancel");
    const etdTime = parseHhmm(etdRaw);
    const expected = cancelled ? null : etdTime ?? (etd === "delayed" ? null : std);

    const due = minutesUntil(expected ?? std, opts.now);
    if (due < opts.walkMinutes) continue;

    let status: TrainStatus;
    let statusText: string;
    if (cancelled) {
      status = "cancelled";
      statusText = "CANCELLED";
    } else if (etdTime !== null && etdTime !== std) {
      status = minutesUntil(etdTime, std) > 0 ? "late" : "on-time";
      statusText = `EXP ${formatMinutes(etdTime)}`;
    } else if (etd === "delayed") {
      status = "delayed";
      statusText = "DELAYED";
    } else if (etd === "on time" || etdTime === std || etd === "") {
      status = "on-time";
      statusText = "ON TIME";
    } else {
      status = "other";
      statusText = etdRaw.toUpperCase();
    }

    const destination =
      (s.destination ?? [])
        .map((d) => d.locationName?.trim())
        .filter(Boolean)
        .join(" & ")
        .toUpperCase() || "UNKNOWN";

    rows.push({
      due: minutesUntil(std, opts.now),
      dep: {
        scheduled: formatMinutes(std),
        status,
        statusText,
        leaveBy: cancelled ? null : formatMinutes((expected ?? std) - opts.walkMinutes),
        destination,
      },
    });
  }
  rows.sort((a, b) => a.due - b.due);
  return rows.slice(0, max).map((r) => r.dep);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Service messages as one plain-text line, or null when there are none. */
export function serviceMessage(board: LdbBoard): string | null {
  const texts: string[] = [];
  for (const m of board.nrccMessages ?? []) {
    const raw = typeof m === "string" ? m : m.Value ?? m.value ?? m.message ?? "";
    const text = decodeEntities(raw.replace(/<br\s*\/?>|<\/p>/gi, " ").replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (text) texts.push(text);
  }
  return texts.length ? texts.join(" / ") : null;
}
