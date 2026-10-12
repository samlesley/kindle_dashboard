// Writes the Kindle's clock digits and their positions to
// kindle/dashboard/clock/ (see src/clock.ts). Run it after changing the
// clock's font, size or position; test/clock.test.ts fails until you do.
//
//   npm run clock

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clockFiles } from "../src/clock";
import { loadFont } from "../src/render";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "..", "kindle", "dashboard", "clock");
mkdirSync(outDir, { recursive: true });

const font = loadFont(readFileSync(join(root, "fonts", "VT323-Regular.ttf")));
for (const [name, data] of clockFiles(font)) writeFileSync(join(outDir, name), data);
console.log(`wrote ${outDir}`);
