import { classifyPage } from './candidates.mjs';

/** Process a pre-enumerated set. Read each page again immediately before an
 * archive request; an unreadable or changed candidate stops execution. */
export async function archiveCandidates({ pages, policy, dryRun = true, readPage, archivePage, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), onResult = () => {}, requestIntervalMs = 1000 }) {
  if (!Number.isFinite(requestIntervalMs) || requestIntervalMs < 0) throw new Error('Invalid request interval');
  const results = [];
  const record = result => { results.push(result); onResult(result); };
  for (const listed of pages) {
    const selection = classifyPage(listed, policy);
    if (selection !== 'eligible') {
      record({ id: listed?.id, status: 'skipped', reason: selection });
      continue;
    }
    if (dryRun) {
      record({ id: listed.id, status: 'selected' });
      continue;
    }
    try {
      const fresh = await readPage(listed.id);
      const currentSelection = classifyPage(fresh, policy);
      if (String(fresh?.id) !== String(listed.id) || currentSelection !== 'eligible') {
        record({ id: listed.id, status: 'skipped', reason: 'changed-before-archive' });
        continue;
      }
      // Only a definite 429 can be retried safely. An ambiguous network or
      // server failure may have accepted the request, so stop and report it.
      for (let attempt = 0; ; attempt++) {
        try {
          await archivePage(listed.id);
          break;
        } catch (error) {
          if (error?.status !== 429 || attempt >= 2) throw error;
          const retryMs = Number(error.retryAfterMs);
          await wait(Number.isFinite(retryMs) && retryMs >= 0 ? Math.max(requestIntervalMs, retryMs) : requestIntervalMs * (attempt + 1));
        }
      }
      let verified = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        await wait(requestIntervalMs);
        const after = await readPage(listed.id);
        if (String(after?.id) !== String(listed.id)) throw new Error('Readback returned a different page');
        if (after.status === 'archived') { verified = true; break; }
      }
      if (!verified) {
        throw new Error('Archive status was not verified');
      }
      record({ id: listed.id, status: 'archived' });
    } catch (error) {
      record({ id: listed.id, status: 'failed', reason: String(error?.message ?? error) });
      return { results, stopped: true };
    }
  }
  return { results, stopped: false };
}
