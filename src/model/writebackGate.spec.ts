import { describe, it, expect } from 'vitest';
import { decideWriteback, deriveWritebackSignals } from './writebackGate';
import { DataSource } from './Diagram/Diagram';

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
// Slice 0 of the content-opening unification: the signal DERIVATION was
// triplicated across forgeIndex / forge-graph-editor / forge-swagger-editor,
// and the two editor copies also reimplemented the decision with drifted
// formulas (graph: `inserting || idChanged || attemptRepair ||
// attemptLegacyMigration`, swagger: same minus the legacy term) — both
// missing the #170 repairWillPersist gate on idChanged.
describe('deriveWritebackSignals (slice 0 — one derivation for all editors)', () => {
  const base = {
    inserting: false,
    configuring: false,
    sourceId: '111',
    newId: '111',
    originalCustomContentId: undefined as string | undefined,
    docSource: DataSource.CustomContent as DataSource | string,
    recoveredFromOrphan: false,
  };

  it('THE graph bug: modal surface + forked id must NOT write back', () => {
    // Graph's inline formula returned needsWriteback=true here and called
    // view.submit in a non-submittable surface ("not submittable" throw).
    const d = decideWriteback(deriveWritebackSignals({ ...base, newId: '222' }));
    expect(d.needsWriteback).toBe(false);
  });

  it('insert surface + forked id still writes back (gate must not over-suppress)', () => {
    const d = decideWriteback(deriveWritebackSignals({ ...base, inserting: true, newId: '222' }));
    expect(d.needsWriteback).toBe(true);
  });

  it('the swagger gap: same-page recovery on a submittable surface triggers legacy migration', () => {
    const s = deriveWritebackSignals({ ...base, configuring: true, recoveredFromOrphan: true });
    expect(s.legacyMacroNeedsRepair).toBe(true);
    const d = decideWriteback(s);
    expect(d.attemptLegacyMigration).toBe(true);
    expect(d.needsWriteback).toBe(true);
  });

  it('content-property legacy doc migrates on insert save', () => {
    const s = deriveWritebackSignals({ ...base, inserting: true, docSource: DataSource.ContentProperty });
    expect(s.legacyMacroNeedsRepair).toBe(true);
    expect(decideWriteback(s).attemptLegacyMigration).toBe(true);
  });

  it('orphan-recovered sibling id sets macroNeedsRepair, not idChanged', () => {
    const s = deriveWritebackSignals({ ...base, originalCustomContentId: '999', sourceId: '222', newId: '222' });
    expect(s.macroNeedsRepair).toBe(true);
    expect(s.idChanged).toBe(false);
  });

  it('a recovered doc with a surviving original id is repair, never legacy migration', () => {
    const s = deriveWritebackSignals({ ...base, originalCustomContentId: '999', recoveredFromOrphan: true, newId: '222' });
    expect(s.legacyMacroNeedsRepair).toBe(false);
    expect(s.macroNeedsRepair).toBe(true);
  });

  it('empty newId suppresses hasId and therefore legacy migration', () => {
    const s = deriveWritebackSignals({ ...base, inserting: true, newId: '', docSource: DataSource.ContentProperty });
    expect(s.hasId).toBe(false);
    expect(decideWriteback(s).attemptLegacyMigration).toBe(false);
  });

  it('coerces undefined surface flags to booleans (any-typed Forge context)', () => {
    const s = deriveWritebackSignals({ ...base, inserting: undefined, configuring: undefined, newId: '222' });
    expect(s.inserting).toBe(false);
    expect(s.configuring).toBe(false);
    expect(decideWriteback(s).needsWriteback).toBe(false);
  });
});

// The merge hazard this guards: decideWriteback's firstBind term reads
// hasSourceId, and deriveWritebackSignals is the only producer of it. If the
// derivation stops setting it, hasSourceId goes undefined, firstBind collapses
// to hasId, and every ordinary save from a configuring surface writes back.
describe('deriveWritebackSignals — hasSourceId feeds the first-bind term', () => {
  const base = {
    inserting: false,
    configuring: true,
    sourceId: '',
    newId: '111',
    originalCustomContentId: undefined as string | undefined,
    docSource: DataSource.CustomContent as DataSource | string,
    recoveredFromOrphan: false,
  };

  it('an autoConvert paste has neither id at open — first bind, so write back', () => {
    const s = deriveWritebackSignals(base);
    expect(s.hasSourceId).toBe(false);
    expect(decideWriteback(s).needsWriteback).toBe(true);
  });

  it('a loaded doc counts as a prior binding', () => {
    const s = deriveWritebackSignals({ ...base, sourceId: '111' });
    expect(s.hasSourceId).toBe(true);
    expect(decideWriteback(s).needsWriteback).toBe(false);
  });

  it('a macro-config id counts as a prior binding even with no loaded doc', () => {
    const s = deriveWritebackSignals({ ...base, originalCustomContentId: '999' });
    expect(s.hasSourceId).toBe(true);
  });

  it('is never undefined — that is what makes firstBind collapse to hasId', () => {
    expect(deriveWritebackSignals(base).hasSourceId).not.toBeUndefined();
  });
});
