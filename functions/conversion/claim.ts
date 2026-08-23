import { handleClaim } from './service';
import type { ForgeRequestData } from '../utils/authenticate';
import type { ConversionEnv } from './service';

export const onRequestPost: PagesFunction<ConversionEnv, string, ForgeRequestData> =
  ({ request, env, data, waitUntil }) => handleClaim(request, env, data, waitUntil);
