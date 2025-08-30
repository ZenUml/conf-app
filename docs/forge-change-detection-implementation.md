# Forge Sequence Macro Change Detection Implementation

## Overview

This document describes the implementation of change detection functionality in the Forge sequence macro, following the same pattern used in the Connect sequence macro.

## Implementation Details

### 1. Change Tracking in Header Component

The change detection logic is implemented entirely in the `Header.vue` component, following the same pattern as the Connect version:

- **Original Code Storage**: The Header component stores original code values in its data properties:
  ```javascript
  data() {
    return {
      // ... other data properties
      originalSeqCode: "",
      originalMermaidCode: "",
    };
  }
  ```

- **Initialization**: Original code is captured in the `mounted` lifecycle:
  ```javascript
  async mounted() {
    if (this.diagramType === DiagramType.Mermaid) {
      this.originalMermaidCode = this.mermaidCode;
    } else {
      this.originalSeqCode = this.seqCode;
    }
  }
  ```

### 2. Enhanced Exit Event Handler

The `exit` event handler in `forgeIndex.ts` now supports change detection with a custom modal dialog:

```typescript
EventBus.$on('exit', async (showWarning: boolean) => {
  console.log('exit', showWarning);
  
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
    // Show custom modal dialog for Forge (similar to Connect)
    const result = await showCloseWithoutSavingDialog();
    if (result === 'discard') {
      await (await getView()).close();
    }
  } else {
    await (await getView()).close();
  }
});
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

### 4. Header Component Integration

The `Header.vue` component has been updated to work with both Connect and Forge modes:

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

1. **Automatic Change Detection**: Tracks changes to both sequence and Mermaid code
2. **Confirmation Dialog**: Shows a confirmation dialog when exiting with unsaved changes
3. **Analytics Tracking**: Logs exit events with change detection context
4. **Backward Compatibility**: Works with both Connect and Forge modes
5. **Session Timing**: Tracks how long the user spent in the editor

## Testing

A test suite has been created in `tests/unit/ChangeDetection.spec.ts` to verify:
- No changes detected when code is unchanged
- Changes detected when sequence code is modified
- Changes detected when Mermaid code is modified
- Proper handling of empty and undefined code values

## Usage

When a user makes changes to the diagram and tries to close the editor:

1. The system detects if changes have been made
2. If changes are detected, a confirmation dialog appears
3. User can choose to discard changes or cancel
4. If no changes are detected, the editor closes immediately

This provides the same user experience as the Connect sequence macro, ensuring consistency across both platforms.
