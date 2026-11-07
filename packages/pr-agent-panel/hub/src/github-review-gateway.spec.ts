import { describe, expect, it } from 'vitest'
import { ciFromRollup, withReviewMaterials } from './github-review-gateway'

describe('marked PR review materials', () => {
  it('puts material above the original body and replaces only the marked section', () => {
    const original = 'Original paragraph\n\n## Existing section\nKeep this.'
    const first = withReviewMaterials(original, '## Problem and value\nEvidence A')
    expect(first.indexOf('## Problem and value')).toBeLessThan(first.indexOf('Original paragraph'))
    const updated = withReviewMaterials(first, '## Problem and value\nEvidence B')
    expect(updated).toContain(original)
    expect(updated).toContain('Evidence B')
    expect(updated).not.toContain('Evidence A')
    expect(updated.match(/zenuml-pr-review:start/g)).toHaveLength(1)
  })
})

describe('ciFromRollup', () => {
  const run = (name: string, conclusion: string, workflowName = 'Build') => ({ name, workflowName, status: 'COMPLETED', conclusion })

  it('ignores a cancelled duplicate when the same check also passed', () => {
    expect(ciFromRollup([run('test', 'CANCELLED'), run('test', 'SUCCESS'), run('lint', 'SUCCESS')])).toBe('success')
  })

  it('never reports success when a cancelled check has no passing run', () => {
    expect(ciFromRollup([run('e2e', 'CANCELLED'), run('lint', 'SUCCESS')])).toBe('unknown')
    expect(ciFromRollup([run('e2e', 'CANCELLED')])).toBe('unknown')
  })

  it('keeps failure and pending ahead of everything else', () => {
    expect(ciFromRollup([run('e2e', 'FAILURE'), run('lint', 'SUCCESS')])).toBe('failure')
    expect(ciFromRollup([{ name: 'e2e', workflowName: 'Build', status: 'IN_PROGRESS' }, run('lint', 'SUCCESS')])).toBe('pending')
    expect(ciFromRollup([])).toBe('unknown')
  })
})
