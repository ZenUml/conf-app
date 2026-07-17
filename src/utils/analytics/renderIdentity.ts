export interface RenderIdentity {
  instance_nonce: string;
  time_origin: number;
}

// One immutable identity per Forge iframe module instance. The render event
// and any post-render work use this pair to remain directly joinable.
const INSTANCE_NONCE: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `nofallback-${Math.random().toString(36).slice(2)}`;

const TIME_ORIGIN =
  typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number'
    ? Math.round(performance.timeOrigin)
    : Date.now();

const RENDER_IDENTITY: Readonly<RenderIdentity> = Object.freeze({
  instance_nonce: INSTANCE_NONCE,
  time_origin: TIME_ORIGIN,
});

export function getRenderIdentity(): Readonly<RenderIdentity> {
  return RENDER_IDENTITY;
}
