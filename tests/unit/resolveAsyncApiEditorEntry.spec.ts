import { describe, expect, it } from 'vitest'

import { resolveAsyncApiEditorEntry } from '../../src/model/asyncapi/resolveEditorEntry'

describe('resolveAsyncApiEditorEntry', () => {
  it('opens the embed picker for an embed macro in the page-editor config surface', () => {
    // Native page-editor config (insert/configure): view.submit is submittable,
    // so re-targeting which document is embedded is allowed here.
    expect(
      resolveAsyncApiEditorEntry({ isEmbedMacro: true, isViewModeEditModal: false }),
    ).toBe('embed-picker')
  })

  it('opens the spec editor (NOT the picker) for an embed macro in the view-mode Edit modal', () => {
    // Regression guard for the "Failed to embed document. Please try again."
    // bug: the picker can only persist via a view.submit() that is not
    // submittable in the view-mode modal, so editing an embed there must edit
    // the referenced document's spec instead of attempting an impossible
    // re-target.
    expect(
      resolveAsyncApiEditorEntry({ isEmbedMacro: true, isViewModeEditModal: true }),
    ).toBe('spec-editor')
  })

  it('opens the spec editor for a regular asyncapi macro in the page-editor config surface', () => {
    expect(
      resolveAsyncApiEditorEntry({ isEmbedMacro: false, isViewModeEditModal: false }),
    ).toBe('spec-editor')
  })

  it('opens the spec editor for a regular asyncapi macro in the view-mode Edit modal', () => {
    expect(
      resolveAsyncApiEditorEntry({ isEmbedMacro: false, isViewModeEditModal: true }),
    ).toBe('spec-editor')
  })
})
