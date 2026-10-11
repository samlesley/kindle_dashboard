import { describe, expect, it } from "vitest";
import { formatMinutes, londonTime, minutesUntil, parseHhmm } from "../src/time";

describe("London time", () => {
  it("uses BST in summer and GMT in winter", () => {
    const bst = londonTime(new Date("2026-10-09T05:44:00Z"));
    expect(bst).toMatchObject({ date: "2026-10-09", hhmm: "06:44", weekday: "FRIDAY", dayMonth: "09 OCT" });
    const gmt = londonTime(new Date("2026-12-01T23:30:00Z"));
    expect(gmt).toMatchObject({ date: "2026-12-01", hhmm: "23:30", weekday: "TUESDAY", dayMonth: "01 DEC" });
  });

  it("switches at the clock change", () => {
    // Clocks go back at 01:00 UTC on Sunday 25 October 2026.
    expect(londonTime(new Date("2026-10-25T00:59:00Z")).hhmm).toBe("01:59");
    expect(londonTime(new Date("2026-10-25T01:00:00Z")).hhmm).toBe("01:00");
    expect(londonTime(new Date("2026-10-24T23:30:00Z")).hhmm).toBe("00:30");
  });

  it("parses and formats clock times", () => {
    expect(parseHhmm("06:56")).toBe(416);
    expect(parseHhmm("On time")).toBeNull();
    expect(parseHhmm("24:00")).toBeNull();
    expect(formatMinutes(416 - 4)).toBe("06:52");
    expect(formatMinutes(-3)).toBe("23:57");
  });

  it("measures minutes across midnight", () => {
    expect(minutesUntil(10, 23 * 60 + 50)).toBe(20);
    expect(minutesUntil(23 * 60 + 50, 10)).toBe(-20);
    expect(minutesUntil(420, 400)).toBe(20);
  });
});
