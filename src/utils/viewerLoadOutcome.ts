import globals from '@/model/globals';
import forgeGlobal from '@/model/globals/forgeGlobal';
import { Diagram, DiagramType, NULL_DIAGRAM, getDiagramData } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import type { DiagramLoadError, ViewerLoadState } from '@/model/store2/types';
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage';
import { serializeError } from '@/utils/window';
import { decompress } from '@/utils/compress';

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

export function publishLoadedDiagram(doc: Diagram | undefined): Diagram {
  const diagram = normalizeCompressedGraphDoc(doc) ?? NULL_DIAGRAM;
  store.state.diagram = diagram;
  // Signal load completion (success OR failure — `doc` is undefined when the
  // referenced content 404s/failed to load). The embed viewer uses this to show
  // a terminal error rather than an endless "Loading embedded diagram…".
  store.state.diagramLoadComplete = true;
  window.diagram = diagram;
  console.log('loadDiagram - window.diagram', window.diagram);
  return diagram;
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

export function applyViewerLoadOutcome(input: ViewerLoadOutcomeInput): Diagram {
  if (!globals.apWrapper.isDisplayMode()) {
    setViewerLoadState(null, null);
    return publishLoadedDiagram(input.doc);
  }

  const outcome = classifyViewerLoadOutcome(input);
  setViewerLoadState(outcome.state, outcome.loadError);
  return publishLoadedDiagram(outcome.diagram);
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
