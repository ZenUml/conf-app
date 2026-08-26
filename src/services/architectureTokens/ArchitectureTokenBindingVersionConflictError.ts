/**
 * A Confluence optimistic-lock conflict affecting a body that carries the
 * Architecture Tokens envelope. The generic custom-content retry is unsafe in
 * this case because it would resend a stale source and binding document.
 *
 * This deliberately carries no source, locator, hash, native ID, or token
 * data. Callers use it only to keep the editor open and ask for a reload.
 */
export class ArchitectureTokenBindingVersionConflictError extends Error {
  constructor(readonly originalError: unknown) {
    super('Architecture Token binding state changed in another editor. Reload before saving again.');
    this.name = 'ArchitectureTokenBindingVersionConflictError';
  }
}
