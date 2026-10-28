/** Serialize requests with a minimum interval. Retry read-only requests on
 * transient HTTP errors; callers decide whether a write is safe to retry. */
export function rateLimitedRequest(request, { intervalMs = 500, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error('Invalid request interval');
  let nextAt = 0;
  let queue = Promise.resolve();
  async function schedule(fn) {
    const job = queue.then(async () => {
      const delay = Math.max(0, nextAt - now());
      if (delay) await wait(delay);
      nextAt = now() + intervalMs;
      return fn();
    });
    queue = job.then(() => {}, () => {});
    return job;
  }
  return {
    async get(...args) {
      for (let attempt = 0; ; attempt++) {
        const response = await schedule(() => request.get(...args));
        if (![429, 502, 503, 504].includes(response.status()) || attempt === 2) return response;
        const retryAfter = Number(response.headers?.()['retry-after']);
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : intervalMs * (attempt + 1));
      }
    },
    post: (...args) => schedule(() => request.post(...args)),
  };
}
