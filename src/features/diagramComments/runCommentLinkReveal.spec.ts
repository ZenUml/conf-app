import { describe, expect, it, vi } from 'vitest';
import { runCommentLinkReveal, type CommentLinkRevealDeps } from './runCommentLinkReveal';

const LINK = 'https://example.atlassian.net/wiki/spaces/SD/pages/42/Order+flow?zenumlDiagram=900&zenumlLocal=local-1&dv=3&zn=k9';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const deps = (over: Partial<CommentLinkRevealDeps> = {}): CommentLinkRevealDeps => ({
  isFullscreen: async () => false,
  isEditor: async () => false,
  context: { localId: 'local-1', extension: { location: LINK } },
  storage: new MemoryStorage() as unknown as Storage,
  settled: vi.fn(async () => {}),
  reveal: vi.fn(),
  track: vi.fn(),
  ...over,
});

describe('runCommentLinkReveal', () => {
  it('waits for the page to settle, reveals this macro and reports it', async () => {
    const d = deps();
    await expect(runCommentLinkReveal(d)).resolves.toBe('revealed');
    expect(d.settled).toHaveBeenCalledTimes(1);
    expect(d.reveal).toHaveBeenCalledTimes(1);
    expect(d.track).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the link is for another macro on the page', async () => {
    const d = deps({ context: { localId: 'local-2', extension: { location: LINK } } });
    await expect(runCommentLinkReveal(d)).resolves.toBe('no_match');
    expect(d.reveal).not.toHaveBeenCalled();
  });

  it('does nothing for a page opened without a comment link', async () => {
    const d = deps({ context: { localId: 'local-1', extension: { location: 'https://example.atlassian.net/wiki/spaces/SD/pages/42' } } });
    await expect(runCommentLinkReveal(d)).resolves.toBe('no_match');
    expect(d.reveal).not.toHaveBeenCalled();
  });

  it('does nothing in the Fullscreen modal or in an editor', async () => {
    const fs = deps({ isFullscreen: async () => true });
    await expect(runCommentLinkReveal(fs)).resolves.toBe('not_a_page_view');
    expect(fs.reveal).not.toHaveBeenCalled();
    const ed = deps({ isEditor: async () => true });
    await expect(runCommentLinkReveal(ed)).resolves.toBe('not_a_page_view');
    expect(ed.reveal).not.toHaveBeenCalled();
  });

  it('reveals once per tab: a refresh of the same link does not flash again', async () => {
    const storage = new MemoryStorage() as unknown as Storage;
    const first = deps({ storage });
    await runCommentLinkReveal(first);
    const second = deps({ storage });
    await expect(runCommentLinkReveal(second)).resolves.toBe('already_revealed');
    expect(second.reveal).not.toHaveBeenCalled();
  });

  it('never throws: a failing reveal is reported as skipped', async () => {
    const d = deps({ reveal: vi.fn(() => { throw new Error('boom'); }) });
    await expect(runCommentLinkReveal(d)).resolves.toBe('failed');
    expect(d.track).not.toHaveBeenCalled();
  });
});
