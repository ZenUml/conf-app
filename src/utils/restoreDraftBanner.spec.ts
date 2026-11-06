import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

// draftStore pulls in @forge/bridge — mock the single function the banner uses.
vi.mock('@/utils/draftStore', () => ({
  clearDraft: vi.fn(async () => {}),
}));

import EventBus from '@/EventBus';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { installRestoreDraftBanner } from './restoreDraftBanner';

installRestoreDraftBanner();

const FIVE_MIN = 5 * 60_000;

function emitDraftAvailable(scope = 'edit:12345') {
  EventBus.$emit('draft-available', {
    scope,
    draft: { code: 'A->B: hi', title: 'T', savedAt: Date.now() - FIVE_MIN },
  });
}

function banner(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-zenuml-draft-banner]');
  if (!el) throw new Error('banner not mounted');
  return el;
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = [...banner().querySelectorAll('button')].find(b => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  return btn;
}

const baseProps = {
  feature_area: 'system',
  surface: 'editor',
  draft_scope_kind: 'edit',
  draft_age_ms: expect.any(Number),
};

beforeEach(() => {
  vi.mocked(trackAnalyticsEvent).mockClear();
  document.querySelectorAll('[data-zenuml-draft-banner]').forEach(el => el.remove());
});

describe('restoreDraftBanner analytics', () => {
  it('mounts as a bounded recovery card away from the editor header', () => {
    emitDraftAvailable();
    expect(banner().style.top).toBe('');
    expect(banner().style.bottom).toBe('16px');
    expect(banner().style.left).toBe('16px');
    expect(banner().style.maxWidth).toBe('560px');
  });

  it('fires draft_banner_shown when the banner mounts', () => {
    emitDraftAvailable();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('draft_banner_shown', baseProps);
  });

  it('derives draft_scope_kind=new from a new:<type> scope', () => {
    emitDraftAvailable('new:mermaid');
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('draft_banner_shown', {
      ...baseProps,
      draft_scope_kind: 'new',
    });
  });

  it('fires draft_restored on Restore click', () => {
    emitDraftAvailable();
    buttonByText('Restore').click();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('draft_restored', baseProps);
  });

  it('fires draft_discarded on Discard click', () => {
    emitDraftAvailable();
    buttonByText('Discard').click();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('draft_discarded', baseProps);
  });

  it('labels the non-destructive dismissal as keeping the draft for later', () => {
    emitDraftAvailable();
    expect(banner().textContent).toContain('keep them for next time');
    buttonByText('Not now').click();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('draft_banner_dismissed', baseProps);
    expect(document.querySelector('[data-zenuml-draft-banner]')).toBeNull();
  });

  it('replacing a visible banner tracks a second shown but no dismissed', () => {
    emitDraftAvailable();
    emitDraftAvailable('new:sequence');
    const names = vi.mocked(trackAnalyticsEvent).mock.calls.map(c => c[0]);
    expect(names).toEqual(['draft_banner_shown', 'draft_banner_shown']);
  });
});
