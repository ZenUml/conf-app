import { describe, it, expect } from 'vitest';
import { isEditorUrl, isHostPageInEditor } from './hostEditor';

const view = 'https://example.atlassian.net/wiki/spaces/TEAM/pages/12345/Release+plan';
const edit = 'https://example.atlassian.net/wiki/spaces/TEAM/pages/edit-v2/12345';

describe('isEditorUrl', () => {
  it('recognises the editor', () => {
    expect(isEditorUrl(edit)).toBe(true);
    expect(isEditorUrl('https://example.atlassian.net/wiki/spaces/TEAM/pages/edit/12345')).toBe(true);
  });

  it('does not mistake a view URL for one', () => {
    expect(isEditorUrl(view)).toBe(false);
    expect(isEditorUrl('https://example.atlassian.net/wiki/spaces/TEAM/overview')).toBe(false);
  });

  it('does not mistake a page TITLED "edit" for the editor', () => {
    // View URLs end in the page title, so a bare /edit/ segment test would
    // report the editor for any page someone called "Edit" — and the cost of a
    // false positive is a viewer with no way to reach the editor at all.
    expect(isEditorUrl('https://example.atlassian.net/wiki/spaces/TEAM/pages/12345/edit')).toBe(false);
    expect(isEditorUrl('https://example.atlassian.net/wiki/spaces/TEAM/pages/12345/edit-v2')).toBe(false);
  });

  it('ignores an editor path that only appears in the query or fragment', () => {
    expect(isEditorUrl(`${view}?returnTo=/wiki/spaces/TEAM/pages/edit-v2/999`)).toBe(false);
    expect(isEditorUrl(`${view}#/edit-v2/999`)).toBe(false);
  });

  it('falls back to a substring test for a non-absolute URL', () => {
    // `location` is documented as a full URL; degrade rather than throw.
    expect(isEditorUrl('/wiki/spaces/TEAM/pages/edit-v2/12345')).toBe(true);
    expect(isEditorUrl('/wiki/spaces/TEAM/pages/12345/Release+plan')).toBe(false);
  });

  it('is false for anything that is not a usable string', () => {
    expect(isEditorUrl(undefined)).toBe(false);
    expect(isEditorUrl(null)).toBe(false);
    expect(isEditorUrl('')).toBe(false);
    expect(isEditorUrl(12345)).toBe(false);
  });
});

describe('isHostPageInEditor', () => {
  it('reads the documented location property', () => {
    expect(isHostPageInEditor({ extension: { location: edit } })).toBe(true);
    expect(isHostPageInEditor({ extension: { location: view } })).toBe(false);
  });

  it('accepts isEditing when the platform supplies it', () => {
    // Undocumented for confluence:contentBylineItem, but already read on the
    // macro surface — treated as a bonus signal, never as the only one.
    expect(isHostPageInEditor({ extension: { isEditing: true } })).toBe(true);
    expect(isHostPageInEditor({ extension: { isEditing: true, location: view } })).toBe(true);
  });

  it('defaults to NOT-editing on a missing or unusable context', () => {
    // The asymmetry is deliberate: a false negative costs a redundant "Open
    // editor" button, a false positive strands a viewer with no way to reach
    // the editor.
    expect(isHostPageInEditor(undefined)).toBe(false);
    expect(isHostPageInEditor({})).toBe(false);
    expect(isHostPageInEditor({ extension: {} })).toBe(false);
    expect(isHostPageInEditor({ extension: { isEditing: 'yes' } })).toBe(false);
  });
});
