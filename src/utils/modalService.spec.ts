import { describe, it, expect, afterEach } from 'vitest';
import { showCloseWithoutSavingDialog } from './modalService';

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('#zenuml-modal-container button')].find((b) => b.textContent === name)!;
const key = (k: string, opts: KeyboardEventInit = {}) =>
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));

describe('showCloseWithoutSavingDialog (#934)', () => {
  afterEach(() => {
    // Settle anything a failing case left open.
    document.querySelector<HTMLButtonElement>('#zenuml-modal-container button:last-of-type')?.click();
    document.body.innerHTML = '';
  });

  it('is an accessible modal dialog labelled by its message', async () => {
    const result = showCloseWithoutSavingDialog();
    const el = dialog();
    expect(el).not.toBeNull();
    expect(el!.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(el!.getAttribute('aria-labelledby')!)?.textContent).toBe('All changes will be lost!');
    button('Cancel').click();
    await expect(result).resolves.toBe('cancel');
  });

  it('moves focus into the dialog and restores it on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const result = showCloseWithoutSavingDialog();
    expect(document.activeElement).toBe(button('Cancel'));
    button('Discard Changes').click();
    await expect(result).resolves.toBe('discard');
    expect(document.activeElement).toBe(opener);
  });

  it('cancels on Escape', async () => {
    const result = showCloseWithoutSavingDialog();
    key('Escape');
    await expect(result).resolves.toBe('cancel');
    expect(document.getElementById('zenuml-modal-container')!.style.display).toBe('none');
  });

  it('keeps Tab inside the dialog', () => {
    showCloseWithoutSavingDialog();
    button('Cancel').focus();
    key('Tab');
    expect(document.activeElement).toBe(button('Discard Changes'));
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(button('Cancel'));
  });

  it('cancels on an overlay click', async () => {
    const result = showCloseWithoutSavingDialog();
    (document.querySelector('#zenuml-modal-container > div') as HTMLElement).click();
    await expect(result).resolves.toBe('cancel');
  });

  it('returns the open promise when called again, so both callers settle once', async () => {
    const first = showCloseWithoutSavingDialog();
    const second = showCloseWithoutSavingDialog();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    button('Discard Changes').click();
    await expect(first).resolves.toBe('discard');
    await expect(second).resolves.toBe('discard');
  });
});
