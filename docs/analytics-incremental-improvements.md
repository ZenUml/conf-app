# Incremental Analytics Improvements

This document outlines a step-by-step approach to improving the analytics event tracking system without breaking existing Mixpanel reports.

## Phase 1: Enhanced Event Context (No Breaking Changes)

### Step 1: Add Additional Context to Existing Events

Keep the current `trackEvent(label, action, category)` function signature, but enhance the `resetEventDetails` parameter to include more context.

```typescript
// Current implementation
trackEvent('', 'create_macro_begin', 'sequence');

// Enhanced implementation (Phase 1)
trackEvent('', 'create_macro_begin', 'sequence', {
  editor_type: 'classic',
  is_new_macro: true,
  // Add more context without changing the event structure
});
```

**Implementation:**

```typescript
// In window.ts - No changes to function signature
export function trackEvent(
  label: string,
  action: string,
  category: EventCategory,
  resetEventDetails: Record<string, any> = {}
) {
  // Add recommended context if not provided
  const enhancedDetails = {
    // Default context that's helpful for all events
    component: getCurrentComponent(), // Helper to determine current component
    ...resetEventDetails
  };
  
  void _awaitableTrackEvent(label, action, category, enhancedDetails);
}
```

### Step 2: Add Session Tracking

Add session tracking without changing the event structure:

```typescript
// In window.ts - Add session management
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

// Modify _awaitableTrackEvent to include session data
export async function _awaitableTrackEvent(
  label: string,
  action: string,
  category: EventCategory,
  resetEventDetails: Record<string, any> = {}
) {
  try {
    // Existing code...
    
    let eventDetails = {
      event_category: category || "unknown",
      event_label: label || "",
      session_id: getOrCreateSessionId(),
      event_sequence: ++eventSequence,
      ...resetEventDetails,
    } as EventDetails;
    
    // Rest of the existing function...
  } catch (e) {
    console.error(e);
  }
}
```

### Step 3: Standardize Event Naming Conventions

Create a document with naming conventions and gradually update events to follow them:

```typescript
// Event naming conventions
const EVENT_ACTIONS = {
  CREATE_BEGIN: 'create_begin',
  CREATE_END: 'create_end',
  VIEW: 'view',
  EDIT: 'edit',
  SAVE: 'save',
  // etc.
};

const EVENT_CATEGORIES = {
  SEQUENCE: 'sequence',
  EDITOR: 'editor',
  AI: 'ai',
  // etc.
};

// Usage example (no breaking changes)
trackEvent('', EVENT_ACTIONS.CREATE_BEGIN, EVENT_CATEGORIES.SEQUENCE);
```

## Phase 2: Dual Tracking System (Parallel Implementation)

### Step 1: Create a New Tracking Function

Implement a new tracking function that works alongside the existing one:

```typescript
// New function with improved structure
export function trackUserEvent(
  feature: string,
  action: string,
  detail: string = '',
  properties: Record<string, any> = {}
) {
  // Map to old structure for backward compatibility
  const category = feature;
  const eventAction = action;
  const label = detail;
  
  // Track using both old and new structures
  trackEvent(label, eventAction, category, {
    // Add new properties with different names to avoid conflicts
    user_event_feature: feature,
    user_event_action: action,
    user_event_detail: detail,
    ...properties
  });
}

// Usage example
trackUserEvent('sequence_diagram', 'create', 'begin', {
  editor_type: 'classic',
  is_new_macro: true
});
```

### Step 2: Gradually Migrate High-Value Events

Identify and migrate the most important user flows first:

```typescript
// Before
trackEvent('', 'create_macro_begin', 'sequence');

// After (using both systems)
trackUserEvent('sequence_diagram', 'create', 'begin', {
  editor_type: 'classic'
});
// Keep the old version temporarily for backward compatibility
trackEvent('', 'create_macro_begin', 'sequence');
```

### Step 3: Create Event Documentation

Document all events in a central location to ensure consistency:

```typescript
// events-catalog.ts
export const EVENTS = {
  SEQUENCE_DIAGRAM: {
    CREATE_BEGIN: {
      feature: 'sequence_diagram',
      action: 'create',
      detail: 'begin',
      description: 'User starts creating a new sequence diagram'
    },
    // More events...
  },
  // More categories...
};

// Usage
trackUserEvent(
  EVENTS.SEQUENCE_DIAGRAM.CREATE_BEGIN.feature,
  EVENTS.SEQUENCE_DIAGRAM.CREATE_BEGIN.action,
  EVENTS.SEQUENCE_DIAGRAM.CREATE_BEGIN.detail,
  { editor_type: 'classic' }
);
```

## Phase 3: Complete Migration (After Validation)

### Step 1: Create New Mixpanel Reports

Set up new reports in Mixpanel based on the enhanced event structure before removing the old events.

### Step 2: Remove Duplicate Events

Once you've confirmed the new events are being tracked correctly and all reports are updated:

```typescript
// Final version
trackUserEvent('sequence_diagram', 'create', 'begin', {
  editor_type: 'classic'
});
// Remove the old version
// trackEvent('', 'create_macro_begin', 'sequence');
```

### Step 3: Refactor the Original trackEvent Function

Update the original function to use the new structure internally:

```typescript
export function trackEvent(
  label: string,
  action: string,
  category: EventCategory,
  resetEventDetails: Record<string, any> = {}
) {
  // For backward compatibility
  trackUserEvent(category, action, label, resetEventDetails);
}
```

## Practical Examples for Immediate Implementation

### Example 1: Enhance Sequence Diagram Creation Events

```typescript
// Current implementation in sequence-editor.ts
if (await MacroUtil.isCreateNew()) {
  trackEvent('', 'create_macro_begin', 'sequence');
}

// Enhanced implementation (Phase 1)
if (await MacroUtil.isCreateNew()) {
  trackEvent('', 'create_macro_begin', 'sequence', {
    editor_type: 'classic',
    page_id: await getPageId(),
    is_new_macro: true,
    user_account_id: getCurrentUserAccountId()
  });
}
```

### Example 2: Improve Error Tracking

```typescript
// Current implementation
trackEvent(JSON.stringify(e), 'load_macro', 'error');

// Enhanced implementation (Phase 1)
trackEvent(e.message, 'load_macro', 'error', {
  error_type: e.name,
  component: 'CompositeContentProvider',
  user_action: 'loading_existing_diagram',
  stack_trace_hash: hashErrorStack(e.stack)
});
```

### Example 3: Better AI Generation Events

```typescript
// Current implementation in Workspace.vue
trackEvent('generate_diagram_from_page', 'click_generate_button', diagramType, {
  userPromptLength: userPrompt.length
});

// Enhanced implementation (Phase 1)
trackEvent('generate_diagram_from_page', 'click_generate_button', diagramType, {
  userPromptLength: userPrompt.length,
  generation_source: 'page_content',
  ai_feature: 'diagram_generation',
  editor_state: this.$store.state.diagram.isNew ? 'new' : 'existing'
});
```

## Timeline and Implementation Plan

### Week 1-2: Phase 1
- Enhance existing events with additional context
- Add session tracking
- Document current events and establish naming conventions

### Week 3-4: Phase 2
- Implement dual tracking for high-value user flows
- Create comprehensive event documentation
- Set up new Mixpanel reports for enhanced events

### Week 5-6: Phase 3
- Validate new tracking system
- Gradually phase out duplicate events
- Complete migration to new system

## Conclusion

This incremental approach allows you to enhance your analytics capabilities without disrupting existing reports. Each phase builds on the previous one, providing immediate value while working toward a more structured and informative event tracking system.

By starting with simple enhancements to the existing system, you can immediately improve the context available in your analytics while planning for more significant improvements in the future.
