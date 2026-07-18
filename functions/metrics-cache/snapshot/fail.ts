import { handleFail } from './service';
import type { ForgeRequestData } from '../../utils/authenticate';
import type { SnapshotEnv } from './common';

export const onRequest: PagesFunction<SnapshotEnv, string, ForgeRequestData> =
  ({ request, env, data, waitUntil }) => handleFail(request, env, data, waitUntil);
