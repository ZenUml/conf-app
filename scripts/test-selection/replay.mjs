#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { args, classify, readDiff } from './classify.mjs';
export function evaluate(selection, fixture) {
  if (!Array.isArray(fixture.expected_categories) || !fixture.reviewed_by) throw new Error('Reviewed expected_categories and reviewed_by required');
  const selected = selection.mode === 'all' ? fixture.expected_categories : Object.entries(selection.categories).filter(([, c]) => c.selected).map(([id]) => id);
  const misses = fixture.expected_categories.filter(id => !selected.includes(id));
  const tests = fixture.tests ?? [];
  const included = tests.filter(t => selection.mode === 'all' || t.smoke || t.categories.some(id => selected.includes(id)));
  return { id: fixture.id, base_sha: selection.base_sha, head_sha: selection.head_sha, reviewed_by: fixture.reviewed_by, expected_categories: fixture.expected_categories, probabilities: selection.categories, fallback_reason: selection.fallback_reason, misses, selected_test_ids: included.map(t => t.id), missed_test_ids: tests.filter(t => t.categories.some(id => fixture.expected_categories.includes(id)) && !included.some(chosen => chosen.id === t.id)).map(t => t.id), selected_fraction: tests.length ? included.length / tests.length : null, estimated_selected_duration_ms: tests.length && included.every(t => Number.isFinite(t.duration_ms)) ? included.reduce((n, t) => n + t.duration_ms, 0) : null, calibration: 'not-established' };
}
async function main() {
  const a = args(process.argv.slice(2)); const fixtures = JSON.parse(readFileSync(a.input, 'utf8')); const records = [];
  for (const fixture of fixtures) { const selection = fixture.selection ?? await classify({ diff: readDiff(fixture.base, fixture.head), apiKey: process.env.TYPESAFE_API_KEY }); records.push(evaluate(selection, fixture)); }
  writeFileSync(a.output, JSON.stringify({ schema_version: 1, calibration: 'not-established', records }, null, 2) + '\n');
  console.log(`Replay recorded ${records.length} reviewed changes; ${records.reduce((n, r) => n + r.misses.length, 0)} category misses.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Replay failed'); process.exitCode = 1; });
