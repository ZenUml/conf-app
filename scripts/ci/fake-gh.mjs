import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// Test helper: runs `run` with a fake `gh` first on PATH, so the real
// execFileSync('gh', ...) call sites execute unchanged. `routes` maps a substring
// of the gh command line to the stdout the fake prints for it (first match wins);
// any other command fails.
export async function withFakeGh(routes, run) {
  const directory = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const path = process.env.PATH;
  try {
    const cases = Object.entries(routes).map(([match, stdout], index) => {
      const file = join(directory, `response-${index}`);
      writeFileSync(file, stdout);
      return `  *'${match}'*) exec cat '${file}' ;;`;
    });
    const script = join(directory, 'gh');
    writeFileSync(script, `#!/bin/sh\ncase "$*" in\n${cases.join('\n')}\n  *) echo "fake gh: unexpected command: $*" >&2; exit 1 ;;\nesac\n`);
    chmodSync(script, 0o755);
    process.env.PATH = `${directory}${delimiter}${path}`;
    return await run();
  } finally {
    process.env.PATH = path;
    rmSync(directory, { recursive: true, force: true });
  }
}

// GitHub returns about 13 KB per workflow run, so a full per_page=100 listing is over
// 1 MiB, the default execFileSync maxBuffer. `child` is the run the caller looks for.
export function largeRunListing(child) {
  const run = (id, display_title) => ({ id, display_title, status: 'completed', conclusion: 'success', run_attempt: 1,
    html_url: `https://example.test/runs/${id}`, repository: { description: 'x'.repeat(13000) } });
  const workflow_runs = [run(child.id, child.display_title), ...Array.from({ length: 99 }, (_, i) => run(i + 1, `other ${i}`))];
  const listing = JSON.stringify({ total_count: workflow_runs.length, workflow_runs });
  if (Buffer.byteLength(listing) <= 1024 * 1024) throw new Error('fixture must exceed the 1 MiB default maxBuffer');
  return listing;
}
