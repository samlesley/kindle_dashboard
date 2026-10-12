// Gathers everything the dashboard shows. Each section succeeds or fails on
// its own, so one broken upstream never stops the image being drawn.

import { cached, type WaitUntil } from "./cache";
import type { Config, KVLike, MockScenario } from "./config";
import { fetchTopStory } from "./headline";
import { londonTime, parseHhmm, formatMinutes, type LondonTime } from "./time";
import { buildDepartures, fetchLiveBoard, serviceMessage, type Departure, type LdbBoard } from "./trains/ldb";
import { mockBoard } from "./trains/mock";
import { buildWeather, fetchForecast, type WeatherView } from "./weather";

export type Section<T> = { ok: true; data: T; asOf?: string } | { ok: false; error: string };

export interface TrainsData {
  departures: Departure[];
  message: string | null;
}

export interface DashboardModel {
  now: LondonTime;
  stationName: string;
  headingTo: string;
  walkMinutes: number;
  trainSource: "live" | "mock";
  mockScenario?: MockScenario;
  trains: Section<TrainsData>;
  weather: Section<WeatherView>;
  /** null when the headline is switched off. */
  headline: Section<string> | null;
  battery: number | null;
  nextRefresh: string | null;
}

export interface Deps {
  fetch: typeof fetch;
  rdmKey?: string;
  kv?: KVLike;
  ctx?: WaitUntil;
}

export interface ClientParams {
  battery?: string | null;
  next?: string | null;
  scenario?: MockScenario;
}

const WEATHER_FRESH_MS = 3 * 60 * 60 * 1000;
const WEATHER_KEEP_MS = 24 * 60 * 60 * 1000;
const HEADLINE_FRESH_MS = 30 * 60 * 1000;
const HEADLINE_KEEP_MS = 12 * 60 * 60 * 1000;

export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.toUpperCase().slice(0, 80);
}

export function parseBattery(v: string | null | undefined): number | null {
  if (v === null || v === undefined || !/^\s*\d{1,3}\s*$/.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n <= 100 ? n : null;
}

export function parseNext(v: string | null | undefined): string | null {
  const m = parseHhmm(v);
  return m === null ? null : formatMinutes(m);
}

export async function gatherDashboard(cfg: Config, deps: Deps, at: Date, params: ClientParams = {}): Promise<DashboardModel> {
  const now = londonTime(at);
  const nowMs = at.getTime();
  const live = cfg.liveTrains && !!deps.rdmKey;
  const scenario = params.scenario ?? cfg.mockScenario;

  const trainsTask = (async (): Promise<TrainsData> => {
    const board: LdbBoard = live
      ? await fetchLiveBoard(cfg.ldbUrl, cfg.stationCrs, cfg.filterCrs, deps.rdmKey!, deps.fetch)
      : mockBoard(scenario, now.minutes, cfg.walkMinutes);
    return {
      departures: buildDepartures(board, {
        filterCrs: cfg.filterCrs,
        walkMinutes: cfg.walkMinutes,
        leaveByMinutes: cfg.leaveByMinutes,
        now: now.minutes,
      }),
      message: serviceMessage(board),
    };
  })();

  const weatherTask = (async () => {
    const forecast = await cached({
      key: `wx:v1:${cfg.lat.toFixed(3)},${cfg.lon.toFixed(3)}`,
      freshMs: WEATHER_FRESH_MS,
      keepMs: WEATHER_KEEP_MS,
      now: nowMs,
      kv: deps.kv,
      ctx: deps.ctx,
      fetcher: () => fetchForecast(cfg.lat, cfg.lon, deps.fetch),
    });
    return { view: buildWeather(forecast.value, now, cfg), stale: forecast.stale, fetchedAt: forecast.fetchedAt };
  })();

  const headlineTask = cfg.showHeadline
    ? cached({
        key: "bbc:v1",
        freshMs: HEADLINE_FRESH_MS,
        keepMs: HEADLINE_KEEP_MS,
        now: nowMs,
        kv: deps.kv,
        ctx: deps.ctx,
        fetcher: () => fetchTopStory(deps.fetch),
      })
    : null;

  const [trains, weather, headline] = await Promise.allSettled([trainsTask, weatherTask, headlineTask ?? Promise.resolve(null)]);

  return {
    now,
    stationName: cfg.stationName,
    headingTo: cfg.headingTo,
    walkMinutes: cfg.walkMinutes,
    trainSource: live ? "live" : "mock",
    mockScenario: live ? undefined : scenario,
    trains: trains.status === "fulfilled" ? { ok: true, data: trains.value } : { ok: false, error: errorText(trains.reason) },
    weather:
      weather.status === "fulfilled"
        ? {
            ok: true,
            data: weather.value.view,
            asOf: weather.value.stale ? londonTime(new Date(weather.value.fetchedAt)).hhmm : undefined,
          }
        : { ok: false, error: errorText(weather.reason) },
    headline: !headlineTask
      ? null
      : headline.status === "fulfilled" && headline.value
        ? { ok: true, data: headline.value.value }
        : { ok: false, error: headline.status === "rejected" ? errorText(headline.reason) : "NO HEADLINE" },
    battery: parseBattery(params.battery),
    nextRefresh: parseNext(params.next),
  };
}
