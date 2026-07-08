// src/composables/agentLink/bridgeOps.ts
//
// Privileged Confluence I/O for the Live Agent Link macro side
// (docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.1, §6).
// The macro is the privileged actor (design §3 decision #1): every read/write
// goes through its own Forge bridge, never the agent. `createBridgeOps` wraps
// an INJECTED `AgentLinkBridge` so the write-scope rule — "read whole page +
// write only the bound diagram" (design §3 decision #4) — is unit-testable
// without a live Forge runtime.
//
// TODO(agent-link): back AgentLinkBridge with ApWrapper2 / requestConfluence
// (Forge bridge) — that needs the live runtime and is not wired here.

export interface AgentLinkBridge {
  readPage(): Promise<{ pageId: string; title: string; text: string }>;
  readDiagram(
    contentId: string
  ): Promise<{ contentId: string; diagramType: string; dsl: string }>;
  writeDiagram(
    contentId: string,
    dsl: string
  ): Promise<{ ok: boolean; version?: number; rendered?: boolean }>;
}

export interface WriteDiagramResult {
  ok: boolean;
  version?: number;
  rendered?: boolean;
  // Set (and no bridge call made) when the requested contentId isn't the
  // bound diagram — see the scope check below.
  reason?: string;
}

export interface AgentLinkBridgeOps {
  readPage(): ReturnType<AgentLinkBridge["readPage"]>;
  readDiagram(): ReturnType<AgentLinkBridge["readDiagram"]>;
  // `summary` is the agent's optional one-line description of the change
  // (design §6 `update_diagram`); it drives the activity-feed entry at the
  // useAgentLinkSession layer and is not sent to the bridge itself.
  // `contentId` defaults to the bound diagram; it exists as an explicit,
  // testable seam for the scope check — real call sites never pass it.
  writeDiagram(
    dsl: string,
    summary?: string,
    contentId?: string
  ): Promise<WriteDiagramResult>;
}

export function createBridgeOps(
  bridge: AgentLinkBridge,
  boundContentId: string
): AgentLinkBridgeOps {
  return {
    readPage: () => bridge.readPage(),
    // read_diagram() (design §6) always resolves to the one bound diagram —
    // there is no other content this session is allowed to read a DSL for.
    readDiagram: () => bridge.readDiagram(boundContentId),
    async writeDiagram(dsl, _summary, contentId = boundContentId) {
      if (contentId !== boundContentId) {
        // Decision #4: write scope is the bound diagram only. Deny outright —
        // do not call the bridge with either the requested or the bound id.
        return { ok: false, reason: "scope_violation" };
      }
      return bridge.writeDiagram(boundContentId, dsl);
    },
  };
}
