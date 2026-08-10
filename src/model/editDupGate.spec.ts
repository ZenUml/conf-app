import { describe, it, expect } from 'vitest';
import { decideEditDupGate, decidePublishBlock } from './editDupGate';

// The in-viewer Edit gate must block BEFORE the modal opens when the macro's
// customContentId is shared by >1 macro on the page (view-fork silent-orphan
// bug: save forks a new CC, the modal cannot write the id back — #170 — and
// the edit strands in an unreferenced record). Both directions are load-
// bearing: blocking the duplicate AND never blocking the normal unique macro.

describe('decideEditDupGate', () => {
  it('opens for macros with no customContentId (nothing shareable)', () => {
    expect(decideEditDupGate({ hasId: false, count: undefined }))
      .toEqual({ openEditor: true, outcome: 'no_id' });
  });

  it('fail-opens when the ADF scan threw — transient errors must not lock Edit', () => {
    expect(decideEditDupGate({ hasId: true, count: undefined }))
      .toEqual({ openEditor: true, outcome: 'scan_failed' });
  });

  it('opens for the normal unique reference (count 1)', () => {
    expect(decideEditDupGate({ hasId: true, count: 1 }))
      .toEqual({ openEditor: true, outcome: 'passed', count: 1 });
  });

  it('opens for a draft-only binding (count 0, ZEN-#169) — not a duplicate', () => {
    expect(decideEditDupGate({ hasId: true, count: 0 }))
      .toEqual({ openEditor: true, outcome: 'passed', count: 0 });
  });

  it('blocks when the id is shared by 2 macros on the page', () => {
    expect(decideEditDupGate({ hasId: true, count: 2 }))
      .toEqual({ openEditor: false, outcome: 'blocked', count: 2 });
  });

  it('blocks for any count > 1', () => {
    expect(decideEditDupGate({ hasId: true, count: 7 }))
      .toEqual({ openEditor: false, outcome: 'blocked', count: 7 });
  });
});

// The editor-side backstop: a copy-flagged doc in a NON-submittable surface
// (neither inserting nor configuring — writebackGate.ts) must disable Publish;
// in the submittable surfaces the fork+writeback is the intended copy-repair
// flow and must never be blocked.

describe('decidePublishBlock', () => {
  const dupDoc = { isCopy: true, copyReason: 'same-page-duplicate' as const };
  const crossDoc = { isCopy: true, copyReason: 'cross-page' as const };
  const cleanDoc = { isCopy: false, copyReason: undefined };

  it('blocks a same-page duplicate in the in-viewer modal (not inserting/configuring)', () => {
    expect(decidePublishBlock({ ...dupDoc, inserting: false, configuring: false }))
      .toBe('same-page-duplicate');
  });

  it('blocks a cross-page copy in a non-submittable surface (staleness-CTA path)', () => {
    expect(decidePublishBlock({ ...crossDoc, inserting: false, configuring: false }))
      .toBe('cross-page');
  });

  it('never blocks the native macro-config editor — fork+writeback is the repair flow', () => {
    expect(decidePublishBlock({ ...dupDoc, inserting: false, configuring: true })).toBeNull();
    expect(decidePublishBlock({ ...crossDoc, inserting: false, configuring: true })).toBeNull();
  });

  it('never blocks inserting a new macro', () => {
    expect(decidePublishBlock({ ...dupDoc, inserting: true, configuring: false })).toBeNull();
  });

  it('never blocks a clean (non-copy) doc anywhere', () => {
    expect(decidePublishBlock({ ...cleanDoc, inserting: false, configuring: false })).toBeNull();
  });

  it('ignores isCopy without a reason (defensive: no reason → no block)', () => {
    expect(decidePublishBlock({ isCopy: true, copyReason: undefined, inserting: false, configuring: false }))
      .toBeNull();
  });
});
