// Fetch from an upstream API, turning failures into short labels that can
// be shown on the screen (e.g. "OPEN-METEO HTTP 503", "BBC TIMED OUT").

const TIMEOUT_MS = 8000;

export async function upstream(name: string, fetchFn: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new Error(`${name} ${timedOut ? "TIMED OUT" : "UNREACHABLE"}`);
  }
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
  return res;
}

export async function upstreamJson<T>(name: string, fetchFn: typeof fetch, url: string, init: RequestInit = {}): Promise<T> {
  const res = await upstream(name, fetchFn, url, init);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${name} BAD RESPONSE`);
  }
}
