import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const workerRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(workerRoot, '../..');
const assetRoot = resolve(workerRoot, 'dist/assets');
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit) {
  throw new Error('GITHUB_SHA does not match the checked-out source commit');
}
const dirty = git('status', '--porcelain', '--untracked-files=normal').length > 0;
const pkg = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));

// Never empty the Forge build, mutate its Vite config, or copy its SPA shell.
await rm(assetRoot, { recursive: true, force: true });
await mkdir(assetRoot, { recursive: true });
await build({
  configFile: resolve(repoRoot, 'vite.mcp-app.config.mjs'),
  mode: 'production',
  build: { outDir: resolve(assetRoot, 'mcp-app'), emptyOutDir: true },
});
await cp(resolve(repoRoot, 'public/drawio'), resolve(assetRoot, 'drawio'), { recursive: true });
const view = await readFile(resolve(assetRoot, 'mcp-app/view.html'));
if (!view.toString().includes('<meta name="mcp-app" content="zenuml-diagram">')) {
  throw new Error('Independent build did not emit the MCP Apps view marker');
}
const chunks = await readdir(resolve(assetRoot, 'mcp-app/assets'));
const requiredFont = (pattern) => {
  const matches = chunks.filter((name) => pattern.test(name));
  if (matches.length !== 1) throw new Error(`Expected one hosted font matching ${pattern}`);
  return `/mcp-app/assets/${matches[0]}`;
};
const smokePaths = [
  [requiredFont(/^IBMPlexSans-Regular-Latin1-.*\.woff2$/), 'font/woff2'],
  [requiredFont(/^MS-Sans-Serif-.*\.ttf$/), 'font/ttf'],
  ['/drawio/js/viewer-static.min.js', 'application/javascript'],
  ['/drawio/stencils/aws4.xml', 'application/xml'],
  ['/drawio/math4/es5/startup.js', 'application/javascript'],
];
const smokeAssets = await Promise.all(smokePaths.map(async ([path, contentType]) => ({
  path,
  contentType,
  sha256: createHash('sha256').update(await readFile(resolve(assetRoot, `.${path}`))).digest('hex'),
})));
const metadata = {
  version: pkg.version,
  commit,
  dirty,
  builtAt: new Date().toISOString(),
  viewSha256: createHash('sha256').update(view).digest('hex'),
  smokeAssets,
};
await writeFile(resolve(assetRoot, 'mcp-app/build-info.json'), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify({ assets: assetRoot, ...metadata }));
