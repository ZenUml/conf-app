#!/usr/bin/env node
/**
 * link-agent-skills.mjs
 *
 * Mirror every skill directory under `.claude/skills/` as a link inside
 * `.agents/skills/`, so tools that look in `.agents/skills/` see the same
 * skills as Claude Code without duplicating any files.
 *
 * Cross-platform by design:
 *   - macOS / Linux: relative symlinks  (e.g. ../../.claude/skills/spot-check)
 *   - Windows:       directory junctions (no admin / Developer Mode required;
 *                    a `dir` symlink on Windows WOULD need elevation, a
 *                    junction does not)
 *
 * The generated links are NOT committed (they are git-ignored). Run this after
 * cloning or whenever skills are added/removed:
 *
 *   pnpm link:skills          # or: node scripts/link-agent-skills.mjs
 *
 * The script is idempotent and self-healing: it refreshes existing links and
 * prunes links whose source skill no longer exists. It never deletes a real
 * (non-link) directory in the destination — it warns and skips instead.
 */

import {
  readdirSync,
  existsSync,
  mkdirSync,
  lstatSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(repoRoot, '.claude', 'skills');
const destDir = join(repoRoot, '.agents', 'skills');
const isWindows = process.platform === 'win32';

/** Is the path a link we own (symlink on POSIX, symlink/junction on Windows)? */
function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function pathExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(srcDir)) {
  console.error(`✗ Source directory not found: ${srcDir}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

const skills = readdirSync(srcDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let created = 0;
let refreshed = 0;
let skipped = 0;

for (const name of skills) {
  const linkPath = join(destDir, name);
  const target = join(srcDir, name);

  if (pathExists(linkPath)) {
    if (isLink(linkPath)) {
      rmSync(linkPath, { force: true });
      refreshed++;
    } else {
      // A real file/dir lives here — never destroy it.
      console.warn(`⚠ Skipping ${name}: a non-link already exists at ${linkPath}`);
      skipped++;
      continue;
    }
  } else {
    created++;
  }

  if (isWindows) {
    // Junctions require an absolute target and work without elevation.
    symlinkSync(target, linkPath, 'junction');
  } else {
    // Relative symlink keeps the repo portable across machines.
    const relTarget = relative(dirname(linkPath), target);
    symlinkSync(relTarget, linkPath, 'dir');
  }
}

// Prune stale links whose source skill was removed.
let pruned = 0;
if (existsSync(destDir)) {
  for (const entry of readdirSync(destDir)) {
    if (entry === '.gitkeep') continue;
    const p = join(destDir, entry);
    if (isLink(p) && !existsSync(join(srcDir, entry))) {
      rmSync(p, { force: true });
      pruned++;
      console.log(`✗ Pruned stale link: ${entry}`);
    }
  }
}

const mode = isWindows ? 'junctions' : 'symlinks';
console.log(
  `✓ ${skills.length} skill ${mode} in .agents/skills/ ` +
    `(${created} created, ${refreshed} refreshed, ${skipped} skipped, ${pruned} pruned)`,
);
