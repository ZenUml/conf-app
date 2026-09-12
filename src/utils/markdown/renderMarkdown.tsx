import React, { Children, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMermaid } from '@/utils/mermaid/loadMermaid';

let nextDocumentId = 0;

/** Render a whole document. Raw HTML stays escaped; URLs use react-markdown's safe defaults. */
export async function renderMarkdown(source: string) {
  const prefix = `markdown-${++nextDocumentId}`;
  const blocks: Array<{ id: string; source: string }> = [];
  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      pre({ children }) {
        const child = Children.toArray(children)[0];
        if (isValidElement<{ className?: string; children?: React.ReactNode }>(child)
          && child.props.className === 'language-mermaid') {
          const id = `${prefix}-${blocks.length}`;
          blocks.push({ id, source: String(child.props.children ?? '') });
          return <div data-markdown-diagram={id} className="markdown-diagram" />;
        }
        return <pre>{children}</pre>;
      },
      a({ node: _node, ...props }) {
        return <a {...props} target="_blank" rel="noopener noreferrer" />;
      },
    }}>{source}</ReactMarkdown>,
  );
  const template = document.createElement('template');
  template.innerHTML = html;
  let failedBlocks = 0;
  // Serialize diagram rendering: Mermaid uses a shared runtime and temporary DOM.
  for (const block of blocks) {
    const container = template.content.querySelector(`[data-markdown-diagram="${block.id}"]`)!;
    try {
      const mermaid = await loadMermaid();
      const { svg } = await mermaid.render(block.id, block.source);
      container.innerHTML = svg;
    } catch {
      failedBlocks++;
      container.setAttribute('role', 'alert');
      const message = document.createElement('p');
      message.textContent = 'Could not render Mermaid diagram. Check the source below.';
      const code = document.createElement('pre');
      code.textContent = block.source;
      container.append(message, code);
      // Mermaid can leave its error SVG in the document after rejecting.
      document.getElementById(`d${block.id}`)?.remove();
    }
  }
  return { html: template.innerHTML, mermaidBlocks: blocks.length, failedBlocks };
}
