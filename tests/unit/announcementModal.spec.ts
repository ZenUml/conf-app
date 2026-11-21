// @vitest-environment jsdom
/**
 * The E2E announcement-modal handler must recognise every Atlassian promo
 * modal that has blocked a run. The fixtures copy the real DOM structure
 * (data-testid, role, button text) observed on staging sites.
 */
import { describe, expect, it } from 'vitest';
import {
  ANNOUNCEMENT_MODAL_SELECTOR,
  ANNOUNCEMENT_DISMISS_BUTTON_TEXTS,
} from '../e2e-tests/helpers/announcementModal';

// jsdom's selector engine drops later parts of some selector lists that
// Chromium matches, so match each part of the list on its own.
function findModal(): Element | null {
  for (const part of ANNOUNCEMENT_MODAL_SELECTOR.split(', ')) {
    const hit = document.querySelector(part);
    if (hit) return hit;
  }
  return null;
}

// dia-stg.atlassian.net, 2026-11-20: Rovo "Meet agents where you are"
// carousel. Custom testId, so no `modal-dialog--close-button` is rendered.
const AGENTIC_AWARENESS = `
  <div class="atlaskit-portal-container">
    <section role="dialog" aria-modal="true" data-testid="agentic-awareness-modal">
      <div data-testid="agentic-awareness-modal--scrollable">
        <div data-testid="agentic-awareness-modal--body">
          <button><span>Close</span></button>
          <h1>Meet agents where you are</h1>
          <button>Dismiss</button>
          <button>Previous</button>
          <button>Next</button>
        </div>
      </div>
    </section>
  </div>`;

// lite-stg.atlassian.net, 2026-08-06: bare Atlaskit ModalDialog.
const BARE_DEFAULT = `
  <div class="atlaskit-portal-container">
    <section role="dialog" aria-modal="true" data-testid="modal-dialog">
      <button data-testid="modal-dialog--close-button" aria-label="Close"></button>
    </section>
  </div>`;

// Our own Insert elements dialog must never be dismissed.
const OWN_ELEMENT_BROWSER = `
  <section role="dialog" aria-modal="true" data-testid="element-browser-modal-dialog">
    <button>Close</button>
  </section>`;

function dismissButton(modal: Element): HTMLButtonElement | undefined {
  const buttons = [...modal.querySelectorAll('button')];
  for (const text of ANNOUNCEMENT_DISMISS_BUTTON_TEXTS) {
    const hit = buttons.find((b) => b.textContent?.trim() === text);
    if (hit) return hit;
  }
  return undefined;
}

describe('announcement modal handler selectors', () => {
  it('matches the Rovo agentic-awareness modal and picks Dismiss', () => {
    document.body.innerHTML = AGENTIC_AWARENESS;
    const modal = findModal();
    expect(modal?.getAttribute('data-testid')).toBe('agentic-awareness-modal');
    expect(dismissButton(modal!)?.textContent).toBe('Dismiss');
  });

  it('still matches the bare Atlaskit default modal', () => {
    document.body.innerHTML = BARE_DEFAULT;
    expect(findModal()?.getAttribute('data-testid')).toBe('modal-dialog');
  });

  it('does not match our own namespaced dialogs', () => {
    document.body.innerHTML = OWN_ELEMENT_BROWSER;
    expect(findModal()).toBeNull();
  });
});
