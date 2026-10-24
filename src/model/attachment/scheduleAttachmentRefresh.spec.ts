import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  isDisplayMode: vi.fn(),
  canUserEdit: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock('@/model/Attachment', () => ({ default: h.upload }));
vi.mock('@/model/globals', () => ({
  default: { apWrapper: { isDisplayMode: h.isDisplayMode, canUserEdit: h.canUserEdit } },
}));
vi.mock('@/utils/window', () => ({
  trackEvent: h.trackEvent,
  serializeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { scheduleAttachmentRefresh } from './scheduleAttachmentRefresh';

describe('scheduleAttachmentRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.isDisplayMode.mockReturnValue(true);
    h.canUserEdit.mockResolvedValue(true);
    h.upload.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not upload before the delay', async () => {
    scheduleAttachmentRefresh(() => 'a', 'sequence');
    await vi.advanceTimersByTimeAsync(1499);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('uploads exactly once after the delay with (content, diagramType)', async () => {
    scheduleAttachmentRefresh(() => 'a', 'sequence');
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.upload).toHaveBeenCalledWith('a', 'sequence');
  });

  it('evaluates the content getter at fire time', async () => {
    let content = 'before';
    scheduleAttachmentRefresh(() => content, 'openapi');
    content = 'after';
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.upload).toHaveBeenCalledWith('after', 'openapi');
  });

  it('honours a custom delay', async () => {
    scheduleAttachmentRefresh(() => 'a', 'graph', 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });

  it('does not upload outside display mode', async () => {
    h.isDisplayMode.mockReturnValue(false);
    scheduleAttachmentRefresh(() => 'a', 'sequence');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.upload).not.toHaveBeenCalled();
    expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('Attachment will not be created'));
  });

  it('does not upload when canUserEdit resolves false', async () => {
    h.canUserEdit.mockResolvedValue(false);
    scheduleAttachmentRefresh(() => 'a', 'sequence');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.upload).not.toHaveBeenCalled();
    expect(console.debug).toHaveBeenCalledTimes(1);
  });

  it('reports an upload error once with diagram_type and does not throw', async () => {
    h.upload.mockRejectedValue(new Error('boom'));
    scheduleAttachmentRefresh(() => 'a', 'mermaid');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.trackEvent).toHaveBeenCalledTimes(1);
    const [label, action, category, props] = h.trackEvent.mock.calls[0];
    expect(action).toBe('create_attachment');
    expect(category).toBe('error');
    expect(label).toContain('boom');
    expect(props).toEqual({ diagram_type: 'mermaid' });
  });

  it('carries the XHR status and response details when the error has one', async () => {
    const err: any = new Error('upload failed');
    err.xhr = { status: 413, statusText: 'Too Large', responseText: 'nope' };
    h.upload.mockRejectedValue(err);
    scheduleAttachmentRefresh(() => 'a', 'plantuml');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.trackEvent).toHaveBeenCalledTimes(1);
    const details = JSON.parse(h.trackEvent.mock.calls[0][0]);
    expect(details.xhr.status).toBe(413);
    expect(details.xhr.responseDetails).toBe('nope');
    expect(h.trackEvent.mock.calls[0][3]).toEqual({ diagram_type: 'plantuml' });
  });
});
