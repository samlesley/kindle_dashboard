// Cloudflare Worker entry point: GET /?k=TOKEN[&batt=82&next=06:54] -> PNG.

import fontData from "../fonts/VT323-Regular.ttf";
import type { Env } from "./config";
import { handleRequest } from "./handler";
import { loadFont } from "./render";
import { warmUp } from "./render/warmup";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Global scope runs once per isolate, at startup (see render/warmup.ts).
const font = loadFont(fontData);
try {
  warmUp(font);
} catch (err) {
  console.error("warm-up failed", err);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Wrapped so fetch is never called with a foreign `this`.
      return await handleRequest(request, env, ctx, font, (input, init) => fetch(input, init));
    } catch (err) {
      console.error("render failed", err);
      // A non-200 tells the Kindle to keep showing its last good image.
      return new Response("Render failed", { status: 500, headers: { "cache-control": "no-store" } });
    }
  },
};
