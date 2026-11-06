import React, { Children, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderMermaid } from '@/utils/mermaid/renderMermaid';

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
      const { svg } = await renderMermaid(block.id, block.source);
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
