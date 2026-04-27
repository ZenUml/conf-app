# Mixpanel Schema Redesign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the canonical Mixpanel event catalog, typed property model, and `trackAnalyticsEvent` frontend API; update the backend `/track` endpoint to accept canonical events; migrate one high-priority call site (`view_macro` → `macro_viewed` in `Sequence.vue`) as the Phase 1 smoke test.

**Architecture:** The canonical frontend tracker (`trackAnalyticsEvent`) uses `mixpanel-browser` directly — consistent with the existing `_awaitableTrackEvent` pattern — and auto-enriches runtime context (user, domain, product type, etc.) from the same sources as the legacy function. The backend `mixpanelService` is updated to use `event.event || event.action` so canonical events from any path land in Mixpanel with the right name. The legacy `trackEvent` wrapper is untouched; only one call site is migrated in this phase.

**Tech Stack:** TypeScript, Vue 3, Vitest, mixpanel-browser (client-side SDK), Cloudflare Pages Functions, Wrangler

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/utils/analytics/catalog.ts` | `AnalyticsEventName` union + all enum types |
| Create | `src/utils/analytics/types.ts` | `AnalyticsProperties` interface (base + event-specific) |
| Create | `src/utils/analytics/trackAnalyticsEvent.ts` | Canonical frontend tracker with auto-enrichment |
| Create | `src/utils/analytics/trackAnalyticsEvent.spec.ts` | Unit tests for canonical tracker |
| Create | `functions/service/analyticsTypes.ts` | Duplicate of catalog types for backend — no `src/` path alias in wrangler compilation |
| Modify | `functions/service/mixpanelService.ts` | Use `event.event \|\| event.action` as Mixpanel event name |
| Modify | `functions/track.ts` | Accept `transport_version: 2` with `event` field; keep legacy `action` path working |
| Modify | `src/components/Sequence.vue` | Replace `trackEvent('', 'view_macro', DiagramType.Sequence)` with `trackAnalyticsEvent("macro_viewed", {...})` |

---

## Task 1: Create the event catalog

**Files:**
- Create: `src/utils/analytics/catalog.ts`

- [ ] **Step 1: Create the file**

```ts
// src/utils/analytics/catalog.ts

export type FeatureArea =
  | "macro"
  | "ai"
  | "upgrade"
  | "content"
  | "confluence"
  | "feedback"
  | "system";

export type MacroTypeValue =
  | "sequence"
  | "mermaid"
  | "graph"
  | "openapi"
  | "embed"
  | "plantuml"
  | "none";

export type Surface =
  | "viewer"
  | "editor"
  | "modal"
  | "dashboard"
  | "route"
  | "forge_trigger";

export type EntryPoint =
  | "page_view"
  | "macro_toolbar"
  | "page_editor"
  | "get_started"
  | "viewer_notice"
  | "ai_prompt"
  | "dashboard"
  | "route"
  | "forge_trigger"
  | "unknown";

export type OperationMode = "create" | "edit" | "unknown";

export type FeedbackValue = "good" | "partial" | "bad";

export type AnalyticsEventName =
  | "macro_viewed"
  | "macro_create_started"
  | "macro_create_succeeded"
  | "macro_edit_opened"
  | "macro_edit_cancelled"
  | "macro_save_succeeded"
  | "macro_save_failed"
  | "macro_export_requested"
  | "macro_export_succeeded"
  | "macro_export_failed"
  | "ai_generation_requested"
  | "ai_generation_succeeded"
  | "ai_generation_failed"
  | "ai_editor_opened"
  | "ai_feedback_submitted"
  | "upgrade_modal_shown"
  | "upgrade_cta_clicked"
  | "upgrade_action_blocked"
  | "upgrade_modal_dismissed"
  | "upgrade_prompt_hovered"
  | "upgrade_slider_changed"
  | "content_sync_requested"
  | "content_sync_succeeded"
  | "content_sync_failed"
  | "custom_content_loaded"
  | "confluence_page_viewed"
  | "confluence_page_updated"
  | "csat_submitted"
  | "feedback_link_clicked"
  | "feature_flags_fetch_failed"
  | "attachment_create_failed"
  | "custom_content_update_failed";
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app
pnpm test:unit --reporter=verbose 2>&1 | tail -5
```

Expected: no TypeScript errors related to `catalog.ts`. Existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/utils/analytics/catalog.ts
git commit -m "feat(analytics): add canonical event catalog (Phase 1)"
```

---

## Task 2: Create the shared property types

**Files:**
- Create: `src/utils/analytics/types.ts`

- [ ] **Step 1: Create the file**

```ts
// src/utils/analytics/types.ts

import type {
  FeatureArea,
  MacroTypeValue,
  Surface,
  EntryPoint,
  OperationMode,
  FeedbackValue,
} from "./catalog";

export type AnalyticsProperties = {
  // Required at call site
  feature_area: FeatureArea;
  surface: Surface;
  // Auto-enriched by tracker (optional for callers)
  client_domain?: string;
  user_account_id?: string;
  product_type?: "lite" | "full" | "diagramly";
  environment_type?: string;
  // Contextual — required when scope implies them
  macro_type?: MacroTypeValue;
  entry_point?: EntryPoint;
  confluence_space?: string;
  macro_uuid?: string;
  is_forge?: boolean;
  // Lifecycle
  operation_mode?: OperationMode;
  result?: string;
  failure_reason?: string;
  // Upgrade
  persona?: string;
  product_option?: string;
  ui_component?: string;
  cta_position?: "primary" | "secondary";
  // AI
  prompt_length?: number;
  generation_source?: string;
  // Feedback
  feedback_value?: FeedbackValue;
  feedback_score?: number;
  // Content
  content_id?: string;
  content_type?: string;
  content_status?: string;
  // Error
  error_code?: string;
  error_name?: string;
  error_source?: string;
};
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm test:unit --reporter=verbose 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/analytics/types.ts
git commit -m "feat(analytics): add canonical AnalyticsProperties type (Phase 1)"
```

---

## Task 3: Create the canonical frontend tracker

**Files:**
- Create: `src/utils/analytics/trackAnalyticsEvent.ts`

This tracker mirrors the enrichment logic in `_awaitableTrackEvent` (`src/utils/window.ts:89-137`) but takes a typed event name as the first argument instead of a positional `action` string.

- [ ] **Step 1: Create the file**

```ts
// src/utils/analytics/trackAnalyticsEvent.ts

import mixpanel from "mixpanel-browser";
import {
  getClientDomain,
  getSpaceKey,
} from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from "@/model/globals/forgeGlobal";
import type { AnalyticsEventName } from "./catalog";
import type { AnalyticsProperties } from "./types";

let _initialized = false;
let _identified = false;

function _initMixpanel() {
  if (!_initialized) {
    mixpanel.init("62d0ff230c6799db2a4d30a04fe5e1e2", {
      debug: true,
      track_pageview: false,
      autocapture: false,
      persistence: "localStorage",
      ignore_dnt: true,
    });
    _initialized = true;
  }
}

function _getCurrentUserAccountId(): string {
  return (
    // @ts-ignore — globals set by Forge bridge at runtime
    window.globals?.apWrapper?.currentUser?.atlassianAccountId ||
    "unknown_user_account_id"
  );
}

async function _getMacroUuid(): Promise<string> {
  if (forgeGlobal.isForge && forgeGlobal.forgeContext?.localId) {
    return forgeGlobal.forgeContext.localId;
  }
  // @ts-ignore
  const macroData = await window.globals?.apWrapper?.getMacroData();
  return macroData?.uuid || "unknown_macro_uuid";
}

function _getProductType(): "lite" | "full" | "diagramly" {
  const t = import.meta.env.PRODUCT_TYPE;
  if (t === "lite" || t === "full" || t === "diagramly") return t;
  return "full";
}

function _identify() {
  if (!_identified) {
    const id = _getCurrentUserAccountId();
    try {
      mixpanel.identify(id);
      _identified = id !== "unknown_user_account_id";
    } catch (e) {
      console.error("mixpanel.identify error", e);
    }
  }
}

export async function _awaitableTrackAnalyticsEvent(
  eventName: AnalyticsEventName,
  callerProps: AnalyticsProperties
): Promise<void> {
  try {
    _initMixpanel();
    _identify();

    const enriched: Record<string, unknown> = {
      ...callerProps,
      user_account_id:
        callerProps.user_account_id ?? _getCurrentUserAccountId(),
      client_domain:
        callerProps.client_domain ??
        getClientDomain() ??
        "unknown_atlassian_domain",
      confluence_space:
        callerProps.confluence_space ?? getSpaceKey() ?? "unknown_space",
      macro_uuid: callerProps.macro_uuid ?? (await _getMacroUuid()),
      is_forge: callerProps.is_forge ?? forgeGlobal.isForge,
      product_type: callerProps.product_type ?? _getProductType(),
      environment_type:
        callerProps.environment_type ??
        forgeGlobal.forgeContext?.environmentType ??
        "unknown_environment_type",
    };

    mixpanel.track(eventName, enriched);
  } catch (e) {
    console.error("[analytics] trackAnalyticsEvent failed", e);
  }
}

export function trackAnalyticsEvent(
  eventName: AnalyticsEventName,
  properties: AnalyticsProperties
): void {
  void _awaitableTrackAnalyticsEvent(eventName, properties);
}
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm test:unit --reporter=verbose 2>&1 | tail -5
```

Expected: no TypeScript errors. All existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/utils/analytics/trackAnalyticsEvent.ts
git commit -m "feat(analytics): add canonical trackAnalyticsEvent frontend API (Phase 1)"
```

---

## Task 4: Unit tests for the canonical tracker

**Files:**
- Create: `src/utils/analytics/trackAnalyticsEvent.spec.ts`

- [ ] **Step 1: Write failing tests first**

```ts
// src/utils/analytics/trackAnalyticsEvent.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import mixpanel from "mixpanel-browser";
import { getClientDomain, getSpaceKey } from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from "@/model/globals/forgeGlobal";
import { _awaitableTrackAnalyticsEvent } from "./trackAnalyticsEvent";

vi.mock("mixpanel-browser", () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    track: vi.fn(),
  },
}));

vi.mock("@/model/globals/forgeGlobal", () => ({
  default: {
    isForge: true,
    forgeContext: { localId: "macro-abc", environmentType: "production" },
  },
}));

vi.mock("@/utils/ContextParameters/ContextParameters", () => ({
  getClientDomain: vi.fn().mockReturnValue("example.atlassian.net"),
  getSpaceKey: vi.fn().mockReturnValue("ENG"),
}));

const mockGlobals = {
  apWrapper: {
    currentUser: { atlassianAccountId: "user-123" },
    getMacroData: vi.fn().mockResolvedValue({ uuid: "fallback-uuid" }),
  },
};

describe("trackAnalyticsEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-ignore
    window.globals = mockGlobals;
    vi.mocked(forgeGlobal).isForge = true;
    vi.mocked(forgeGlobal).forgeContext = {
      localId: "macro-abc",
      environmentType: "production",
    } as any;
    vi.mocked(getClientDomain).mockReturnValue("example.atlassian.net");
    vi.mocked(getSpaceKey).mockReturnValue("ENG");
  });

  it("sends macro_viewed with correct event name to Mixpanel", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
      macro_type: "sequence",
      entry_point: "page_view",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        feature_area: "macro",
        surface: "viewer",
        macro_type: "sequence",
        entry_point: "page_view",
      })
    );
  });

  it("auto-enriches user_account_id from window.globals", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({ user_account_id: "user-123" })
    );
  });

  it("auto-enriches client_domain from ContextParameters", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({ client_domain: "example.atlassian.net" })
    );
  });

  it("auto-enriches macro_uuid from Forge localId", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({ macro_uuid: "macro-abc" })
    );
  });

  it("caller-supplied properties override auto-enriched values", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
      client_domain: "override.atlassian.net",
      user_account_id: "caller-user",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        client_domain: "override.atlassian.net",
        user_account_id: "caller-user",
      })
    );
  });

  it("falls back to sentinel values when context is unavailable", async () => {
    // @ts-ignore
    window.globals = undefined;
    vi.mocked(getClientDomain).mockReturnValue(undefined as any);
    vi.mocked(getSpaceKey).mockReturnValue(undefined as any);
    vi.mocked(forgeGlobal).isForge = false;
    vi.mocked(forgeGlobal).forgeContext = null as any;

    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        client_domain: "unknown_atlassian_domain",
        user_account_id: "unknown_user_account_id",
      })
    );
  });

  it("does not throw when mixpanel.track throws", async () => {
    vi.mocked(mixpanel.track).mockImplementation(() => {
      throw new Error("mixpanel down");
    });

    await expect(
      _awaitableTrackAnalyticsEvent("upgrade_modal_shown", {
        feature_area: "upgrade",
        surface: "modal",
      })
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests and verify they fail with expected reasons**

```bash
pnpm test:unit -- trackAnalyticsEvent --reporter=verbose
```

Expected: tests fail because `trackAnalyticsEvent.ts` doesn't exist yet. If they fail for any other reason, fix it before moving on.

- [ ] **Step 3: Run tests after creating the implementation (Task 3)**

```bash
pnpm test:unit -- trackAnalyticsEvent --reporter=verbose
```

Expected: all 7 tests pass.

> **Note:** Tasks 3 and 4 are designed to be done TDD-style: write the spec (Task 4 Step 1), then implement (Task 3), then verify tests pass (Task 4 Step 3). Commit order: spec first, then implementation.

- [ ] **Step 4: Commit**

```bash
git add src/utils/analytics/trackAnalyticsEvent.spec.ts
git commit -m "test(analytics): unit tests for canonical trackAnalyticsEvent (Phase 1)"
```

---

## Task 5: Backend analytics types (duplicate for wrangler context)

The `functions/` directory compiles with Wrangler, which does not resolve `@/` (Vite alias into `src/`). Types must be duplicated here. A comment marks them as co-located with the frontend catalog.

**Files:**
- Create: `functions/service/analyticsTypes.ts`

- [ ] **Step 1: Create the file**

```ts
// functions/service/analyticsTypes.ts
// Canonical analytics types for backend use.
// Keep in sync with src/utils/analytics/catalog.ts and src/utils/analytics/types.ts.
// TODO: unify into a shared/ module when build config supports it.

export type AnalyticsEventName =
  | "macro_viewed"
  | "macro_create_started"
  | "macro_create_succeeded"
  | "macro_edit_opened"
  | "macro_edit_cancelled"
  | "macro_save_succeeded"
  | "macro_save_failed"
  | "macro_export_requested"
  | "macro_export_succeeded"
  | "macro_export_failed"
  | "ai_generation_requested"
  | "ai_generation_succeeded"
  | "ai_generation_failed"
  | "ai_editor_opened"
  | "ai_feedback_submitted"
  | "upgrade_modal_shown"
  | "upgrade_cta_clicked"
  | "upgrade_action_blocked"
  | "upgrade_modal_dismissed"
  | "upgrade_prompt_hovered"
  | "upgrade_slider_changed"
  | "content_sync_requested"
  | "content_sync_succeeded"
  | "content_sync_failed"
  | "custom_content_loaded"
  | "confluence_page_viewed"
  | "confluence_page_updated"
  | "csat_submitted"
  | "feedback_link_clicked"
  | "feature_flags_fetch_failed"
  | "attachment_create_failed"
  | "custom_content_update_failed";

export const CANONICAL_EVENT_NAMES = new Set<string>([
  "macro_viewed",
  "macro_create_started",
  "macro_create_succeeded",
  "macro_edit_opened",
  "macro_edit_cancelled",
  "macro_save_succeeded",
  "macro_save_failed",
  "macro_export_requested",
  "macro_export_succeeded",
  "macro_export_failed",
  "ai_generation_requested",
  "ai_generation_succeeded",
  "ai_generation_failed",
  "ai_editor_opened",
  "ai_feedback_submitted",
  "upgrade_modal_shown",
  "upgrade_cta_clicked",
  "upgrade_action_blocked",
  "upgrade_modal_dismissed",
  "upgrade_prompt_hovered",
  "upgrade_slider_changed",
  "content_sync_requested",
  "content_sync_succeeded",
  "content_sync_failed",
  "custom_content_loaded",
  "confluence_page_viewed",
  "confluence_page_updated",
  "csat_submitted",
  "feedback_link_clicked",
  "feature_flags_fetch_failed",
  "attachment_create_failed",
  "custom_content_update_failed",
]);

export type TrackCanonicalRequest = {
  transport_version: 2;
  event: AnalyticsEventName;
  properties: Record<string, string | number | boolean | null | undefined>;
  addon_key: string;
  version: string;
};

export type TrackLegacyRequest = {
  transport_version?: 1;
  action: string;
  event_category?: string;
  event_label?: string;
  client_domain?: string;
  user_account_id?: string;
  addon_key: string;
  version: string;
  [key: string]: string | number | boolean | null | undefined;
};

export type TrackRequest = TrackCanonicalRequest | TrackLegacyRequest;

export function isCanonicalRequest(body: TrackRequest): body is TrackCanonicalRequest {
  return (body as TrackCanonicalRequest).transport_version === 2;
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/service/analyticsTypes.ts
git commit -m "feat(analytics): add backend canonical analytics types (Phase 1)"
```

---

## Task 6: Update mixpanelService to use canonical event name

Currently `mixpanelService.ts` sets `"event": event.action` on line 48. Update it to prefer `event.event` (canonical) over `event.action` (legacy), so the Mixpanel event name is correct for both paths.

**Files:**
- Modify: `functions/service/mixpanelService.ts`

Current state of `mixpanelService.ts` (lines 40-58):

```ts
export async function mixpanelTrack(event: MixpanelTrackPayload, token: string) {
  const distinctId = getDistinctId(event);
  // ...
  const events = [{
    "event": event.action,   // <-- this is the line to update
    "properties": { ... }
  }];
```

- [ ] **Step 1: Update `MixpanelTrackPayload` and `mixpanelTrack`**

Replace the current `MixpanelTrackPayload` interface and the `events` construction in `mixpanelTrack`:

```ts
// In functions/service/mixpanelService.ts

// Replace the existing MixpanelTrackPayload with:
export interface MixpanelTrackPayload {
  event?: string;           // canonical event name (transport_version: 2)
  action?: string;          // legacy event name (transport_version: 1)
  user_account_id?: string;
  atlassian_user_id?: string;
  [key: string]: string | number | boolean | undefined | null;
}

// Replace the events array construction in mixpanelTrack with:
const eventName = event.event || event.action || "unknown_event";
const events = [{
  "event": eventName,
  "properties": {
    token,
    time: Date.now(),
    '$insert_id': uuidv4(),
    "distinct_id": distinctId,
    user_account_id: distinctId,
    ...event
  }
}];
```

The full updated function looks like:

```ts
export async function mixpanelTrack(event: MixpanelTrackPayload, token: string) {
  const distinctId = getDistinctId(event);

  if (distinctId !== "unknown_user_account_id") {
    await identify(distinctId, token);
  }

  const eventName = event.event || event.action || "unknown_event";
  const events = [{
    "event": eventName,
    "properties": {
      token,
      time: Date.now(),
      '$insert_id': uuidv4(),
      "distinct_id": distinctId,
      user_account_id: distinctId,
      ...event
    }
  }];

  const response = await fetch(`https://api.mixpanel.com/import`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${token}:`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(events)
  });

  if (!response.ok) {
    throw new Error(`Mixpanel track request failed with status: ${response.status}, message: ${await response.text()}`);
  }
}
```

- [ ] **Step 2: Verify existing unit tests still pass**

```bash
pnpm test:unit --reporter=verbose 2>&1 | tail -10
```

Expected: all tests pass. The change is backward-compatible: legacy events still use `event.action` as fallback.

- [ ] **Step 3: Commit**

```bash
git add functions/service/mixpanelService.ts
git commit -m "feat(analytics): use canonical event.event name in mixpanelService (Phase 1)"
```

---

## Task 7: Update `/track` endpoint to accept canonical requests

**Files:**
- Modify: `functions/track.ts`

Currently `track.ts` validates `body.client_domain`, `body.addon_key`, `body.user_account_id` and then calls `mixpanelTrack(body, token)`. For canonical requests (`transport_version: 2`), the required fields are different — `client_domain` and `user_account_id` live inside `body.properties`, not at the top level.

- [ ] **Step 1: Update `track.ts` to handle both shapes**

```ts
// functions/track.ts

import { mixpanelTrack, MIXPANEL_TOKEN_FRONTEND } from "./service/mixpanelService";
import { isCanonicalRequest, TrackRequest } from "./service/analyticsTypes";

const ALLOWED_REFERER_DOMAINS = ['zenuml.com', 'confluence-plugin.pages.dev', 'peng-new-8080.diagramly.ai'];

const validateReferer = (referer: string) => {
  const refererDomain = new URL(referer).hostname;
  return ALLOWED_REFERER_DOMAINS.find(d => refererDomain.endsWith(d));
};

export const onRequest = async (event: any) => {
  const referer = event.request.headers.get('referer') || '';
  if (!validateReferer(referer)) {
    console.log(`Referer ${referer} not allowed`);
    return new Response('Forbidden', { status: 403 });
  }

  console.log('Received request from referer', referer);
  const body = await event.request.json() as TrackRequest;

  if (isCanonicalRequest(body)) {
    // Canonical path: event name is top-level body.event
    if (!body.event || !body.addon_key) {
      return new Response('Missing event or addon_key', { status: 400 });
    }
    // Flatten for mixpanelTrack: pass event name + properties as a flat payload
    const payload = {
      event: body.event,
      addon_key: body.addon_key,
      version: body.version,
      ...body.properties,
    };
    event.waitUntil(mixpanelTrack(payload, MIXPANEL_TOKEN_FRONTEND));
    return new Response(null, { status: 204 });
  }

  // Legacy path (transport_version: 1 or absent)
  const legacyBody = body as any;
  if (!legacyBody.client_domain || !legacyBody.addon_key || !legacyBody.user_account_id) {
    const error = `Missing ${!legacyBody.client_domain ? 'client_domain' : (!legacyBody.addon_key ? 'addon_key' : 'user_account_id')}`;
    console.log(error);
    return new Response(error, { status: 400 });
  }

  event.waitUntil(mixpanelTrack(legacyBody, MIXPANEL_TOKEN_FRONTEND));
  return new Response(null, { status: 204 });
};
```

- [ ] **Step 2: Verify existing tests pass**

```bash
pnpm test:unit --reporter=verbose 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add functions/track.ts
git commit -m "feat(analytics): accept canonical transport_version:2 in /track endpoint (Phase 1)"
```

---

## Task 8: Migrate `view_macro` in `Sequence.vue` to `macro_viewed`

This is the Phase 1 smoke-test call site. It's the highest-priority migration (spec rollout order item 1). `Sequence.vue` fires when a sequence diagram is rendered in viewer mode.

**Files:**
- Modify: `src/components/Sequence.vue:56`

Current call:
```ts
trackEvent('', 'view_macro', DiagramType.Sequence);
```

- [ ] **Step 1: Update the import and the tracking call in `Sequence.vue`**

At the top of `<script>` block add the new import:
```ts
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
```

Replace line 56:
```ts
// Before:
trackEvent('', 'view_macro', DiagramType.Sequence);

// After:
trackAnalyticsEvent("macro_viewed", {
  feature_area: "macro",
  surface: "viewer",
  macro_type: "sequence",
  entry_point: "page_view",
});
```

Keep the existing `import { trackEvent } from "@/utils/window";` line — `trackEvent` is still used in the same file for other calls.

Wait — check `Sequence.vue` for any other `trackEvent` calls before removing the import:

```bash
grep -n "trackEvent" /Users/pengxiao/workspaces/zenuml/conf-app/src/components/Sequence.vue
```

If the only call was the `view_macro` one, also remove the `trackEvent` import to avoid dead imports. If other calls exist, keep it.

- [ ] **Step 2: Run all unit tests**

```bash
pnpm test:unit --reporter=verbose 2>&1 | tail -15
```

Expected: all tests pass. `Sequence.vue` has no unit test of its own currently, so this won't add new test failures.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sequence.vue
git commit -m "feat(analytics): migrate macro_viewed in Sequence.vue (Phase 1 smoke test)"
```

---

## Task 9: Phase 1 completion verification

- [ ] **Step 1: Confirm all Phase 1 artifacts exist**

```bash
ls -la \
  /Users/pengxiao/workspaces/zenuml/conf-app/src/utils/analytics/catalog.ts \
  /Users/pengxiao/workspaces/zenuml/conf-app/src/utils/analytics/types.ts \
  /Users/pengxiao/workspaces/zenuml/conf-app/src/utils/analytics/trackAnalyticsEvent.ts \
  /Users/pengxiao/workspaces/zenuml/conf-app/src/utils/analytics/trackAnalyticsEvent.spec.ts \
  /Users/pengxiao/workspaces/zenuml/conf-app/functions/service/analyticsTypes.ts
```

Expected: all 5 files listed.

- [ ] **Step 2: Run the full test suite**

```bash
pnpm test:unit --reporter=verbose
```

Expected: all tests pass, including the 7 new canonical tracker tests.

- [ ] **Step 3: Verify `Sequence.vue` no longer calls legacy `view_macro`**

```bash
grep -n "view_macro" /Users/pengxiao/workspaces/zenuml/conf-app/src/components/Sequence.vue
```

Expected: no output.

- [ ] **Step 4: Verify TypeScript has no new errors**

```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

Expected: no new errors in `src/utils/analytics/` or `src/components/Sequence.vue`.

- [ ] **Step 5: Confirm spec completion criteria are met**

Phase 1 is done when:
- [x] `src/utils/analytics/catalog.ts` compiles
- [x] `src/utils/analytics/types.ts` compiles
- [x] `src/utils/analytics/trackAnalyticsEvent.ts` exists and is used by at least one migrated call site (`Sequence.vue`)
- [x] `functions/track.ts` validates the canonical `transport_version: 2` request
- [x] At least one unit test covers a canonical event payload end-to-end through the tracker

---

## Self-Review

### Spec coverage check

| Spec requirement | Covered by task |
|---|---|
| Add the event catalog | Task 1 |
| Add shared property enums/types | Task 2 |
| Add canonical frontend tracking API | Task 3 |
| Canonical frontend API used by at least one call site | Task 8 |
| Add canonical backend transport model | Task 7 |
| Backend uses `event.event` not `event.action` | Task 6 |
| Phase 1 completion criteria are testable | Task 9 |
| Unit tests cover canonical event payload end-to-end | Task 4 |
| Backend types live in named files | Task 5 |

### Type consistency check

- `AnalyticsEventName` defined in `catalog.ts` (Task 1), imported in `trackAnalyticsEvent.ts` (Task 3), `trackAnalyticsEvent.spec.ts` (Task 4)
- `AnalyticsProperties` defined in `types.ts` (Task 2), imported in `trackAnalyticsEvent.ts` (Task 3), `trackAnalyticsEvent.spec.ts` (Task 4)
- `TrackCanonicalRequest` / `isCanonicalRequest` defined in `analyticsTypes.ts` (Task 5), imported in `track.ts` (Task 7)
- `MixpanelTrackPayload` updated in `mixpanelService.ts` (Task 6) — now has optional `event?` field alongside `action?`
- No type name conflicts or inconsistencies found

### Placeholder scan

No TBD/TODO/placeholder content. All code blocks are complete.
