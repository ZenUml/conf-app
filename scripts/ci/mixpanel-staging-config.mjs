#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const sections = ['vars', 'env.production.vars'];

export function prepareMixpanelConfig(config, environment) {
  if (environment !== 'stg') return config;
  for (const section of sections) {
    const header = `[${section}]`;
    const start = config.indexOf(`${header}\n`);
    if (start < 0) throw new Error(`Staging config is missing ${header}`);
    const contentStart = start + header.length + 1;
    const nextSection = config.indexOf('\n[', contentStart);
    const end = nextSection < 0 ? config.length : nextSection + 1;
    const content = config.slice(contentStart, end);
    const replacement = content.match(/^MIXPANEL_DISABLED\s*=.*$/m)
      ? content.replace(/^MIXPANEL_DISABLED\s*=.*$/m, 'MIXPANEL_DISABLED = "true"')
      : `MIXPANEL_DISABLED = "true"\n${content}`;
    config = config.slice(0, contentStart) + replacement + config.slice(end);
  }
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , path, environment] = process.argv;
  if (!path || !environment) throw new Error('Usage: mixpanel-staging-config.mjs <wrangler.toml> <stg|prod>');
  const original = await readFile(path, 'utf8');
  await writeFile(path, prepareMixpanelConfig(original, environment));
}
