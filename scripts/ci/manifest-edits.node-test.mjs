import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

import { getManifestEditYqArgs } from '../forge-wizard.mjs'
import { manifestEditsScript } from './manifest-edits.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const VARIANTS = ['lite', 'full', 'diagramly', 'asyncapi']
const hasYq = spawnSync('yq', ['--version']).status === 0

const workflow = (name) => yaml.load(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8'))
const steps = (wf) => Object.values(wf.jobs).flatMap((job) => job.steps ?? [])
const editsManifest = (step) => step.uses === 'mikefarah/yq@master' && /manifest\.yml/.test(step.with?.cmd ?? '')

test('the edits script has one yq line per forge-wizard edit, in order', () => {
  for (const variant of VARIANTS) {
    const lines = manifestEditsScript(variant).split('\n').filter((line) => line.startsWith('yq '))
    assert.equal(lines.length, getManifestEditYqArgs(variant).length, variant)
  }
  assert.throws(() => manifestEditsScript('nope'), /Unknown app/)
})

test('applying the script equals applying each forge-wizard edit', { skip: !hasYq && 'yq not installed' }, () => {
  const base = fs.readFileSync(path.join(root, 'manifest.yml'), 'utf8')
  const normalised = (file) => execFileSync('yq', ['-o=json', 'sort_keys(..)', file]).toString()
  for (const variant of VARIANTS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `manifest-edits-${variant}-`))
    const viaScript = path.join(dir, 'manifest.yml')
    const direct = path.join(dir, 'direct.yml')
    fs.writeFileSync(viaScript, base)
    fs.writeFileSync(direct, base)
    fs.writeFileSync(path.join(dir, 'manifest-edits.sh'), manifestEditsScript(variant))
    execFileSync('sh', ['manifest-edits.sh'], { cwd: dir, stdio: 'ignore' })
    for (const { expr } of getManifestEditYqArgs(variant)) execFileSync('yq', ['eval', expr, '-i', direct])
    assert.equal(normalised(viaScript), normalised(direct), variant)
  }
})

// Staging, production and the personal whimet4 deploy used to carry hand
// copies of these edits; they drifted (#383/#460, the Diagramly admin page,
// whimet4's byline). Each workflow now writes the script from forge-wizard.mjs
// and runs it with the same yq action.
for (const [file, variantExpr, allowed] of [
  ['staging-deploy.yml', '${{ needs.resolve.outputs.variant }}', ['Speed up the conversion trigger on staging']],
  ['release.yml', '${{ steps.properties.outputs.license }}', []],
  ['deploy-whimet4.yml', '$VARIANT', []],
]) {
  test(`${file} applies the forge-wizard edits and carries no hand-copied ones`, () => {
    const all = steps(workflow(file))
    const write = all.findIndex((s) => (s.run ?? '').includes('node scripts/ci/manifest-edits.mjs'))
    assert.ok(write >= 0, 'writes manifest-edits.sh')
    assert.match(all[write].run, new RegExp(`manifest-edits\\.mjs "${variantExpr.replace(/[$.{}]/g, '\\$&')}" manifest-edits\\.sh`))
    const apply = all[write + 1]
    assert.equal(apply.uses, 'mikefarah/yq@master')
    assert.equal(apply.with.cmd.trim(), 'sh manifest-edits.sh')
    const handCopies = all.filter(editsManifest).map((s) => s.name).filter((name) => !allowed.includes(name))
    assert.deepEqual(handCopies, [])
    const upload = all.findIndex((s) => s.name === 'Upload final manifest')
    assert.ok(upload > write + 1, 'edits run before the manifest is uploaded')
  })
}
