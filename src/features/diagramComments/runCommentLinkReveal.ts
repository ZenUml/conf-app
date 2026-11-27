// Run the reveal for a page opened from a diagram-comment link (#1047).
//
// Called from main() after the viewer has loaded, NOT from the end of
// loadHeavyComponents: for sequence-family macros that function returns early
// when the diagram is rendered from the stale-while-revalidate cache, which is
// every repeat view, so a hook placed at its end never ran for the readers a
// comment link is meant for. Every dependency is injected so the rules are
// tested without a Forge context.
import { claimLinkReveal, linkRevealTarget } from './revealFromLink';

export interface CommentLinkRevealDeps {
  isFullscreen(): Promise<boolean>;
  isEditor(): Promise<boolean>;
  context: { localId?: string; extension?: { location?: string } } | undefined;
  storage: Storage | undefined;
  /** Resolve once the page has stopped growing, so the scroll is the last thing that happens. */
  settled(): Promise<void>;
  reveal(): void;
  track(): void;
}

export type CommentLinkRevealResult = 'revealed' | 'no_match' | 'not_a_page_view' | 'already_revealed' | 'failed';

/**
 * Scroll to and ring this macro when the page URL carries a comment link for its
 * own localId. A page view only (the Fullscreen modal has nothing to scroll and an
 * editor must not move), once per tab, and never throws.
 */
export async function runCommentLinkReveal(deps: CommentLinkRevealDeps): Promise<CommentLinkRevealResult> {
  try {
    if ((await deps.isFullscreen()) || (await deps.isEditor())) return 'not_a_page_view';
    const target = linkRevealTarget(deps.context?.extension?.location, deps.context?.localId);
    if (!target) return 'no_match';
    if (!claimLinkReveal(deps.storage, target)) return 'already_revealed';
    await deps.settled();
    deps.reveal();
    deps.track();
    return 'revealed';
  } catch (e) {
    console.debug('[comment-link reveal] skipped', e);
    return 'failed';
  }
}
