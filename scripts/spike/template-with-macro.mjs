// Usage: SITE=https://example.atlassian.net SRC_PAGE_ID=123 SPACE_KEY=TEST node scripts/spike/template-with-macro.mjs
// Reads FORGE_EMAIL / FORGE_API_TOKEN from .env.forge.local. Prints the captured
// extension node and the created templateId. Never prints the token.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env.forge.local', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const SITE = process.env.SITE;
const AUTH = 'Basic ' + Buffer.from(`${env.FORGE_EMAIL}:${env.FORGE_API_TOKEN}`).toString('base64');
const { SRC_PAGE_ID, SPACE_KEY } = process.env;
if (!SITE || !SRC_PAGE_ID || !SPACE_KEY) { console.error('SITE, SRC_PAGE_ID and SPACE_KEY are required'); process.exit(2); }

async function call(path, init = {}) {
  const res = await fetch(SITE + path, { ...init, headers: { Authorization: AUTH, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// 1. Capture the page's ADF and pull the first ZenUML extension node.
const page = await call(`/wiki/api/v2/pages/${SRC_PAGE_ID}?body-format=atlas_doc_format`);
const adf = JSON.parse(page.body.atlas_doc_format.value);
function findExtension(node) {
  if (!node || typeof node !== 'object') return undefined;
  if (['extension', 'bodiedExtension', 'inlineExtension'].includes(node.type) && String(node.attrs?.extensionKey || '').includes('zenuml')) return node;
  for (const c of node.content || []) { const hit = findExtension(c); if (hit) return hit; }
  return undefined;
}
const capturedExt = findExtension(adf);
if (!capturedExt) { console.error('no zenuml extension node on the source page'); process.exit(3); }

// Keep only app/module routing metadata. A published node's localId,
// guestParams.customContentId, and embeddedMacroContext all belong to the
// source macro/page. Carrying any of them into the template would clone a
// reference to the existing diagram instead of exercising a first create.
const capturedParams = capturedExt.attrs.parameters || {};
const ext = {
  type: capturedExt.type,
  attrs: {
    layout: capturedExt.attrs.layout,
    extensionType: capturedExt.attrs.extensionType,
    extensionKey: capturedExt.attrs.extensionKey,
    text: capturedExt.attrs.text,
    parameters: {
      layout: capturedParams.layout,
      forgeEnvironment: capturedParams.forgeEnvironment,
      extensionId: capturedParams.extensionId,
      extensionTitle: capturedParams.extensionTitle,
      guestParams: {},
    },
  },
};
console.log('submitted extension node:\n' + JSON.stringify(ext, null, 2));

// 2. Create a space template whose body is: heading + paragraph + that node.
const body = { version: 1, type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Design note' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Describe the change, then keep the diagram below current.' }] },
  ext,
] };
const created = await call('/wiki/rest/api/template', { method: 'POST', body: JSON.stringify({
  name: `ZenUML spike ${new Date().toISOString().slice(0, 16)}`,
  templateType: 'page',
  description: 'Spike: Forge macro inside a space template',
  space: { key: SPACE_KEY },
  body: { atlas_doc_format: { value: JSON.stringify(body), representation: 'atlas_doc_format' } },
}) });
console.log('templateId:', created.templateId, 'editorVersion:', created.editorVersion);
