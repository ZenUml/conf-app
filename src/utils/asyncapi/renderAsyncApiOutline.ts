/**
 * A read-only outline of an AsyncAPI document, drawn without the AsyncAPI parser.
 *
 * WHY NOT @asyncapi/react-component. The MCP Apps host (claude.ai) runs the
 * view under a CSP with no 'unsafe-eval', and @asyncapi/parser compiles its
 * validators with `new Function` at import time, so the import alone throws
 * (docs/features/mcp-app-view.md, "Why not AsyncAPI"). This draws what a
 * reader needs from the YAML itself: the title and version, servers, channels,
 * operations and messages, for both AsyncAPI 2.x (publish/subscribe under each
 * channel) and 3.x (top-level `operations` that reference channels).
 *
 * Every string from the spec is set with textContent, never as HTML: the spec
 * is user content and this runs in someone else's frame.
 */
import yaml from 'js-yaml';

type Obj = Record<string, unknown>;

export interface AsyncApiOutline {
  asyncapi: string;
  title?: string;
  version?: string;
  description?: string;
  servers: Array<{ name: string; url: string; protocol?: string }>;
  channels: Array<{ name: string; address?: string; description?: string }>;
  operations: Array<{ id: string; action: string; channel: string; summary?: string }>;
  messages: Array<{ name: string; summary?: string }>;
}

function obj(value: unknown): Obj | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/** `#/channels/userSignedUp` → `userSignedUp`. JSON Pointer escapes are undone. */
function refName(value: unknown): string | undefined {
  const ref = str(obj(value)?.$ref);
  if (!ref) return undefined;
  const last = ref.split('/').pop() ?? ref;
  return last.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Parse the spec into an outline. Throws with a readable message when it is not AsyncAPI. */
export function readAsyncApiOutline(source: string): AsyncApiOutline {
  const doc = obj(yaml.load(source));
  if (!doc) throw new Error('the AsyncAPI document must be a YAML or JSON mapping');
  const asyncapi = str(doc.asyncapi);
  if (!asyncapi) throw new Error("the document has no top-level 'asyncapi' version key");
  const major = Number.parseInt(asyncapi, 10);

  const info = obj(doc.info) ?? {};
  const servers = Object.entries(obj(doc.servers) ?? {}).map(([name, raw]) => {
    const s = obj(raw) ?? {};
    // 2.x has `url`; 3.x splits it into `host` and `pathname`.
    const url = str(s.url) ?? [str(s.host), str(s.pathname)].filter(Boolean).join('');
    return { name, url, protocol: str(s.protocol) };
  });

  const channelEntries = Object.entries(obj(doc.channels) ?? {});
  const channels = channelEntries.map(([name, raw]) => {
    const c = obj(raw) ?? {};
    return { name, address: str(c.address), description: str(c.description) };
  });

  const operations: AsyncApiOutline['operations'] = [];
  if (major >= 3) {
    for (const [id, raw] of Object.entries(obj(doc.operations) ?? {})) {
      const o = obj(raw) ?? {};
      operations.push({
        id,
        action: str(o.action) ?? 'operation',
        channel: refName(o.channel) ?? '',
        summary: str(o.summary) ?? str(o.description),
      });
    }
  } else {
    for (const [channel, raw] of channelEntries) {
      const c = obj(raw) ?? {};
      for (const action of ['publish', 'subscribe'] as const) {
        const o = obj(c[action]);
        if (!o) continue;
        operations.push({
          id: str(o.operationId) ?? `${action} ${channel}`,
          action,
          channel,
          summary: str(o.summary) ?? str(o.description),
        });
      }
    }
  }

  const messages = Object.entries(obj(obj(doc.components)?.messages) ?? {}).map(([name, raw]) => {
    const m = obj(raw) ?? {};
    return { name: str(m.name) ?? name, summary: str(m.summary) ?? str(m.title) };
  });

  return {
    asyncapi,
    title: str(info.title),
    version: str(info.version),
    description: str(info.description),
    servers,
    channels,
    operations,
    messages,
  };
}

const STYLE = `
.zen-asyncapi { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #172b4d; padding: 4px 8px 12px; }
.zen-asyncapi h1 { font-size: 20px; margin: 0 0 2px; }
.zen-asyncapi .zen-asyncapi-meta { color: #626f86; margin: 0 0 10px; }
.zen-asyncapi .zen-asyncapi-desc { white-space: pre-wrap; margin: 0 0 12px; }
.zen-asyncapi h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #626f86; margin: 16px 0 6px; }
.zen-asyncapi ul { list-style: none; margin: 0; padding: 0; }
.zen-asyncapi li { padding: 6px 0; border-top: 1px solid #dfe1e6; }
.zen-asyncapi code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
.zen-asyncapi .zen-asyncapi-tag { display: inline-block; min-width: 64px; margin-right: 8px; padding: 0 6px; border-radius: 3px;
  font-size: 11px; font-weight: 600; text-transform: uppercase; text-align: center; background: #e9f2ff; color: #0055cc; }
.zen-asyncapi .zen-asyncapi-note { color: #626f86; margin-left: 6px; }
@media (prefers-color-scheme: dark) {
  .zen-asyncapi { color: #dee4ea; }
  .zen-asyncapi li { border-top-color: #38414a; }
  .zen-asyncapi .zen-asyncapi-meta, .zen-asyncapi h2, .zen-asyncapi .zen-asyncapi-note { color: #9fadbc; }
  .zen-asyncapi .zen-asyncapi-tag { background: #1c2b41; color: #85b8ff; }
}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(root: HTMLElement, heading: string, items: HTMLElement[]): void {
  if (!items.length) return;
  root.appendChild(el('h2', undefined, heading));
  const list = el('ul');
  items.forEach((item) => list.appendChild(item));
  root.appendChild(list);
}

/** Draw the outline of `source` into `container`, replacing its contents. */
export function renderAsyncApiOutline(container: HTMLElement, source: string): AsyncApiOutline {
  const outline = readAsyncApiOutline(source);
  container.innerHTML = '';
  const root = el('div', 'zen-asyncapi');
  root.appendChild(el('style', undefined, STYLE));
  root.appendChild(el('h1', undefined, outline.title ?? 'AsyncAPI document'));
  const meta = [outline.version ? `Version ${outline.version}` : '', `AsyncAPI ${outline.asyncapi}`].filter(Boolean).join(' · ');
  root.appendChild(el('p', 'zen-asyncapi-meta', meta));
  if (outline.description) root.appendChild(el('p', 'zen-asyncapi-desc', outline.description));

  section(root, 'Servers', outline.servers.map((s) => {
    const li = el('li');
    li.appendChild(el('code', undefined, s.name));
    const note = [s.url, s.protocol].filter(Boolean).join(' · ');
    if (note) li.appendChild(el('span', 'zen-asyncapi-note', note));
    return li;
  }));

  section(root, 'Operations', outline.operations.map((o) => {
    const li = el('li');
    li.appendChild(el('span', 'zen-asyncapi-tag', o.action));
    li.appendChild(el('code', undefined, o.channel || o.id));
    if (o.summary) li.appendChild(el('span', 'zen-asyncapi-note', o.summary));
    return li;
  }));

  section(root, 'Channels', outline.channels.map((c) => {
    const li = el('li');
    li.appendChild(el('code', undefined, c.address ?? c.name));
    if (c.description) li.appendChild(el('span', 'zen-asyncapi-note', c.description));
    return li;
  }));

  section(root, 'Messages', outline.messages.map((m) => {
    const li = el('li');
    li.appendChild(el('code', undefined, m.name));
    if (m.summary) li.appendChild(el('span', 'zen-asyncapi-note', m.summary));
    return li;
  }));

  container.appendChild(root);
  return outline;
}
