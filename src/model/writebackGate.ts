// Decision logic for the save-handler config writeback, extracted from the
// three Forge macro editors (forgeIndex / forge-graph-editor / forge-swagger-editor)
// so it can be unit-tested in isolation — the live gate lives inside a
// setTimeout in an EventBus handler and is untestable in place.
//
// See ZenUml/conf-app#170.

import { DataSource } from './Diagram/Diagram';

export interface WritebackSignals {
  /** context.extension.macro.isInserting — page-editor slash-menu insert. */
  inserting: boolean;
  /** context.extension.macro.isConfiguring — native macro-config editor. */
  configuring: boolean;
  /** save returned a custom-content id different from the loaded one. */
  idChanged: boolean;
  /** an orphan-recovery repair is pending (ZEN-1170 Defect 2b). */
  macroNeedsRepair: boolean;
  /** a legacy content-property → custom-content migration is pending (ZEN-1170 Defect 1). */
  legacyMacroNeedsRepair: boolean;
  /** the save produced a usable custom-content id (!!id). */
  hasId: boolean;
}

export interface WritebackDecision {
  /** the current surface can persist a config writeback (view.submit is valid). */
  repairWillPersist: boolean;
  attemptRepair: boolean;
  attemptLegacyMigration: boolean;
  /** fire view.submit when true; otherwise view.close(). */
  needsWriteback: boolean;
}

export function decideWriteback(s: WritebackSignals): WritebackDecision {
  // isInserting / isConfiguring are the ONLY surfaces where view.submit is
  // valid; the in-viewer Edit modal sets neither.
  const repairWillPersist = s.inserting || s.configuring;
  const attemptRepair = repairWillPersist && s.macroNeedsRepair;
  const attemptLegacyMigration = repairWillPersist && s.legacyMacroNeedsRepair && s.hasId;
  // #170: gate the ENTIRE writeback behind repairWillPersist so view.submit is
  // never attempted in a non-submittable surface (the in-viewer Edit modal,
  // where inserting/configuring are both false). A legitimate new id there —
  // cross-page copy (samePage===false), a race duplicate — degrades to a clean
  // view.close() with the local draft preserved as a retry anchor, instead of
  // throwing "this resource's view is not submittable" and sticking the dialog
  // open. On the submittable surfaces (insert/configure) behavior is unchanged.
  const needsWriteback =
    repairWillPersist && (s.inserting || s.idChanged || attemptRepair || attemptLegacyMigration);
  return { repairWillPersist, attemptRepair, attemptLegacyMigration, needsWriteback };
}

// Signal derivation shared by the three macro editors (slice 0 of the
// content-opening unification). Callers pass their own doc handle's fields
// (forgeIndex: store.state.diagram; graph/swagger: window.diagram) captured
// BEFORE any deferred writeback runs.
export interface WritebackDerivationInput {
  inserting: boolean;
  configuring: boolean;
  /** custom-content id loaded into the editor ('' when none). */
  sourceId: string;
  /** id returned by saveToPlatform ('' when save produced none). */
  newId: string;
  /** original macro-config id when orphan recovery loaded a sibling. */
  originalCustomContentId?: string;
  /** DataSource of the doc the editor mounted. */
  docSource?: DataSource | string;
  /** the mounted doc came through the uuid/orphan recovery chain. */
  recoveredFromOrphan?: boolean;
}

export function deriveWritebackSignals(i: WritebackDerivationInput): WritebackSignals {
  return {
    inserting: i.inserting,
    configuring: i.configuring,
    idChanged: !!i.sourceId && !!i.newId && i.newId !== i.sourceId,
    // ZEN-1170 Defect 2b: saved against a recovered sibling id.
    macroNeedsRepair: !!(i.originalCustomContentId && i.newId && i.newId !== i.originalCustomContentId),
    // ZEN-1170 Defect 1 + PR #139 same-page recovery: uuid-only macro whose
    // doc came from a legacy source — stamp customContentId on first save.
    legacyMacroNeedsRepair:
      !i.originalCustomContentId &&
      (i.docSource === DataSource.ContentProperty ||
        i.docSource === DataSource.ContentPropertyOld ||
        (i.docSource === DataSource.CustomContent && !!i.recoveredFromOrphan)),
    hasId: !!i.newId,
  };
}
