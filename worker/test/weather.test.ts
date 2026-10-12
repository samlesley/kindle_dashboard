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
    expect(w.notices).toEqual(["RAIN FROM 15:00, PEAK 18:00. TAKE AN UMBRELLA."]);
    expect([w.sunrise, w.sunset]).toEqual(["07:31", "18:28"]);
  });

  it("adds cold and hot notices", () => {
    const cold = buildWeather(sampleForecast({ tempOffset: -6 }), londonTime(SAMPLE_TIME), cfg);
    expect(cold.notices).toContain("LOW OF 1° AT 06:00. WRAP UP WARM.");
    const hot = buildWeather(sampleForecast({ tempOffset: 11 }), londonTime(SAMPLE_TIME), cfg);
    expect(hot.notices).toContain("HIGH OF 24° AT 15:00. TAKE WATER.");
  });

  it("has no notice on a dry, mild day", () => {
    const f = sampleForecast();
    f.hourly.precipitation_probability = f.hourly.precipitation_probability.map(() => 10);
    f.hourly.precipitation = f.hourly.precipitation.map(() => 0);
    f.hourly.weather_code = f.hourly.weather_code.map(() => 2);
    const w = buildWeather(f, londonTime(SAMPLE_TIME), cfg);
    expect(w.notices).toEqual([]);
    expect(w.summary).toBe("PARTLY CLOUDY. STAYING DRY.");
    expect(w.rain.window).toBeNull();
  });

  it("says when rain has already started", () => {
    const w = buildWeather(sampleForecast(), at("2026-10-09T15:10:00Z"), cfg); // 16:10 BST
    expect(w.summary).toBe("RAIN UNTIL 00:00.");
    expect(w.notices[0]).toBe("RAIN NOW, PEAK 18:00. TAKE AN UMBRELLA.");
  });

  it("describes tomorrow from 17:00, rain and all", () => {
    const before = buildWeather(sampleForecast(), at("2026-10-09T15:59:00Z"), cfg); // 16:59 BST
    expect(before.notices[0]).toBe("RAIN NOW, PEAK 18:00. TAKE AN UMBRELLA.");
    const w = buildWeather(sampleForecast(), at("2026-10-09T16:00:00Z"), cfg); // 17:00 BST
    expect(w.notices).toEqual(["TOMORROW: CLOUDY, 7° TO 13°. RAIN FROM 15:00, PEAK 18:00. TAKE AN UMBRELLA."]);
    const late = buildWeather(sampleForecast(), at("2026-10-09T21:30:00Z"), cfg); // 22:30 BST
    expect(late.notices).toEqual(w.notices);
    expect(late.sunrise).toBe("07:31"); // tomorrow's, as today's sunset has passed
  });

  it("describes tomorrow even when nothing is worth a warning", () => {
    const f = sampleForecast();
    f.hourly.precipitation_probability = f.hourly.precipitation_probability.map(() => 10);
    f.hourly.weather_code = f.hourly.weather_code.map(() => 2);
    const w = buildWeather(f, at("2026-10-09T17:30:00Z"), cfg); // 18:30 BST
    expect(w.notices).toEqual(["TOMORROW: PARTLY CLOUDY, 7° TO 13°. DRY."]);
  });

  it("adds cold and hot warnings to tomorrow's line", () => {
    const cold = buildWeather(sampleForecast({ tempOffset: -6 }), at("2026-10-09T19:00:00Z"), cfg); // 20:00 BST
    expect(cold.notices).toEqual(["TOMORROW: CLOUDY, 1° TO 7°. RAIN FROM 15:00, PEAK 18:00. TAKE AN UMBRELLA. WRAP UP WARM."]);
    const hot = buildWeather(sampleForecast({ tempOffset: 11 }), at("2026-10-09T19:00:00Z"), cfg);
    expect(hot.notices[0]).toMatch(/^TOMORROW: CLOUDY, 18° TO 24°\. .* TAKE WATER\.$/);
  });

  it("names a wet day by its rain when most hours are wet", () => {
    const f = sampleForecast();
    f.hourly.weather_code = f.hourly.weather_code.map(() => 61);
    f.hourly.precipitation_probability = f.hourly.precipitation_probability.map(() => 30);
    const w = buildWeather(f, at("2026-10-09T19:00:00Z"), cfg);
    expect(w.notices).toEqual(["TOMORROW: LIGHT RAIN, 7° TO 13°."]); // not "DRY", though below the rain-chance threshold
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
    expect(w.notices.some((n) => n.startsWith("LOW"))).toBe(false);
  });

  it("rejects a forecast that doesn't cover now", () => {
    expect(() => buildWeather(sampleForecast(), at("2026-11-01T12:00:00Z"), cfg)).toThrow("FORECAST OUT OF DATE");
  });

  it("formats compass points and rain totals", () => {
    expect([compass(0), compass(44), compass(225), compass(350)]).toEqual(["N", "NE", "SW", "N"]);
    expect([formatRain(0), formatRain(0.44), formatRain(6.2)]).toEqual(["0MM", "0.4MM", "6MM"]);
  });
});
