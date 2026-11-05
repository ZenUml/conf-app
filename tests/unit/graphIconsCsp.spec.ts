/**
 * DrawIO diagrams can reference stencil icons by absolute URL on
 * icons.diagrams.net, and Forge builds the macro's CSP from these manifest
 * entries. Without `images` the viewer and editor show a broken icon. Without
 * `fetch.client` the PNG capture cannot download the icon to embed it, so the
 * macro has no PNG backup for PDF export.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const ICON_HOST = 'https://icons.diagrams.net';

const manifest = load(readFileSync(resolve(__dirname, '../../manifest.yml'), 'utf8')) as {
  permissions: { external: { images: string[]; fetch: { client: string[] } } };
};

describe('CSP for DrawIO icons on icons.diagrams.net', () => {
  it('allows the viewer and editor to display them', () => {
    expect(manifest.permissions.external.images).toContain(ICON_HOST);
  });

  it('allows the PNG capture to fetch them', () => {
    expect(manifest.permissions.external.fetch.client).toContain(ICON_HOST);
  });
});
