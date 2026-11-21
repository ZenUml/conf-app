import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The package's default entry bundles the session-replay recorder (rrweb,
// ~330 KB) into the boot path of every macro view. mixpanelClient.ts imports
// the async-modules loader instead; one direct `import ... from
// "mixpanel-browser"` anywhere in src/ would pull the full bundle back in.
const SRC = path.resolve(__dirname, "../..");
const SDK_IMPORT = /\bfrom\s+["']mixpanel-browser["'/]|import\(\s*["']mixpanel-browser["'/]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|mjs|vue)$/.test(entry.name) ? [full] : [];
  });
}

describe("mixpanelClient", () => {
  it("is the only module that imports the mixpanel-browser SDK", () => {
    const importers = sourceFiles(SRC)
      .filter((file) => SDK_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));
    expect(importers).toEqual(["utils/analytics/mixpanelClient.ts"]);
  });
});
