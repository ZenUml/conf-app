import { describe, it, expect } from 'vitest';
import { asyncApiViewerSurface } from './viewerSurface';

describe('asyncApiViewerSurface', () => {
  it('renders the page macro through GenericViewer', () => {
    expect(asyncApiViewerSurface(undefined)).toBe('macro');
  });

  it('renders the macro Fullscreen through GenericViewer too, so it gets the header and Connect MCP', () => {
    expect(asyncApiViewerSurface('fullscreen')).toBe('macro');
  });

  it('keeps the dashboard View modal on the in-place Studio viewer', () => {
    expect(asyncApiViewerSurface('viewer')).toBe('studio-modal');
  });
});
