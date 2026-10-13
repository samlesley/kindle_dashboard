// Open-Meteo forecast: fetch, and turn into what the dashboard shows.

import type { Config } from "./config";
import { pad2, parseHhmm, type LondonTime } from "./time";
import { upstreamJson } from "./upstream";

export interface ForecastData {
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: (number | null)[];
    precipitation: (number | null)[];
    weather_code: number[];
    wind_gusts_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
  };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
}

export interface HourSlot {
  label: string;
  temp: number;
  chance: number;
}

export interface WeatherView {
  summary: string;
  high: { temp: number; at: string };
  low: { temp: number; at: string };
  rain: { totalMm: number; window: string | null };
  gusts: { mph: number; dir: string };
  hours: HourSlot[];
  /** The box under the strip: today, this evening or tomorrow, depending on the time. */
  outlook: string | null;
  sunrise: string | null;
  sunset: string | null;
}

export async function fetchForecast(lat: number, lon: number, fetchFn: typeof fetch = fetch): Promise<ForecastData> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m,wind_direction_10m",
  );
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("timezone", "Europe/London");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("forecast_days", "3");
  const data = await upstreamJson<ForecastData>("OPEN-METEO", fetchFn, url.toString());
  if (!Array.isArray(data?.hourly?.time) || !Array.isArray(data?.daily?.time)) throw new Error("OPEN-METEO BAD RESPONSE");
  return { hourly: data.hourly, daily: data.daily };
}

const CONDITIONS: [number[], string][] = [
  [[0], "CLEAR"],
  [[1], "MAINLY CLEAR"],
  [[2], "PARTLY CLOUDY"],
  [[3], "CLOUDY"],
  [[45, 48], "FOG"],
  [[51, 53, 55], "DRIZZLE"],
  [[56, 57], "FREEZING DRIZZLE"],
  [[61], "LIGHT RAIN"],
  [[63], "RAIN"],
  [[65], "HEAVY RAIN"],
  [[66, 67], "FREEZING RAIN"],
  [[71], "LIGHT SNOW"],
  [[73], "SNOW"],
  [[75], "HEAVY SNOW"],
  [[77], "SNOW GRAINS"],
  [[80], "LIGHT SHOWERS"],
  [[81], "SHOWERS"],
  [[82], "HEAVY SHOWERS"],
  [[85, 86], "SNOW SHOWERS"],
  [[95], "THUNDERSTORMS"],
  [[96, 99], "THUNDER AND HAIL"],
];

export function describeCode(code: number): string {
  return CONDITIONS.find(([codes]) => codes.includes(code))?.[1] ?? "UNSETTLED";
}

const isPrecipCode = (code: number) => code >= 51;
const isSnowCode = (code: number) => (code >= 71 && code <= 77) || code === 85 || code === 86;

export function compass(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

const hourOf = (iso: string) => Number(iso.slice(11, 13));
const dateOf = (iso: string) => iso.slice(0, 10);
const clockOf = (iso: string) => iso.slice(11, 16);
const roundTemp = (t: number) => Math.round(t) || 0; // avoid "-0"

/** Hours ahead the summary line looks at. */
export const WINDOW_HOURS = 18;

export function buildWeather(data: ForecastData, now: LondonTime, cfg: Config): WeatherView {
  const h = data.hourly;
  const i0 = h.time.indexOf(`${now.date}T${pad2(now.hour)}:00`);
  if (i0 < 0) throw new Error("FORECAST OUT OF DATE");
  const end = Math.min(h.time.length, i0 + WINDOW_HOURS);
  const chance = (i: number) => h.precipitation_probability[i] ?? 0;
  const precip = (i: number) => h.precipitation[i] ?? 0;
  const thr = cfg.rainChancePct;
  const temp = (i: number) => h.temperature_2m[i];
  /** Warmest (sign 1) or coldest (sign -1) hour in [from, to]; earliest wins ties. */
  const extreme = (from: number, to: number, sign: 1 | -1) => {
    let best = from;
    for (let i = from + 1; i <= to; i++) if (sign * (temp(i) - temp(best)) > 0) best = i;
    return best;
  };
  const lastOfDate = (date: string | undefined, from: number) => {
    let i = from;
    while (i + 1 < h.time.length && dateOf(h.time[i + 1]) === date) i++;
    return i;
  };

  // The boxes cover today only: high and low over the whole day, rain and
  // gusts over what is still to come today.
  let dayStart = i0;
  while (dayStart > 0 && dateOf(h.time[dayStart - 1]) === now.date) dayStart--;
  const dayEnd = lastOfDate(now.date, i0);
  const hi = extreme(dayStart, dayEnd, 1);
  const lo = extreme(dayStart, dayEnd, -1);
  let gust = i0;
  let total = 0;
  let firstWet = -1;
  let lastWet = -1;
  for (let i = i0; i <= dayEnd; i++) {
    if ((h.wind_gusts_10m[i] ?? 0) > (h.wind_gusts_10m[gust] ?? 0)) gust = i;
    total += precip(i);
    if (precip(i) >= 0.1) {
      if (firstWet < 0) firstWet = i;
      lastWet = i;
    }
  }
  const high = { temp: roundTemp(temp(hi)), at: clockOf(h.time[hi]) };
  const low = { temp: roundTemp(temp(lo)), at: clockOf(h.time[lo]) };
  const rainWindow =
    firstWet < 0 ? null : firstWet === lastWet ? `AROUND ${clockOf(h.time[firstWet])}` : `${clockOf(h.time[firstWet])}-${clockOf(h.time[lastWet])}`;

  // Hourly strip: now, then every 3 hours on the 00/03/06... grid.
  const hours: HourSlot[] = [{ label: "NOW", temp: roundTemp(h.temperature_2m[i0]), chance: Math.round(chance(i0)) }];
  for (let i = i0 + 1; i < h.time.length && hours.length < 6; i++) {
    if (hourOf(h.time[i]) % 3 === 0) hours.push({ label: clockOf(h.time[i]), temp: roundTemp(h.temperature_2m[i]), chance: Math.round(chance(i)) });
  }

  // One-line summary.
  const cond = describeCode(h.weather_code[i0]);
  const wet = (i: number) => chance(i) >= thr || isPrecipCode(h.weather_code[i]);
  let summary: string;
  if (wet(i0)) {
    let dry = -1;
    for (let i = i0 + 1; i < end; i++) {
      if (!wet(i)) {
        dry = i;
        break;
      }
    }
    const lead = isPrecipCode(h.weather_code[i0]) ? cond : `${cond}. ${isSnowCode(h.weather_code[i0]) ? "SNOW" : "RAIN"}`;
    summary = dry < 0 ? `${lead} ALL DAY.` : `${lead} UNTIL ${clockOf(h.time[dry])}.`;
  } else {
    let next = -1;
    for (let i = i0 + 1; i < end; i++) {
      if (chance(i) >= thr) {
        next = i;
        break;
      }
    }
    summary =
      next < 0 ? `${cond}. STAYING DRY.` : `${cond}. ${isSnowCode(h.weather_code[next]) ? "SNOW" : "RAIN"} FROM ${clockOf(h.time[next])}.`;
  }

  /** Rain (or snow) notice for the rain hours within [from, to], or null if it stays dry. */
  const rainNotice = (from: number, to: number): string | null => {
    const rainHours: number[] = [];
    for (let i = from; i <= to; i++) {
      const hr = hourOf(h.time[i]);
      if (hr >= cfg.rainFromHour && hr <= cfg.rainToHour && chance(i) >= thr) rainHours.push(i);
    }
    if (rainHours.length === 0) return null;
    const first = rainHours[0];
    let peak = first;
    for (const i of rainHours) {
      if (chance(i) > chance(peak) || (chance(i) === chance(peak) && precip(i) > precip(peak))) peak = i;
    }
    const snow = isSnowCode(h.weather_code[peak]);
    const what = snow ? "SNOW" : "RAIN";
    const when = first === i0 ? `${what} NOW` : `${what} FROM ${clockOf(h.time[first])}`;
    const peakText = peak === first ? "" : `, PEAK ${clockOf(h.time[peak])}`;
    return `${when}${peakText}. ${snow ? "TAKE CARE ON PAVEMENTS." : "TAKE AN UMBRELLA."}`;
  };

  /** The usual weather over the rain hours of [from, to]: wet or dry, whichever covers more hours, then the commonest code. */
  const typicalCode = (from: number, to: number): number => {
    const wetCodes: number[] = [];
    const dryCodes: number[] = [];
    for (let i = from; i <= to; i++) {
      const hr = hourOf(h.time[i]);
      if (hr >= cfg.rainFromHour && hr <= cfg.rainToHour) (isPrecipCode(h.weather_code[i]) ? wetCodes : dryCodes).push(h.weather_code[i]);
    }
    const codes = wetCodes.length > dryCodes.length ? wetCodes : dryCodes;
    const counts = new Map<number, number>();
    for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
    let best = h.weather_code[from];
    let bestCount = 0;
    for (const [c, n] of counts) {
      if (n > bestCount || (n === bestCount && c > best)) [best, bestCount] = [c, n];
    }
    return best;
  };

  /** One line about the hours [from, to]: the usual weather, low and high, rain (or dry), and warnings. */
  const outlookLine = (label: string, from: number, to: number): string => {
    const lo = roundTemp(temp(extreme(from, to, -1)));
    const hi = roundTemp(temp(extreme(from, to, 1)));
    const code = typicalCode(from, to);
    const rain = rainNotice(from, to);
    // A wet day with a rain warning: the warning says it, so skip "RAIN" up front.
    const sky = rain && isPrecipCode(code) ? "" : `${describeCode(code)}, `;
    const parts = [`${label}: ${sky}${lo === hi ? `${lo}°` : `${lo}° TO ${hi}°`}.`];
    if (rain) parts.push(rain);
    else if (!isPrecipCode(code)) parts.push("DRY.");
    if (lo < cfg.coldBelowC) parts.push("WRAP UP WARM.");
    if (hi > cfg.hotAboveC) parts.push("TAKE WATER.");
    return parts.join(" ");
  };

  // Outlook: the rest of today (after midnight, the new day), called "this
  // evening" from the afternoon, then tomorrow.
  let outlook: string | null = null;
  if (now.minutes >= cfg.tomorrowFrom) {
    const next = dayEnd + 1;
    if (next < h.time.length) outlook = outlookLine("TOMORROW", next, lastOfDate(dateOf(h.time[next]), next));
  } else {
    outlook = outlookLine(now.minutes >= cfg.eveningFrom ? "THIS EVENING" : "TODAY", i0, dayEnd);
  }

  // Sunrise/sunset: today's, or tomorrow's once today's sunset has passed.
  let d = data.daily.time.indexOf(now.date);
  const sunsetToday = d >= 0 ? parseHhmm(clockOf(data.daily.sunset[d] ?? "")) : null;
  if (d >= 0 && sunsetToday !== null && now.minutes > sunsetToday && d + 1 < data.daily.time.length) d++;

  return {
    summary,
    high,
    low,
    rain: { totalMm: total, window: rainWindow },
    gusts: { mph: Math.round(h.wind_gusts_10m[gust] ?? 0), dir: compass(h.wind_direction_10m[gust] ?? 0) },
    hours,
    outlook,
    sunrise: d >= 0 ? clockOf(data.daily.sunrise[d]) : null,
    sunset: d >= 0 ? clockOf(data.daily.sunset[d]) : null,
  };
}

export function formatRain(mm: number): string {
  if (mm < 0.05) return "0MM";
  if (mm < 1) return `${mm.toFixed(1)}MM`;
  return `${Math.round(mm)}MM`;
}
