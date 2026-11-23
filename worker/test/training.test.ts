import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { clearMemoryCache } from "../src/cache";
import type { Env } from "../src/config";
import { handleRequest } from "../src/handler";
import { loadFont } from "../src/render";
import { addDays, bullets, buildTraining, isoWeekId, mainPace, parseFrontMatter, summarise } from "../src/training";
import { fixtureFetch, SAMPLE_PLAN, SAMPLE_TIME } from "../scripts/fixtures";

const font = loadFont(readFileSync(new URL("../fonts/VT323-Regular.ttf", import.meta.url)));
const env: Env = { ACCESS_TOKEN: "t", PLAN_REPO: "someone/training" };

beforeEach(() => clearMemoryCache());

describe("dates", () => {
  it("names ISO weeks, including across the new year", () => {
    expect(isoWeekId("2026-10-09")).toBe("2026-W41");
    expect(isoWeekId("2026-11-23")).toBe("2026-W48"); // Monday
    expect(isoWeekId("2026-11-29")).toBe("2026-W48"); // Sunday
    expect(isoWeekId("2027-01-01")).toBe("2026-W53");
    expect(isoWeekId("2027-01-04")).toBe("2027-W01");
    expect(isoWeekId("2025-12-29")).toBe("2026-W01");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});

describe("plan file", () => {
  it("reads the front matter", () => {
    const fm = parseFrontMatter(SAMPLE_PLAN);
    expect(fm.week).toBe("2026-W41");
    expect(fm.target_km).toBe("62.5");
    expect(fm.club_days).toBe("[mon, thu]");
    const sessions = fm.sessions as Record<string, string>[];
    expect(sessions).toHaveLength(5);
    expect(sessions[2].title).toBe("Gym: main session"); // quoted
    expect(sessions[0].note).toBe("Placeholder. The club sets it.\n"); // folded
    expect(sessions[1].prescription).toBe("Easy, 5:00 to 5:10. Slower is fine and quicker is not.\n");
    expect(sessions[3].prescription).toBe(
      "- 5.6 km easy at 5:00 to 5:15\n- 4x100m strides, relaxed, full walk-back\n\nRun first, gym after.\n",
    );
  });

  it("refuses a file without front matter", () => {
    expect(() => parseFrontMatter("# Just prose")).toThrow("NO FRONT MATTER");
  });

  it("lists the day's sessions, run before gym", () => {
    const t = buildTraining(SAMPLE_PLAN, "2026-W41", "2026-10-09", "TODAY");
    expect(t.found).toBe(true);
    expect(t.weekKm).toBe(62.5);
    expect(t.sessions.map((s) => [s.title, s.km])).toEqual([
      ["Easy run, with strides", 6],
      ["Gym: main session", null],
    ]);
    expect(t.line).toBe("EASY 6 KM AT 5:00/KM + STRIDES + GYM");
  });

  it("has nothing for a day without sessions, and says when there's no file", () => {
    expect(buildTraining(SAMPLE_PLAN, "2026-W41", "2026-10-06", "TODAY")).toMatchObject({ sessions: [], line: "REST DAY" });
    expect(buildTraining(null, "2026-W42", "2026-10-12", "TODAY")).toMatchObject({
      found: false,
      sessions: [],
      line: "NO PLAN FOR WEEK 42 YET",
    });
  });
});

describe("the one-line summary", () => {
  it("joins bullets, with continuation lines, and skips the explanation after them", () => {
    expect(bullets("- one\n- two\n  more\n\nWhy.")).toEqual(["one", "two more"]);
    expect(bullets("A paragraph.\n- not a list")).toEqual([]);
  });

  it("takes the pace from the main set, not the warm-up", () => {
    expect(mainPace("- 2 km warm up at 5:30\n- 6x2 min at 3:10 to 3:15\n- 2 km jog home\n")).toBe("3:10");
    expect(mainPace("Easy, 5:00 to 5:10. Day after the club session.\n")).toBe("5:00");
    expect(mainPace("Easy and short.\n")).toBeNull();
  });

  it("says each kind of session in a few words", () => {
    expect(summarise("easy", "Easy run", 8, "- 8 km easy at 5:00 to 5:10\n")).toBe("EASY 8 KM AT 5:00/KM");
    expect(summarise("easy", "Easy run", 4, "Easy and short.\n")).toBe("EASY 4 KM");
    expect(summarise("long", "Long run, easy", 14, "- 14 km easy at 4:50 to 5:05\n")).toBe("LONG RUN 14 KM AT 4:50/KM");
    expect(summarise("club", "Club session", 12, "")).toBe("CLUB SESSION 12 KM");
    expect(
      summarise("session", "6x2 min, short and sharp", 8.5, "- 2 km warm up\n- 6x2 min at 3:10 to 3:15, 2 min standing\n- 2 km jog home\n"),
    ).toBe("SESSION 8.5 KM: 6x2 min AT 3:10/KM");
    expect(summarise("session", "4x5 min sub-threshold, plus strides", 11, "- 4x5 min at 3:38 to 3:44\n")).toBe(
      "SESSION 11 KM: 4x5 min AT 3:38/KM",
    );
    expect(summarise("session", "6x60 s hills", 9, "- 6x60 s uphill at 3:45 to 4:00\n")).toBe("SESSION 9 KM: 6x60 s hills AT 3:45/KM");
    expect(summarise("race", "West District Championships", 13.5, "- Race, 8 km, run hard\n")).toBe("RACE: West District Championships");
    expect(summarise("race", "West League XC, run controlled", 10, "")).toBe("RACE: West League XC");
    expect(summarise("gym", "Gym — deload", null, "- Squats — 2 sets of 5 at 60kg\n")).toBe("GYM");
  });
});

describe("in the dashboard", () => {
  const get = (e: Env, f: typeof fetch, now = SAMPLE_TIME) =>
    handleRequest(new Request("https://example.workers.dev/?k=t&format=json"), e, undefined, font, f, now);

  it("is hidden unless a repository is configured", async () => {
    const model = await (await get({ ACCESS_TOKEN: "t" }, fixtureFetch())).json();
    expect(model.training).toBeNull();
  });

  it("fetches the week's file with the token", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const inner = fixtureFetch();
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("github")) seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      return inner(input, init);
    }) as typeof fetch;
    const model = await (await get({ ...env, GITHUB_TOKEN: "gh-test" }, f)).json();
    expect(seen).toEqual([
      {
        url: "https://api.github.com/repos/someone/training/contents/training-hq/plan/weeks/2026-W41.md?ref=main",
        auth: "Bearer gh-test",
      },
    ]);
    expect(model.training.ok).toBe(true);
    expect(model.training.data.when).toBe("TODAY");
    expect(model.training.data.sessions).toHaveLength(2);
  });

  it("moves on to tomorrow with the weather box", async () => {
    const evening = new Date("2026-10-09T17:30:00Z"); // 18:30 BST
    const model = await (await get(env, fixtureFetch(), evening)).json();
    expect(model.training.data).toMatchObject({ when: "TOMORROW", date: "2026-10-10", line: "SESSION 8.5 KM: 6x2 min AT 3:10/KM" });
  });

  it("goes back to today at midnight", async () => {
    const justBefore = new Date("2026-10-09T22:59:00Z"); // 23:59 BST on Friday
    const justAfter = new Date("2026-10-09T23:00:00Z"); // 00:00 BST on Saturday
    expect((await (await get(env, fixtureFetch(), justBefore)).json()).training.data).toMatchObject({ when: "TOMORROW", date: "2026-10-10" });
    clearMemoryCache();
    expect((await (await get(env, fixtureFetch(), justAfter)).json()).training.data).toMatchObject({ when: "TODAY", date: "2026-10-10" });
  });

  it("says when the week has no plan, and when GitHub fails", async () => {
    const none = await (await get(env, fixtureFetch({ plan: null }))).json();
    expect(none.training).toMatchObject({ ok: true, data: { found: false, week: "2026-W41" } });
    clearMemoryCache();
    const noRepo = (async (input: RequestInfo | URL) =>
      new Response("Not Found", { status: String(input).includes("api.github.com") ? 404 : 503 })) as unknown as typeof fetch;
    expect((await (await get(env, noRepo)).json()).training).toEqual({ ok: false, error: "PLAN_REPO NOT FOUND (GITHUB_TOKEN NOT SET)" });
    clearMemoryCache();
    expect((await (await get({ ...env, GITHUB_TOKEN: "x" }, noRepo)).json()).training).toEqual({
      ok: false,
      error: "GITHUB TOKEN CAN'T READ PLAN_REPO",
    });
    clearMemoryCache();
    const failing = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    const failed = await (await get(env, failing)).json();
    expect(failed.training).toEqual({ ok: false, error: "GITHUB HTTP 401" });
  });

  it("draws every case without failing", async () => {
    for (const [f, now] of [
      [fixtureFetch(), SAMPLE_TIME],
      [fixtureFetch(), new Date("2026-10-09T17:30:00Z")],
      [fixtureFetch({ plan: null }), SAMPLE_TIME],
      [(async () => new Response("no", { status: 500 })) as unknown as typeof fetch, SAMPLE_TIME],
    ] as const) {
      clearMemoryCache();
      const res = await handleRequest(new Request("https://example.workers.dev/?k=t"), env, undefined, font, f, now);
      expect(res.status).toBe(200);
    }
  });
});
