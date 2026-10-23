import { plantumlEncode } from './encode';
import { svgUrl } from './serverUrl';

export interface PlantUmlSvgResponse {
  ok: boolean;
  status: number;
  /** Read even for non-2xx: a 400 still carries the "Syntax Error?" SVG. */
  svgText: string;
}

// The viewer validates (fetch #1) and then renders (fetch #2) the same code —
// at once on first mount, after a 500 ms debounce on edits: two identical
// round trips to plantuml.com (#929). Share one: in-flight requests are
// joined, and a completed response is reused for longer than debounce +
// validation take. A network failure is not cached.
const RESULT_TTL_MS = 5000;
const inFlight = new Map<string, Promise<PlantUmlSvgResponse>>();
const results = new Map<string, { response: PlantUmlSvgResponse; at: number }>();

export function fetchPlantUmlSvg(code: string): Promise<PlantUmlSvgResponse> {
  const encoded = plantumlEncode(code.trim());
  const now = Date.now();
  for (const [key, entry] of results) {
    if (now - entry.at >= RESULT_TTL_MS) results.delete(key);
  }
  const cached = results.get(encoded);
  if (cached) return Promise.resolve(cached.response);
  const pending = inFlight.get(encoded);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetch(svgUrl(encoded));
    return { ok: response.ok, status: response.status, svgText: await response.text() };
  })();
  inFlight.set(encoded, request);
  request.then(
    (response) => {
      inFlight.delete(encoded);
      results.set(encoded, { response, at: Date.now() });
    },
    () => inFlight.delete(encoded),
  );
  return request;
}

/** Test hook: forget completed responses so each spec starts cold. */
export function clearPlantUmlSvgCache(): void {
  results.clear();
}
