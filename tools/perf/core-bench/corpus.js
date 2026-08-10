// Prefer a real production corpus (gitignored, produced by fetch-corpus.mjs);
// fall back to the committed synthetic sample so a fresh clone still runs.
//
// Fetched at runtime rather than imported: Vite resolves static/dynamic imports
// at transform time, so a missing diagrams.json is a hard 500 that try/catch
// cannot recover from.
async function load(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

let diagrams;
try {
  diagrams = await load('/diagrams.json');
} catch {
  diagrams = await load('/diagrams.sample.json');
  console.warn('[core-bench] no diagrams.json — using synthetic sample. Run fetch-corpus.mjs for the real corpus.');
}
export default diagrams;
