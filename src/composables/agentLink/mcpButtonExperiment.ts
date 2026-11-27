// The viewer-header Connect MCP button test (catalog.ts AgentLinkMcpButtonVariant).
//
// Why: about 1,700 viewers a day saw the inline button in late November 2026,
// and 3–6 opened the dialog. The button is revealed only on hover and is
// labelled "MCP", a term most Confluence readers do not know. The treatment
// arm names the outcome and keeps the button visible at rest for people who
// can edit the diagram, the ones likely to point an agent at their code.
//
// Assignment is a stable hash of the Atlassian account id, so one person sees
// one arm on every page, macro and site. Without an account (anonymous
// viewers, who cannot connect anyway) the button stays as it was.

export type McpButtonVariant = 'control' | 'outcome_label'

// Part of the hash input: a later test with a new key reshuffles the split.
const EXPERIMENT_KEY = 'mcp-button-2026-11'

// QA override, read in the macro iframe's own storage: set it to 'control' or
// 'outcome_label' to see an arm on staging or in Storybook.
export const MCP_BUTTON_VARIANT_OVERRIDE_KEY = 'zenuml.mcpButtonVariant'

export const MCP_BUTTON_LABEL: Record<McpButtonVariant, string> = {
  control: 'MCP',
  outcome_label: 'Use with AI',
}

// FNV-1a, 32-bit: small, stable across browsers, and evenly spread for ids.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

function override(): McpButtonVariant | null {
  try {
    const value = localStorage.getItem(MCP_BUTTON_VARIANT_OVERRIDE_KEY)
    return value === 'control' || value === 'outcome_label' ? value : null
  } catch {
    return null
  }
}

/** The arm for this account; 'control' when there is no account. */
export function mcpButtonVariant(accountId: string | null | undefined): McpButtonVariant {
  const forced = override()
  if (forced) return forced
  if (!accountId) return 'control'
  return fnv1a(`${EXPERIMENT_KEY}:${accountId}`) % 2 === 0 ? 'control' : 'outcome_label'
}
