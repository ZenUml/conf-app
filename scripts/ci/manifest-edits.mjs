#!/usr/bin/env node
// Writes the per-variant manifest.yml edits from scripts/forge-wizard.mjs as a
// shell script, so staging, production and the wizard apply one list.
//
//   node scripts/ci/manifest-edits.mjs <lite|full|diagramly|asyncapi> manifest-edits.sh
//
// The workflow then runs it with the mikefarah/yq action (`sh manifest-edits.sh`),
// the same yq the hand-copied steps used. Needs no installed dependencies.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { getAppConfig } from '../forge-wizard.mjs'

const quote = (text) => `'${text.replace(/'/g, `'\\''`)}'`

export function manifestEditsScript(variant) {
  const lines = ['set -e']
  for (const edit of getAppConfig(variant).manifestEdits) {
    lines.push(`echo ${quote(`manifest.yml: ${edit.description}`)}`)
    lines.push(`yq eval ${quote(edit.yqEvalExpr)} -i manifest.yml`)
  }
  return `${lines.join('\n')}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [variant, out] = process.argv.slice(2)
  if (!variant || !out) {
    console.error('usage: manifest-edits.mjs <variant> <output.sh>')
    process.exit(64)
  }
  fs.writeFileSync(out, manifestEditsScript(variant))
  console.log(`Wrote ${getAppConfig(variant).manifestEdits.length} manifest edits for ${variant} to ${out}`)
}
