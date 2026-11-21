// usage: node measure.mjs <distDir> <source-map-js path>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const [, , dist, smPath] = process.argv;
const { SourceMapConsumer } = await import(smPath);
const A = path.join(dist, 'assets');
const files = fs.readdirSync(A).filter((f) => f.endsWith('.js'));
const size = (f) => fs.statSync(path.join(A, f)).size;
const gz = (f) => zlib.gzipSync(fs.readFileSync(path.join(A, f)), { level: 9 }).length;

function bucket(src) {
  let m = src.match(/@zenuml[_+]core@(\d+\.\d+\.\d+)/);
  if (m) return 'core@' + m[1];
  if (/node_modules\/@zenuml\/core\//.test(src)) return 'core@ours';
  return null;
}
// byte attribution per chunk
const attr = {}; // bucket -> bytes
const perChunk = {};
for (const f of files) {
  const mp = path.join(A, f + '.map');
  if (!fs.existsSync(mp)) continue;
  const code = fs.readFileSync(path.join(A, f), 'utf8');
  const lines = code.split('\n');
  const c = new SourceMapConsumer(JSON.parse(fs.readFileSync(mp, 'utf8')));
  const segs = [];
  c.eachMapping((m) => segs.push(m));
  // attribute each segment's span to its source
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], n = segs[i + 1];
    let len;
    if (n && n.generatedLine === s.generatedLine) len = n.generatedColumn - s.generatedColumn;
    else len = (lines[s.generatedLine - 1] || '').length - s.generatedColumn;
    const b = s.source ? bucket(s.source) : null;
    if (!b) continue;
    attr[b] = (attr[b] || 0) + len;
    perChunk[f] ??= {};
    perChunk[f][b] = (perChunk[f][b] || 0) + len;
  }
}
// static import closure
const deps = {};
for (const f of files) {
  const code = fs.readFileSync(path.join(A, f), 'utf8');
  const s = new Set();
  for (const m of code.matchAll(/(?:import|export)\s*(?:[\w${}\s,*]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) s.add(m[1]);
  deps[f] = [...s];
}
const closure = (roots) => {
  const out = new Set();
  const st = [...roots];
  while (st.length) { const x = st.pop(); if (out.has(x) || !deps[x]) continue; out.add(x); st.push(...deps[x]); }
  return out;
};
const find = (re) => files.filter((f) => re.test(f));
const entry = closure(find(/^index-.*\.js$/));
const paths = {
  'entry (index)': find(/^index-.*\.js$/),
  'sequence viewer (zenuml.esm)': find(/^zenuml\.esm-/),
  'Mermaid zenuml (zenuml-definition)': find(/^zenuml-definition-/),
  'editor (Workspace)': find(/^Workspace-.*\.js$/),
};
const sum = (set, fn) => [...set].reduce((a, f) => a + fn(f), 0);
const out = { totalJsBytes: sum(new Set(files), size), jsFiles: files.length, coreBytesByVersion: attr, paths: {}, coreChunks: {} };
for (const [k, roots] of Object.entries(paths)) {
  const cl = closure(roots);
  const inc = new Set([...cl].filter((f) => k.startsWith('entry') || !entry.has(f)));
  out.paths[k] = { roots, chunks: inc.size, raw: sum(inc, size), gzip: sum(inc, gz) };
}
for (const [f, b] of Object.entries(perChunk)) {
  if (Object.values(b).reduce((a, x) => a + x, 0) > 200000) out.coreChunks[f] = { size: size(f), ...b };
}
out.chunksWithCore343 = Object.entries(perChunk).filter(([, b]) => b['core@3.43.3']).length;
out.chunksWithCore350 = Object.entries(perChunk).filter(([, b]) => b['core@3.50.1']).length;
console.log(JSON.stringify(out, null, 1));
