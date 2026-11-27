// Build the comment we post (#1047): who to notify, and the ADF body.

/**
 * People we ask Confluence to notify: the @-mentioned and the diagram's last
 * modifier, once each, never the writer. This is a plan, not a delivery count.
 */
export function plannedRecipients(input: {
  mentionIds: string[];
  lastModifierId: string | undefined;
  currentAccountId: string | undefined;
}): string[] {
  const out: string[] = [];
  for (const id of [...input.mentionIds, input.lastModifierId]) {
    if (id && id !== input.currentAccountId && !out.includes(id)) out.push(id);
  }
  return out;
}

export interface AdfDoc {
  version: 1;
  type: 'doc';
  content: Array<Record<string, unknown>>;
}

/**
 * A comment body: mentions first, then the reader's text, then a line that
 * links back to the diagram. A mention carries `text` as well as `id`: without
 * it, Confluence's notification preview shows "@unknown" (CONFCLOUD-84905).
 */
export function buildCommentAdf(input: {
  text: string;
  mentions: Array<{ accountId: string; name: string }>;
  link?: { href: string; label: string };
}): AdfDoc {
  const blocks = input.text.replace(/\r\n/g, '\n').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (!blocks.length) blocks.push('');
  const content: AdfDoc['content'] = blocks.map((block, i) => {
    const lines = block.split('\n');
    const nodes: Array<Record<string, unknown>> = [];
    if (i === 0) {
      input.mentions.forEach((m, j) => {
        nodes.push({ type: 'mention', attrs: { id: m.accountId, text: `@${m.name}` } });
        if (j < input.mentions.length - 1) nodes.push({ type: 'text', text: ' ' });
      });
    }
    lines.forEach((line, k) => {
      if (k > 0) nodes.push({ type: 'hardBreak' });
      const lead = i === 0 && k === 0 && input.mentions.length ? ' ' : '';
      if (lead + line !== '') nodes.push({ type: 'text', text: lead + line });
    });
    return { type: 'paragraph', content: nodes };
  });
  if (input.link) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: input.link.label, marks: [{ type: 'link', attrs: { href: input.link.href } }] }],
    });
  }
  return { version: 1, type: 'doc', content };
}

/** A short random token that makes each posted comment's link unique. */
export function newNonce(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => (b % 36).toString(36)).join('');
}
