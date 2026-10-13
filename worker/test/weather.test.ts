import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { londonTime } from "../src/time";
import { buildWeather, compass, formatRain } from "../src/weather";
import { sampleForecast, SAMPLE_TIME } from "../scripts/fixtures";

const cfg = loadConfig({});
const at = (iso: string) => londonTime(new Date(iso));

describe("weather", () => {
  it("matches the mockup for the sample forecast", () => {
    const w = buildWeather(sampleForecast(), londonTime(SAMPLE_TIME), cfg);
    expect(w.summary).toBe("CLOUDY. RAIN FROM 15:00.");
    expect(w.high).toEqual({ temp: 13, at: "15:00" });
    expect(w.low).toEqual({ temp: 7, at: "06:00" });
    expect(formatRain(w.rain.totalMm)).toBe("6MM");
    expect(w.rain.window).toBe("15:00-23:00");
    expect(w.gusts).toEqual({ mph: 35, dir: "SW" });
    expect(w.hours).toEqual([
      { label: "NOW", temp: 7, chance: 0 },
      { label: "09:00", temp: 8, chance: 5 },
      { label: "12:00", temp: 12, chance: 15 },
      { label: "15:00", temp: 13, chance: 70 },
      { label: "18:00", temp: 11, chance: 85 },
      { label: "21:00", temp: 9, chance: 60 },
    ]);
    expect(w.outlook).toBe("TODAY: CLOUDY, 7° TO 13°. RAIN FROM 15:00, PEAK 18:00. TAKE AN UMBRELLA.");
    expect([w.sunrise, w.sunset]).toEqual(["07:31", "18:28"]);
  });

  it("adds cold and hot warnings", () => {
    const cold = buildWeather(sampleForecast({ tempOffset: -6 }), londonTime(SAMPLE_TIME), cfg);
    expect(cold.outlook).toBe("TODAY: CLOUDY, 1° TO 7°. RAIN FROM 15:00, PEAK 18:00. TAKE AN UMBRELLA. WRAP UP WARM.");
    const hot = buildWeather(sampleForecast({ tempOffset: 11 }), londonTime(SAMPLE_TIME), cfg);
    expect(hot.outlook).toMatch(/^TODAY: CLOUDY, 18° TO 24°\. .* TAKE WATER\.$/);
  });

  it("still fills the box on a dry, mild day", () => {
    const f = sampleForecast();
    f.hourly.precipitation_probability = f.hourly.precipitation_probability.map(() => 10);
    f.hourly.precipitation = f.hourly.precipitation.map(() => 0);
    f.hourly.weather_code = f.hourly.weather_code.map(() => 2);
    const w = buildWeather(f, londonTime(SAMPLE_TIME), cfg);
    expect(w.outlook).toBe("TODAY: PARTLY CLOUDY, 7° TO 13°. DRY.");
    expect(w.summary).toBe("PARTLY CLOUDY. STAYING DRY.");
    expect(w.rain.window).toBeNull();
    // Same in the evening, for tomorrow.
    expect(buildWeather(f, at("2026-10-09T17:30:00Z"), cfg).outlook).toBe("TOMORROW: PARTLY CLOUDY, 7° TO 13°. DRY."); // 18:30 BST
  });

  it("covers what is left of today until 15:00", () => {
    // 14:59 BST: mostly wet from here, so the rain warning leads.
    const w = buildWeather(sampleForecast(), at("2026-10-09T13:59:00Z"), cfg);
    expect(w.outlook).toBe("TODAY: 8° TO 13°. RAIN FROM 15:00, PEAK 18:00. TAKE AN UMBRELLA.");
  });

  it("covers this evening from 15:00", () => {
    expect(buildWeather(sampleForecast(), at("2026-10-09T14:00:00Z"), cfg).outlook).toBe(
      "THIS EVENING: 8° TO 13°. RAIN NOW, PEAK 18:00. TAKE AN UMBRELLA.", // 15:00 BST
    );
    const w = buildWeather(sampleForecast(), at("2026-10-09T16:10:00Z"), cfg); // 17:10 BST
    expect(w.summary).toBe("RAIN UNTIL 00:00.");
    expect(w.outlook).toBe("THIS EVENING: 8° TO 12°. RAIN NOW, PEAK 18:00. TAKE AN UMBRELLA.");
    expect(buildWeather(sampleForecast(), at("2026-10-09T17:29:00Z"), cfg).outlook).toBe(
      "THIS EVENING: 8° TO 11°. RAIN NOW. TAKE AN UMBRELLA.", // 18:29 BST
    );
  });

  it("covers tomorrow from 18:30, then the new day after midnight", () => {
    const evening = buildWeather(sampleForecast(), at("2026-10-09T17:30:00Z"), cfg); // 18:30 BST
    expect(evening.outlook).toBe("TOMORROW: CLOUDY, 7° TO 13°. RAIN FROM 15:00, PEAK 18:00. TAKE AN UMBRELLA.");
    const late = buildWeather(sampleForecast(), at("2026-10-09T21:30:00Z"), cfg); // 22:30 BST
    expect(late.outlook).toBe(evening.outlook);
    expect(late.sunrise).toBe("07:31"); // tomorrow's, as today's sunset has passed
    const night = buildWeather(sampleForecast(), at("2026-10-10T01:00:00Z"), cfg); // 02:00 BST
    expect(night.outlook).toBe("TODAY: CLOUDY, 7° TO 13°. RAIN FROM 15:00, PEAK 18:00. TAKE AN UMBRELLA.");
  });

  it("adds cold and hot warnings to tomorrow's line", () => {
    const cold = buildWeather(sampleForecast({ tempOffset: -6 }), at("2026-10-09T19:00:00Z"), cfg); // 20:00 BST
    expect(cold.outlook).toBe("TOMORROW: CLOUDY, 1° TO 7°. RAIN FROM 15:00, PEAK 18:00. TAKE AN UMBRELLA. WRAP UP WARM.");
    const hot = buildWeather(sampleForecast({ tempOffset: 11 }), at("2026-10-09T19:00:00Z"), cfg);
    expect(hot.outlook).toMatch(/^TOMORROW: CLOUDY, 18° TO 24°\. .* TAKE WATER\.$/);
  });

  it("names a wet day by its rain when most hours are wet", () => {
    const f = sampleForecast();
    f.hourly.weather_code = f.hourly.weather_code.map(() => 61);
    f.hourly.precipitation_probability = f.hourly.precipitation_probability.map(() => 30);
    const w = buildWeather(f, at("2026-10-09T19:00:00Z"), cfg);
    expect(w.outlook).toBe("TOMORROW: LIGHT RAIN, 7° TO 13°."); // not "DRY", though below the rain-chance threshold
  });

  it("takes its times from the config", () => {
    const early = loadConfig({ EVENING_FROM: "14:00", TOMORROW_FROM: "16:00" });
    expect(buildWeather(sampleForecast(), at("2026-10-09T13:00:00Z"), early).outlook).toMatch(/^THIS EVENING: /); // 14:00 BST
    expect(buildWeather(sampleForecast(), at("2026-10-09T15:00:00Z"), early).outlook).toMatch(/^TOMORROW: /); // 16:00 BST
  });

  it("keeps the boxes within today", () => {
    // Warmer after midnight than this afternoon: the high must still be today's.
    const f = sampleForecast();
    f.hourly.temperature_2m[24 + 1] = 16; // 01:00 tomorrow
    const morning = buildWeather(f, at("2026-10-09T07:16:00Z"), cfg); // 08:16 BST
    expect(morning.high).toEqual({ temp: 13, at: "15:00" });

    // High and low cover the whole day, including hours already gone.
    const noon = buildWeather(f, at("2026-10-09T11:00:00Z"), cfg); // 12:00 BST
    expect(noon.low).toEqual({ temp: 7, at: "06:00" });

    // Rain and gusts cover what is still to come today.
    const later = buildWeather(f, at("2026-10-09T15:10:00Z"), cfg); // 16:10 BST
    expect(later.rain.window).toBe("16:00-23:00");
    expect(later.rain.totalMm).toBeCloseTo(5.6);
  });

  it("only warns about cold that is still to come", () => {
    // Low of 2° at 06:00 has passed by noon; the rest of the day stays above 3°.
    const w = buildWeather(sampleForecast({ tempOffset: -5 }), at("2026-10-09T11:00:00Z"), cfg);
    expect(w.low).toEqual({ temp: 2, at: "06:00" });
    expect(w.outlook).not.toContain("WRAP UP WARM");
  });

  it("rejects a forecast that doesn't cover now", () => {
    expect(() => buildWeather(sampleForecast(), at("2026-11-01T12:00:00Z"), cfg)).toThrow("FORECAST OUT OF DATE");
  });

  it("formats compass points and rain totals", () => {
    expect([compass(0), compass(44), compass(225), compass(350)]).toEqual(["N", "NE", "SW", "N"]);
    expect([formatRain(0), formatRain(0.44), formatRain(6.2)]).toEqual(["0MM", "0.4MM", "6MM"]);
  });
});
