import { describe, expect, it } from 'vitest'
import { withReviewMaterials } from './github-review-gateway'

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
