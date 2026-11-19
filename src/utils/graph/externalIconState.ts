/**
 * Where a Graph diagram's external-icon proxy call stands, so PNG capture can
 * wait for it. Kept apart from externalIcons.ts: captureBlob imports this and
 * should not pull in the request layer.
 */
export type IconProxyResult = { ok: true } | { ok: false; code: string };

const states = new WeakMap<Element, Promise<IconProxyResult>>();

export function setExternalIconState(container: Element, settled: Promise<IconProxyResult>): void {
  states.set(container, settled);
}

export function clearExternalIconState(container: Element | null | undefined): void {
  if (container) states.delete(container);
}

/**
 * Resolves once the container's icons are applied (or it has none); rejects when
 * the proxy failed or only partly succeeded, so a capture is never saved with a
 * broken-image glyph. A diagram without external icons never registers a state.
 */
export async function awaitExternalIcons(container: Element | null | undefined): Promise<void> {
  const settled = container ? states.get(container) : undefined;
  if (!settled) return;
  const result = await settled;
  if (!result.ok) throw new Error(`graph icon proxy failed: ${result.code}`);
}
