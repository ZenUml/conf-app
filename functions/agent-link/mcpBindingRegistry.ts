/**
 * Local-dev/test fallback for MCP-session -> Agent Link token bindings.
 * Production stores the same relation in Durable Objects; this Map mirrors
 * registrySingleton.ts so Pages Functions without AGENT_LINK stay usable.
 */
export class McpBindingRegistry {
  private readonly tokenBySession = new Map<string, string>();
  private readonly sessionByToken = new Map<string, string>();

  bind(mcpSessionId: string, token: string): { ok: true } | { ok: false; code: 'code_already_used' } {
    const claimant = this.sessionByToken.get(token);
    if (claimant && claimant !== mcpSessionId) return { ok: false, code: 'code_already_used' };

    const previousToken = this.tokenBySession.get(mcpSessionId);
    if (previousToken && previousToken !== token) this.sessionByToken.delete(previousToken);

    this.tokenBySession.set(mcpSessionId, token);
    this.sessionByToken.set(token, mcpSessionId);
    return { ok: true };
  }

  getToken(mcpSessionId: string): string | undefined {
    return this.tokenBySession.get(mcpSessionId);
  }

  release(mcpSessionId: string): void {
    const token = this.tokenBySession.get(mcpSessionId);
    if (token) this.sessionByToken.delete(token);
    this.tokenBySession.delete(mcpSessionId);
  }

  clear(): void {
    this.tokenBySession.clear();
    this.sessionByToken.clear();
  }
}

export const mcpBindingRegistry = new McpBindingRegistry();
