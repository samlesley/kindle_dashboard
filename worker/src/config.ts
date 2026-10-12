// Worker environment and parsed configuration.

/** The subset of the Workers KV API this project uses. */
export interface KVLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  ACCESS_TOKEN?: string;
  RDM_KEY?: string;
  CACHE?: KVLike;

  LAT?: string;
  LON?: string;
  STATION_CRS?: string;
  STATION_NAME?: string;
  FILTER_CRS?: string;
  HEADING_TO?: string;
  WALK_MINUTES?: string;
  LEAVE_BY_MINUTES?: string;
  LIVE_TRAINS?: string;
  MOCK_SCENARIO?: string;
  LDB_URL?: string;
  RAIN_CHANCE_PCT?: string;
  RAIN_FROM_HOUR?: string;
  RAIN_TO_HOUR?: string;
  COLD_BELOW_C?: string;
  HOT_ABOVE_C?: string;
  TOMORROW_FROM_HOUR?: string;
  SHOW_HEADLINE?: string;
}

export type MockScenario = "normal" | "delayed" | "cancelled";

export interface Config {
  lat: number;
  lon: number;
  stationCrs: string;
  stationName: string;
  filterCrs: string;
  headingTo: string;
  walkMinutes: number;
  leaveByMinutes: number;
  liveTrains: boolean;
  mockScenario: MockScenario;
  ldbUrl: string;
  rainChancePct: number;
  rainFromHour: number;
  rainToHour: number;
  coldBelowC: number;
  hotAboveC: number;
  tomorrowFromHour: number;
  showHeadline: boolean;
}

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

const bool = (v: unknown, fallback: boolean): boolean => {
  if (typeof v === "boolean") return v;
  if (v === undefined || v === null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
};

export function parseScenario(v: unknown): MockScenario | undefined {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "normal" || s === "delayed" || s === "cancelled" ? s : undefined;
}

export function loadConfig(env: Env): Config {
  return {
    lat: num(env.LAT, 55.8637),
    lon: num(env.LON, -4.2107),
    stationCrs: (env.STATION_CRS || "AXP").toUpperCase(),
    stationName: (env.STATION_NAME || "ALEXANDRA PARADE").toUpperCase(),
    filterCrs: (env.FILTER_CRS || "PTK").toUpperCase(),
    headingTo: (env.HEADING_TO || "QUEEN ST / PARTICK").toUpperCase(),
    walkMinutes: Math.max(0, Math.round(num(env.WALK_MINUTES, 4))),
    leaveByMinutes: Math.max(0, Math.round(num(env.LEAVE_BY_MINUTES, 5))),
    liveTrains: bool(env.LIVE_TRAINS, false),
    mockScenario: parseScenario(env.MOCK_SCENARIO) ?? "normal",
    ldbUrl: (env.LDB_URL || "https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepartureBoard").replace(/\/+$/, ""),
    rainChancePct: num(env.RAIN_CHANCE_PCT, 50),
    rainFromHour: num(env.RAIN_FROM_HOUR, 7),
    rainToHour: num(env.RAIN_TO_HOUR, 22),
    coldBelowC: num(env.COLD_BELOW_C, 3),
    hotAboveC: num(env.HOT_ABOVE_C, 22),
    tomorrowFromHour: num(env.TOMORROW_FROM_HOUR, 17),
    showHeadline: bool(env.SHOW_HEADLINE, true),
  };
}
