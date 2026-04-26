# ZenUML Debug Header Bar — Comprehensive Test Plan

## Application Overview

The debug bar (`DebugBar.vue`) is a thin `<aside role="status">` strip rendered at the very top of
every viewer and editor page when the app runs in a standalone (non-Forge-iframe) context, or when
`localStorage.zenumlDebug` is truthy. It is composed of three child components:

- **Static metadata section** (left): git branch/tag + commit hash, content UUID + content ID
  abbreviation, build-variant badge (`LITE` / `FULL`).
- **PresetDropdown** (`[data-testid="preset-trigger"]`): clicking opens a list of named paywall
  presets. Selecting a preset calls `applyPreset(name)` which writes/deletes the nine `mock*`
  localStorage keys and calls `window.location.reload()`.
- **AdvancedDropdown** (`[data-testid="advanced-trigger"]`): clicking opens a 420 px panel that
  starts in read-only mode (`FlagsStatusTable`). Clicking the **Edit** button (`[data-testid=
  "advanced-edit"]`) replaces it with `FlagsEditor`. The editor exposes per-flag inputs — boolean
  selects, number inputs with "unset" checkboxes, an enum select, and a JSON textarea. **Save**
  (`[data-testid="editor-save"]`) writes to localStorage and reloads; **Cancel** (`[data-testid=
  "editor-cancel"]`) returns to read-only view without touching storage or reloading.
- **Clear button** (`[data-testid="debug-clear"]`): calls `applyPreset('Reset')` (removes all nine
  `mock*` keys) then reloads.

Target URL: `http://127.0.0.1:8082/index.html?sandbox=seq-view&outputType=display`

The nine managed localStorage keys are:
`mockCSSEnabled`, `mockMacroCount`, `mockSpacePaid`, `mockPersonaAwarePaywall`,
`mockPersonalAuthored`, `mockTenantSizeEstimate`, `mockConfluenceAdmin`, `mockPersonaThreshold`,
`mockNotifyAdmin`.

---

## Test Scenarios

### 1. Initial Render and Visibility

#### 1.1 Debug bar visible in standalone mode

**Starting state:** Fresh browser tab. All `mock*` localStorage keys absent.

**Steps:**
1. Navigate to `http://127.0.0.1:8082/index.html?sandbox=seq-view&outputType=display`.
2. Wait for the page to finish loading.
3. Observe the very top of the page (above the viewer header that contains the Fullscreen/Edit
   buttons).

**Expected results:**
- A thin horizontal bar approximately 36 px tall is visible at the very top.
- The bar has a light gray background (`bg-gray-100`) and a bottom border.
- The bar is rendered as an `<aside>` with `role="status"` and `aria-label="Debug information"`.
- The left section shows a git branch icon followed by a colon-separated string in the form
  `<branch>:<hash>` (may be empty strings in dev but the `:` separator is always present).
- A content-ID section shows a string in the form `[<uuid>]:<contentId>` where the content ID for
  `seq-view` is `..q-seq` (last 5 characters of `fake-content-id-diagram-sequence`).
- A build-variant pill shows the first letter of the product type in a colored circle followed by
  the full label (e.g., a blue `L` circle and the text `LITE` when built with `PRODUCT_TYPE=lite`).
- The **Preset: — ▾** control is visible to the right.
- The **Advanced ▾** control is visible to its right.
- The **Clear** button is visible at the far right.

#### 1.2 Debug bar hidden when running inside a Forge iframe

**Starting state:** App loaded inside a Forge sandboxed iframe (cross-origin, `window.self !==
window.top`) and `localStorage.zenumlDebug` is absent.

**Steps:**
1. Open the app in a real Forge context (production or staging Confluence instance).
2. Observe the top of the viewer/editor.

**Expected results:**
- The `<aside>` debug bar is not rendered.
- The viewer header (Fullscreen/Edit buttons) is the topmost element.

#### 1.3 Debug bar visible via localStorage override in Forge iframe

**Starting state:** Running inside a Forge iframe, `localStorage.zenumlDebug` set to any truthy
string (e.g., `"1"`).

**Steps:**
1. In browser devtools, execute `localStorage.setItem('zenumlDebug', '1')` on the top-level origin.
2. Reload the page.

**Expected results:**
- The debug bar is rendered even though `window.self !== window.top` is false.

---

### 2. Static Metadata Display

#### 2.1 Branch and commit hash display

**Starting state:** No `mock*` keys in localStorage.

**Steps:**
1. Load the target URL.
2. Read the text content of the first info segment (left of the first vertical divider).

**Expected results:**
- Text matches the pattern `<branch-or-tag>:<commit-hash>`.
- If neither is set (local dev without env vars), the string is `":"` — the separator is always
  rendered.

#### 2.2 Content UUID and content ID display — seq-view preset

**Starting state:** No `mock*` keys in localStorage.

**Steps:**
1. Load `?sandbox=seq-view&outputType=display`.
2. Read the content-ID segment (between first and second dividers).

**Expected results:**
- Format is `[<8-char-uuid>]:<contentId-suffix>`.
- The content ID suffix is `..q-seq` (the last 5 characters of `fake-content-id-diagram-sequence`).

#### 2.3 Content UUID and content ID display — no customContentId

**Starting state:** No `mock*` keys in localStorage.

**Steps:**
1. Load `?sandbox=seq-new` (a preset with no `customContentId`).
2. Read the content-ID segment.

**Expected results:**
- Content ID portion displays `N/A`.

#### 2.4 Build variant badge — LITE build

**Starting state:** App built with `PRODUCT_TYPE=lite`.

**Steps:**
1. Load the target URL.
2. Observe the badge segment (between second and third dividers).

**Expected results:**
- A filled blue circle containing the letter `L` is shown.
- The text label `LITE` is displayed in blue.
- Hovering the segment shows a tooltip: `"Build variant: lite"`.

#### 2.5 Build variant badge — FULL build

**Starting state:** App built with `PRODUCT_TYPE=full`.

**Steps:**
1. Load the target URL with a full build.
2. Observe the badge segment.

**Expected results:**
- A gray circle containing the letter `F` is shown.
- The text `FULL` is displayed in gray.

---

### 3. Preset Dropdown — Closed State

#### 3.1 Dropdown shows active preset label on load

**Starting state:** `mockCSSEnabled=true`, `mockMacroCount=120`, `mockSpacePaid=false` in
localStorage (matches "Lite blocked" signature exactly).

**Steps:**
1. Set the three localStorage keys above.
2. Load the target URL.
3. Read the text inside `[data-testid="preset-active"]`.

**Expected results:**
- The label reads `Lite blocked`.

#### 3.2 Dropdown shows dash when no preset matches

**Starting state:** `mockCSSEnabled=true` only in localStorage (partial match, not a full preset
signature).

**Steps:**
1. Set only `localStorage.setItem('mockCSSEnabled', 'true')`.
2. Load the target URL.
3. Read `[data-testid="preset-active"]`.

**Expected results:**
- The label renders as `—` (em dash fallback).

#### 3.3 Dropdown is closed on initial load

**Starting state:** Any.

**Steps:**
1. Load the target URL.
2. Look for the presence of `[data-testid="preset-item"]` elements.

**Expected results:**
- No preset list items are visible; the dropdown panel is not in the DOM.

---

### 4. Preset Dropdown — Open and Select

#### 4.1 Clicking the trigger opens the dropdown

**Steps:**
1. Load the target URL.
2. Click `[data-testid="preset-trigger"]`.

**Expected results:**
- A dropdown list appears below the trigger button.
- The list contains exactly 6 items in this order:
  1. Reset
  2. Lite blocked
  3. Bystander
  4. Heavy creator — Bundle primary
  5. Heavy creator — Marketplace primary
  6. Comparison view
- Each item has `data-testid="preset-item"`.

#### 4.2 Selecting "Reset" clears all mock keys and reloads

**Starting state:** All nine `mock*` keys set to arbitrary values in localStorage.

**Steps:**
1. Load the target URL.
2. Click `[data-testid="preset-trigger"]`.
3. Click the list item with text `Reset`.

**Expected results:**
- The page reloads.
- After reload, all nine `mock*` keys are absent from localStorage (verified via devtools or test
  fixture).
- `[data-testid="preset-active"]` shows `Reset`.

#### 4.3 Selecting "Lite blocked" writes the correct localStorage signature

**Starting state:** Fresh localStorage (all `mock*` keys absent).

**Steps:**
1. Load the target URL.
2. Click `[data-testid="preset-trigger"]`.
3. Click the list item `Lite blocked`.
4. After the page reloads, inspect localStorage.

**Expected results:**
- `mockCSSEnabled` = `"true"`
- `mockMacroCount` = `"120"`
- `mockSpacePaid` = `"false"`
- All other six `mock*` keys are absent.
- `[data-testid="preset-active"]` shows `Lite blocked`.

#### 4.4 Selecting "Bystander" writes the correct localStorage signature

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Click `[data-testid="preset-trigger"]`.
3. Click the list item `Bystander`.
4. After reload, inspect localStorage.

**Expected results:**
- `mockCSSEnabled` = `"true"`
- `mockMacroCount` = `"120"`
- `mockSpacePaid` = `"false"`
- `mockPersonaAwarePaywall` = `"true"`
- `mockPersonalAuthored` = `"0"`
- `mockTenantSizeEstimate` = `"small_likely"`
- `mockConfluenceAdmin` = `"false"`
- `mockNotifyAdmin` = `'{"notified":true,"adminCount":1}'`
- `mockPersonaThreshold` is absent.
- Active label shows `Bystander`.

#### 4.5 Selecting "Heavy creator — Bundle primary" writes the correct signature

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Preset dropdown.
3. Click `Heavy creator — Bundle primary`.
4. After reload, inspect localStorage.

**Expected results:**
- `mockCSSEnabled` = `"true"`
- `mockMacroCount` = `"120"`
- `mockSpacePaid` = `"false"`
- `mockPersonaAwarePaywall` = `"true"`
- `mockPersonalAuthored` = `"60"`
- `mockTenantSizeEstimate` = `"medium_or_larger"`
- `mockConfluenceAdmin` = `"true"`
- `mockNotifyAdmin` and `mockPersonaThreshold` are absent.

#### 4.6 Selecting "Heavy creator — Marketplace primary" writes the correct signature

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Preset dropdown.
3. Click `Heavy creator — Marketplace primary`.
4. After reload, inspect localStorage.

**Expected results:**
- Same as 4.5 except `mockTenantSizeEstimate` = `"small_likely"`.

#### 4.7 Selecting "Comparison view" writes the correct signature

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Preset dropdown.
3. Click `Comparison view`.
4. After reload, inspect localStorage.

**Expected results:**
- `mockCSSEnabled` = `"true"`
- `mockMacroCount` = `"120"`
- `mockSpacePaid` = `"false"`
- `mockPersonaAwarePaywall` = `"true"`
- `mockPersonalAuthored` = `"20"`
- `mockTenantSizeEstimate` = `"unknown"`
- `mockConfluenceAdmin` = `"true"`
- `mockNotifyAdmin` and `mockPersonaThreshold` are absent.

#### 4.8 Switching from one preset to another removes keys from the prior preset

**Starting state:** "Bystander" preset currently applied (8 keys set including `mockNotifyAdmin`).

**Steps:**
1. Load the target URL.
2. Open the Preset dropdown.
3. Click `Heavy creator — Bundle primary`.
4. After reload, inspect localStorage.

**Expected results:**
- `mockNotifyAdmin` key is absent (it is not in the "Heavy creator" signature).
- All seven keys in the "Heavy creator — Bundle primary" signature are set correctly.

---

### 5. Advanced Dropdown — Read-Only (FlagsStatusTable)

#### 5.1 Clicking "Advanced" opens the read-only panel

**Starting state:** All `mock*` keys absent. Preset dropdown is closed.

**Steps:**
1. Load the target URL.
2. Click `[data-testid="advanced-trigger"]`.

**Expected results:**
- A panel (420 px wide) opens below the Advanced button.
- The panel shows a table with exactly 9 rows, one per `mock*` key in canonical order:
  `mockCSSEnabled`, `mockMacroCount`, `mockSpacePaid`, `mockPersonaAwarePaywall`,
  `mockPersonalAuthored`, `mockTenantSizeEstimate`, `mockConfluenceAdmin`, `mockPersonaThreshold`,
  `mockNotifyAdmin`.
- Each row has `data-testid="flag-row"` and `data-key=<keyName>`.
- The value cell (`data-testid="flag-value"`) for every key shows `—` with reduced opacity because
  all keys are absent.
- An **Edit** button (`[data-testid="advanced-edit"]`) is visible in the footer.

#### 5.2 Read-only panel shows current localStorage values

**Starting state:** `mockMacroCount` = `"42"`, `mockSpacePaid` = `"true"`, all others absent.

**Steps:**
1. Set the two localStorage keys above.
2. Load the target URL.
3. Click `[data-testid="advanced-trigger"]`.
4. Read the value cells in the table.

**Expected results:**
- Row `mockMacroCount` → value cell shows `42` at full opacity.
- Row `mockSpacePaid` → value cell shows `true` at full opacity.
- All other rows show `—` with reduced opacity.

#### 5.3 Read-only panel shows long JSON values without clipping the key

**Starting state:** `mockNotifyAdmin` = `'{"notified":true,"adminCount":1}'`.

**Steps:**
1. Set `mockNotifyAdmin` as above.
2. Load the target URL.
3. Open the Advanced panel.
4. Observe the `mockNotifyAdmin` row.

**Expected results:**
- The full JSON string is displayed in the value cell.
- The value wraps within the cell (`break-all`) and does not overflow the panel horizontally.
- The key label `mockNotifyAdmin` remains on a single line.

#### 5.4 Clicking outside the panel does not close it (no outside-click handler)

**Steps:**
1. Load the target URL.
2. Click `[data-testid="advanced-trigger"]`.
3. Click anywhere on the page outside the panel but not on the trigger.

**Expected results:**
- The panel remains open (there is no outside-click close handler in the current implementation).

#### 5.5 Clicking the trigger again closes the panel

**Steps:**
1. Load the target URL.
2. Click `[data-testid="advanced-trigger"]` to open.
3. Click `[data-testid="advanced-trigger"]` again.

**Expected results:**
- The panel closes (removed from DOM).

---

### 6. Advanced Dropdown — Edit Mode (FlagsEditor)

#### 6.1 Clicking "Edit" switches to the editor view

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Click `[data-testid="advanced-trigger"]`.
3. Click `[data-testid="advanced-edit"]`.

**Expected results:**
- The read-only table is replaced by the FlagsEditor table.
- The Edit button itself is no longer visible.
- Each row now shows an input control appropriate to the flag's type:
  - `mockCSSEnabled` → `<select>` (`[data-testid="edit-mockCSSEnabled"]`) with options:
    `unset`, `true`, `false`. Currently selected: `unset`.
  - `mockMacroCount` → `<input type="number">` + "unset" checkbox. Input is disabled;
    checkbox is checked (flag is unset).
  - `mockSpacePaid` → `<select>` with options `unset`, `true`, `false`. Currently: `unset`.
  - `mockPersonaAwarePaywall` → `<select>`, options `unset`/`true`/`false`. Currently: `unset`.
  - `mockPersonalAuthored` → number input + unset checkbox. Currently unset.
  - `mockTenantSizeEstimate` → `<select>` with options `unset`, `unknown`, `small_likely`,
    `medium_or_larger`. Currently: `unset`.
  - `mockConfluenceAdmin` → `<select>`, options `unset`/`true`/`false`. Currently: `unset`.
  - `mockPersonaThreshold` → number input + unset checkbox. Currently unset.
  - `mockNotifyAdmin` → `<textarea>`. Currently empty.
- A **Save** button (`[data-testid="editor-save"]`) and a **Cancel** button
  (`[data-testid="editor-cancel"]`) are rendered at the bottom.

#### 6.2 Editor pre-populates with existing localStorage values

**Starting state:** `mockMacroCount` = `"75"`, `mockSpacePaid` = `"true"`, all others absent.

**Steps:**
1. Set the two keys above.
2. Load the target URL.
3. Open the Advanced panel, then click **Edit**.
4. Observe the editor controls.

**Expected results:**
- `[data-testid="edit-mockMacroCount"]` shows value `75`; the "unset" checkbox is unchecked; the
  input is enabled.
- `[data-testid="edit-mockSpacePaid"]` has `true` selected.
- All other controls are in their unset state.

#### 6.3 Clicking "Cancel" returns to read-only view without modifying localStorage or reloading

**Starting state:** `mockMacroCount` = `"10"`.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel.
3. Click **Edit**.
4. Change `mockMacroCount` input to `999`.
5. Click `[data-testid="editor-cancel"]`.

**Expected results:**
- The editor is replaced by the read-only FlagsStatusTable.
- `[data-testid="advanced-edit"]` reappears.
- localStorage `mockMacroCount` is still `"10"` (no save occurred).
- The page has not reloaded.

#### 6.4 Boolean flag: selecting "true" from "unset" and saving

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. Change `[data-testid="edit-mockCSSEnabled"]` from `unset` to `true`.
4. Click `[data-testid="editor-save"]`.

**Expected results:**
- Page reloads.
- After reload, `localStorage.getItem('mockCSSEnabled')` = `"true"`.
- All other `mock*` keys remain absent.
- The read-only table (after reopening Advanced) shows `true` for `mockCSSEnabled`.

#### 6.5 Boolean flag: selecting "unset" removes the key

**Starting state:** `mockCSSEnabled` = `"true"`.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. `[data-testid="edit-mockCSSEnabled"]` shows `true`. Change to `unset`.
4. Click **Save**.

**Expected results:**
- After reload, `mockCSSEnabled` is absent from localStorage.

#### 6.6 Number flag: entering a valid positive integer and saving

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. Uncheck the "unset" checkbox next to `mockMacroCount`.
4. The input becomes enabled. Type `150`.
5. Click **Save**.

**Expected results:**
- Page reloads.
- `localStorage.getItem('mockMacroCount')` = `"150"`.

#### 6.7 Number flag: entering a negative number shows an error and disables Save

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. Uncheck the "unset" checkbox for `mockMacroCount`.
4. Clear the input and type `-5`.
5. Observe the Save button and any error indicators.

**Expected results:**
- `[data-testid="editor-error-mockMacroCount"]` appears with text
  `"Invalid number (must be ≥ 0)"`.
- `[data-testid="editor-save"]` is disabled (has the `disabled` attribute and
  `disabled:cursor-not-allowed` visual).

#### 6.8 Number flag: entering a non-numeric string shows an error and disables Save

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. Uncheck the "unset" checkbox for `mockPersonaThreshold`.
4. Type `abc` in the input.

**Expected results:**
- `[data-testid="editor-error-mockPersonaThreshold"]` is visible.
- Save button is disabled.

#### 6.9 Number flag: checking "unset" disables the input and clears validation errors

**Starting state:** Continuing from 6.8 (invalid value entered).

**Steps:**
1. Check the "unset" checkbox next to `mockPersonaThreshold`.

**Expected results:**
- The input becomes disabled.
- The error message disappears.
- Save button becomes enabled (assuming no other errors).

#### 6.10 Enum flag: selecting a non-"unset" option and saving

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. Change `[data-testid="edit-mockTenantSizeEstimate"]` to `medium_or_larger`.
4. Click **Save**.

**Expected results:**
- After reload, `localStorage.getItem('mockTenantSizeEstimate')` = `"medium_or_larger"`.

#### 6.11 Enum flag: setting back to "unset" removes the key

**Starting state:** `mockTenantSizeEstimate` = `"small_likely"`.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. `[data-testid="edit-mockTenantSizeEstimate"]` shows `small_likely`. Change to `unset`.
4. Click **Save**.

**Expected results:**
- After reload, `mockTenantSizeEstimate` is absent from localStorage.

#### 6.12 JSON flag: entering valid JSON and saving

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. Type `{"notified":false,"adminCount":0}` into `[data-testid="edit-mockNotifyAdmin"]`.
4. Click **Save**.

**Expected results:**
- No JSON error indicator is shown.
- After reload, `localStorage.getItem('mockNotifyAdmin')` = `'{"notified":false,"adminCount":0}'`.

#### 6.13 JSON flag: entering invalid JSON shows an error and disables Save

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. Type `{broken json` into `[data-testid="edit-mockNotifyAdmin"]`.
4. Observe the Save button and error indicator.

**Expected results:**
- `[data-testid="editor-error-mockNotifyAdmin"]` appears with text `"Invalid JSON"`.
- `[data-testid="editor-save"]` is disabled.

#### 6.14 JSON flag: fixing invalid JSON re-enables Save

**Starting state:** Continuing from 6.13 (invalid JSON present).

**Steps:**
1. Clear the textarea and type `{"notified":true}`.
2. Observe the error indicator and Save button.

**Expected results:**
- The JSON error message disappears.
- Save button is re-enabled.

#### 6.15 Multiple simultaneous validation errors: Save stays disabled until all are resolved

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. Uncheck "unset" for `mockMacroCount` and type `-1`.
4. Type `bad` in the `mockNotifyAdmin` textarea.
5. Observe the Save button.
6. Fix `mockMacroCount` to `50`. Observe.
7. Fix `mockNotifyAdmin` to `{}`. Observe.

**Expected results:**
- After step 5: Save is disabled. Both error messages are visible.
- After step 6: `mockMacroCount` error disappears; Save is still disabled due to JSON error.
- After step 7: Both errors gone; Save is enabled.

#### 6.16 Saving with no changes still reloads the page

**Starting state:** `mockCSSEnabled` = `"true"`.

**Steps:**
1. Load the target URL.
2. Open the Advanced panel, click **Edit**.
3. Make no changes (all controls show their existing/unset state).
4. Click **Save**.

**Expected results:**
- Page reloads.
- localStorage values are unchanged.

---

### 7. Clear Button

#### 7.1 Clear removes all nine mock keys and reloads

**Starting state:** All nine `mock*` keys set (apply the "Bystander" preset first, then manually
add `mockPersonaThreshold` and `mockNotifyAdmin` to cover the full set).

**Steps:**
1. Apply "Bystander" preset, then manually set `mockPersonaThreshold = "3"`.
2. Verify all nine keys are present in localStorage.
3. Load the target URL.
4. Click `[data-testid="debug-clear"]`.

**Expected results:**
- Page reloads.
- After reload, all nine `mock*` keys are absent from localStorage.
- `[data-testid="preset-active"]` shows `Reset` (the "Reset" preset's signature is an empty
  object, which matches the state of all keys absent).

#### 7.2 Clear when localStorage is already empty still reloads

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Click `[data-testid="debug-clear"]`.

**Expected results:**
- Page reloads cleanly with no JavaScript errors.
- All `mock*` keys remain absent.

#### 7.3 Clear does not touch non-mock localStorage keys

**Starting state:** `localStorage.setItem('unrelated-key', 'hello')`.

**Steps:**
1. Set `unrelated-key` as above.
2. Load the target URL.
3. Click **Clear**.
4. After reload, check `localStorage.getItem('unrelated-key')`.

**Expected results:**
- `unrelated-key` = `"hello"` (not removed).

---

### 8. Viewer Content Reflects Applied Paywall State

#### 8.1 "Lite blocked" preset → upgrade CTA appears in viewer header

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Apply the "Lite blocked" preset via the debug bar Preset dropdown.
3. After reload, observe the viewer header (Fullscreen/Edit bar).

**Expected results:**
- The gold-gradient **Upgrade** button appears in the right side of the viewer header, because
  `macrosCreated = 120 > 50` and `spacePaid = false` and `isLite = true`.

#### 8.2 "Reset" preset → upgrade CTA disappears

**Starting state:** "Lite blocked" preset applied (Upgrade button visible).

**Steps:**
1. Load the target URL with "Lite blocked" active.
2. Click the Preset dropdown and select **Reset**.
3. After reload, observe the viewer header.

**Expected results:**
- The Upgrade button is no longer visible.

#### 8.3 "Lite blocked" preset → Edit button is blocked (shows upgrade modal)

**Starting state:** "Lite blocked" preset applied (`mockCSSEnabled=true`, `mockMacroCount=120`,
`mockSpacePaid=false`).

**Steps:**
1. Load the target URL.
2. In the viewer header, click the **Edit** button.

**Expected results:**
- The edit action is blocked; the upgrade modal or upgrade prompt is shown instead of opening the
  editor.

#### 8.4 `mockSpacePaid=true` → Edit action proceeds normally even with high macro count

**Starting state:** Apply "Lite blocked", then use the Advanced editor to set
`mockSpacePaid` to `"true"`.

**Steps:**
1. Apply "Lite blocked" preset.
2. Reload, then open Advanced → Edit.
3. Change `mockSpacePaid` to `true`. Save.
4. After reload, click **Edit** in the viewer header.

**Expected results:**
- No upgrade modal appears.
- The editor opens (or attempts to open the Forge modal).

#### 8.5 "Bystander" preset → persona-aware paywall variant is rendered

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Apply the "Bystander" preset via the Preset dropdown.
2. After reload, click **Edit** in the viewer header (or whatever edit trigger triggers the upgrade
   flow when blocked).

**Expected results:**
- The upgrade prompt shown is the Bystander-variant persona-aware paywall UI (as configured by
  `mockPersonaAwarePaywall=true`, `mockPersonalAuthored=0`, `mockConfluenceAdmin=false`).
- The UI differs visually from the generic "Lite blocked" prompt.

#### 8.6 "Heavy creator — Bundle primary" preset → admin-persona paywall variant

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Apply "Heavy creator — Bundle primary" via the Preset dropdown.
2. After reload, trigger the blocked edit action.

**Expected results:**
- Upgrade prompt reflects the admin/heavy-creator persona (`mockConfluenceAdmin=true`,
  `mockTenantSizeEstimate=medium_or_larger`, `mockPersonalAuthored=60`).
- The primary CTA is oriented toward the Enterprise Bundle purchase path.

---

### 9. Edge Cases and Boundary Conditions

#### 9.1 Preset dropdown stays closed when clicking inside the open panel

**Steps:**
1. Load the target URL.
2. Open the Preset dropdown.
3. Click on the white background area of the dropdown panel (not on any list item).

**Expected results:**
- The dropdown remains open (click propagation is stopped by `@click.stop` on the `<ul>`).
- No preset is applied; no reload occurs.

#### 9.2 Opening one dropdown does not close the other

**Steps:**
1. Load the target URL.
2. Open the Preset dropdown.
3. Without closing it, click `[data-testid="advanced-trigger"]`.

**Expected results:**
- The Advanced panel opens.
- The Preset dropdown may or may not close (depends on whether the click propagates). Document
  the actual behavior as the baseline.

#### 9.3 FlagsEditor: number input value of zero is valid

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open Advanced → Edit.
3. Uncheck "unset" for `mockPersonalAuthored`.
4. Clear the input and type `0`.
5. Observe the error indicator and Save button.

**Expected results:**
- No error indicator appears (0 is valid: `must be ≥ 0`).
- Save button is enabled.

#### 9.4 FlagsEditor: empty number input (cleared, not "unset") is invalid

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open Advanced → Edit.
3. Uncheck "unset" for `mockPersonalAuthored`.
4. Leave the input empty (value is `""`).
5. Observe.

**Expected results:**
- Error indicator appears (empty string fails the `trimmed === ''` check).
- Save button is disabled.

#### 9.5 FlagsEditor: Save button is enabled when all controls are in "unset" state

**Starting state:** All `mock*` keys absent.

**Steps:**
1. Load the target URL.
2. Open Advanced → Edit (all controls start as unset).
3. Make no changes. Observe the Save button.

**Expected results:**
- Save is enabled (no validation errors when all fields are unset).

#### 9.6 Applying a preset while the Advanced panel is open

**Steps:**
1. Load the target URL.
2. Open the Advanced panel.
3. Without closing it, open the Preset dropdown (by clicking the trigger).
4. Select **Lite blocked**.

**Expected results:**
- Page reloads.
- After reload, "Lite blocked" keys are in localStorage.
- The Advanced panel state (open/closed) is reset since the page reloaded.

#### 9.7 Debug bar remains at top after diagram renders

**Starting state:** Any.

**Steps:**
1. Load the target URL.
2. Wait for the sequence diagram to fully render inside the viewer.
3. Verify the debug bar's vertical position.

**Expected results:**
- The debug bar remains the topmost element, above the viewer header and the diagram content.
- The diagram renders below the debug bar without overlap.

---

## Test Data Summary

| Preset | mockCSSEnabled | mockMacroCount | mockSpacePaid | mockPersonaAwarePaywall | mockPersonalAuthored | mockTenantSizeEstimate | mockConfluenceAdmin | mockNotifyAdmin | mockPersonaThreshold |
|---|---|---|---|---|---|---|---|---|---|
| Reset | — | — | — | — | — | — | — | — | — |
| Lite blocked | true | 120 | false | — | — | — | — | — | — |
| Bystander | true | 120 | false | true | 0 | small_likely | false | `{"notified":true,"adminCount":1}` | — |
| Heavy creator — Bundle primary | true | 120 | false | true | 60 | medium_or_larger | true | — | — |
| Heavy creator — Marketplace primary | true | 120 | false | true | 60 | small_likely | true | — | — |
| Comparison view | true | 120 | false | true | 20 | unknown | true | — | — |

`—` means the key is deleted from localStorage when the preset is applied.
