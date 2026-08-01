import { describe, it, expect } from 'vitest';
import { decideWriteback } from './writebackGate';

// ZenUml/conf-app#170 — the save-handler writeback gate must never attempt
// `view.submit` in a surface that cannot persist a config writeback.
//
// `repairWillPersist = isInserting || isConfiguring` is exactly the set of
// SUBMITTABLE surfaces (the page-editor insert + the native macro-config
// editor — both set context.extension.macro.is{Inserting,Configuring}). The
// in-viewer Edit dialog is a @forge/bridge Modal where BOTH are false; calling
// view.submit there throws "this resource's view is not submittable" and the
// dialog sticks open with no feedback (the #169 incident, second half).
//
// The fix gates the ENTIRE writeback behind repairWillPersist. These tests lock
// BOTH directions: suppression in the modal (no spurious throw) AND — the
// load-bearing one — that legitimate writebacks still fire on insert/configure,
// so gating never silently drops a real id-repair (which would be quiet data
// loss: macro left pointing at a stale id, no `saved`, no telemetry).

const base = {
  inserting: false,
  configuring: false,
  idChanged: false,
  macroNeedsRepair: false,
  legacyMacroNeedsRepair: false,
  hasId: true,
};

describe('decideWriteback (#170 — gate view.submit to submittable surfaces)', () => {
  describe('non-submittable surface (in-viewer Edit modal: inserting=false, configuring=false)', () => {
    it('does NOT write back even when the id changed → falls through to view.close()', () => {
      // THE bug: a legitimate new id (cross-page fork, race duplicate, etc.)
      // in the modal must degrade to a clean close, not a "not submittable" throw.
      const d = decideWriteback({ ...base, idChanged: true });
      expect(d.repairWillPersist).toBe(false);
      expect(d.needsWriteback).toBe(false);
    });

    it('does NOT write back even when an orphan repair is pending', () => {
      const d = decideWriteback({ ...base, idChanged: true, macroNeedsRepair: true });
      expect(d.attemptRepair).toBe(false);
      expect(d.needsWriteback).toBe(false);
    });

    it('does NOT write back even when a legacy migration is pending', () => {
      const d = decideWriteback({ ...base, idChanged: true, legacyMacroNeedsRepair: true });
      expect(d.attemptLegacyMigration).toBe(false);
      expect(d.needsWriteback).toBe(false);
    });
  });

  describe('submittable surfaces — writeback MUST still fire (no regression / no silent drop)', () => {
    it('inserting a fresh macro → writes back', () => {
      const d = decideWriteback({ ...base, inserting: true });
      expect(d.repairWillPersist).toBe(true);
      expect(d.needsWriteback).toBe(true);
    });

    it('configuring with a changed id → writes back', () => {
      const d = decideWriteback({ ...base, configuring: true, idChanged: true });
      expect(d.repairWillPersist).toBe(true);
      expect(d.needsWriteback).toBe(true);
    });

    it('configuring with a pending orphan repair → writes back and flags the repair', () => {
      const d = decideWriteback({ ...base, configuring: true, macroNeedsRepair: true });
      expect(d.attemptRepair).toBe(true);
      expect(d.needsWriteback).toBe(true);
    });

    it('inserting with a pending legacy migration (and an id) → writes back and flags the migration', () => {
      const d = decideWriteback({ ...base, inserting: true, legacyMacroNeedsRepair: true, hasId: true });
      expect(d.attemptLegacyMigration).toBe(true);
      expect(d.needsWriteback).toBe(true);
    });

    it('legacy migration requires an id — no id means no migration flag', () => {
      const d = decideWriteback({ ...base, configuring: true, legacyMacroNeedsRepair: true, hasId: false });
      expect(d.attemptLegacyMigration).toBe(false);
    });
  });
});

describe('decideWriteback — first bind (autoConvert paste)', () => {
  const base = {
    inserting: false,
    configuring: false,
    idChanged: false,
    macroNeedsRepair: false,
    legacyMacroNeedsRepair: false,
    hasId: true,
  }

  it('writes back the first id for a macro that was never inserted through the macro browser', () => {
    // An autoConvert paste creates the ADF node before its editor opens, so
    // Forge reports neither inserting nor an id change. Without this the id is
    // never bound and every save orphans a fresh custom content.
    expect(decideWriteback({ ...base, configuring: true, hasSourceId: false }).needsWriteback).toBe(true)
  })

  it('still refuses on a non-submittable surface, preserving #170', () => {
    // In-viewer Edit modal: inserting and configuring both false. view.submit
    // would throw "view is not submittable".
    expect(decideWriteback({ ...base, hasSourceId: false }).needsWriteback).toBe(false)
  })

  it('does not fire for a macro that already references a custom content', () => {
    expect(decideWriteback({ ...base, configuring: true, hasSourceId: true }).needsWriteback).toBe(false)
  })

  it('does not fire when the save produced no usable id', () => {
    expect(decideWriteback({ ...base, configuring: true, hasId: false, hasSourceId: false }).needsWriteback).toBe(false)
  })

  it('leaves the slash-menu insert path unchanged', () => {
    expect(decideWriteback({ ...base, inserting: true, hasSourceId: false }).needsWriteback).toBe(true)
  })
})
