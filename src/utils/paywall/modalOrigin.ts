/**
 * Where an editor modal was opened from, as carried in
 * `context.extension.modal.origin`.
 *
 * Its own module so the byline component can state its origin without importing
 * `mountPaywallGate`, which would drag PaywallGate.vue, the customer-success
 * composable and mountRoot into the byline bundle for the sake of one string.
 * The byline iframe boots on a click and its whole job is to paint a list fast.
 */
export const BYLINE_MODAL_ORIGIN = 'byline';

/** True when this modal was opened by the Lite byline's "Add a diagram". */
export function isBylineModal(context: unknown): boolean {
  return (context as any)?.extension?.modal?.origin === BYLINE_MODAL_ORIGIN;
}
