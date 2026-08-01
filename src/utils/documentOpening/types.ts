// src/utils/documentOpening/types.ts
import { Diagram } from '@/model/Diagram/Diagram';
import type { OrphanDiagramKind } from '@/utils/orphanTelemetry';

// Slice 1 of the content-opening unification
// (docs/superpowers/specs/2026-07-31-content-opening-unification-design.md).
// openDocument covers id resolution + recovery only. Paywall stays a
// caller-side gate (mountPaywallGate.ts) and SWR caching stays inside
// viewerBootstrap.ts until Slice 4 retires that file.

/** 'read' = viewer/dashboard-view (SWR-eligible, cross-page-only copy scan).
 *  'write' = editor (fresh load, full blocking copy scan). */
export type OpenPolicy = 'read' | 'write';

export type TargetSource = 'config' | 'modal';

export interface ResolvedTarget {
  contentId?: string;
  source: TargetSource;
}

export interface LegacyFallbackContext {
  context: any;
  pageId?: string;
}

/**
 * A family-specific recovery step, tried in order after the direct fetch +
 * orphan-sibling recovery both miss. Must stamp `doc.recoveredFromOrphan =
 * true` on any doc it returns and fire its own telemetry — this mirrors
 * exactly what the inline per-family code does today; it is a lift-and-shift,
 * not new behavior.
 */
export type LegacyFallback = (ctx: LegacyFallbackContext) => Promise<Diagram | undefined>;

export interface TargetSpec {
  /**
   * Sync — doubles as the SWR cache key at the caller
   * (viewerBootstrap.ts's `resolveContentId`), so it must resolve the SAME id
   * this does.
   */
  resolveId(context: any): ResolvedTarget | undefined;
  /** Ordered family-specific recovery chain, tried after the direct fetch and
   *  orphan-sibling recovery both miss. */
  legacyFallbacks: LegacyFallback[];
  /**
   * No id at all: 'default-doc' opens `defaultDoc()` (the new-macro case);
   * 'fail' returns `failed`. An id that WAS resolved but every fallback still
   * misses is ALWAYS `failed`, regardless of this setting — that is not a
   * "miss", it's a real resolution failure.
   */
  onMiss: 'default-doc' | 'fail';
  defaultDoc?: () => Diagram;
  /** `reportOrphanObserved`'s `diagramKind` argument. */
  macroType: OrphanDiagramKind;
}

export interface DocumentOrigin {
  contentId?: string;
  source?: TargetSource;
  recoveredFromOrphan: boolean;
  /**
   * The id `resolveId` returned, captured regardless of whether the load
   * needed recovery — feeds `deriveWritebackSignals`'s
   * `originalCustomContentId` (src/model/writebackGate.ts), replacing the
   * editors' module-scope `originalCustomContentId` variable.
   */
  originalCustomContentId?: string;
  /** The page the macro lives on, captured whenever `resolveId` ran — feeds
   *  `reportOrphanMacroRepaired`'s pageId argument on a later save-repair. */
  recoveryPageId?: string;
}

export interface OpenedDocument {
  doc: Diagram;
  origin: DocumentOrigin;
}

export type OpenErrorKind = 'not_found';

export interface OpenError {
  kind: OpenErrorKind;
  customContentId?: string;
}

export type OpenOutcome =
  | { kind: 'opened'; document: OpenedDocument }
  | { kind: 'failed'; error: OpenError };

export interface OpenDocumentOptions {
  policy: OpenPolicy;
  context: any;
  pageId?: string;
  target: TargetSpec;
}
