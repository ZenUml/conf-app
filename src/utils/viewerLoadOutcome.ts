import globals from '@/model/globals';
import forgeGlobal from '@/model/globals/forgeGlobal';
import { Diagram, DiagramType, NULL_DIAGRAM, getDiagramData } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import type { DiagramLoadError, ViewerLoadState } from '@/model/store2/types';
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage';
import { serializeError } from '@/utils/window';
import { decompress } from '@/utils/compress';
import type { DiagramAttribution } from '@/model/DiagramAttribution';

/**
 * Legacy Connect-era graph/DrawIO macros persisted graphXml as LZUTF8-Base64
 * with `compressed: true`. The customContentId load path (ApWrapper2's
 * JSON.parse) preserved that flag without decompressing, so the still-
 * compressed string reached the store and ForgeGraphViewer's
 * `mxUtils.parseXml(<base64>)` threw → blank canvas (the error is swallowed).
 * The content-property recovery path already decompresses inline; this
 * normalizes the customContentId path too, at the single store-write boundary,
 * so the store always holds plain <mxGraphModel> XML regardless of load path.
 *
 * Returns a NEW object when it decompresses, leaving the caller's `doc`
 * reference compressed so afterLoad's compressed_* telemetry still fires on it.
 * No-op for plain XML and for non-graph docs (`compressed` is undefined).
 */
function normalizeCompressedGraphDoc(doc: Diagram | undefined): Diagram | undefined {
  if (doc?.compressed && doc.graphXml && !doc.graphXml.startsWith('<mxGraphModel')) {
    return { ...doc, graphXml: decompress(doc.graphXml), compressed: false };
  }
  return doc;
}

export function publishLoadedDiagram(doc: Diagram | undefined, loadError?: DiagramLoadError | null): Diagram {
  const normalized = normalizeCompressedGraphDoc(doc) ?? NULL_DIAGRAM;
  // Attach the load error to the published diagram as well as the store slots
  // below: components that receive the diagram as a `doc` PROP rather than
  // reading the store (OpenApiViewer in the embed host / editor preview)
  // key their own terminal state off `diagram.loadError`. Persistence strips
  // it (sanitizeCustomContentBody) so it can never round-trip into storage.
  const diagram = loadError ? { ...normalized, loadError } : normalized;
  store.state.diagram = diagram;
  // Signal load completion (success OR failure — `doc` is undefined when the
  // referenced content 404s/failed to load). The embed viewer uses this to show
  // a terminal error rather than an endless "Loading embedded diagram…".
  store.state.diagramLoadComplete = true;
  window.diagram = diagram;
  console.log('loadDiagram - window.diagram', window.diagram);
  return diagram;
}

/** Viewer-only metadata; Diagram itself is persisted custom-content data. */
export function publishDiagramAttribution(attribution: DiagramAttribution | null | undefined): void {
  store.state.diagramAttribution = attribution ?? null;
}

export type { DiagramLoadError, ViewerLoadState };

export interface ViewerLoadOutcomeInput {
  doc?: Diagram;
  customContentId?: string;
  loadError?: DiagramLoadError | null;
  macroKind?: MacroKind;
}

export interface ViewerLoadOutcome {
  state: Exclude<ViewerLoadState, null | 'loading'>;
  diagram: Diagram;
  loadError: DiagramLoadError | null;
}

export function getForgeCustomContentId(): string | undefined {
  const extension = forgeGlobal.forgeContext?.extension;
  return extension?.config?.customContentId ?? extension?.modal?.customContentId;
}

export function isDisplayableDiagram(
  doc: Diagram | undefined,
  macroKind?: MacroKind,
): boolean {
  if (!doc) {
    return false;
  }
  if (doc.legacyLoadBlocked) {
    return false;
  }

  const coreData = getDiagramData(doc)?.trim();
  if (coreData) {
    return true;
  }

  if (macroKind === 'graph' && doc.graphXml?.trim()) {
    return true;
  }
  if (macroKind === 'openapi' && doc.code?.trim()) {
    return true;
  }
  if (macroKind === 'embed') {
    return Boolean(
      doc.code?.trim()
      || doc.graphXml?.trim()
      || doc.mermaidCode?.trim()
      || doc.plantUmlCode?.trim(),
    );
  }

  // Doc was fetched and parsed (known type) but has empty content — treat as a
  // blank-but-valid diagram so the viewer shows an empty canvas instead of the
  // error panel. Only NULL_DIAGRAM (Unknown type) should trigger failure.
  if (doc.diagramType !== DiagramType.Unknown) {
    return true;
  }

  return false;
}

export function classifyViewerLoadOutcome(
  input: ViewerLoadOutcomeInput,
): ViewerLoadOutcome {
  const customContentId = input.customContentId ?? getForgeCustomContentId();
  const loadError = input.loadError ?? null;

  // A loader may retain the fetched document for diagnostics/compatibility
  // while explicitly reporting that the requested representation is invalid
  // (for example, a Board macro whose independent document is missing or
  // malformed). An explicit load error must win over displayability; otherwise
  // a valid legacy graphXml would mask the requested Board failure.
  if (loadError) {
    return {
      state: customContentId ? 'failed_with_source' : 'failed_without_source',
      diagram: input.doc ?? NULL_DIAGRAM,
      loadError,
    };
  }

  if (isDisplayableDiagram(input.doc, input.macroKind)) {
    return {
      state: 'ready',
      diagram: input.doc!,
      loadError: null,
    };
  }

  if (customContentId) {
    return {
      state: 'failed_with_source',
      diagram: input.doc ?? NULL_DIAGRAM,
      loadError,
    };
  }

  return {
    state: 'failed_without_source',
    diagram: input.doc ?? NULL_DIAGRAM,
    loadError,
  };
}

export function setViewerLoadState(state: ViewerLoadState, loadError: DiagramLoadError | null = null): void {
  store.state.viewerLoadState = state;
  store.state.loadError = loadError;
}

/**
 * Classify and publish the load state for a sequence-family doc that's
 * ALREADY known-renderable — it's what mounted on screen — rather than one
 * just returned from a fetch. Extracted so forgeIndex.ts's content-SWR
 * `mountSequenceViewer` (the single call site shared by both the cache-hit
 * render and the background-revalidate remount) has a testable unit for the
 * 2026-08-19 fix: that function used to mount the doc without ever calling
 * setViewerLoadState, leaving store.state.viewerLoadState stuck at its
 * initial `null` for ~66% of sequence-family viewer views (see the "BUG FIX"
 * comment on mountSequenceViewer). Classifies with the same
 * isDisplayableDiagram check classifyViewerLoadOutcome uses, rather than
 * hardcoding 'ready', so a blank/unrenderable cached doc still reports
 * 'failed_with_source'.
 */
export function setSequenceViewerLoadState(doc: Diagram): void {
  setViewerLoadState(isDisplayableDiagram(doc, 'sequence') ? 'ready' : 'failed_with_source');
}

export function applyViewerLoadOutcome(input: ViewerLoadOutcomeInput): Diagram {
  if (!globals.apWrapper.isDisplayMode()) {
    setViewerLoadState(null, null);
    return publishLoadedDiagram(input.doc);
  }

  const outcome = classifyViewerLoadOutcome(input);
  setViewerLoadState(outcome.state, outcome.loadError);
  return publishLoadedDiagram(outcome.diagram, outcome.loadError);
}

// Boundary adapter: the openDocument pipeline's OpenError (documentOpening/
// types.ts — {kind, customContentId?, indeterminate}) → the store-level
// DiagramLoadError this module classifies on. openDocument compresses HTTP
// detail away, so httpStatus/errorCode stay undefined here; `indeterminate`
// (forbidden/5xx/malformed — content may still exist) maps to 'other_error',
// a confirmed clean 404 to 'not_found'. Keeps ONE error vocabulary in the
// store/panel layer while the pipeline keeps its own contract.
export function mapOpenErrorToLoadError(error: {
  kind: 'not_found';
  customContentId?: string;
  indeterminate: boolean;
}): DiagramLoadError {
  return {
    directFetchStatus: error.indeterminate ? 'other_error' : 'not_found',
    errorClass: 'structured',
  };
}

export function mapThrownViewerLoadError(error: unknown): DiagramLoadError {
  const httpStatus = extractHttpStatus(error);
  return {
    errorClass: 'thrown',
    errorCode: serializeError(error).slice(0, 200),
    httpStatus,
    directFetchStatus: httpStatus === 404 ? 'not_found' : httpStatus ? 'other_error' : undefined,
  };
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const candidate = error as {
    status?: number;
    statusCode?: number;
    xhr?: { status?: number };
  };
  return candidate.status ?? candidate.statusCode ?? candidate.xhr?.status;
}

export function mapCustomContentLoadError(loaded: {
  directFetchStatus?: 'ok' | 'not_found' | 'other_error';
  directFetchHttpStatus?: number;
  directFetchErrorCode?: string;
  directFetchErrorClass?: 'thrown' | 'structured' | 'malformed';
}): DiagramLoadError | null {
  if (
    loaded.directFetchStatus === undefined
    && loaded.directFetchHttpStatus === undefined
    && loaded.directFetchErrorCode === undefined
    && loaded.directFetchErrorClass === undefined
  ) {
    return null;
  }
  return {
    directFetchStatus: loaded.directFetchStatus,
    httpStatus: loaded.directFetchHttpStatus,
    errorCode: loaded.directFetchErrorCode,
    errorClass: loaded.directFetchErrorClass,
  };
}
