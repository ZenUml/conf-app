// Decision logic for the save-handler config writeback, extracted from the
// three Forge macro editors (forgeIndex / forge-graph-editor / forge-swagger-editor)
// so it can be unit-tested in isolation — the live gate lives inside a
// setTimeout in an EventBus handler and is untestable in place.
//
// See ZenUml/conf-app#170.

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
  /** the macro already referenced a custom content before this save
   *  (!!originalCustomContentId). False for a macro that has never been saved. */
  hasSourceId?: boolean;
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
  // First bind: the macro had no customContentId and this save produced one.
  // `inserting` covers that for a slash-menu insert, but NOT for a macro that
  // arrived in the ADF some other way — an autoConvert paste
  // (https://confluence.zenuml.com/new/<type>) creates the node before its
  // editor is ever opened, so Forge reports neither inserting nor an id change,
  // every other signal here is false, and the id was never written back.
  // Observed on lite-stg 2026-08-01: three saves of one pasted graph macro
  // produced three version-1 custom contents and an ADF node still carrying no
  // customContentId — i.e. every save orphaned its own content.
  const firstBind = !s.hasSourceId && s.hasId;
  const needsWriteback =
    repairWillPersist && (s.inserting || firstBind || s.idChanged || attemptRepair || attemptLegacyMigration);
  return { repairWillPersist, attemptRepair, attemptLegacyMigration, needsWriteback };
}
