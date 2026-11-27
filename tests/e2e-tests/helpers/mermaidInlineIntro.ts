import type { Page } from '@playwright/test';

/**
 * The Mermaid inline-edit intro (src/features/mermaidInlineIntro/) is a modal
 * `<dialog class="inline-intro">` inside the macro editor iframe. It opens once
 * per account and diagram type (`sequence`, `flowchart`) and records "seen" in
 * the app's Confluence user property `zenuml-mermaid-inline-intro-v1-<type>`.
 *
 * The robot account meets it on the first editor run after that property is
 * missing: a new site or account, or a new property key. Seen on lite-stg
 * 2026-11-27 (the robot's first editor run there since the intro shipped), in
 * mermaid-inline-edit.spec.ts, which passed on the next run:
 *   - the Mermaid tab first renders the default flowchart, so the flowchart
 *     intro covered the editor and the click into CodeMirror timed out;
 *   - the sequence intro opens WHILE a test types its sequence source (as soon
 *     as the preview renders a sequence). The dialog takes focus, the next space
 *     activates its button and is lost: `Alice->>Bob: Hi` lands as
 *     `Alice->>Bob:Hi`.
 * A locator handler cannot fix the second case: Playwright runs handlers before
 * locator actions, not before `page.keyboard` input.
 *
 * So E2E pages answer the "seen?" lookup with 200, which the app reads as seen
 * (`seen.ts`: `response.ok` means seen), and the intro never opens. No E2E test
 * covers the intro itself; its unit tests and Storybook stories do. The lookup
 * goes through `requestConfluence`, which the Confluence host page sends to
 * `api.atlassian.com/ex/confluence/<cloudId>/wiki/rest/api/user/<id>/property/<key>`,
 * so a page-level route sees it (checked on lite-stg 2026-11-27).
 */
export const MERMAID_INLINE_INTRO_PROPERTY = /\/property\/zenuml-mermaid-inline-intro-v1-[a-z]+(?:[?#]|$)/;

const registered = new WeakSet<Page>();

export async function suppressMermaidInlineIntro(page: Page): Promise<void> {
  if (registered.has(page)) return;
  registered.add(page);

  await page.route(MERMAID_INLINE_INTRO_PROPERTY, (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ key: 'zenuml-mermaid-inline-intro-v1', value: { seen: true } }),
    });
  });
}
