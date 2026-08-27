import { handleCalibration, type ArchitectureTokenEnv } from '../calibration';
import type { ForgeRequestData } from '../../utils/authenticate';

export const onRequestPost: PagesFunction<ArchitectureTokenEnv, string, ForgeRequestData> =
  ({ request, env, data, waitUntil }) => handleCalibration(request, env, data, waitUntil);
