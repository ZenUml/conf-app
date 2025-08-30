# Forge Macro Change Detection Implementation

## Overview

This document describes the implementation of change detection functionality in all Forge macros (sequence, graph, OpenAPI, and embed), following the same pattern used in the Connect sequence macro.

## Implementation Details

### 1. Change Detection by Macro Type

Each Forge macro implements change detection based on its specific content type:

#### Sequence Macro
- **Change Tracking**: Implemented in the `Header.vue` component
- **Original Code Storage**: Stores original code values in component data properties
- **Change Detection**: Compares current code with original code

#### Graph Macro
- **Change Tracking**: Implemented in `src/forge-graph-editor.ts`
- **Original Code Storage**: Stores original `graphXml` in `window.diagram`
- **Change Detection**: Compares current `window.graphXml` with original `window.diagram.graphXml`

#### OpenAPI Macro
- **Change Tracking**: Implemented in `src/forge-swagger-editor.ts`
- **Original Code Storage**: Stores original `code` in `window.diagram`
- **Change Detection**: Compares current `window.specContent` with original `window.diagram.code`

#### Embed Macro
- **Change Tracking**: Implemented in `src/forge-embed-editor.ts`
- **Original Code Storage**: Stores original picked document ID
- **Change Detection**: Compares current `window.picked.id` with original picked document ID

### 2. Enhanced Exit Event Handlers

Each Forge macro has its own exit event handler that supports change detection with a custom modal dialog:

#### Sequence Macro (`forgeIndex.ts`)
```typescript
EventBus.$on('exit', async (showWarning: boolean) => {
  // Track exit event with context
  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.Sequence;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  trackEvent('', 'create_macro_exit', DiagramType.Sequence, {
    had_changes: showWarning,
    macro_stage: isNewSequence ? 'creation' : 'editing',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.code?.length || 0
  });
  
  if (showWarning) {
    const result = await showCloseWithoutSavingDialog();
    if (result === 'discard') {
      await (await getView()).close();
    }
  } else {
    await (await getView()).close();
  }
});
```

#### Graph Macro (`forge-graph-editor.ts`)
```typescript
async function exit() {
  const codeChanged = window.diagram?.graphXml !== window.graphXml;
  
  // Track exit event with context
  const isNewGraph = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.Graph;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  trackEvent('', 'create_macro_exit', DiagramType.Graph, {
    had_changes: codeChanged,
    macro_stage: isNewGraph ? 'creation' : 'editing',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.graphXml?.length || 0
  });
  
  if (codeChanged) {
    const result = await showCloseWithoutSavingDialog();
    if (result === 'discard') {
      await (await getView()).close();
    }
  } else {
    await (await getView()).close();
  }
}
```

#### OpenAPI Macro (`forge-swagger-editor.ts`)
```typescript
async function exit() {
  const codeChanged = window.diagram?.code !== window.specContent;
  
  // Track exit event with context
  const isNewOpenApi = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.OpenApi;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  trackEvent('', 'create_macro_exit', DiagramType.OpenApi, {
    had_changes: codeChanged,
    macro_stage: isNewOpenApi ? 'creation' : 'editing',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.code?.length || 0
  });
  
  if (codeChanged) {
    const result = await showCloseWithoutSavingDialog();
    if (result === 'discard') {
      await (await getView()).close();
    }
  } else {
    await (await getView()).close();
  }
}
```

#### Embed Macro (`forge-embed-editor.ts`)
```typescript
async function exit() {
  // For embed editor, changes are detected by comparing current picked document with original
  const currentPickedId = window.picked?.id || null;
  const hasChanges = currentPickedId !== originalPickedId;
  
  // Track exit event with context
  const isNewEmbed = !store.state.diagram.id && store.state.diagram.diagramType === DiagramType.Embed;
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  trackEvent('', 'create_macro_exit', DiagramType.Embed, {
    had_changes: hasChanges,
    macro_stage: isNewEmbed ? 'creation' : 'editing',
    elapsed_time_ms: elapsedTimeMs,
    selected_document: currentPickedId
  });
  
  if (hasChanges) {
    const result = await showCloseWithoutSavingDialog();
    if (result === 'discard') {
      await (await getView()).close();
    }
  } else {
    await (await getView()).close();
  }
}
```

### 3. Custom Modal Dialog

A custom modal dialog service has been implemented in `src/utils/modalService.ts` that replicates the Connect app's confirmation dialog:

```typescript
export function showCloseWithoutSavingDialog(): Promise<string> {
  return new Promise((resolve) => {
    // Creates a modal overlay with the same styling as Connect
    // Returns 'discard' or 'cancel' based on user action
  });
}
```

The modal dialog features:
- Same visual design as the Connect app
- "Discard Changes" and "Cancel" buttons
- Click outside to cancel functionality
- Proper event cleanup

### 3. Header Component Integration (Sequence Macro Only)

The `Header.vue` component has been updated to work with both Connect and Forge modes for the sequence macro:

```javascript
exit: function () {
  return () => {
    // Use local comparison like the Connect version
    const codeChanged = this.diagramType === DiagramType.Sequence
      ? this.seqCode !== this.originalSeqCode
      : this.mermaidCode !== this.originalMermaidCode;

    // Track exit button click with more context
    trackEvent("exit_button", "click", this.diagramType, {
      had_changes: codeChanged,
      title_provided: this.diagramType === DiagramType.Sequence ? !!this.seqTitle : !!this.mermaidTitle,
      source: "header_exit_button"
    });

    EventBus.$emit("exit", codeChanged);
  };
}
```

The Header component initializes the original code values in its `mounted` lifecycle:

```javascript
async mounted() {
  // ... other initialization code ...

  if (this.diagramType === DiagramType.Mermaid) {
    this.mermaidTitle = this.title;
    this.originalMermaidCode = this.mermaidCode;
  } else {
    this.seqTitle = this.title;
    this.originalSeqCode = this.seqCode;
  }
}
```

## Key Features

1. **Automatic Change Detection**: Each macro type has its own change detection logic:
   - **Sequence**: Tracks changes to sequence and Mermaid code
   - **Graph**: Tracks changes to graph XML content
   - **OpenAPI**: Tracks changes to API specification content
   - **Embed**: Tracks changes to selected document

2. **Confirmation Dialog**: Shows a confirmation dialog when exiting with unsaved changes
3. **Analytics Tracking**: Logs exit events with change detection context for each macro type
4. **Backward Compatibility**: Works with both Connect and Forge modes
5. **Session Timing**: Tracks how long the user spent in each editor
6. **Consistent UX**: Same confirmation dialog across all macro types

## Testing

A test suite has been created in `tests/unit/ChangeDetection.spec.ts` to verify:
- No changes detected when code is unchanged
- Changes detected when sequence code is modified
- Changes detected when Mermaid code is modified
- Proper handling of empty and undefined code values

## Usage

When a user makes changes in any macro editor and tries to close:

1. The system detects if changes have been made based on the macro type
2. If changes are detected, a confirmation dialog appears
3. User can choose to:
   - Click "Discard Changes" to discard changes and close
   - Click "Cancel" to stay in the editor
4. If no changes are detected, the editor closes immediately

This provides the same user experience across all Forge macros, ensuring consistency with the Connect app.
