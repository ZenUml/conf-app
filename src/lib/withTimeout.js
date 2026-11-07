// Bound a promise by N ms. Plain JS with no imports on purpose: Forge function
// entries are bundled with babel for .js, while .ts graphs go through ts-loader
// (which has broken deploys). Shared by the browser, Forge functions and Pages.
//
// Both helpers always clear their timer once `work` settles, and attach
// handlers to `work` so a rejection that arrives after the timeout is never an
// unhandled rejection.

/**
 * Reject with onTimeout() when ms elapses first. Always clears its timer.
 * @template T
 * @param {PromiseLike<T> | T} work
 * @param {number} ms
 * @param {() => unknown} onTimeout
 * @returns {Promise<T>}
 */
export function withTimeout(work, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    Promise.resolve(work).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Resolve with fallback when ms elapses first. Always clears its timer.
 * @template T, F
 * @param {PromiseLike<T> | T} work
 * @param {number} ms
 * @param {F} fallback
 * @returns {Promise<T | F>}
 */
export function withDeadline(work, ms, fallback) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(work).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
