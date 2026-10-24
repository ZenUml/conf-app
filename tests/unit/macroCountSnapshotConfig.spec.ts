import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('macro-count snapshot deployment bindings', () => {
  it.each([
    ['wrangler-stg.toml', 'conf-macro-count-snapshots-stg'],
    ['wrangler-prod.toml', 'conf-macro-count-snapshots-prod'],
    ['wrangler-dev.toml', 'conf-macro-count-snapshots-dev'],
  ])('%s uses a dedicated R2 bucket', (file, bucket) => {
    const config = fs.readFileSync(file, 'utf8')
    expect(config).toContain('binding = "MACRO_COUNT_SNAPSHOT_BUCKET"')
    expect(config).toContain(`bucket_name = "${bucket}"`)
  })

  it('routes the complete snapshot endpoint family to Pages Functions', () => {
    const routes = JSON.parse(fs.readFileSync('public/_routes.json', 'utf8'))
    expect(routes.include).toContain('/metrics-cache/snapshot/*')
  })
})
