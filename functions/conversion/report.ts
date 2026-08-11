import { handleReport } from './service';
import type { ForgeRequestData } from '../utils/authenticate';
import type { ConversionEnv } from './service';

export const onRequestPost: PagesFunction<ConversionEnv, string, ForgeRequestData> =
  ({ request, env, data }) => handleReport(request, env, data);
