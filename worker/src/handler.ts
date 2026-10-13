// Request handling, kept free of Worker-only imports so tests and the
// preview script can call it directly.

import type { WaitUntil } from "./cache";
import { loadConfig, parseScenario, type Env } from "./config";
import { gatherDashboard } from "./dashboard";
import { renderDashboardPng } from "./render";
import type { Font } from "./render/text";

const NO_STORE = { "cache-control": "no-store" };

/** Constant-time comparison (hashing first makes the lengths equal). */
export async function tokenMatches(given: string | null, expected: string | undefined): Promise<boolean> {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: WaitUntil | undefined,
  font: Font,
  fetchFn: typeof fetch,
  now: Date = new Date(),
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: NO_STORE });
  }
  const url = new URL(request.url);
  if (!(await tokenMatches(url.searchParams.get("k"), env.ACCESS_TOKEN))) {
    return new Response("Forbidden", { status: 403, headers: NO_STORE });
  }

  const cfg = loadConfig(env);
  const model = await gatherDashboard(cfg, { fetch: fetchFn, rdmKey: env.RDM_KEY, kv: env.CACHE, ctx }, now, {
    battery: url.searchParams.get("batt"),
    next: url.searchParams.get("next"),
    scenario: parseScenario(url.searchParams.get("mock")),
  });

  if (url.searchParams.get("format") === "json") {
    return new Response(JSON.stringify(model, null, 2), {
      headers: { ...NO_STORE, "content-type": "application/json; charset=utf-8" },
    });
  }

  const png = renderDashboardPng(font, model);
  return new Response(request.method === "HEAD" ? null : png, {
    headers: { ...NO_STORE, "content-type": "image/png", "content-length": String(png.length) },
  });
}
