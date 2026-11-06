# P&S questionnaire — browser fill mechanics

The form is a React-controlled form in the Marketplace vendor console at
`manage/apps/<appId>/privacy-and-security` → **Edit responses**. It renders inside the
main page (not a Forge iframe), so ordinary Playwright MCP selectors reach it — but its
field validation has quirks that cost hours to discover. Follow these exactly.

## The one rule that matters most

**Radios, checkboxes, day inputs, the EUD-type chip lists, the rich-text permissions
editor, and the SCC textarea all accept programmatic `browser_evaluate` writes.**
**The sub-processor entity subform (name / domain / purpose fields) does NOT** — its
validation only registers real keystrokes. If you set those programmatically the DOM
shows correct values but "Save and preview" rejects all of them with *"This is a
mandatory field."* Fill the 3 fields × N entities with `browser_type` + `slowly: true`
(pressSequentially). Country pickers are react-select: real click → type "United States"
→ Enter.

Doing everything one-field-per-tool-call cost 200+ calls and hit relay drops that killed
the tab. Batch the programmatic fields into a few `browser_evaluate` calls; only the
sub-processor block needs slow typing.

## Native-setter helper (makes React register a value)

```js
const setNativeValue = (el, val) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
```

## Set a radio (real .click() fires React onChange; radios don't toggle off)

```js
const name = 'privacy.ccpa.serviceProvider.isAppServiceProvider';   // the group
const radios = [...document.querySelectorAll(`input[type=radio][name="${name}"]`)];
const yes = radios.find(r => ((r.closest('label')||r.parentElement)?.textContent||'').trim().startsWith('Yes'));
yes.click();
// verify: read radios' .checked back; confirm sibling groups untouched; aria-invalid count == 0
```
Note Atlassian gives all radios in a group the **same `id`** — target by `name`, not `id`.

## Fill an EUD-type chip list (dynamic; "Add more" reveals _1, _2 …)

```js
// step 1: fill _0, then click the nearest following "Add more"
const first = document.querySelector('input[name="privacy.ccpa.serviceProvider.endUserDataTypes_0"]');
setNativeValue(first, "Diagram content and titles created with the app's macros");
const addMore = [...document.querySelectorAll('button')].filter(b=>/add more/i.test(b.textContent||''))
  .find(b => first.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
addMore.click();
// step 2 (separate browser_evaluate — React reveal is async): fill _1
setNativeValue(document.querySelector('input[name="privacy.ccpa.serviceProvider.endUserDataTypes_1"]'),
               "Atlassian account IDs and Confluence content identifiers");
```

## Rich-text permissions justification

It's a ProseMirror editor. Select-all + type over it via real keystrokes, or set via the
editor API; verify the text landed inside a `<p data-prosemirror-node-name="paragraph">`
node, not as raw DOM text.

## Screenshots

`fullPage: true` returns a mostly-blank image — the page scrolls via `document.body`, not
`window`. Scroll with `document.body.scrollTop` (or `el.scrollIntoView({block:'center'})`)
and take per-viewport shots. Save OUTSIDE the git repo (scratchpad); the screenshot tool
may drop files into the repo root — move them and confirm `git status --short` is clean.

## Field-name map (input `name` attributes)

| Question | name |
|---|---|
| Stores EUD outside Atlassian | `dataAccessAndStorage.appStoresEUDOutsideAtlassian` |
| Processes EUD outside Atlassian | `dataAccessAndStorage.appProcessEUDOutsideAtlassian` |
| Processed = stored (checkbox) | `dataAccessAndStorage.isSameDataProcessedAndStored` |
| EUD types stored (chips) | `dataAccessAndStorage.typesOfDataStored_<n>` |
| Custom retention allowed | `dataRetention.isCustomRetentionPeriodAllowed` |
| Stores after uninstall | `dataRetention.*` (min/max day spinbuttons appear after Yes) |
| Shares EUD w/ third parties | `thirdPartyInformation.isEndUserDataShared` |
| Sub-processor entity fields | `thirdPartyInformation.thirdPartyDetails.{name,link,purpose}_<n>` (KEYSTROKES ONLY) |
| Data residency | `dataRetention`/`dataResidency` radio (option text "No. App does not support…") |
| Disk encryption at rest | `security.isDiskEncryptionSupported` |
| Requires PATs | `security.requiresUsersToProvidePATs` |
| GDPR controller | `privacy.gdpr.dataController.isAppDataController` |
| GDPR processor | `privacy.gdpr.dataProcessor.isAppDataProcessor` |
| GDPR processor EUD (chips) | `privacy.gdpr.dataProcessor.endUserDataTypes_<n>` |
| CCPA business | `privacy.ccpa.business.isAppBusiness` |
| CCPA service provider | `privacy.ccpa.serviceProvider.isAppServiceProvider` |
| CCPA service-provider EUD (chips) | `privacy.ccpa.serviceProvider.endUserDataTypes_<n>` |
| EEA transfer | `privacy.gdpr.dataTransfer.isEndUserDataTransferredOutsideEEA` |
| Transfer mechanism adhered | `privacy.gdpr.dataTransfer.isTransferComplianceMechanismsAdhered` |

(Names are stable but confirm with a `browser_evaluate` dump of `input[name]`/`[type=radio]`
before relying on them — Atlassian occasionally revises the form.)
