import { describe, it, expect, vi, afterEach } from 'vitest';
import { toast } from './toast';

describe('toast (#934)', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('announces its message politely to screen readers and then removes itself', () => {
    vi.useFakeTimers();
    toast({ message: 'Copied', duration: 1000 });
    const el = [...document.body.children].find((c) => c.textContent === 'Copied') as HTMLElement;
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    vi.advanceTimersByTime(1300);
    expect(document.body.contains(el)).toBe(false);
  });
});
