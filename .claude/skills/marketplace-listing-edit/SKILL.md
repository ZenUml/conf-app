---
name: marketplace-listing-edit
description: >-
  Change the public Atlassian Marketplace listing of a ZenUML app - name, tagline, summary,
  highlight texts, highlight images, More details - in the vendor console, then read the
  result back. Use for "change the listing", "rename the app on Marketplace", "replace the
  highlight images", "update the tagline", "上架页", "改名", "换配图", and for reading a search
  rank before and after. For prices, licenses and revenue use marketplace.
---

# Marketplace listing edit

Edits one app's public listing in the Marketplace vendor console and proves the result.
Every saved field is public at once. There is no draft state and no review step.

## Boundary

| In scope | Out of scope |
|---|---|
| Listing fields of an existing app version | New app versions, releases (use `release-app`) |
| Composing 1840x900 highlight images from screenshots | Pricing, licenses, transactions (use `marketplace`) |
| Search-rank reads before and after | Deciding the wording: the owner approves every public text |

## Inputs and outputs

| Input | Notes |
|---|---|
| App | One row of the table below |
| Approved text and images | Exact strings from the owner. Text you drafted is not approved until the owner says so |
| Evidence folder | A private path (`private/local-data/...`), never the public tree |

Output: the fields that changed, the public-page read-back for each, the search rank before
and after as separate readings, and anything that was rejected with the exact message.

## Apps

Vendor P&D VISION, id `1215266`. The build number changes with each release: open
`/manage/apps/<app id>` and follow the latest Cloud version, do not reuse an old build number.

| App | App id | Key |
|---|---|---|
| Lite | 1219422 | `com.zenuml.confluence-addon-lite` |
| Full | 1218380 | `com.zenuml.confluence-addon` |
| Diagramly | find with `search_rank.py <term> --match gptdock` | `gptdock-confluence` |

The Full listing also serves Server and Data Center. A new name applies there too.

## Where each field lives

| Field | Console page | Limit | Save |
|---|---|---|---|
| Name | `/manage/apps/<id>/details` | 60 characters | one Save for the page |
| Tagline | same | 130, no end punctuation | same |
| Summary | same | 250 | same |
| Highlight title (x3) | `/manage/apps/<id>/versions/<build>/highlights` | 50 | one Save for all three |
| Highlight description (x3) | same | 220, rich text | same |
| Highlight image (x3) | same | 1840 x 900 px | same |
| Image caption (x3) | same | 220, optional | same |
| More details | `/manage/apps/<id>/versions/<build>/details` | 250 to 1000, see Traps | one Save |

All paths are under `https://marketplace.atlassian.com`.

## Procedure

1. **Before state.** Save the current values and the rank:
   `python3 .claude/skills/marketplace-listing-edit/scripts/search_rank.py <query> --save <abs prefix>`.
   Read the website search once as well; it is a separate reading.
2. **Open the console in the owner's real Chrome** (`mcp__claude-in-chrome__*`). See Traps for why.
3. **Text fields.** Click the field, select all, type the approved text. The description
   editors are rich text: same method. Check the character limit before typing.
4. **Images.** Each highlight is an accordion panel; only an open panel exposes its file
   input. Open one panel, `read_page` with `filter: interactive`, upload to the `type="file"`
   button with `file_upload`, confirm the thumbnail changed, then collapse it and open the
   next. The upload path must be inside the session's folders; a scratchpad path may be refused.
5. **Captions.** An image caption describes the old image. When you replace an image, clear
   or rewrite its caption in the same save.
6. **Save**, and read the confirmation ("... has been updated successfully").
7. **Read back** on the public page `https://marketplace.atlassian.com/apps/<id>?tab=overview&hosting=cloud`.
   A field is done when the public page shows it, not when the console accepted it.
8. **Rank after.** Run `search_rank.py` again. Compare the printed name with the name you
   saved first: if it is still the old name, the index has not caught up and the rank is
   not an after-reading yet.
9. **Repo references.** `rg` the old name and old slug in the repo. `.md` files can change on
   `main`; other files need a branch and PR.

## Highlight images

Take screenshots from our own staging sites with the `create-test-page` skill and
`agent-browser`, then compose:

```bash
.claude/skills/marketplace-listing-edit/scripts/compose_highlight.sh /abs/out/highlight2.png \
  /abs/crops/openapi.png:h=600 /abs/crops/plantuml.png:h=600 /abs/crops/drawio.png:w=540:box=560x600
```

Rules for what may appear in a public image:

- Use neutral sample content (an order flow, an example API). No customer data, no real tenant.
- Crop to the macro or the editor. Confluence chrome shows the space name, the page author
  and the staging app name.
- Hide the viewer's attribution footer and feedback button inside each macro iframe before
  the screenshot; the footer prints the diagram author's name.
- Capture at device scale 2 (`agent-browser set viewport <w> <h> 2`) and wait until every
  macro has rendered; a lazy macro screenshots as an empty card. Look at each capture.
- Lite and Full need their own captures: the editor title names the edition, and only Full
  has the Graph (DrawIO) macro.
- A staging space over the Lite diagram limit shows a paywall watermark. Use a small space.

Look at every composed image before upload, and at the public page after.

## Traps

| Trap | What happens | What to do |
|---|---|---|
| `agent-browser` with the support profile | `marketplace.atlassian.com/manage` asks for an 8-digit code sent by email | Do not read or enter the code. Use the owner's real Chrome, which holds the vendor session |
| More details length | The console rejected an edit of 998 plain characters with "More Details must be between 250 and 1000 characters long"; the stored text was 962 plain and 1,384 HTML characters | The count is not plain text (HTML length is the likely rule, not confirmed). Draft the body under 1000 HTML characters and get the wording approved first |
| `shift+End` in the More details editor | Selects the whole document | Click, then shift-click the end of the sentence |
| Highlights page read too early | Empty page | Wait, then read again |
| Search index lag | The listing page and `rest/2/addons/<key>` show the new name while search still returns the old one. Observed 2026-11-17: Lite's index had the new name inside the hour; Full's still held the old name at 05:10Z and held the new one at 05:29Z | Re-read later; never report a rank that was read under the old name as the after-state |
| Single-app API `totalInstalls` | Returns 0 | Read install counts from the search endpoint |
| Slug | A rename changes the URL slug; the old slug still answered 200 on 2026-11-17 | Links keep working, but update `.md` references |
| Website `&page=N` | Ignored; page 1 is returned | Use the API for positions beyond the first page |

## Report

| Item | Evidence |
|---|---|
| Each changed field | Old value, new value, public-page read-back |
| Rank | Before and after, API and website as separate readings, with time and signed-in state |
| Rejected or skipped | Exact console message |
| Not verified | Say so: for example the app name in Confluence "Manage apps", the Server/DC listing |

A rank change read once is one observation. Say when it was read, and re-read on another day
before calling it stable.
