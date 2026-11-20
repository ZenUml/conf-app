export const BUNDLE_ANNUAL_PRICE_USD = 299;
export const BLACK_FRIDAY_OFFER = 'black_friday_2026';
export const BLACK_FRIDAY_START = Date.parse('2026-11-20T00:00:00+11:00');
export const BLACK_FRIDAY_END = Date.parse('2026-11-30T23:59:00+11:00');
export const BLACK_FRIDAY_PRICE_USD = BUNDLE_ANNUAL_PRICE_USD / 2;
export const BLACK_FRIDAY_PRICE = `US$${BLACK_FRIDAY_PRICE_USD.toFixed(2)}`;
export const BUNDLE_RENEWAL_PRICE = `US$${BUNDLE_ANNUAL_PRICE_USD}/year`;
export const BLACK_FRIDAY_TERMS = `Then ${BUNDLE_RENEWAL_PRICE} per space. Plus tax where applicable.`;
export const BLACK_FRIDAY_DEADLINE = 'Ends Nov 30 at 11:59 pm AEDT. Applied automatically at checkout.';

// Both the Confluence UI and handoff use this verified, public Stripe code.
export const BLACK_FRIDAY_STRIPE_CODE = 'ZENUMLLITEBF26';

export function blackFridayActive(now: number): boolean {
  return now >= BLACK_FRIDAY_START && now < BLACK_FRIDAY_END;
}

export function bundleOfferCheckoutUrl(url: string): string {
  const checkout = new URL(url);
  checkout.searchParams.set('offer', BLACK_FRIDAY_OFFER);
  return checkout.toString();
}
