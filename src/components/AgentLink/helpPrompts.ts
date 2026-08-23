// Short, state-aware prompts users can paste into their current AI agent
// session. They intentionally contain no endpoint URL, session token/pairing
// code, document content, raw error, or deployment detail. The explicit
// connection prompt lives in ConnectPanel because that is the one case
// where the one-time code is inherently required.

export const AGENT_LINK_SETUP_HELP_PROMPT = [
  'Help me connect this AI assistant to ZenUML Agent Link.',
  'Check whether the Agent Link MCP is available and configured, then guide me through updating or adding its configuration if needed.',
  'Tell me when this current or a new AI assistant session is ready for the connection prompt.',
  'Do not start a nested agent process, and do not ask me to share tokens, URLs, document contents, raw errors, or deployment details.',
].join(' ')

export const AGENT_LINK_PROTOCOL_HELP_PROMPT = [
  'ZenUML Agent Link says this AI client is not compatible. No diagram change was attempted.',
  'Update or reconfigure the Agent Link MCP in this current AI client, then start a fresh AI client session.',
  'Do not start a nested agent process, and do not ask me to share tokens, URLs, document contents, raw errors, or deployment details.',
].join(' ')
