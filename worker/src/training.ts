// Today's training, read from the weekly plan files in the training repo
// (`training-hq/plan/weeks/<iso-week>.md`). Those files are YAML front matter
// that scripts read, then prose for the athlete. Only the front matter's
// `sessions` list is used here, and only a few fields of each session.
//
// There's no YAML library in the bundle, so `parseFrontMatter` reads the
// subset the plan files are written in: block mappings and sequences, plain
// and quoted scalars, and `|` / `>` block scalars. Flow collections such as
// `club_days: [mon, thu]` are kept as plain strings; nothing here needs them.

import { upstream } from "./upstream";

export interface PlannedSession {
  id: string;
  kind: string;
  title: string;
  km: number | null;
  /** One short line on what to do, or null when the title says it all. */
  detail: string | null;
}

export interface TrainingView {
  /** "TODAY" or "TOMORROW". */
  when: string;
  /** YYYY-MM-DD of the day shown. */
  date: string;
  /** e.g. 2026-W48 */
  week: string;
  weekKm: number | null;
  /** False when the repository has no plan file for that week. */
  found: boolean;
  /** Empty when nothing is planned for the day. */
  sessions: PlannedSession[];
}

type Yaml = string | Yaml[] | { [key: string]: Yaml };

interface Line {
  indent: number;
  text: string;
}

const SLOT_ORDER = ["am", "pm", "gym"];

// --- dates ----------------------------------------------------------------

/** ISO week id ("2026-W48") for a YYYY-MM-DD date. */
export function isoWeekId(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // the Thursday of this week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// --- YAML subset ----------------------------------------------------------

/** The YAML between the opening and closing `---`, parsed. */
export function parseFrontMatter(md: string): { [key: string]: Yaml } {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(md);
  if (!m) throw new Error("PLAN FILE HAS NO FRONT MATTER");
  const lines = m[1].split(/\r?\n/).map((raw) => {
    const text = raw.replace(/\s+$/, "");
    return { indent: text.length - text.trimStart().length, text: text.trimStart() };
  });
  const state = { i: 0 };
  const root = parseBlock(lines, state, 0);
  if (typeof root !== "object" || Array.isArray(root)) throw new Error("PLAN FRONT MATTER IS NOT A MAPPING");
  return root;
}

const isBlank = (l: Line) => l.text === "" || l.text.startsWith("#");

function skipBlank(lines: Line[], state: { i: number }): void {
  while (state.i < lines.length && isBlank(lines[state.i])) state.i++;
}

function parseBlock(lines: Line[], state: { i: number }, indent: number): Yaml {
  skipBlank(lines, state);
  const first = lines[state.i];
  if (!first || first.indent < indent) return "";
  return first.text === "-" || first.text.startsWith("- ") ? parseSeq(lines, state, first.indent) : parseMap(lines, state, first.indent);
}

function parseSeq(lines: Line[], state: { i: number }, indent: number): Yaml[] {
  const out: Yaml[] = [];
  for (skipBlank(lines, state); state.i < lines.length; skipBlank(lines, state)) {
    const line = lines[state.i];
    if (line.indent !== indent || !(line.text === "-" || line.text.startsWith("- "))) break;
    const rest = line.text.slice(1).trimStart();
    if (rest === "") {
      state.i++;
      out.push(parseBlock(lines, state, indent + 1));
    } else if (keyOf(rest)) {
      // "- key: value" starts a mapping whose keys sit two columns in.
      const childIndent = indent + (line.text.length - rest.length);
      lines[state.i] = { indent: childIndent, text: rest };
      out.push(parseMap(lines, state, childIndent));
    } else {
      state.i++;
      out.push(scalar(rest));
    }
  }
  return out;
}

function keyOf(text: string): [string, string] | null {
  const m = /^("[^"]*"|'[^']*'|[^\s#'"][^:#]*?)\s*:(?:\s+(.*)|$)/.exec(text);
  return m ? [unquote(m[1]), m[2] ?? ""] : null;
}

function parseMap(lines: Line[], state: { i: number }, indent: number): { [key: string]: Yaml } {
  const out: { [key: string]: Yaml } = {};
  for (skipBlank(lines, state); state.i < lines.length; skipBlank(lines, state)) {
    const line = lines[state.i];
    if (line.indent !== indent) break;
    const kv = keyOf(line.text);
    if (!kv) break;
    const [key, rest] = kv;
    state.i++;
    const block = /^([|>])([+-]?)\d*\s*(#.*)?$/.exec(rest);
    if (block) out[key] = blockScalar(lines, state, indent, block[1] === ">", block[2]);
    else if (rest === "" || rest.startsWith("#")) out[key] = parseBlock(lines, state, indent + 1);
    else out[key] = scalar(rest);
  }
  return out;
}

function blockScalar(lines: Line[], state: { i: number }, parentIndent: number, folded: boolean, chomp: string): string {
  const body: Line[] = [];
  let indent = -1;
  while (state.i < lines.length) {
    const line = lines[state.i];
    if (line.text !== "") {
      if (line.indent <= parentIndent) break;
      if (indent < 0) indent = line.indent;
      if (line.indent < indent) break;
    }
    body.push(line);
    state.i++;
  }
  while (body.length && body[body.length - 1].text === "") body.pop();
  const raw = body.map((l) => (l.text === "" ? "" : " ".repeat(l.indent - indent) + l.text));
  let text: string;
  if (!folded) text = raw.join("\n");
  else {
    // Folded: single newlines become spaces, blank lines become newlines.
    text = "";
    for (let k = 0; k < raw.length; k++) {
      const l = raw[k];
      if (l === "") text += "\n";
      else text += (k > 0 && raw[k - 1] !== "" ? " " : "") + l;
    }
  }
  return chomp === "-" ? text : `${text}\n`;
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(["\\nt])/g, (_, c: string) => ({ n: "\n", t: "\t" })[c] ?? c);
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function scalar(rest: string): string {
  const t = rest.trim();
  if (t.startsWith('"') || t.startsWith("'")) {
    const q = t[0];
    const end = q === '"' ? /^"(?:[^"\\]|\\.)*"/.exec(t) : /^'(?:[^']|'')*'/.exec(t);
    return unquote(end ? end[0] : t);
  }
  return t.replace(/\s+#.*$/, "");
}

// --- sessions -------------------------------------------------------------

const str = (v: Yaml | undefined): string => (typeof v === "string" ? v : "");

const num = (v: Yaml | undefined): number | null => {
  const n = Number.parseFloat(str(v));
  return Number.isFinite(n) ? n : null;
};

/** Bullet items in a prescription; a line not starting "- " continues the bullet above. */
export function bullets(text: string): string[] {
  const items: string[] = [];
  let inList = false;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") {
      if (items.length) break; // the list is over; what follows is explanation
      continue;
    }
    if (t.startsWith("- ")) {
      items.push(t.slice(2).trim());
      inList = true;
    } else if (inList) items[items.length - 1] += ` ${t}`;
    else return []; // a paragraph comes first, so this isn't a list
  }
  return items;
}

const firstSentence = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(flat);
  return (m ? m[1] : flat).replace(/\.$/, "");
};

const ROUTINE = /^(?:[\d.]+\s*km\s+)?(?:warm[ -]?up|cool[ -]?down|jog(?:ged)?)\b/i;

/** One short line on what to do. */
export function sessionDetail(kind: string, prescription: string): string | null {
  if (kind === "club") return "SET BY THE CLUB";
  if (!prescription.trim()) return null;
  const items = bullets(prescription);
  if (!items.length) return firstSentence(prescription);
  // Gym bullets read "Squats — 2 sets of 5, at 60kg and 70kg": the names are enough.
  if (kind === "gym") return items.map((b) => b.split(/\s+[—–]\s+/)[0]).join(" · ");
  // Warm-ups and jogs home take up the line and are the same every time.
  const main = items.filter((b) => !ROUTINE.test(b));
  return (main.length ? main : items).join(" · ");
}

export function sessionsOn(frontMatter: { [key: string]: Yaml }, ymd: string): PlannedSession[] {
  const list = frontMatter.sessions;
  if (!Array.isArray(list)) return [];
  const slot = (id: string) => {
    const k = SLOT_ORDER.indexOf(id.split("-").pop() ?? "");
    return k < 0 ? SLOT_ORDER.length : k;
  };
  return list
    .filter((s): s is { [key: string]: Yaml } => typeof s === "object" && !Array.isArray(s) && str(s.date) === ymd)
    .map((s) => {
      const kind = str(s.kind).toLowerCase();
      return {
        id: str(s.id),
        kind,
        title: str(s.title) || kind.toUpperCase(),
        km: num(s.target_km),
        detail: sessionDetail(kind, str(s.prescription)),
      };
    })
    .sort((a, b) => slot(a.id) - slot(b.id));
}

// --- fetching -------------------------------------------------------------

export interface PlanSource {
  /** owner/name */
  repo: string;
  branch: string;
  /** Folder holding the <iso-week>.md files. */
  dir: string;
  token?: string;
}

/**
 * The week's plan file from GitHub, or null when the repository has no file
 * for that week. Uses the contents API, which also works for a private
 * repository given a token with read access to its contents.
 */
export async function fetchWeekPlan(src: PlanSource, week: string, fetchFn: typeof fetch): Promise<string | null> {
  const path = `${src.dir.replace(/^\/+|\/+$/g, "")}/${week}.md`.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${src.repo}/contents/${path}?ref=${encodeURIComponent(src.branch)}`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github.raw+json",
    "user-agent": "kindle-dashboard/1.0",
    "x-github-api-version": "2022-11-28",
  };
  if (src.token) headers.authorization = `Bearer ${src.token}`;
  try {
    const res = await upstream("GITHUB", fetchFn, url, { headers });
    return await res.text();
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "GITHUB HTTP 404") throw err;
  }
  // GitHub also answers 404 for a private repository the token can't read.
  // Only if the repository itself is visible does 404 mean "no plan that week".
  try {
    await upstream("GITHUB", fetchFn, `https://api.github.com/repos/${src.repo}`, { headers });
  } catch (err) {
    if (err instanceof Error && err.message === "GITHUB HTTP 404") {
      throw new Error(src.token ? "GITHUB TOKEN CAN'T READ PLAN_REPO" : "PLAN_REPO NOT FOUND (GITHUB_TOKEN NOT SET)");
    }
    throw err;
  }
  return null;
}

export function buildTraining(md: string | null, week: string, ymd: string, when: string): TrainingView {
  if (md === null) return { when, date: ymd, week, weekKm: null, found: false, sessions: [] };
  const fm = parseFrontMatter(md);
  return { when, date: ymd, week, weekKm: num(fm.target_km), found: true, sessions: sessionsOn(fm, ymd) };
}
