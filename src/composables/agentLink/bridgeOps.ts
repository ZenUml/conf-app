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

// One discovery result row (search_diagrams / list_diagrams), design §3. The
// agent re-ranks these itself, then opens a hit with read_diagram { contentId }.
export interface AgentLinkDiagramRow {
  contentId: string;
  title: string;
  diagramType: string;
  spaceKey: string;
  pageId: string;
  // Pre-highlighted match snippet from the CQL search response (empty for
  // list_diagrams, which has no query to highlight).
  excerpt: string;
  lastModified: string;
}

// read_diagram result (design §3) — enough to pull-to-local. `title`/`pageId`/
// `version` were added for the discovery surface (S5): a diagram read by
// contentId is only useful if the agent can see where it lives.
export interface AgentLinkReadDiagramResult {
  contentId: string;
  diagramType: string;
  title: string;
  dsl: string;
  pageId?: string;
  version?: number;
}

export interface SearchDiagramsParams {
  query: string;
  types?: string[];
  spaceKey?: string;
  limit?: number;
}

export interface ListDiagramsParams {
  spaceKey?: string;
  pageId?: string;
  types?: string[];
  limit?: number;
}

export interface AgentLinkBridge {
  readPage(): Promise<{ pageId: string; title: string; text: string }>;
  readDiagram(contentId: string): Promise<AgentLinkReadDiagramResult>;
  writeDiagram(
    contentId: string,
    dsl: string
  ): Promise<{ ok: boolean; version?: number; rendered?: boolean }>;
  // Discovery (design §S3/S4) — read-only, user-permissioned, may reach any
  // diagram the user can see. NOT scoped to the bound contentId (that scope is
  // the WRITE anchor only).
  searchDiagrams(params: SearchDiagramsParams): Promise<AgentLinkDiagramRow[]>;
  listDiagrams(params: ListDiagramsParams): Promise<AgentLinkDiagramRow[]>;
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
  // S5: default (no arg) reads the bound diagram — unchanged. A `contentId`
  // reads any diagram the user can see (a discovery hit). Reads are NOT
  // scope-gated (the bound contentId is the write anchor, not a read cage).
  readDiagram(contentId?: string): ReturnType<AgentLinkBridge["readDiagram"]>;
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
  // Discovery (design §S3/S4) — passthrough, read-only, user-permissioned.
  searchDiagrams(params: SearchDiagramsParams): Promise<AgentLinkDiagramRow[]>;
  listDiagrams(params: ListDiagramsParams): Promise<AgentLinkDiagramRow[]>;
}

export function createBridgeOps(
  bridge: AgentLinkBridge,
  boundContentId: string
): AgentLinkBridgeOps {
  return {
    readPage: () => bridge.readPage(),
    // S5: read the bound diagram by default; a `contentId` reads any diagram
    // the user can see. Unlike writeDiagram below, reads are NOT scope-gated —
    // the bind is the write anchor + UI anchor, not a read cage (design §3).
    readDiagram: (contentId) => bridge.readDiagram(contentId ?? boundContentId),
    async writeDiagram(dsl, _summary, contentId = boundContentId) {
      if (contentId !== boundContentId) {
        // Decision #4: write scope is the bound diagram only. Deny outright —
        // do not call the bridge with either the requested or the bound id.
        return { ok: false, reason: "scope_violation" };
      }
      return bridge.writeDiagram(boundContentId, dsl);
    },
    // Discovery is read-only and user-permissioned — no scope gate; a second
    // WRITE target still requires a second user-minted link (write invariant).
    searchDiagrams: (params) => bridge.searchDiagrams(params),
    listDiagrams: (params) => bridge.listDiagrams(params),
  };
}

// Macro-host mounting seam (docs/superpowers/specs/2026-07-08-live-agent-link-design.md
// §5.1). The host component (GenericViewer.vue) needs an AgentLinkBridgeOps
// to construct useAgentLinkSession() before the real Forge-bridge-backed
// AgentLinkBridge exists — this satisfies the interface without performing
// any Confluence I/O. Nothing in the current UI plumbing invokes these ops
// (ConnectPanel only emits `disconnect` / `open-fullscreen`, never an edit),
// so rejecting is a safe placeholder, not a silent no-op.
//
// TODO(agent-link): swap this for createBridgeOps(bridge, boundContentId)
// once an ApWrapper2 / requestConfluence-backed AgentLinkBridge exists and
// the relay transport can call applyEdit() for real.
export function createUnwiredBridgeOps(): AgentLinkBridgeOps {
  const notWired = () =>
    Promise.reject(
      new Error("agent-link bridge not wired yet (relay transport is out of scope)")
    );
  return {
    readPage: notWired,
    readDiagram: notWired,
    writeDiagram: notWired,
    searchDiagrams: notWired,
    listDiagrams: notWired,
  };
}
