import path from 'path';
import { APP_PROFILES } from './apps.js';

function getAuthStatePath(): string {
  const app = process.env.APP;
  if (app) {
    const profile = APP_PROFILES[app];
    if (profile) {
      return path.join(__dirname, '..', `auth-state-${profile.domain}.json`);
    }
  }
  const domain = process.env.ZENUML_DOMAIN || 'zenuml-stg.atlassian.net';
  return path.join(__dirname, '..', `auth-state-${domain}.json`);
}

export const AUTH_STATE_PATH = getAuthStatePath();
