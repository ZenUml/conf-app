# PR 1208 evidence: byline post-save link copy

- BEFORE: Full staging, main `599802c` (2026-11-17), view mode. Auto-copy ran after the editor closed and failed with `NotAllowedError: Document is not focused`; the panel told the user to copy by hand.
- AFTER: Forge tunnel on the Lite development site, stacked candidate `141e036c` (this PR's head `26c53c93` plus PR 1209), 2026-11-17, desktop Chrome, account = Forge CLI account.
  - Editor mode: create from the byline, Publish. Panel footer is one primary button "Copy link & close". Clicked it, then pasted into the page editor: the link converted to the diagram macro and the page published.
- Mixpanel (project 3373228, client_domain = the Lite development site), same session:
  - `advocacy_message_copied` view mode, `copy_trigger=auto`, `result=skipped_no_focus` (the copy is no longer attempted without focus)
  - `advocacy_message_copied` editor mode, `copy_trigger=done`, `result=copied`, `copy_method=clipboard_api`
- Limitations: no BEFORE screenshot of the editor-mode panel (main had "Done" + auto-copy on close); BEFORE is described from code and field data. In the editor-mode run, `byline_diagram_created` did not reach Mixpanel although the panel opened; not reproduced or explained yet.
