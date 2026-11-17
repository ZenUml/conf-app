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

  it('renders an action button with its label', () => {
    toast({ message: 'Moved', action: { label: 'Undo', onClick: vi.fn() } });
    const button = document.body.querySelector('[data-testid="toast-action"]') as HTMLButtonElement;
    expect(button.textContent).toBe('Undo');
    expect(button.type).toBe('button');
    expect(document.body.querySelector('[data-testid="toast"]')!.textContent).toContain('Moved');
  });

  it('calls onClick once and removes the toast immediately on click', () => {
    const onClick = vi.fn();
    toast({ message: 'Moved', action: { label: 'Undo', onClick } });
    (document.body.querySelector('[data-testid="toast-action"]') as HTMLButtonElement).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[data-testid="toast"]')).toBeNull();
  });

  it('does not throw when the timers fire after the toast was removed by a click', () => {
    vi.useFakeTimers();
    toast({ message: 'Moved', duration: 1000, action: { label: 'Undo', onClick: vi.fn() } });
    (document.body.querySelector('[data-testid="toast-action"]') as HTMLButtonElement).click();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });

  it('sits 20px from the top by default and takes another offset', () => {
    toast({ message: 'Copied' });
    toast({ message: 'Moved', top: '64px' });
    const tops = [...document.body.querySelectorAll('[data-testid="toast"]')].map((el) => (el as HTMLElement).style.top);
    expect(tops).toEqual(expect.arrayContaining(['20px', '64px']));
  });

  it('has no button without an action', () => {
    toast({ message: 'Copied' });
    expect(document.body.querySelector('[data-testid="toast"]')).not.toBeNull();
    expect(document.body.querySelector('button')).toBeNull();
  });
});
