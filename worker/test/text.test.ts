import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadFont } from "../src/render";

const font = loadFont(readFileSync(new URL("../fonts/VT323-Regular.ttf", import.meta.url)));

describe("text", () => {
  it("measures VT323 as monospaced, 0.4 em per character", () => {
    expect(font.measure("06:56", 50)).toBe(100);
    expect(font.measure("ON TIME", 37.5)).toBe(105);
  });

  it("shortens text to fit", () => {
    expect(font.fit("SHORT", 30, 1000)).toBe("SHORT");
    const cut = font.fit("A VERY LONG DESTINATION NAME", 30, 120);
    expect(cut.endsWith("...")).toBe(true);
    expect(font.measure(cut, 30)).toBeLessThanOrEqual(120);
  });

  it("wraps onto a limited number of lines", () => {
    const lines = font.wrap("ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT", 25, 150, 2); // 15 chars per line
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("ONE TWO THREE");
    expect(lines[1].endsWith("...")).toBe(true);
    expect(font.wrap("FITS", 25, 150, 2)).toEqual(["FITS"]);
  });

  it("keeps characters the font has and replaces ones it lacks", () => {
    expect(font.clean("Queen St \u2013 \u2018Partick\u2019")).toBe("Queen St \u2013 \u2018Partick\u2019");
    expect(font.clean("Train \u{1F686} late")).toBe("Train ? late");
  });
});
