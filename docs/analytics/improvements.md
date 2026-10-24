# Analytics Improvements

This document covers known weaknesses in the current event tracking system and a phased roadmap for addressing them without breaking existing Mixpanel reports.

---

## Current Challenges

### Inconsistent Parameter Order and Naming

The `trackEvent` function takes parameters as `(label, action, category)`, but these are used inconsistently across the codebase. Some events pass empty strings for `label`, making it difficult to identify context at a glance.

### No Standardized Event Hierarchy

Events do not follow a consistent hierarchical structure (e.g. `feature > action > detail`). This makes it hard to group related events or reconstruct a user journey.

### Limited Context in Event Data

Many events carry insufficient context about what the user was doing when the event fired. Timestamps are captured, but relationships between events within the same user flow are not explicit.

### Inconsistent Error Tracking

Error events use varying formats and levels of detail, making it difficult to correlate an error with the user action that caused it (e.g. `trackEvent(JSON.stringify(e), 'load_macro', 'error')` discards structure and is noisy in Mixpanel).

---

## Target Event Structure

The goal is a structured, hierarchical event shape:

```typescript
interface TrackEventParams {
  feature: string;   // High-level feature area
  action: string;    // Specific action taken
  detail?: string;   // Additional context about the action
  properties?: Record<string, any>;
}
```

### Canonical Feature Categories

- `sequence_diagram`
- `editor`
- `ai_generation`
- `theme`
- `macro_management`
- `error_handling`

### Canonical Actions

- `view`, `create`, `edit`, `save`, `generate`, `export`, `click`, `error`

### Example — before and after

```typescript
// Current
trackEvent('', 'create_macro_begin', 'sequence');

// Target
trackUserEvent({
  feature: 'sequence_diagram',
  action: 'create',
  detail: 'begin',
  properties: { editor_type: 'classic', is_new_macro: true }
});
```

---

## Migration Roadmap

The migration is split into three phases, each safe to ship independently.

### Phase 1 — Enhanced Context (No Breaking Changes)

Extend the existing `trackEvent(label, action, category, resetEventDetails)` call sites with richer properties. The function signature does not change; Mixpanel event names do not change; existing reports remain valid.

**1a. Enrich event properties at call sites**

```typescript
// Current
trackEvent('', 'create_macro_begin', 'sequence');

// Phase 1
trackEvent('', 'create_macro_begin', 'sequence', {
  editor_type: 'classic',
  is_new_macro: true,
  page_id: await getPageId(),
  user_account_id: getCurrentUserAccountId()
});
```

**1b. Improve error events**

```typescript
// Current
trackEvent(JSON.stringify(e), 'load_macro', 'error');

// Phase 1
trackEvent(e.message, 'load_macro', 'error', {
  error_type: e.name,
  component: 'CompositeContentProvider',
  user_action: 'loading_existing_diagram',
  stack_trace_hash: hashErrorStack(e.stack)
});
```

**1c. Enrich AI generation events**

```typescript
// Current
trackEvent('generate_diagram_from_page', 'click_generate_button', diagramType, {
  userPromptLength: userPrompt.length
});

// Phase 1
trackEvent('generate_diagram_from_page', 'click_generate_button', diagramType, {
  userPromptLength: userPrompt.length,
  generation_source: 'page_content',
  ai_feature: 'diagram_generation',
  editor_state: this.$store.state.diagram.isNew ? 'new' : 'existing'
});
```

**1d. Add session tracking**

Add `session_id` and `event_sequence` to every event by extending `_awaitableTrackEvent`:

```typescript
let currentSessionId: string | null = null;
let eventSequence = 0;

function getOrCreateSessionId(): string {
  if (!currentSessionId) {
    currentSessionId = localStorage.getItem('zenuml_session_id');
    if (!currentSessionId) {
      currentSessionId = generateUniqueId();
      localStorage.setItem('zenuml_session_id', currentSessionId);
      eventSequence = 0;
    }
  }
  return currentSessionId;
}

// Inside _awaitableTrackEvent, before building eventDetails:
let eventDetails = {
  event_category: category || 'unknown',
  event_label: label || '',
  session_id: getOrCreateSessionId(),
  event_sequence: ++eventSequence,
  ...resetEventDetails,
} as EventDetails;
```

**1e. Standardize constant names**

Introduce typed constants to prevent typos; do not change the string values yet:

```typescript
const EVENT_ACTIONS = {
  CREATE_BEGIN: 'create_begin',
  CREATE_END:   'create_end',
  VIEW:         'view',
  EDIT:         'edit',
  SAVE:         'save',
} as const;

const EVENT_CATEGORIES = {
  SEQUENCE: 'sequence',
  EDITOR:   'editor',
  AI:       'ai',
} as const;
```

**Deliverables (weeks 1–2):** enriched event properties at all high-traffic call sites, session tracking live, naming-convention document written.

---

### Phase 2 — Dual Tracking (Parallel Implementation)

Introduce `trackUserEvent` alongside the existing function. High-value flows are migrated to the new function; the old call is kept temporarily so existing Mixpanel funnels remain intact during validation.

**2a. New tracking function**

```typescript
export function trackUserEvent(
  feature: string,
  action: string,
  detail: string = '',
  properties: Record<string, any> = {}
) {
  const category = feature as EventCategory;
  trackEvent(detail, action, category, {
    user_event_feature: feature,
    user_event_action:  action,
    user_event_detail:  detail,
    ...properties
  });
}
```

**2b. Central event catalog**

```typescript
// src/utils/analytics/catalog.ts
export const EVENTS = {
  SEQUENCE_DIAGRAM: {
    CREATE_BEGIN: {
      feature:     'sequence_diagram',
      action:      'create',
      detail:      'begin',
      description: 'User starts creating a new sequence diagram',
    },
  },
  AI_GENERATION: {
    GENERATE_REQUEST: {
      feature:     'ai_generation',
      action:      'generate',
      detail:      'request',
      description: 'User submits an AI diagram generation request',
    },
    GENERATE_COMPLETE: {
      feature:     'ai_generation',
      action:      'generate',
      detail:      'complete',
      description: 'AI generation finishes successfully',
    },
  },
} as const;
```

**2c. Dual-track a high-value flow (example)**

```typescript
// Sequence diagram creation — tracks under both old and new schemas
if (await MacroUtil.isCreateNew()) {
  trackUserEvent('sequence_diagram', 'create', 'begin', { editor_type: 'classic' });
  trackEvent('', 'create_macro_begin', 'sequence'); // kept until old reports retire
}
```

**2d. Multi-step flow correlation**

For flows that span multiple events, pass a shared `flow_id`:

```typescript
const flowId = generateUniqueId();

trackUserEvent('sequence_diagram', 'create', 'begin', { flow_id: flowId });

// ... user edits ...

trackUserEvent('sequence_diagram', 'save', 'complete', {
  flow_id:      flowId,
  duration_ms:  endTime - startTime,
  is_new:       true,
  code_length:  codeLength
});
```

**Deliverables (weeks 3–4):** `trackUserEvent` shipped, top 5 user flows dual-tracked, new Mixpanel reports drafted.

---

### Phase 3 — Full Migration (After Validation)

Once new Mixpanel reports are confirmed correct and all existing reports have been recreated on the new schema:

**3a. Remove legacy parallel calls**

```typescript
// Remove the old line, keep only:
trackUserEvent('sequence_diagram', 'create', 'begin', { editor_type: 'classic' });
```

**3b. Redirect `trackEvent` through `trackUserEvent`**

```typescript
export function trackEvent(
  label: string,
  action: string,
  category: EventCategory,
  resetEventDetails: Record<string, any> = {}
) {
  trackUserEvent(category, action, label, resetEventDetails);
}
```

This keeps backward compatibility for any remaining call sites while unifying the underlying implementation.

**Deliverables (weeks 5–6):** old parallel calls removed, `trackEvent` is a thin wrapper, migration complete.

---

## Full Example User Journey

A complete create-and-save flow for a sequence diagram, as it looks under the target schema:

```typescript
// 1. User opens the macro editor
trackUserEvent('sequence_diagram', 'create', 'begin', {
  editor_type: 'classic',
  page_id: pageId
});

// 2. User selects a theme
trackUserEvent('theme', 'select', 'global', {
  theme_name: themeName,
  diagram_type: 'sequence'
});

// 3. User triggers AI generation
trackUserEvent('ai_generation', 'generate', 'request', {
  diagram_type:      'sequence',
  prompt_length:     promptLength,
  generation_source: 'page_content'
});

// 4. AI generation completes
trackUserEvent('ai_generation', 'generate', 'complete', {
  diagram_type:        'sequence',
  generation_time_ms:  generationTime,
  success:             true
});

// 5. User saves the diagram
trackUserEvent('sequence_diagram', 'save', 'complete', {
  is_new:                    true,
  code_length:               codeLength,
  editor_session_duration_ms: sessionDuration
});
```

---

## Expected Benefits

- **Clearer user journeys** — `session_id` + `flow_id` + `event_sequence` let you replay exactly what a user did.
- **Better error debugging** — structured error properties replace opaque `JSON.stringify(e)` labels.
- **Consistent reporting** — the catalog enforces naming before events are wired, not after.
- **Safe migration** — the phased dual-tracking approach means no existing Mixpanel reports break mid-migration.
