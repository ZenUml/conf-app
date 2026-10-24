const DEFAULT_TIMEOUT_MS = 3000;

const ZENUML_ICON_SELECTOR = '.participant .h-6.w-6.mr-1.flex-shrink-0';

function hasPendingZenUmlIcon(root: HTMLElement): boolean {
  return Array.from(root.querySelectorAll(ZENUML_ICON_SELECTOR)).some(
    (icon) => !icon.querySelector('svg'),
  );
}

/** Wait for image/font resources that html-to-image serializes into a preview. */
export function waitForCaptureAssets(
  root: HTMLElement,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let finished = false;
    let mutated = false;
    let nextScan = 0;
    let scanRunning = false;
    let scanRequested = false;
    const imageCancels = new Set<() => void>();
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      mutated = true;
      scheduleScan();
    });
    const timeout = setTimeout(() => finish(new Error('capture assets did not become ready')), timeoutMs);

    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      if (nextScan) clearTimeout(nextScan);
      imageCancels.forEach((cancel) => cancel());
      imageCancels.clear();
      clearTimeout(timeout);
      observer?.disconnect();
      if (error) reject(error);
      else resolve();
    };

    const waitForImage = (image: HTMLImageElement): Promise<void> => {
      if (image.complete) {
        return typeof image.decode === 'function' ? image.decode().catch(() => undefined) : Promise.resolve();
      }
      return new Promise<void>((resolveImage) => {
        const done = () => {
          cleanup();
          resolveImage();
        };
        const cancel = () => {
          cleanup();
          resolveImage();
        };
        const cleanup = () => {
          image.removeEventListener('load', done);
          image.removeEventListener('error', done);
          imageCancels.delete(cancel);
        };
        imageCancels.add(cancel);
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
      });
    };

    const scan = async () => {
      if (scanRunning || finished) return;
      scanRunning = true;
      do {
        scanRequested = false;
        mutated = false;
        await Promise.all(Array.from(root.querySelectorAll('img')).map(waitForImage));
        if (finished) break;
        if (typeof document.fonts?.ready?.then === 'function') {
          await document.fonts.ready.catch(() => undefined);
        }
        if (finished) break;
        // Core's participant icons are loaded by a React effect after the
        // parser/store render resolves. The empty icon wrapper is a concrete
        // pending marker. Use an event-loop turn instead of rAF: Forge can
        // throttle rAF in an offscreen iframe.
        await new Promise<void>((resolveScan) => {
          nextScan = window.setTimeout(() => {
            nextScan = 0;
            resolveScan();
          }, 0);
        });
        if (mutated || hasPendingZenUmlIcon(root)) scanRequested = true;
        else finish();
      } while (!finished && scanRequested);
      scanRunning = false;
    };

    function scheduleScan() {
      if (finished) return;
      scanRequested = true;
      scan();
    }

    observer?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href', 'xlink:href'] });
    scan();
  });
}
