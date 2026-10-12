import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { clearMemoryCache } from "../src/cache";
import type { Env, KVLike } from "../src/config";
import { handleRequest } from "../src/handler";
import { loadFont } from "../src/render";
import { failingFetch, fixtureFetch, SAMPLE_TIME } from "../scripts/fixtures";

const font = loadFont(readFileSync(new URL("../fonts/VT323-Regular.ttf", import.meta.url)));
const env: Env = { ACCESS_TOKEN: "secret-token" };

class MemoryKV implements KVLike {
  store = new Map<string, string>();
  async get(key: string) {
    const v = this.store.get(key);
    return v === undefined ? null : JSON.parse(v);
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
}

function countingFetch(inner: typeof fetch) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return inner(input, init);
  }) as typeof fetch;
  return { f, calls };
}

const get = (query: string, e: Env, f: typeof fetch, now = SAMPLE_TIME) =>
  handleRequest(new Request(`https://example.workers.dev/${query}`), e, undefined, font, f, now);

beforeEach(() => clearMemoryCache());

describe("access", () => {
  it("returns 403 without the right token", async () => {
    expect((await get("", env, fixtureFetch())).status).toBe(403);
    expect((await get("?k=wrong", env, fixtureFetch())).status).toBe(403);
    expect((await get("?k=secret-token", {}, fixtureFetch())).status).toBe(403); // no secret configured
  });

  it("returns a PNG with the token", async () => {
    const res = await get("?k=secret-token&batt=82&next=06:54", env, fixtureFetch());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const png = new Uint8Array(await res.arrayBuffer());
    const view = new DataView(png.buffer);
    expect([view.getUint32(16), view.getUint32(20), png[24], png[25]]).toEqual([1072, 1448, 8, 0]);
  });
});

describe("data", () => {
  it("passes battery and next refresh through, and ignores junk", async () => {
    const ok = await (await get("?k=secret-token&batt=82&next=06:54&format=json", env, fixtureFetch())).json();
    expect([ok.battery, ok.nextRefresh]).toEqual([82, "06:54"]);
    const junk = await (await get("?k=secret-token&batt=lots&next=soon&format=json", env, fixtureFetch())).json();
    expect([junk.battery, junk.nextRefresh]).toEqual([null, null]);
  });

  it("marks failed sections instead of failing the request", async () => {
    const res = await get("?k=secret-token&format=json", { ...env, LIVE_TRAINS: "true", RDM_KEY: "x" }, failingFetch);
    const model = await res.json();
    expect(model.trains).toEqual({ ok: false, error: "RAIL DATA HTTP 503" });
    expect(model.weather).toEqual({ ok: false, error: "OPEN-METEO HTTP 503" });
    expect(model.headline).toEqual({ ok: false, error: "BBC HTTP 503" });
    const png = await get("?k=secret-token", { ...env, LIVE_TRAINS: "true", RDM_KEY: "x" }, failingFetch);
    expect(png.status).toBe(200);
  });

  it("uses mock trains unless the flag is on and RDM_KEY is set", async () => {
    const { f, calls } = countingFetch(fixtureFetch());
    const model = await (await get("?k=secret-token&format=json", { ...env, LIVE_TRAINS: "true" }, f)).json();
    expect(model.trainSource).toBe("mock");
    expect(calls.some((u) => u.includes("raildata"))).toBe(false);
  });

  it("calls the live board with the key header and Partick filter", async () => {
    let seen: { url: string; key: string | null } | null = null;
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("raildata")) {
        seen = { url, key: new Headers(init?.headers).get("x-apikey") };
        return Response.json({ filtercrs: "PTK", trainServices: [{ std: "06:56", etd: "On time", destination: [{ locationName: "Dalmuir" }] }] });
      }
      return fixtureFetch()(input, init);
    }) as typeof fetch;
    const model = await (await get("?k=secret-token&format=json", { ...env, LIVE_TRAINS: "true", RDM_KEY: "rdm-test" }, f)).json();
    expect(seen!.key).toBe("rdm-test");
    expect(seen!.url).toContain("/GetDepartureBoard/AXP?");
    expect(seen!.url).toContain("filterCrs=PTK");
    expect(model.trainSource).toBe("live");
    expect(model.trains.data.departures[0].destination).toBe("DALMUIR");
  });

  describe("looking past two hours", () => {
    const live = { ...env, LIVE_TRAINS: "true", RDM_KEY: "rdm-test" };
    const dep = (std: string, id: string) => ({ std, etd: "On time", serviceID: id, destination: [{ locationName: "Milngavie" }] });
    /** Answers the first board with `first` and the later one (timeOffset set) with `later`. */
    const boards = (first: object[], later: object[] | "fail") => {
      const urls: string[] = [];
      const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.includes("raildata")) return fixtureFetch()(input, init);
        urls.push(url);
        if (!url.includes("timeOffset")) return Response.json({ filtercrs: "PTK", trainServices: first });
        if (later === "fail") return new Response("Service Unavailable", { status: 503 });
        return Response.json({ filtercrs: "PTK", trainServices: later });
      }) as typeof fetch;
      return { f, urls };
    };
    const json = async (f: typeof fetch) => (await get("?k=secret-token&format=json", live, f)).json();

    it("fills empty rows from the next two hours", async () => {
      // 06:44 now: one train in the first board, more from 08:43 onwards (08:46 is in both).
      const { f, urls } = boards([dep("08:46", "A")], [dep("08:46", "A"), dep("09:16", "B"), dep("09:46", "C")]);
      const model = await json(f);
      expect(urls[1]).toContain("timeOffset=119");
      expect(urls[1]).toContain("timeWindow=120");
      expect(model.trains.data.departures.map((d: { scheduled: string }) => d.scheduled)).toEqual(["08:46", "09:16", "09:46"]);
      expect(model.trains.data.horizon).toBe(239);
    });

    it("shows the next train when none are due for two hours", async () => {
      const { f } = boards([], [dep("10:30", "D")]);
      const model = await json(f);
      expect(model.trains.data.departures.map((d: { scheduled: string }) => d.scheduled)).toEqual(["10:30"]);
    });

    it("doesn't ask when the first board has three trains", async () => {
      const { f, urls } = boards([dep("06:56", "A"), dep("07:26", "B"), dep("07:56", "C")], []);
      await json(f);
      expect(urls).toHaveLength(1);
    });

    it("keeps the first board if the later one fails", async () => {
      const { f } = boards([dep("06:56", "A")], "fail");
      const model = await json(f);
      expect(model.trains.ok).toBe(true);
      expect(model.trains.data.departures).toHaveLength(1);
      expect(model.trains.data.horizon).toBe(120);
    });
  });

  it("hides the headline when switched off", async () => {
    const model = await (await get("?k=secret-token&format=json", { ...env, SHOW_HEADLINE: "false" }, fixtureFetch())).json();
    expect(model.headline).toBeNull();
  });
});

describe("caching", () => {
  it("fetches weather once per 3 hours and the headline once per 30 minutes", async () => {
    const kv = new MemoryKV();
    const { f, calls } = countingFetch(fixtureFetch());
    const e = { ...env, CACHE: kv };
    const minutes = (m: number) => new Date(SAMPLE_TIME.getTime() + m * 60000);
    await get("?k=secret-token", e, f, minutes(0));
    clearMemoryCache(); // as if a new isolate: must come from KV
    await get("?k=secret-token", e, f, minutes(20));
    await get("?k=secret-token", e, f, minutes(40));
    await get("?k=secret-token", e, f, minutes(185));
    const weather = calls.filter((u) => u.includes("open-meteo")).length;
    const bbc = calls.filter((u) => u.includes("bbci")).length;
    expect(weather).toBe(2); // 0 and 185 min
    expect(bbc).toBe(3); // 0, 40 and 185 min
  });

  it("falls back to the last good forecast when a refresh fails", async () => {
    const kv = new MemoryKV();
    const e = { ...env, CACHE: kv };
    await get("?k=secret-token", e, fixtureFetch(), SAMPLE_TIME);
    const later = new Date(SAMPLE_TIME.getTime() + 4 * 3600 * 1000);
    const model = await (await get("?k=secret-token&format=json", e, failingFetch, later)).json();
    expect(model.weather.ok).toBe(true);
    expect(model.weather.asOf).toBe("06:44");
  });
});
