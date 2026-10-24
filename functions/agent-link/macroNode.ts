// The ADF a ZenUML macro is, and the two questions you have to answer before
// writing one onto somebody's page.
//
// This is the Worker-side twin of src/utils/byline/addToPage.ts. Design §7
// asks for one shared module; the frontend copy cannot be imported here
// because it reads `import.meta.env` and the Forge globals at module scope,
// neither of which exists in a Worker. The duplication is deliberate and
// narrow: node shape, dedupe and count only. The macro KEY — the part with the
// scar tissue — is not duplicated at all, because `macroKeyFor` in
// macroIdentity.ts already derives it from the identity resolved off the site,
// which is exactly the thing the frontend gets from its Forge context and the
// Worker cannot.
//
// The scar tissue, verbatim from addToPage.ts so nobody has to go looking: a
// malformed `extensionKey` rendered as an unknown extension on a customer's
// page (2026-08-11, lite→full conversion job c5a6d954). Everything here
// refuses rather than guesses.

/** `crypto.randomUUID`, with a fallback so a node is never written without a localId. */
function randomLocalId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `zenuml-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
}

/**
 * The macro node, in the shape Confluence writes when a user inserts one.
 *
 * Modelled on a real node captured from a live page rather than invented (see
 * addToPage.ts's header). `extensionKey` is the load-bearing field; the caller
 * supplies it already built by `extensionKeyFor`, which refuses on an identity
 * it could not resolve.
 */
export function buildMacroNode(
  extensionKey: string,
  customContentId: string,
  nowMs: number = Date.now(),
): Record<string, unknown> {
  return {
    type: 'extension',
    attrs: {
      layout: 'default',
      extensionType: 'com.atlassian.ecosystem',
      extensionKey,
      parameters: {
        layout: 'extension',
        extensionId: `ari:cloud:ecosystem::extension/${extensionKey}`,
        // The macro reads this on render; everything else in a
        // Confluence-authored node is editor context it rebuilds for itself.
        guestParams: {
          customContentId: String(customContentId),
          updatedAt: new Date(nowMs).toISOString(),
        },
      },
      localId: randomLocalId(),
    },
  };
}

/**
 * Which custom content a macro node names, by either of the two ways it can.
 *
 * A SAVED macro carries `customContentId`. A macro created by pasting a
 * deeplink carries only `autoConvertLink` until its first save. Reading just
 * the first misses precisely the macros this code path creates — which is how
 * the frontend once appended a second copy of a diagram the page was already
 * rendering (addToPage.ts, 2026-08-14).
 *
 * The deeplink form is matched on the id in the URL rather than resolved
 * through the frontend's cloudId-guarded helpers; to stay safe without them,
 * the match requires the link to name the same site we are writing to.
 */
export function referencedCustomContentId(parameters: unknown, cloudId: string): string | undefined {
  const p = (parameters ?? {}) as Record<string, any>;
  for (const params of [p.guestParams, p.macroParams, p]) {
    if (!params || typeof params !== 'object') continue;
    const raw = (params as Record<string, unknown>).customContentId;
    const id = typeof raw === 'string' ? raw : (raw as { value?: unknown } | undefined)?.value;
    if (id) return String(id);

    const link = (params as Record<string, unknown>).autoConvertLink;
    if (typeof link === 'string' && link.includes(cloudId)) {
      // /d/<cloudId>/<contentId> — the shape the byline's "Copy link" writes.
      const match = new RegExp(`/d/${cloudId}/([0-9]+)`).exec(link);
      if (match) return match[1];
    }
  }
  return undefined;
}

/** Does this document already place `customContentId`? */
export function referencesCustomContent(adf: unknown, customContentId: string, cloudId: string): boolean {
  let found = false;
  const walk = (node: unknown): void => {
    if (found) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, any>;
    const id = referencedCustomContentId(n.attrs?.parameters, cloudId);
    if (id && String(id) === String(customContentId)) {
      found = true;
      return;
    }
    Object.values(n).forEach(walk);
  };
  walk(adf);
  return found;
}

/** Every macro on the page, of any app — what the paywall's limit counts. */
export function countExtensions(adf: unknown): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, any>;
    if (typeof n.type === 'string' && ['extension', 'bodiedExtension', 'inlineExtension'].includes(n.type)) {
      count += 1;
    }
    Object.values(n).forEach(walk);
  };
  walk(adf);
  return count;
}
