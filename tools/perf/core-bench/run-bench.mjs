import { chromium } from "@playwright/test";

const REPS = Number(process.env.REPS || 5);
const N = Number(process.env.N || 16);
const matrix = [];
for (const mode of ['serial', 'concurrent'])
  for (const v of ['old', 'new', 'v4'])
    matrix.push({ mode, v });

const browser = await chromium.launch();
const results = {};

for (const { mode, v } of matrix) {
  const key = `${mode}/${v}`;
  results[key] = [];
  for (let i = 0; i < REPS; i++) {
    // fresh context each rep: no module cache, no JIT warm-up carryover
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`http://localhost:5599/?v=${v}&mode=${mode}&n=${N}`);
    await page.waitForFunction(() => document.title === 'BENCH_DONE', { timeout: 120000 });
    results[key].push(await page.evaluate(() => window.__bench));
    await ctx.close();
  }
}
await browser.close();

const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`\nreps=${REPS}  n=${N}  (median across reps)\n`);
console.log('mode        ver   core      wall_ms   per-diagram median   per-diagram max');
console.log('─'.repeat(78));
for (const [key, runs] of Object.entries(results)) {
  const [mode, v] = key.split('/');
  console.log(
    `${mode.padEnd(11)} ${v.padEnd(5)} ${String(runs[0].coreVersion).padEnd(9)} ` +
    `${String(med(runs.map(r => r.wall_ms))).padStart(7)}   ` +
    `${String(med(runs.map(r => r.median_ms))).padStart(17)}   ` +
    `${String(med(runs.map(r => r.max_ms))).padStart(14)}`
  );
}
for (const mode of ['serial', 'concurrent']) {
  // Labels come from the versions actually loaded, not hardcoded — the aliases
  // in package.json are meant to be re-pointed.
  const at = (slot) => {
    const runs = results[`${mode}/${slot}`];
    return { v: String(runs[0].coreVersion), ms: med(runs.map((r) => r.wall_ms)) };
  };
  const o = at('old'), n = at('new'), f = at('v4');
  const pct = (x, base) => `${((x / base - 1) * 100).toFixed(1)}%`;
  console.log(
    `\n${mode}: ${o.v} ${o.ms}ms → ${n.v} ${n.ms}ms (${pct(n.ms, o.ms)})` +
    ` → ${f.v} ${f.ms}ms (${pct(f.ms, o.ms)} vs base, ${pct(f.ms, n.ms)} vs ${n.v})`
  );
}

console.log('\nspread (wall_ms per rep):');
for (const [key, runs] of Object.entries(results)) {
  console.log(`  ${key.padEnd(18)} ${runs.map(r => r.wall_ms).join(', ')}`);
}
