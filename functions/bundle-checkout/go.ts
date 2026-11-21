// GET /bundle-checkout/go — records the step and answers 302 to the Payment Link.
import { handleBundleCheckoutGo } from '../service/bundleCheckout';
import { bundleCheckoutDeps, type BundleCheckoutEnv } from './deps';

export const onRequest: PagesFunction<BundleCheckoutEnv> = ({ request, env, waitUntil }) =>
  handleBundleCheckoutGo(request, bundleCheckoutDeps(env, waitUntil));
