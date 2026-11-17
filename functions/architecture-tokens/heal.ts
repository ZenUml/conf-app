/**
 * Read-path repair of ONE diagram's ArchitectureTokenOccurrence rows.
 *
 * The rows are written by the save-time sync (forge-custom-content.ts → indexDiagramOnSave).
 * A save that skips that sync leaves the rows at an old version, and the related lookup then
 * answers `stale_index` for that diagram on every view until the next synced save. When the
 * lookup sees a real version mismatch for the diagram being viewed, it calls this healer.
 *
 * Same code path as the save sync: the same as-user body read
 * (getCustomContentFromConfluenceForForge) and the same writer (indexDiagramOnSave), with run
 * id `heal:N` instead of `save:N`. It writes only the derived token index; it never writes the
 * CustomContent or CustomContentVersion mirrors, so D1 holds no diagram body because of it.
 *
 * Who may trigger a write: only a viewer whose own token just returned this diagram from the
 * live v2 read, so the viewer can read the body that is indexed. The rows are the ones any
 * authorised save would write; other viewers reach them only through their own as-user
 * filters in service.ts.
 */
import { getCustomContentFromConfluenceForForge } from '../utils/confluenceUtils';
import { indexDiagramOnSave } from './indexOnSave';
import { occurrencesForContent } from './repository';

export type HealOutcome =
  | 'healed'
  /** Another request rebuilt the rows to the live version first; nothing written here. */
  | 'already_current'
  /** The rows describe a newer version than this live read; nothing written. */
  | 'index_newer'
  | 'content_fetch_failed'
  | 'write_failed'
  | 'not_a_diagram'
  | 'no_cloud_id'
  /** The rebuild runs on after the response under waitUntil; this viewer gets today's answer. */
  | 'heal_pending'
  | 'heal_failed';

export type StaleIndexHealer = (contentId: string, liveVersion: number) => Promise<HealOutcome>;

/**
 * Longest a viewer waits for the rebuild. The lookup's p95 is about 1.6 s against the client's
 * 8 s timeout, and a healed lookup runs a second pass, so 2.5 s keeps the worst case near 6 s.
 */
export const HEAL_BUDGET_MS = 2500;

/**
 * One rebuild per (tenant, diagram, live version) per isolate. A page with many diagrams sends
 * one lookup per diagram, and several viewers can open the same page together; without this,
 * every lookup of a stale diagram would read its body and rewrite its rows. Across isolates the
 * index re-check in rebuild() skips the work once one writer has finished. A duplicate that still
 * gets through writes identical rows (DELETE + INSERT for the same version), so it costs a
 * request, not correctness.
 */
const inFlight = new Map<string, Promise<HealOutcome>>();

export function __resetHealsInFlightForTests() {
  inFlight.clear();
}

export interface HealerDeps {
  db: D1Database;
  /** The cloudId the lookup reads with; the rows must be written under the same one. */
  cloudId: string;
  apiBaseUrl: string;
  userToken: string;
  waitUntil?: (promise: Promise<unknown>) => void;
  budgetMs?: number;
  fetchContent?: typeof getCustomContentFromConfluenceForForge;
}

async function rebuild(deps: HealerDeps, contentId: string, liveVersion: number): Promise<HealOutcome> {
  const { db, cloudId } = deps;
  const indexed = (await occurrencesForContent(db, cloudId, contentId))[0]?.contentVersion;
  if (indexed === liveVersion) return 'already_current';
  // Never move rows backwards: a newer save sync may have landed after this live read.
  if (indexed !== undefined && indexed > liveVersion) return 'index_newer';

  let content: any;
  try {
    content = await (deps.fetchContent ?? getCustomContentFromConfluenceForForge)(
      deps.apiBaseUrl, contentId, deps.userToken,
    );
  } catch {
    return 'content_fetch_failed';
  }
  if (String(content?.id ?? '') !== contentId) return 'content_fetch_failed';

  const result = await indexDiagramOnSave(db, cloudId, content, { runIdPrefix: 'heal' });
  if (result.indexed) return 'healed';
  if (result.reason === 'write_failed') {
    console.error('architecture-tokens: heal index write failed', result.detail);
  }
  return result.reason;
}

export function staleIndexHealer(deps: HealerDeps): StaleIndexHealer {
  return async (contentId, liveVersion) => {
    const key = `${deps.cloudId}:${contentId}:${liveVersion}`;
    let work = inFlight.get(key);
    if (!work) {
      work = rebuild(deps, contentId, liveVersion)
        .catch(() => 'heal_failed' as const)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, work);
      // The rebuild finishes even if this viewer's request ends first.
      deps.waitUntil?.(work);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<HealOutcome>((done) => {
      timer = setTimeout(() => done('heal_pending'), deps.budgetMs ?? HEAL_BUDGET_MS);
    });
    try {
      return await Promise.race([work, budget]);
    } finally {
      clearTimeout(timer);
    }
  };
}
