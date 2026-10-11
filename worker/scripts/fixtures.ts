// Offline sample data for the preview script and tests. The forecast
// reproduces the numbers in docs/mockup.png (Fri 09 Oct, 06:44).

import type { ForecastData } from "../src/weather";

export const SAMPLE_TIME = new Date("2026-10-09T05:44:00Z"); // 06:44 BST

export const SAMPLE_HEADLINE = "[TOP STORY HEADLINE FROM THE BBC NEWS FEED]";
export const SAMPLE_LONG_HEADLINE =
  "[SAMPLE] A LONGER TOP STORY HEADLINE FROM THE BBC NEWS FEED, WHICH WRAPS ONTO A SECOND LINE WHEN THERE IS ROOM FOR IT";

// Hour-by-hour values for 06:00-23:00 on the sample day.
const TEMP: Record<number, number> = {
  0: 8, 1: 8, 2: 7.6, 3: 7.4, 4: 7.2, 5: 7.1, 6: 7, 7: 7.2, 8: 7.6, 9: 8.2, 10: 9.6, 11: 11, 12: 12.1,
  13: 12.6, 14: 12.9, 15: 13.2, 16: 12.6, 17: 11.8, 18: 11, 19: 10.4, 20: 9.8, 21: 9.2, 22: 8.8, 23: 8.4,
};
const CHANCE: Record<number, number> = {
  0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 5, 9: 5, 10: 5, 11: 10, 12: 15, 13: 30, 14: 45, 15: 70,
  16: 75, 17: 80, 18: 85, 19: 80, 20: 70, 21: 60, 22: 55, 23: 40,
};
const PRECIP: Record<number, number> = { 15: 0.4, 16: 0.6, 17: 0.8, 18: 1.2, 19: 1.0, 20: 0.8, 21: 0.6, 22: 0.4, 23: 0.2 };
const GUST: Record<number, number> = { 12: 22, 13: 25, 14: 28, 15: 30, 16: 32, 17: 34, 18: 35, 19: 33, 20: 29, 21: 26 };

export interface ForecastTweaks {
  /** Added to every temperature. */
  tempOffset?: number;
}

export function sampleForecast(tweaks: ForecastTweaks = {}): ForecastData {
  const days = ["2026-10-09", "2026-10-10", "2026-10-11"];
  const hourly: ForecastData["hourly"] = {
    time: [],
    temperature_2m: [],
    precipitation_probability: [],
    precipitation: [],
    weather_code: [],
    wind_gusts_10m: [],
    wind_direction_10m: [],
  };
  for (const day of days) {
    for (let hr = 0; hr < 24; hr++) {
      hourly.time.push(`${day}T${String(hr).padStart(2, "0")}:00`);
      hourly.temperature_2m.push(TEMP[hr] + (tweaks.tempOffset ?? 0));
      hourly.precipitation_probability.push(CHANCE[hr]);
      hourly.precipitation.push(PRECIP[hr] ?? 0);
      hourly.weather_code.push(hr >= 15 ? 63 : 3);
      hourly.wind_gusts_10m.push(GUST[hr] ?? 18);
      hourly.wind_direction_10m.push(225);
    }
  }
  return {
    hourly,
    daily: {
      time: days,
      sunrise: days.map((d) => `${d}T07:31`),
      sunset: days.map((d) => `${d}T18:28`),
    },
  };
}

export function sampleRss(headline: string): string {
  const esc = headline.replace(/&/g, "&amp;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title><![CDATA[BBC News]]></title>
<item><title><![CDATA[${esc}]]></title><link>https://www.bbc.co.uk/news</link></item>
<item><title><![CDATA[Second story]]></title></item>
</channel></rss>`;
}

/** A fetch that serves the sample forecast and RSS feed. */
export function fixtureFetch(opts: { headline?: string; forecast?: ForecastData } = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("open-meteo.com")) return Response.json(opts.forecast ?? sampleForecast());
    if (url.includes("bbci.co.uk")) return new Response(sampleRss(opts.headline ?? SAMPLE_HEADLINE));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

/** A fetch where every upstream is down. */
export const failingFetch = (async () => new Response("Service Unavailable", { status: 503 })) as unknown as typeof fetch;
