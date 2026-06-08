# ZenUML for Confluence — User Guide

## What Is This App?

ZenUML for Confluence lets you create professional technical diagrams directly inside your Confluence pages — no external tools, no copy-pasting images. Whether you are documenting an API flow, sketching a system architecture, or publishing an OpenAPI spec, you author your diagram in a built-in editor and it appears inline on the page for your whole team to read. It is designed for software teams who want their diagrams to live alongside their documentation, stay version-controlled in Confluence, and update instantly when the source changes.

---

## Getting Started

1. Open any Confluence page in edit mode.
2. Click the **+** button in the Confluence editor toolbar (or type `/` to open the macro menu).
3. Search for **ZenUML** and select the diagram type you want to create (for example, "ZenUML Sequence" or "ZenUML Graph").
4. The ZenUML editor opens in a full-screen workspace.
5. Type your diagram code in the left panel — a live preview appears on the right as you type.
6. Enter a title in the **TITLE** field at the top.
7. Click **Publish** to save the diagram and return to your Confluence page.
8. The diagram now appears embedded in the page. Click **Publish** (or **Save**) in the Confluence editor to make it visible to your team.

> **Tip:** You can also discover ZenUML diagrams on pages you are reading. Hover over any diagram to reveal the Edit and Fullscreen buttons.

---

## Diagram Types

### 1. Sequence Diagrams (ZenUML)

Sequence diagrams show how people, services, or systems exchange messages over time — perfect for documenting API calls, authentication handshakes, microservice interactions, and step-by-step processes. ZenUML's text syntax is developer-friendly: you describe participants and messages using a style that resembles method calls, and the diagram draws itself automatically.

**Best for:** Software engineers and architects documenting how components talk to each other.

**To create one:** Insert the **ZenUML Sequence** macro. In the editor, type participant names and use arrow-style method calls to describe message flows. The diagram updates in real time as you type.

**What you will see:** A vertical timeline for each participant, with horizontal arrows representing messages between them. The preview updates instantly. Published, the diagram renders inline on the Confluence page with pan and zoom built in.

![Sequence diagram on a Confluence page](screenshots/sequence-diagram.png)

---

### 2. Flowcharts & Diagrams (Mermaid)

Mermaid is a versatile renderer that supports many diagram types beyond sequence diagrams — flowcharts, class diagrams, entity-relationship (ER) diagrams, Gantt charts, pie charts, Git graphs, and more. If you have used Mermaid in GitHub, Notion, or Obsidian, your existing diagrams work here without modification.

**Best for:** Technical writers, product managers, and developers who need chart types beyond sequence, or who already know Mermaid syntax.

**To create one:** Insert the **ZenUML Mermaid** macro. Choose your diagram type at the top of the syntax (for example, start with `flowchart TD` for a top-down flowchart). The editor color-codes your diagram type, keywords, and node labels to make the syntax easier to follow.

**What you will see:** The rendered diagram appears on the right side of the editor as you type, and on the published page it displays as a crisp, scalable graphic.

---

### 3. PlantUML Diagrams

PlantUML is a mature diagramming tool with support for UML sequence, class, use-case, activity, component, deployment, state, and timing diagrams. If your organization has existing PlantUML diagrams — in wikis, code comments, or other tools — you can paste them directly into this editor and they render in Confluence without any changes.

**Best for:** Enterprise architects and UML practitioners who need diagram types not covered by other renderers, or who maintain existing PlantUML libraries.

**To create one:** Insert the **ZenUML PlantUML** macro. The editor pre-fills the `@startuml` / `@enduml` markers (these are required and cannot be deleted). Write your diagram content between them. Note that rendering requires a network connection, as PlantUML diagrams are processed by a public rendering server.

**What you will see:** The finished diagram appears in the preview panel and, once published, is embedded on the Confluence page as a scalable image.

![PlantUML diagram on a Confluence page](screenshots/plantuml-diagram.png)

---

### 4. Graph / Flowchart Editor (DrawIO)

The Graph editor gives you a full visual, drag-and-drop diagramming canvas powered by DrawIO — no code required. You can draw boxes, arrows, swimlanes, and any freeform shape by pointing and clicking. This is the only diagram type in the app that does not require writing syntax.

**Best for:** Anyone who prefers a visual editor: business analysts, project managers, or anyone creating architecture diagrams, process maps, or org charts without wanting to write code.

**To create one:** Insert the **ZenUML Graph** macro. The DrawIO editor opens full-screen. Drag shapes from the panel on the left, connect them with arrows, add labels, and click **Publish** (inside DrawIO) when you are done.

**What you will see on the Confluence page:** The rendered diagram appears in a clean card. Hover over the card to reveal Edit and Fullscreen buttons. Multi-page DrawIO files show navigation arrows so readers can page through each section.

![Graph diagram on a Confluence page](screenshots/graph-diagram.png)

---

### 5. API Documentation (OpenAPI/Swagger)

The OpenAPI viewer renders an interactive API reference directly inside Confluence. Paste in an OpenAPI 3.x or Swagger 2.x specification (YAML or JSON) and your team gets an expandable, navigable API reference — complete with endpoint descriptions, request/response schemas, and a "Try it out" button — without leaving the page.

**Best for:** Backend developers and API teams who want their API docs to live next to their architectural diagrams and prose in Confluence, always in sync with the spec.

**To create one:** Insert the **ZenUML OpenAPI** macro. Paste your OpenAPI spec YAML or JSON into the code editor. The interactive Swagger UI preview appears on the right immediately.

**What you will see:** A full Swagger UI interface embedded in the page, with expandable endpoint groups, schemas, and the ability to test calls interactively.

![OpenAPI documentation on a Confluence page](screenshots/openapi-diagram.png)

---

### 6. Embed an Existing Diagram

The Embed macro lets you display a diagram that already exists in Confluence on a different page — without duplicating it. When the original diagram is updated, every page that embeds it automatically shows the latest version.

**Best for:** Teams that maintain a single canonical diagram (for example, a system architecture) and want to reference it from multiple pages without maintaining separate copies.

**To create one:** Insert the **ZenUML Embed** macro. A browser panel opens listing all diagrams saved in your Confluence site, organized by the page they live on. Use the type tabs (All, Sequence, Mermaid, Graph, OpenAPI) or the search box to find the diagram you want. Click it to see a live preview on the right, then click **Publish** to confirm the selection.

**What you will see:** The embedded diagram renders identically to how it looks on its source page, including the same hover controls and fullscreen button.

---

## The Editor

When you open or create any diagram (except Graph, which uses the DrawIO visual editor), you land in a split-screen workspace:

- **Left panel (35% wide):** A dark-themed code editor where you type your diagram syntax. Line numbers appear on the left margin. Code is color-highlighted automatically based on the diagram type you are editing — keywords, participants, arrows, and comments each get their own color, making long diagrams easier to read at a glance.
- **Right panel (65% wide):** A live preview of your rendered diagram, updated as you type. The preview sits on a light dotted background.
- **Divider:** A thin bar between the panels. Drag it left or right to resize the panels to your preference.

**Syntax highlighting by type:**
- ZenUML: participants, arrows, and control keywords are colored distinctly.
- Mermaid: diagram names, keywords, arrows, and comments all have their own colors.
- PlantUML: the `@startuml` / `@enduml` markers are dimmed and locked; everything between them is editable.

**Error indicators:** The editor checks your syntax automatically about one second after you stop typing. If there is a problem, a red error bar appears at the bottom of the editor showing the exact error message. You can fix it by editing the code — the error bar disappears once the syntax is valid.

**AI Repair (when available):** If an error bar appears and you see a blue **AI Repair** button, click it to let the AI analyze your broken code and suggest a fix. A side-by-side comparison shows the original (red highlights) versus the repaired version (green highlights). You can accept or reject individual changes line by line, edit any line directly in the repaired panel, and then click **Apply Code** to update the editor. If you prefer to fix it yourself, click **Discard** to close the repair panel without making any changes.

**Autocomplete (ZenUML only):** As you type, a dropdown appears with matching suggestions. Press **Tab** or **Enter** to accept a suggestion.

**Bracket matching:** When you open a bracket or parenthesis, the editor automatically inserts the closing character.

---

## Saving & Publishing

**Auto-save drafts:** While you work, the editor silently saves a local draft every half-second. If you close the editor without publishing, your work is preserved. The next time you open the same diagram for editing, a prompt appears offering to restore your unsaved draft.

**Title field:** The **TITLE** field in the top bar is required before you can publish. Click into it and type a name for your diagram. If you click Publish without a title, the title field flashes red as a reminder.

**AI-generated titles (when available):** If you have typed diagram code but left the title blank, a sparkle icon button appears next to the title field. After about 1.5 seconds of inactivity, the editor automatically suggests a title by analyzing your diagram content — you will see it appear character by character with a blinking purple cursor. Click the sparkle icon at any time to request a new suggestion, or click the **X** button next to the field to clear the AI suggestion and type your own.

**Publish button:** Once a title is entered, the blue **Publish** button at the top right becomes active. Clicking it saves the diagram as content in Confluence and closes the editor, returning you to the Confluence page. Your diagram now appears inline in the page.

**Close without publishing:** Click the **X** icon in the top-right corner to exit the editor without saving. If you have made changes since the editor opened, those changes remain in the local draft (see Auto-save above) and can be recovered on your next edit session.

---

## Viewing Your Diagrams

On a published Confluence page, diagrams appear inline in the page body. Readers see the rendered diagram immediately, with no interaction required.

**Hover controls:** Move your mouse over any diagram to reveal:
- An **Edit** button (pencil icon) in the top-right — takes you back into the editor. Only visible to users with edit permission on the page.
- A **Fullscreen** button (expand icon) in the top-right — opens the diagram in a full-screen overlay that fills the entire browser window. Use this for presenting or examining fine detail. Close it with the standard modal close button to return to the page.

**Bottom action bar (appears on hover):**
- **Copy code** — copies the diagram source text to your clipboard.
- **Export PNG** — opens the export dialog (see Exporting below).
- **Versions** — shows the version history for this diagram (available for diagrams stored as Confluence custom content).
- **Copy link** — copies a direct link to this diagram.
- **More (•••)** — opens a menu with a **Download debug info** option, which packages diagnostic information useful if you need to report a problem to support.

**Multi-page Graph diagrams:** If a DrawIO diagram has multiple pages, navigation arrows and a page counter appear in the bottom bar so readers can step through each page.

**Pan and zoom (Sequence diagrams):** ZenUML sequence diagrams scale automatically to fit the available width. In fullscreen mode, you have more room to view wide diagrams.

---

## Exporting Diagrams

To export a diagram as an image:

1. Hover over the diagram on the Confluence page to reveal the bottom action bar.
2. Click **Export PNG**.
3. The export dialog opens with a live preview of your diagram on the left and export settings on the right.
4. Optionally, annotate the preview before downloading:
   - **Arrow:** Drag to draw an arrow. Choose direction, color, and thickness.
   - **Callout:** Click to place a speech bubble with custom text.
   - **Note:** Click to place a floating text label anywhere on the diagram.
   - **Watermark:** Overlay text (for example, "Confidential") at adjustable opacity and position.
5. Change the **background color** using the color swatches in the right panel, including a transparent option.
6. Click **Refresh** to recapture the preview if you have changed anything.
7. Click **Download PNG** to save the image to your computer. The dialog closes automatically when the download is complete.

Only PNG format is available for export.

---

## Tips & Tricks

1. **Resize the editor panels:** Drag the divider between the code editor and the preview to give yourself more room on whichever side you need. Wide diagrams benefit from a larger preview; complex syntax benefits from a wider editor.

2. **Use keyboard shortcuts in the editor:**
   - Undo: **Ctrl+Z** (Windows/Linux) or **Cmd+Z** (Mac)
   - Redo: **Ctrl+Shift+Z** or **Cmd+Shift+Z**
   - Accept autocomplete: **Tab** or **Enter**
   - Toggle comment (Mermaid): **Ctrl+/** or **Cmd+/**

3. **Switch diagram types without losing work:** Use the type tabs at the top of the editor (Sequence, Mermaid, PlantUML, Graph, OpenAPI, Embed) to switch. Each type maintains its own separate code, so switching tabs does not erase what you have written in the other types.

4. **Let AI write the title for you:** If you find naming diagrams tedious, leave the title field blank while you write your diagram. The AI title generator activates automatically and proposes a descriptive name based on your diagram content. Accept it, tweak it, or replace it entirely.

5. **Use the Embed macro instead of copying diagrams:** If the same architecture diagram appears on five pages, use the Embed macro to point all five pages at a single source diagram. When that diagram changes, all five pages update automatically — no manual re-publishing needed.

6. **Recover after closing accidentally:** If you close the editor without publishing, your work is not lost. Reopen the macro for editing and accept the draft-restore prompt to pick up exactly where you left off.

7. **Check the Examples button:** Each diagram type has an **Examples** link in the editor header (lightbulb icon). Clicking it opens a new tab with sample diagrams for that type — a useful starting point when you are learning a new syntax.

---

## Frequently Asked Questions

**Can readers without edit permission view my diagrams?**
Yes. Diagrams are embedded in the published Confluence page and render for all readers, regardless of whether they have edit permission. The Edit button is only shown to users who have permission to edit the page.

**My diagram shows a syntax error. What should I do?**
Look at the red error bar at the bottom of the editor. It shows the exact error message from the diagram parser. Fix the flagged part of your code — common issues include missing closing brackets, misspelled keywords, or invalid arrow syntax. If the AI Repair button is visible, click it to get an automated suggestion with a line-by-line diff you can review before applying.

**What is the difference between Sequence (ZenUML) and Sequence (Mermaid)?**
Both can draw sequence diagrams, but they use different syntax and have different strengths. ZenUML uses a method-call style that many developers find natural for documenting code-level interactions. Mermaid uses an arrow-notation style (`Alice->>Bob: Hello`) and also supports many other diagram types beyond sequence. If you are new to both, try ZenUML for pure sequence diagrams and Mermaid if you need flowcharts or other chart types.

**Can I use an existing PlantUML or Mermaid diagram I wrote elsewhere?**
Yes. Paste your existing code directly into the editor for that diagram type. PlantUML diagrams must include `@startuml` / `@enduml` delimiters (the editor inserts these automatically, so just replace the content between them). Mermaid diagrams from GitHub, Notion, or Obsidian paste in as-is.

**What happens to my diagrams if the ZenUML app is uninstalled?**
Diagram content is stored as Confluence custom content using Confluence's own storage APIs. Confluence is the system of record. However, because diagram rendering depends on the ZenUML app being installed, diagrams will not render if the app is removed. Contact your Confluence administrator before uninstalling if you have important diagrams you need to preserve.

---

## Release History

Future release notes will appear here.
