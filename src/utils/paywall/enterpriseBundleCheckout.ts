/** Explicit space identity is required on site-wide surfaces. */
export function enterpriseBundleCheckout(clientDomain: string, spaceKey: string) {
  const clientReferenceId = `${clientDomain}__${spaceKey}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200)
  return {
    clientReferenceId,
    url: `https://buy.stripe.com/cNifZifkN7hzavK12H7IY05?client_reference_id=${clientReferenceId}`,
  }
}
