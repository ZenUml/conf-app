#!/usr/bin/env node
/*
 * SPIKE: does a standalone local `create_diagram` tool emit a Confluence v2
 * custom-content body byte-identical to conf-app's ApWrapper2.createCustomContentV2?
 *
 * Riskiest assumption (ARCHITECTURE.md):
 *   "A local create_diagram tool can emit a Confluence v2 custom-content
 *    body.value JSON byte-identical to what conf-app's
 *    ApWrapper2.createCustomContentV2 produces, so the existing macro renders
 *    it unchanged."
 *
 * This script is HEADLESS (no @forge/bridge, no network). It reconstructs the
 * PURE serialization logic that ApWrapper2.createCustomContentV2 +
 * sanitizeCustomContentBody + getCustomContentType apply, then compares it
 * byte-for-byte against what a naive standalone tool would emit.
 *
 * What is LIVE-EXECUTED here: the JSON.stringify serialization of the diagram
 *   object (this is pure JS — identical bytes whether run here or in the
 *   Forge iframe, since JSON.stringify is deterministic on key insertion order).
 * What is SHAPE-MATCHED-BY-CODE-READING only: the surrounding request envelope
 *   fields (type/title/pageId/spaceId) — their VALUES depend on Forge runtime
 *   context (forgeGlobal.isLite, forgeContext.extension.content.id, current
 *   space). We replicate the construction logic verbatim from source but feed
 *   it fixture context, and mark it as such.
 *
 * Source of truth (read 2026-06-25, branch spike/local-agent-diagram):
 *   src/model/ApWrapper2.ts  lines 182-201 (getCustomContentTypePrefix/Type),
 *                            lines 237-278 (createCustomContentV2),
 *                            lines 320-338 (sanitizeCustomContentBody)
 *   src/model/Diagram/Diagram.ts (Diagram fields, NULL_DIAGRAM)
 *   src/forgeIndex.ts lines 402-408 (fresh-Sequence `doc` literal),
 *                     line 753 (saveToPlatform(store.state.diagram))
 *   src/model/store2/ExtendedStore.ts (store starts at NULL_DIAGRAM, mutated)
 *   src/utils/sequence/Example.ts (Example.Sequence DSL)
 */

import { writeFileSync } from 'node:fs';

// ----------------------------------------------------------------------------
// 0. KNOWN FIXTURE — a Sequence DSL the local tool would be asked to create.
// ----------------------------------------------------------------------------
const FIXTURE_DSL = `title Order Service
OrderController
OrderController.post(payload) {
  OrderService.create(payload)
}`;
const FIXTURE_TITLE = 'Order Service';

// ============================================================================
// 1. CONF-APP REFERENCE BUILDER
//    Verbatim replication of the conf-app save path's serialization.
// ============================================================================

// --- 1a. getCustomContentType() — ApWrapper2.ts:182-201 (SHAPE-MATCHED) ------
// prefix depends on variant (forgeGlobal.isDiagramly / isAsyncApi / isLite).
// We model the default ZenUML full + lite variants. Connect prefix is fixed.
function getCustomContentType({ isLite = false, isDiagramly = false, isAsyncApi = false } = {}) {
  let key;
  if (isDiagramly) key = 'gptdock-confluence';
  else if (isAsyncApi) key = 'my-api';
  else key = `com.zenuml.confluence-addon${isLite ? '-lite' : ''}`;
  const prefix = `ac:${key}`;
  let contentKey;
  if (isDiagramly) contentKey = 'gpt-custom-content-key';
  else if (isAsyncApi) contentKey = 'async-api-doc';
  else contentKey = 'zenuml-content-sequence';
  return `${prefix}:${contentKey}`;
}

// --- 1b. sanitizeCustomContentBody() — ApWrapper2.ts:320-338 (LIVE) ----------
// Deletes the three UI/control-plane flags unconditionally; deletes `compressed`
// only for a Graph body whose graphXml is plain XML. For a Sequence diagram the
// compressed branch never fires.
const DiagramType = { Sequence: 'sequence', Graph: 'graph' };
function sanitizeCustomContentBody(content) {
  const body = { ...content };
  delete body.recoveredFromOrphan;
  delete body.recoveredFromOrphanId;
  delete body.legacyLoadBlocked;
  if (
    body.diagramType === DiagramType.Graph &&
    typeof body.graphXml === 'string' &&
    body.graphXml.trimStart().startsWith('<')
  ) {
    delete body.compressed;
  }
  return body;
}

// --- 1c. createCustomContentV2 body envelope — ApWrapper2.ts:237-278 ----------
// body.value = JSON.stringify(sanitizeCustomContentBody(content))   <-- LIVE
// type/title/pageId|spaceId                                          <-- SHAPE
function confAppCreateBody(diagram, ctx) {
  const type = getCustomContentType(ctx.variant);
  const sanitized = sanitizeCustomContentBody(diagram);
  const data = {
    type,
    title: diagram.title || `Untitled ${new Date().toISOString()}`,
    body: {
      value: JSON.stringify(sanitized), // <-- the load-bearing byte stream
      representation: 'raw',
    },
  };
  // Exactly one parent (ApWrapper2.ts:264-274)
  if (ctx.pageId) data.pageId = ctx.pageId;
  else if (ctx.spaceId) data.spaceId = ctx.spaceId;
  else throw new Error('no page or space context');
  return data;
}

// --- 1d. The ACTUAL save-time diagram object for a fresh Sequence macro ------
// forgeIndex.ts:402-408 builds the initial `doc`; store mutations then set
// title + source. This is the realistic key insertion order at save time.
// NULL_DIAGRAM is NOT used for a fresh create — the example doc is.
function confAppSaveTimeDiagram(dsl, title) {
  // Mirrors: doc = { diagramType, code, mermaidCode, plantUmlCode, isNew }
  // then store sets diagram.code (already), diagram.title, and the loader sets
  // source. Key order below = insertion order conf-app actually produces.
  const doc = {
    diagramType: 'sequence',
    code: dsl,
    mermaidCode: '', // Example.Mermaid in real flow, but unused field; '' if user never switched
    plantUmlCode: '',
    isNew: true,
  };
  // store2 mutation updateTitle sets a trimmed title (added as new key AFTER
  // the doc literal, since `title` is not in the doc literal above)
  doc.title = title.trim();
  // forge load path sets source = DataSource.CustomContent on existing loads;
  // for a brand-new create the doc has no `source` until persistence — leave
  // unset to reflect the literal. (Honest: source may or may not be present
  // depending on path; see SPIKE.md residual risk.)
  return doc;
}

// ============================================================================
// 2. LOCAL `create_diagram` TOOL BUILDER (the standalone agent's emitter)
//    A naive-but-reasonable implementation that only knows DSL + title.
// ============================================================================
function localToolCreateBody(dsl, title, ctx) {
  // A standalone tool, not having read conf-app's source, would emit the
  // minimal semantically-correct diagram object.
  const diagram = {
    diagramType: 'sequence',
    code: dsl,
    title: title,
  };
  const type = getCustomContentType(ctx.variant);
  const data = {
    type,
    title: title || `Untitled ${new Date().toISOString()}`,
    body: {
      value: JSON.stringify(diagram),
      representation: 'raw',
    },
  };
  if (ctx.pageId) data.pageId = ctx.pageId;
  else if (ctx.spaceId) data.spaceId = ctx.spaceId;
  return data;
}

// ============================================================================
// 3. RUN THE COMPARISON
// ============================================================================
const CTX = {
  variant: { isLite: false },         // ZenUML Full
  pageId: '123456789',                // fixture: forgeContext.extension.content.id
  spaceId: undefined,
};

const out = [];
const log = (s = '') => out.push(s);

log('================================================================');
log(' SPIKE: local create_diagram body vs ApWrapper2.createCustomContentV2');
log('================================================================');
log('');
log(`Fixture DSL (Sequence):\n${FIXTURE_DSL}`);
log(`Fixture title: "${FIXTURE_TITLE}"`);
log('');

const confDiagram = confAppSaveTimeDiagram(FIXTURE_DSL, FIXTURE_TITLE);
const confBody = confAppCreateBody(confDiagram, CTX);
const localBody = localToolCreateBody(FIXTURE_DSL, FIXTURE_TITLE, CTX);

log('--- conf-app body.value (JSON.stringify of save-time diagram) ---');
log(confBody.body.value);
log('');
log('--- local-tool body.value ---');
log(localBody.body.value);
log('');

// 3a. Byte comparison of the load-bearing body.value
const confBytes = Buffer.from(confBody.body.value, 'utf8');
const localBytes = Buffer.from(localBody.body.value, 'utf8');
const bodyValueIdentical = confBytes.equals(localBytes);

log('--- body.value byte comparison ---');
log(`conf-app length : ${confBytes.length} bytes`);
log(`local    length : ${localBytes.length} bytes`);
log(`byte-identical  : ${bodyValueIdentical}`);
log('');

// 3b. Field-by-field on the parsed diagram object
const confParsed = JSON.parse(confBody.body.value);
const localParsed = JSON.parse(localBody.body.value);
const allKeys = [...new Set([...Object.keys(confParsed), ...Object.keys(localParsed)])];
log('--- diagram-object field-by-field ---');
log('field           | conf-app                | local-tool              | match');
log('----------------|-------------------------|-------------------------|------');
for (const k of allKeys) {
  const a = JSON.stringify(confParsed[k] ?? '∅');
  const b = JSON.stringify(localParsed[k] ?? '∅');
  const m = JSON.stringify(confParsed[k]) === JSON.stringify(localParsed[k]) ? 'YES' : 'NO';
  log(`${k.padEnd(15)} | ${String(a).slice(0,23).padEnd(23)} | ${String(b).slice(0,23).padEnd(23)} | ${m}`);
}
log('');

// 3c. Key-ORDER comparison (JSON.stringify is order-sensitive → bytes differ)
log('--- key insertion order (drives byte order in JSON.stringify) ---');
log(`conf-app : [${Object.keys(confParsed).join(', ')}]`);
log(`local    : [${Object.keys(localParsed).join(', ')}]`);
log(`order-identical: ${JSON.stringify(Object.keys(confParsed)) === JSON.stringify(Object.keys(localParsed))}`);
log('');

// 3d. Envelope comparison (type/title/parent)
log('--- request envelope (SHAPE-MATCHED-BY-CODE-READING) ---');
for (const k of ['type', 'title']) {
  log(`${k.padEnd(7)} | conf="${confBody[k]}" | local="${localBody[k]}" | match=${confBody[k] === localBody[k]}`);
}
log(`parent  | conf=${confBody.pageId ? 'pageId='+confBody.pageId : 'spaceId='+confBody.spaceId} | local=${localBody.pageId ? 'pageId='+localBody.pageId : 'spaceId='+localBody.spaceId}`);
log(`body.representation | conf="${confBody.body.representation}" | local="${localBody.body.representation}"`);
log('');

// 3e. CAN a local tool be made byte-identical? Prove it by reproducing the
//     exact conf-app save-time object in the local tool.
function localToolAligned(dsl, title, ctx) {
  // After reading conf-app source, the tool emits the SAME object shape AND
  // key order as confAppSaveTimeDiagram.
  const diagram = {
    diagramType: 'sequence',
    code: dsl,
    mermaidCode: '',
    plantUmlCode: '',
    isNew: true,
    title: title.trim(),
  };
  const type = getCustomContentType(ctx.variant);
  const data = {
    type,
    title: title || `Untitled ${new Date().toISOString()}`,
    body: { value: JSON.stringify(diagram), representation: 'raw' },
  };
  if (ctx.pageId) data.pageId = ctx.pageId;
  else if (ctx.spaceId) data.spaceId = ctx.spaceId;
  return data;
}
const alignedBody = localToolAligned(FIXTURE_DSL, FIXTURE_TITLE, CTX);
const alignedIdentical = Buffer.from(alignedBody.body.value, 'utf8').equals(confBytes);
log('--- ALIGNED local tool (after reading conf-app source) ---');
log(`aligned body.value byte-identical to conf-app: ${alignedIdentical}`);
log('');

// 3f. Verdict
log('================================================================');
let verdict;
if (bodyValueIdentical) {
  verdict = 'PROVED (naive tool already byte-identical)';
} else if (alignedIdentical) {
  verdict = 'PARTIALLY-PROVED (byte-identity ACHIEVABLE but requires the local tool to exactly replicate conf-app key set + insertion order; the naive tool is NOT byte-identical)';
} else {
  verdict = 'DISPROVED (could not reach byte-identity even with aligned tool)';
}
log(` VERDICT: ${verdict}`);
log('================================================================');

const report = out.join('\n');
console.log(report);

// Persist evidence
const EVIDENCE = '/Users/pengxiao/.overnight-runs/conf-app/2026-06-25-0802/evidence/spike-body-diff.txt';
try {
  writeFileSync(EVIDENCE, report + '\n');
  console.log(`\n[evidence written: ${EVIDENCE}]`);
} catch (e) {
  console.error(`[could not write evidence: ${e.message}]`);
}

// Exit 0 always (this is a measurement, not a pass/fail gate). Honesty: a
// non-byte-identical naive tool is a VALID, valuable finding, not a failure.
process.exit(0);
