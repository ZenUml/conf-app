import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// public/third-party-notices.txt ships in every variant's dist (ADR-0010,
// "Licensing"). These checks fail an @plantuml/core upgrade that would leave
// the notice stale or bring back a non-MIT engine (versions before 1.2026.6
// are GPL-3.0-or-later).
const root = resolve(__dirname, '../../..');
// The upstream LICENSE uses CRLF; compare text, not line endings.
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const notices = read('public/third-party-notices.txt');

describe('third-party notices (ADR-0010)', () => {
  const pinned = JSON.parse(read('package.json')).dependencies['@plantuml/core'];
  const installed = JSON.parse(read('node_modules/@plantuml/core/package.json'));

  it('names the pinned @plantuml/core version', () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(notices).toContain(`@plantuml/core ${pinned}`);
  });

  it('pins an MIT-licensed @plantuml/core', () => {
    expect(installed.version).toBe(pinned);
    expect(installed.license).toBe('MIT');
  });

  it('carries the PlantUML and C4-PlantUML license texts as shipped', () => {
    expect(notices).toContain(read('node_modules/@plantuml/core/LICENSE').trim());
    expect(notices).toContain(read('src/utils/plantuml/stdlib/C4-PlantUML.LICENSE').trim());
  });

  it('attributes the bundled themes, icons and emoji', () => {
    expect(notices).toContain('Copyright (c) 2020 Brett Schwarz');
    expect(notices).toContain('Copyright (c) 2014 Waybury');
    expect(notices).toContain('Graphics licensed under CC-BY 4.0');
  });
});
