# Confluence Smoke Test - ZenUML Macros

Automated smoke test for the ZenUML Confluence Cloud app. Uses Playwright MCP browser automation to create a test page and insert all 4 macro types.

## Arguments

This skill accepts an optional **site** argument to specify which Confluence instance to test on.

Usage: `/confluence-smoke-test [on <site>]`

Examples:
- `/confluence-smoke-test` — runs on production (`yanhui` site)
- `/confluence-smoke-test on zenuml-stg` — runs on Full staging
- `/confluence-smoke-test on lite-stg` — runs on Lite staging

## Site Configuration

| Site | Atlassian Host | Space Key | Parent Page Name | Parent Page ID |
|------|---------------|-----------|------------------|----------------|
| `yanhui` (default) | `whimet4.atlassian.net` | `WHIMET4` | Test pages | `649953281` |
| `zenuml-stg` | `zenuml-stg.atlassian.net` | `ZS` | Before release test pages | `177176629` |
| `lite-stg` | `lite-stg.atlassian.net` | `SD` | Before release test pages | `524297` |

When processing the arguments:
1. Parse the site name from the arguments (e.g., `on zenuml-stg` → `zenuml-stg`)
2. If no site is specified, default to `zenuml`
3. Look up the site configuration from the table above
4. Use the **Atlassian Host**, **Space Key**, and **Parent Page ID** values throughout all steps

In the instructions below, these placeholders are used:
- `{HOST}` — the Atlassian host (e.g., `zenuml-stg.atlassian.net`)
- `{SPACE_KEY}` — the space key (e.g., `ZS`)
- `{PARENT_PAGE_ID}` — the parent page ID (e.g., `177176629`)
- `{PARENT_PAGE_NAME}` — the parent page name (e.g., `Before release test pages`)

## Prerequisites

- Playwright MCP browser tools must be available
- User must be logged into Confluence at `https://{HOST}`

## Test Steps

### Step 1: Navigate to the Confluence Space

Navigate to `https://{HOST}/wiki/spaces/{SPACE_KEY}/pages/{PARENT_PAGE_ID}/{PARENT_PAGE_NAME}` (the test pages parent page).

Wait for the page to load. Verify the page title contains the parent page name.

### Step 2: Create a Child Page

1. Click the **"Create"** button in the top navigation bar
2. A dropdown appears with a "Page" option. Click **"Page"** - it will include `parentPageId={PARENT_PAGE_ID}` automatically
3. This opens the Confluence v2 editor with a new child page draft

**Important:** Do NOT navigate to `/wiki/spaces/{SPACE_KEY}/pages/create?parentPageId=...` directly - it opens the legacy v1 editor which has Synchrony errors. Always use the Create button in the top nav while viewing the parent page.

### Step 3: Type the Page Title

1. Find the title textbox (placeholder: "Give this page a title")
2. Type: `Automated Test Page YYYY-MM-DD` (use today's date)

### Step 4: Insert Diagram (ZenUML & Mermaid) Macro

1. Click the **"Insert elements"** (`+`) button in the editor toolbar
2. In the search combobox, type `zenuml`
3. Click the **"Diagram (ZenUML & Mermaid)"** option (NOT the Lite version)
4. The macro editor opens as a Connect app iframe dialog
5. Find the **"Title"** textbox inside the iframe (it has ref prefix `f`)
6. Type `Test Diagram` in the Title field
7. The **"Publish"** button becomes enabled - click it
8. The dialog closes and the macro is inserted into the page

**Key insight:** The Publish button starts disabled and only enables after a title is entered. Clicking "Close" discards the macro.

### Step 5: Insert PlantUML Diagram Macro

1. **Position cursor below the first macro** (same approach as any macro positioning):
   - Click the **page title** textbox first to exit the macro iframe
   - Press `End` then `ArrowDown` repeatedly (8+ times) to move past the macro
   - Press `Enter` to create a new paragraph below
   - Verify the editing area textbox is `[active]` and a new `paragraph` element appears
2. Click the **"Insert elements"** button again
3. In the search combobox, type `zenuml`
4. Click the **"Diagram (ZenUML & Mermaid)"** option (NOT the Lite version) — same macro as Step 4
5. The macro editor opens as a Connect app iframe dialog
6. **Click the "PlantUML" tab** in the diagram type tab switcher (tabs: Sequence | Mermaid | PlantUML)
7. Find the **"Title"** textbox inside the iframe
8. Type `Test PlantUML` in the Title field
9. The **"Publish"** button becomes enabled - click it
10. The dialog closes and the macro is inserted into the page

**Key insight:** PlantUML is the third tab in the same "Diagram (ZenUML & Mermaid)" macro editor. The tab switcher appears at the top of the editor dialog. The Publish button starts disabled and only enables after a title is entered.

### Step 6: Insert Graph (DrawIO) Macro

1. **Position cursor below the previous macro** (this is critical - see Troubleshooting):
   - Click the **page title** textbox first to exit the macro iframe
   - Press `End` then `ArrowDown` repeatedly (8+ times) to move past the macros
   - Press `Enter` to create a new paragraph below
   - Verify the editing area textbox is `[active]` and a new `paragraph` element appears in the snapshot
2. Click the **"Insert elements"** button again
3. In the search combobox, type `graph`
4. Click the **"Graph (DrawIO)"** option (NOT the Lite version)
5. The DrawIO editor opens in an iframe dialog
6. A "Create New Graph" overlay appears with:
   - A **"Graph Title"** label and **"Title"** textbox
   - A disabled **"Confirm"** button
7. Type `Test Graph` in the Title textbox
8. The **"Confirm"** button becomes enabled - click it
9. **Add at least one component to the canvas** (see details below)
10. Then click the **"Publish"** button in the DrawIO toolbar (bottom of the DrawIO editor)
11. The dialog closes and the macro is inserted

#### Adding a Component in DrawIO

After clicking "Confirm", the DrawIO editor canvas loads. You must add at least one shape before publishing so the graph is non-empty. Options:

**Option A: Double-click the canvas** (simplest)
1. Double-click on the white canvas area in the center of the DrawIO editor
2. A text/rectangle shape is created at that position
3. Type a label like `Component A` and click outside the shape to deselect

**Option B: Drag from the shapes sidebar** (more realistic)
1. The left sidebar shows shape categories (e.g., "General")
2. Drag a **Rectangle** shape from the sidebar onto the canvas
3. The shape appears on the canvas - optionally double-click it to type a label

**Option C: Use the toolbar** (if sidebar is collapsed)
1. Look for shape buttons in the top toolbar or the `+` insert button
2. Click to insert a shape onto the canvas

Take a snapshot after adding the component to verify it appears on the canvas before clicking Publish.

**Key difference from Diagram macro:** Graph (DrawIO) has a three-step process:
- First: Fill title and click "Confirm" in the title overlay
- Then: Add at least one component to the canvas
- Finally: Click "Publish" in the DrawIO toolbar

### Step 7: Insert OpenAPI / Swagger Macro

1. **Position cursor below the previous macro** (same approach as Step 6):
   - Click the **page title** textbox first to exit the macro iframe
   - Press `End` then `ArrowDown` repeatedly (12+ times) to move past all macros
   - Press `Enter` to create a new paragraph below
   - Verify the editing area textbox is `[active]` and a new `paragraph` element appears
2. Click the **"Insert elements"** button again
3. In the search combobox, type `openapi`
4. Click the **"OpenAPI / Swagger"** option (NOT the Lite version)
5. The OpenAPI/Swagger editor opens in an iframe dialog
6. The **"Title"** textbox is pre-filled with "Sample API"
7. Clear and type `Test OpenAPI` in the Title field
8. The **"Publish"** button is already enabled - click it
9. The dialog closes and the macro is inserted

**Key difference:** OpenAPI macro pre-fills the title with "Sample API" and has Publish already enabled.

### Step 8: Publish the Page (Optional)

1. Click the **"Publish..."** button in the top-right of the editor
2. The page is published with all 4 macros

## Expected Results

After completing all steps, the page should contain:
- Title: "Automated Test Page YYYY-MM-DD"
- 4 macros inserted in order:
  1. Diagram (ZenUML & Mermaid) - titled "Test Diagram" (Sequence/ZenUML tab)
  2. Diagram (ZenUML & Mermaid) - titled "Test PlantUML" (PlantUML tab)
  3. Graph (DrawIO) - titled "Test Graph", with at least one shape on the canvas
  4. OpenAPI / Swagger - titled "Test OpenAPI"

## Macro Search Terms

| Macro | Search Term | Full Name | Tab |
|-------|------------|-----------|-----|
| Sequence Diagram | `zenuml` | Diagram (ZenUML & Mermaid) | Sequence (default) |
| PlantUML Diagram | `zenuml` | Diagram (ZenUML & Mermaid) | PlantUML (3rd tab) |
| Graph | `graph` | Graph (DrawIO) | — |
| OpenAPI | `openapi` | OpenAPI / Swagger | — |

## Troubleshooting

- **Publish button disabled:** Make sure you filled in the Title field inside the macro iframe
- **Dialog closes without inserting:** You clicked "Close" instead of "Publish" - Close discards the macro
- **Legacy editor opens:** Don't navigate to create URLs directly. Use the Create button in the top nav bar
- **Macro not found in search:** Make sure the ZenUML app is installed on the Confluence instance
- **Iframe not loaded:** Wait 5 seconds after clicking the macro option for the iframe to fully load
- **Element refs change:** Confluence re-renders elements frequently. Always take a fresh snapshot before interacting
- **Cursor stuck in macro iframe:** After inserting a macro, the cursor gets trapped inside the macro's iframe. Pressing ArrowDown/Enter while inside the iframe does NOT move the cursor in the Confluence editor. **Solution:** Click the page title textbox first to exit the iframe, then use `End` + multiple `ArrowDown` + `Enter` to position below the macro. Verify the editing area textbox shows `[active]` (not the iframe) before inserting the next macro.
- **Macro not inserted after Publish:** If the cursor was inside a previous macro's iframe when you opened "Insert elements", the new macro may not be properly inserted. Always ensure the cursor is in the main editing area (not inside an iframe) before inserting.

## Available ZenUML Macros (Full Version)

- Diagram (ZenUML & Mermaid)
- Diagram (ZenUML & Mermaid) Lite
- Graph (DrawIO)
- Graph (DrawIO) Lite
- OpenAPI / Swagger
- OpenAPI / Swagger Lite
- Embed a Diagram, Graph or API Spec
- Embed a Diagram, Graph or API Spec Lite
- Async API Spec
- Embed Async API Spec