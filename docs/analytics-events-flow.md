# ZenUML Analytics Events Flow Documentation

## Overview: Sequence Diagram Macro Creation in Classic Editor

This document outlines the analytics events flow that occurs when a user creates a new "sequence diagram" macro using the Confluence classic editor. Understanding this flow helps in tracking user interactions, diagnosing issues, and improving the overall user experience.

## Event Flow Diagram

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Initialization │     │ User Interaction │     │  Saving Phase   │
│      Phase      │────▶│      Phase       │────▶│                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │                       │
        ▼                        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ create_macro_   │     │ Theme Selection │     │ create_macro_   │
│ begin           │     │ AI Generation   │     │ end             │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │   save_macro    │
                                                └─────────────────┘
```

## Detailed Event Flow

### 1. Initialization Phase

When a user starts creating a new sequence diagram macro in the classic editor:

```typescript
// sequence-editor.ts
if (await MacroUtil.isCreateNew()) {
  trackEvent('', 'create_macro_begin', 'sequence');
}
```

- **Event**: `create_macro_begin`
- **Category**: `sequence`
- **Label**: `''` (empty string)
- **Trigger**: Editor initialization for a new macro
- **Purpose**: Marks the beginning of the macro creation process

### 2. User Interaction Phase

During the editing phase, several events might be tracked based on user actions:

#### Theme Selection Events

```typescript
// Sequence.vue
trackEvent("set_theme_global", "click", "sequence");
// or
trackEvent("set_theme_scoped", "click", "sequence");
```

- **Events**: 
  - `click` (with label `set_theme_global`)
  - `click` (with label `set_theme_scoped`)
- **Category**: `sequence`
- **Trigger**: User changing theme settings
- **Purpose**: Track theme preferences

#### AI Generation Events

```typescript
// Workspace.vue
trackEvent('generate_diagram_from_page', 'click_generate_button', diagramType, {userPromptLength: userPrompt.length});
// or
trackEvent('generate_diagram_from_page', 'click_open_editor_button', '');
```

- **Events**:
  - `click_generate_button`
  - `click_open_editor_button`
- **Label**: `generate_diagram_from_page`
- **Category**: The diagram type (e.g., `sequence`)
- **Additional Data**: `userPromptLength` for AI generation
- **Trigger**: User interacting with AI generation features
- **Purpose**: Track AI feature usage

### 3. Saving Phase

When the user saves the macro:

#### Create Macro End Event

```typescript
// Persistence.ts
if(!macroData?.uuid) {
  trackEvent(uuid, 'create_macro_end', diagram.diagramType.toLowerCase());
}
```

- **Event**: `create_macro_end`
- **Category**: `sequence` (lowercase diagram type)
- **Label**: The macro UUID
- **Trigger**: Successful saving of a new macro
- **Purpose**: Marks the completion of creating a new sequence diagram macro

#### Save Macro Event

```typescript
// Persistence.ts
trackEvent(uuid, 'save_macro', diagram.diagramType);
```

- **Event**: `save_macro`
- **Category**: The diagram type (e.g., `Sequence`)
- **Label**: The macro UUID
- **Trigger**: Any save action (new or existing macro)
- **Purpose**: Track all save operations

### 4. Error Tracking

If errors occur during the process:

```typescript
// CompositeContentProvider.ts
trackEvent('diagramType is undefined or unknown', 'load_macro', 'warn');
// or
trackEvent(JSON.stringify(e), 'load_macro', 'error');
```

- **Events**: 
  - `load_macro` (with various labels)
- **Categories**: `warn`, `error`
- **Trigger**: Errors during macro loading or processing
- **Purpose**: Diagnose issues in the macro creation/editing process

## Event Data Structure

Each tracking event includes detailed information as defined in the `_awaitableTrackEvent` function:

```typescript
// window.ts
let eventDetails = {
  event_category: category || "unknown",
  event_label: label || "",
  ...resetEventDetails,
  user_account_id: userAccountId,
  client_domain: getClientDomain() || "unknown_atlassian_domain",
  confluence_space: getSpaceKey() || "unknown_space",
  macro_uuid: await getMacroUuid(),
  isLite: isLite(),
};
```

### Standard Event Properties

- **User Information**:
  - `user_account_id`: The Atlassian account ID of the current user
  
- **Confluence and Macro Information**:
  - `client_domain`: The Atlassian domain
  - `confluence_space`: The space key where the macro is being created
  - `macro_uuid`: The UUID of the macro (generated for new macros)
  - `isLite`: Whether the app is running in Lite mode

- **Event Information**:
  - `event_category`: The category of the event (e.g., 'sequence', 'error', etc.)
  - `event_label`: The label for the event
  - Additional custom properties as needed

## Analytics Implementation

The events are tracked through multiple channels:

### 1. Mixpanel

```typescript
// window.ts
mixpanel.track(action, Object.assign({}, eventDetails));
```

### 2. Google Analytics (gtag)

```typescript
// window.ts
window.gtag && window.gtag("event", action, eventDetails);
```

### 3. Custom R2 Tracking

```typescript
// window.ts
await r2Track(action, eventDetails);

// r2Track function
async function r2Track(action: string, eventDetails: any) {
  await fetch("/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      Object.assign(
        {
          event_source: window.location.host,
          addon_key: addonKey(),
          version: version(),
          action,
        },
        eventDetails
      )
    ),
  });
}
```

## Conclusion

This comprehensive tracking system provides valuable insights into how users interact with the sequence diagram macro creation process. The data collected helps in:

1. Understanding user behavior and preferences
2. Identifying potential issues or bottlenecks in the workflow
3. Measuring feature adoption and usage
4. Informing future development decisions

By tracking events at each stage of the macro creation process, the ZenUML team can continuously improve the user experience and ensure the product meets user needs effectively.

## Forge Confluence Page Behavior Events

In addition to in-app macro/editor analytics, the Forge app can also receive Confluence page-level behavior events through Forge triggers.

### V1 event coverage

- `avi:confluence:viewed:page` -> `page_viewed`
- `avi:confluence:updated:page` -> `page_updated`

These events are routed through Forge Remote to `/forge-user-behavior`, normalized on the backend, and then forwarded to Mixpanel.

### Important distinction

These events describe Confluence page activity, not editor-only interactions inside the app UI.

- **Page activity**: page was viewed or updated in Confluence
- **In-app activity**: macro creation, editor actions, AI usage, save flows

Keeping them separate makes reporting clearer and avoids mixing page-level behavior with macro-level journeys.
