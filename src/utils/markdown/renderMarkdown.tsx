import { renderMermaid } from '@/utils/mermaid/renderMermaid';
import { renderMarkdownDocument } from './renderMarkdownDocument';

/** Render a whole document with the app's Mermaid. See renderMarkdownDocument. */
export function renderMarkdown(source: string) {
  return renderMarkdownDocument(source, renderMermaid);
}
