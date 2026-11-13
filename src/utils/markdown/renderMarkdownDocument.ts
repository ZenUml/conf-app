import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

// Minimal tree shape: mdast and hast both fit it, and the plugins below need nothing more.
interface TreeNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: TreeNode[];
}

function walk(node: TreeNode, visit: (node: TreeNode) => void) {
  visit(node);
  node.children?.forEach((child) => walk(child, visit));
}

// Raw HTML is shown as text, never parsed: remark-rehype drops `html` nodes unless told otherwise.
function remarkRawHtmlAsText() {
  return (tree: TreeNode) => walk(tree, (node) => {
    if (node.type === 'html') node.type = 'text';
  });
}

// Same allow-list as react-markdown's defaultUrlTransform: relative URLs and http(s), irc(s), mailto, xmpp.
function safeUrl(url: string) {
  const colon = url.indexOf(':');
  const question = url.indexOf('?');
  const hash = url.indexOf('#');
  const slash = url.indexOf('/');
  if (colon === -1
    || (slash !== -1 && colon > slash)
    || (question !== -1 && colon > question)
    || (hash !== -1 && colon > hash)
    || /^(https?|ircs?|mailto|xmpp)$/i.test(url.slice(0, colon))) {
    return url;
  }
  return '';
}

const URL_PROPERTIES = ['href', 'src', 'cite'];

function rehypeSafeElements() {
  return (tree: TreeNode) => walk(tree, (node) => {
    if (node.type !== 'element' || !node.properties) return;
    for (const name of URL_PROPERTIES) {
      if (typeof node.properties[name] === 'string') node.properties[name] = safeUrl(node.properties[name]);
    }
    // GFM column alignment: react-markdown emitted an inline style, so keep that.
    if ((node.tagName === 'td' || node.tagName === 'th') && typeof node.properties.align === 'string') {
      node.properties.style = `text-align:${node.properties.align}`;
      delete node.properties.align;
    }
    if (node.tagName === 'a') {
      node.properties.target = '_blank';
      node.properties.rel = 'noopener noreferrer';
    }
  });
}

function isMermaidPre(node: TreeNode) {
  const code = node.children?.[0];
  const className = code?.properties?.className;
  return node.tagName === 'pre' && code?.tagName === 'code'
    && Array.isArray(className) && className.includes('language-mermaid');
}

// Turns each ```mermaid block into an empty placeholder and records its source.
function rehypeMermaidPlaceholders(prefix: string, blocks: Array<{ id: string; source: string }>) {
  return () => (tree: TreeNode) => walk(tree, (node) => {
    if (node.type !== 'element' || !isMermaidPre(node)) return;
    const id = `${prefix}-${blocks.length}`;
    blocks.push({ id, source: (node.children![0].children ?? []).map((child) => child.value ?? '').join('') });
    node.tagName = 'div';
    node.properties = { dataMarkdownDiagram: id, className: ['markdown-diagram'] };
    node.children = [];
  });
}

let nextDocumentId = 0;

// Keep "Parse error on line N" and the caret excerpt; the token list after
// "Expecting" runs to ~30 grammar names and tells an author nothing.
function describeMermaidError(error: unknown, source: string) {
  const text = error instanceof Error ? error.message : String(error ?? '');
  const lines = text.split('\n');
  const expecting = lines.findIndex((line) => line.startsWith('Expecting '));
  const reason = (expecting === -1 ? lines : lines.slice(0, expecting)).join('\n').trim();
  // Sequence diagrams treat `;` as a line break, so "untouched; next" in a note
  // or message splits it in two. Flowchart labels accept `;`; mermaid 11.13.
  if (/^\s*sequenceDiagram\b/m.test(source) && reason.includes(';')) {
    return `${reason}\n\nIn a sequence diagram, ";" ends a statement. Write #59; for a literal semicolon.`;
  }
  return reason;
}

/** Draws one ```mermaid block. The app passes renderMermaid; the MCP view, which has no Confluence bundle to load Mermaid from, passes its own. */
export type MarkdownDiagramRenderer = (id: string, source: string) => Promise<{ svg: string }>;

/**
 * Render a whole document. Raw HTML stays escaped; unsafe URLs are emptied and links open in a new tab.
 *
 * Kept free of any Mermaid import so a bundle that brings its own Mermaid
 * (mcp-app-view.ts) does not also pull in the app's loader.
 */
export async function renderMarkdownDocument(source: string, renderDiagram: MarkdownDiagramRenderer) {
  const prefix = `markdown-${++nextDocumentId}`;
  const blocks: Array<{ id: string; source: string }> = [];
  const html = String(await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRawHtmlAsText)
    .use(remarkRehype)
    .use(rehypeSafeElements)
    .use(rehypeMermaidPlaceholders(prefix, blocks))
    .use(rehypeStringify)
    .process(source));
  const template = document.createElement('template');
  template.innerHTML = html;
  let failedBlocks = 0;
  // Serialize diagram rendering: Mermaid uses a shared runtime and temporary DOM.
  for (const block of blocks) {
    const container = template.content.querySelector(`[data-markdown-diagram="${block.id}"]`)!;
    try {
      const { svg } = await renderDiagram(block.id, block.source);
      container.innerHTML = svg;
    } catch (error) {
      failedBlocks++;
      container.setAttribute('role', 'alert');
      const message = document.createElement('p');
      message.textContent = 'Could not render Mermaid diagram. Check the source below.';
      // Mermaid's message names the line and echoes it with a caret. textContent,
      // never innerHTML: the echoed line is author source and may contain markup.
      const reason = document.createElement('pre');
      reason.className = 'markdown-diagram-error';
      reason.textContent = describeMermaidError(error, block.source);
      const code = document.createElement('pre');
      code.textContent = block.source;
      container.append(message, reason, code);
    }
  }
  return { html: template.innerHTML, mermaidBlocks: blocks.length, failedBlocks };
}
