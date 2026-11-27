// GET /bundle-checkout — Enterprise Bundle handoff page. See functions/service/bundleCheckout.ts.
import { handleBundleCheckoutPage } from '../service/bundleCheckout';
import { bundleCheckoutDeps, type BundleCheckoutEnv } from './deps';

export const onRequest: PagesFunction<BundleCheckoutEnv> = ({ request, env, waitUntil }) =>
  handleBundleCheckoutPage(request, bundleCheckoutDeps(env, waitUntil));
