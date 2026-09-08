import { describe, expect, it } from 'vitest';
import * as stories from './ExportModal.stories';

describe('ExportModal fullscreen visual-review stories', () => {
  it('covers the stacking breakpoint at a realistic narrow width', () => {
    expect(stories.FullscreenNarrow).toBeDefined();
  });

  it('covers a sidebar whose controls overflow vertically', () => {
    expect(stories.FullscreenOverflowEditing).toBeDefined();
  });
});
