# PR 1209 evidence: Add to page on the byline post-save panel

- BEFORE: post-save panel in view mode without a place action. Captured on the Lite development site from `feat/byline-flowchart-seed@e947f667`, whose panel footer code equals this PR's base (`fix/byline-copy-on-click`): "Not now" + "Open editor & paste".
- AFTER: Forge tunnel on the Lite development site, candidate `141e036c`, 2026-11-17, desktop Chrome, Forge CLI account. Fresh space with no Full-presence marker (the Lite byline is hidden where Full is active).
  1. Flowchart tile, Publish: panel shows hint "Choose where on the page it goes." and buttons "Open editor & paste" + primary "Add to page".
  2. Add to page opens the placement picker; chose the slot after the first paragraph.
  3. Add here: page reloads by itself; the macro renders between the two paragraphs (dev bar `feat/byline-pan…@141e03`).
  4. Editor mode: no Add to page button (see PR 1208 evidence).
- Mixpanel (same session): `placement_picker_opened placement_entry=created_panel result=loaded`; `diagram_added_to_page placement_entry=created_panel custom_content_id=117407746 result=added`; `byline_created_panel_closed created_panel_action=add_to_page custom_content_id=117407746`; editor-mode `byline_created_panel_closed created_panel_action=done`.
- Storybook: story "Created — view mode, Add to page" interaction PASS (`storybook-add-to-page-pass.jpg`).
