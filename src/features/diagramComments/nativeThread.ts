// "Reply in Confluence" (#1047): our panel never posts replies; the native
// comment list does. One helper holds both ways to get the reader there.
//
//   1. The modal calls router.navigate() on the host page, then closes itself.
//   2. If navigate is refused from inside the modal, it closes with
//      { action: 'reply', commentId } and the macro iframe's onClose navigates.
//
// Whether navigation from a modal reaches the host page can only be verified on a
// real Forge tunnel; unit tests here prove the order and the fallback, not that.

export interface NativeReplyPayload {
  action: 'reply';
  commentId: string;
}

/** Site-relative path to the page with the comment focused. Other query keys and the hash are dropped. */
export function nativeThreadPath(pageUrl: string, commentId: string): string | null {
  try {
    const url = new URL(pageUrl);
    return `${url.pathname}?focusedCommentId=${encodeURIComponent(commentId)}`;
  } catch {
    return null;
  }
}

export function replyFromClosePayload(payload: unknown): { commentId: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const { action, commentId } = payload as Partial<NativeReplyPayload>;
  return action === 'reply' && typeof commentId === 'string' && commentId ? { commentId } : null;
}

export async function openNativeThread(input: {
  pageUrl: string;
  commentId: string;
  navigate: (path: string) => Promise<unknown> | unknown;
  close: (payload?: NativeReplyPayload) => Promise<unknown> | unknown;
}): Promise<'navigated' | 'handed_back'> {
  const path = nativeThreadPath(input.pageUrl, input.commentId);
  if (path) {
    try {
      await input.navigate(path);
      await input.close();
      return 'navigated';
    } catch {
      // Fall through: let the macro iframe navigate when the modal closes.
    }
  }
  await input.close({ action: 'reply', commentId: input.commentId });
  return 'handed_back';
}
