// Writes sample dashboard PNGs to preview/ without deploying anything.
//
//   npm run preview         offline sample data at Fri 09 Oct 06:44
//   npm run preview:live    real Open-Meteo + BBC data at the current time
//                           (trains stay mock unless RDM_KEY is set in your shell)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clearMemoryCache } from "../src/cache";
import { loadConfig, type Env, type MockScenario } from "../src/config";
import { gatherDashboard } from "../src/dashboard";
import { loadFont, renderDashboardPng } from "../src/render";
import { failingFetch, fixtureFetch, SAMPLE_LONG_HEADLINE, SAMPLE_TIME } from "./fixtures";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "preview");
mkdirSync(outDir, { recursive: true });

const font = loadFont(readFileSync(join(root, "fonts", "VT323-Regular.ttf")));
const live = process.argv.includes("--live");

// Defaults from wrangler.toml [vars].
const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
const vars: Record<string, string> = {};
const varsBlock = toml.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
for (const line of varsBlock.split("\n")) {
  const m = /^\s*([A-Z_]+)\s*=\s*"([^"]*)"/.exec(line);
  if (m) vars[m[1]] = m[2];
}
const env: Env = { ...vars };
const cfg = loadConfig(env);

async function write(name: string, png: Uint8Array) {
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${(png.length / 1024).toFixed(0)} KB)`);
}

const params = { battery: "82", next: "06:54" };

if (live) {
  const rdmKey = process.env.RDM_KEY;
  const liveCfg = { ...cfg, liveTrains: !!rdmKey };
  const model = await gatherDashboard(liveCfg, { fetch, rdmKey }, new Date(), params);
  await write("live", renderDashboardPng(font, model));
} else {
  const scenarios: MockScenario[] = ["normal", "delayed", "cancelled"];
  for (const scenario of scenarios) {
    clearMemoryCache();
    const fetchFn = fixtureFetch({ headline: scenario === "delayed" ? SAMPLE_LONG_HEADLINE : undefined });
    const model = await gatherDashboard({ ...cfg, liveTrains: false }, { fetch: fetchFn }, SAMPLE_TIME, { ...params, scenario });
    await write(scenario, renderDashboardPng(font, model));
  }

  // Every upstream failing: shows how missing sections are marked.
  clearMemoryCache();
  const model = await gatherDashboard({ ...cfg, liveTrains: true }, { fetch: failingFetch, rdmKey: "unused" }, SAMPLE_TIME, params);
  await write("unavailable", renderDashboardPng(font, model));
}
