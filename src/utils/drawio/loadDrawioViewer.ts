/**
 * Lazy-load DrawIO viewer scripts for Graph macro / embed surfaces only.
 *
 * Previously every `main` resource iframe parsed viewer-static.min.js and shape
 * scripts from index.html before forgeIndex routed to the correct viewer. This
 * module moves that boot path behind an explicit call so Sequence, Mermaid,
 * PlantUML, and OpenAPI surfaces avoid the DrawIO script tax.
 */

const DRAWIO_COMMON_CSS_ID = 'drawio-common-css';

const VIEWER_SCRIPTS = [
  'drawio/js/viewer-static.min.js',
  'drawio/shapes/mxBasic.js',
  'drawio/shapes/mxAWS3D.js',
  'drawio/shapes/mxAWS4.js',
] as const;

let loading: Promise<void> | null = null;
let loaded = false;

function resolveDrawioAsset(path: string): string {
  return new URL(path, document.baseURI).href;
}

function parseUrlParams(url: string): Record<string, string> {
  const result: Record<string, string> = {};
  const idx = url.lastIndexOf('?');
  if (idx <= 0) return result;

  const params = url.substring(idx + 1).split('&');
  for (let i = 0; i < params.length; i++) {
    const eq = params[i].indexOf('=');
    if (eq > 0) {
      result[params[i].substring(0, eq)] = params[i].substring(eq + 1);
    }
  }
  return result;
}

function configureDrawioGlobals(): void {
  const w = window as typeof window & {
    mxLoadStylesheets?: boolean;
    mxLoadResources?: boolean;
    mxBasePath?: string;
    uiTheme?: string;
    SHAPES_PATH?: string;
    STENCIL_PATH?: string;
    IMAGE_PATH?: string;
    STYLE_PATH?: string;
    urlParams?: Record<string, string>;
  };

  w.mxLoadStylesheets = false;
  w.mxLoadResources = false;
  w.mxBasePath = './drawio/mxgraph/';
  w.uiTheme = '';
  w.SHAPES_PATH = './drawio/shapes';
  w.STENCIL_PATH = './drawio/stencils';
  w.IMAGE_PATH = './drawio/images';
  w.STYLE_PATH = './drawio/styles';
  w.urlParams = parseUrlParams(window.location.href);
}

function ensureDrawioStylesheet(): void {
  if (document.getElementById(DRAWIO_COMMON_CSS_ID)) return;

  const link = document.createElement('link');
  link.id = DRAWIO_COMMON_CSS_ID;
  link.rel = 'stylesheet';
  link.href = resolveDrawioAsset('drawio/mxgraph/css/common.css');
  document.head.appendChild(link);
}

function loadScript(src: string): Promise<void> {
  const absoluteSrc = resolveDrawioAsset(src);
  const existing = document.querySelector(`script[src="${absoluteSrc}"]`);
  if (existing) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = absoluteSrc;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load DrawIO script: ${src}`));
    document.head.appendChild(script);
  });
}

function registerDrawioStencilLibraries(): void {
  const w = window as typeof window & {
    mxStencilRegistry?: {
      allowEval: boolean;
      libraries: Record<string, string[]>;
    };
    SHAPES_PATH?: string;
    STENCIL_PATH?: string;
  };

  if (typeof w.mxStencilRegistry === 'undefined') return;

  w.mxStencilRegistry.allowEval = false;

  const L = w.mxStencilRegistry.libraries;
  const SHAPES_PATH = w.SHAPES_PATH!;
  const STENCIL_PATH = w.STENCIL_PATH!;

  L['arrows2'] = [SHAPES_PATH + '/mxArrows.js'];
  L['atlassian'] = [STENCIL_PATH + '/atlassian.xml', SHAPES_PATH + '/mxAtlassian.js'];
  L['bpmn'] = [SHAPES_PATH + '/mxBasic.js', STENCIL_PATH + '/bpmn.xml', SHAPES_PATH + '/bpmn/mxBpmnShape2.js'];
  L['bpmn2'] = [SHAPES_PATH + '/mxBasic.js', STENCIL_PATH + '/bpmn.xml', SHAPES_PATH + '/bpmn/mxBpmnShape2.js'];
  L['c4'] = [SHAPES_PATH + '/mxC4.js'];
  L['cisco19'] = [SHAPES_PATH + '/mxCisco19.js', STENCIL_PATH + '/cisco19.xml'];
  L['dfd'] = [SHAPES_PATH + '/mxDFD.js'];
  L['er'] = [SHAPES_PATH + '/er/mxER.js'];
  L['kubernetes'] = [SHAPES_PATH + '/mxKubernetes.js', STENCIL_PATH + '/kubernetes.xml'];
  L['flowchart'] = [SHAPES_PATH + '/mxFlowchart.js', STENCIL_PATH + '/flowchart.xml'];
  L['lean_mapping'] = [SHAPES_PATH + '/mxLeanMap.js', STENCIL_PATH + '/lean_mapping.xml'];
  L['basic'] = [SHAPES_PATH + '/mxBasic.js', STENCIL_PATH + '/basic.xml'];
  L['floorplan'] = [SHAPES_PATH + '/mxFloorplan.js', STENCIL_PATH + '/floorplan.xml'];
  L['bootstrap'] = [SHAPES_PATH + '/mxBootstrap.js', SHAPES_PATH + '/mxBasic.js', STENCIL_PATH + '/bootstrap.xml'];
  L['gmdl'] = [SHAPES_PATH + '/mxGmdl.js', STENCIL_PATH + '/gmdl.xml'];
  L['gcp2'] = [SHAPES_PATH + '/mxGCP2.js', STENCIL_PATH + '/gcp2.xml'];
  L['ibm'] = [SHAPES_PATH + '/mxIBM.js', STENCIL_PATH + '/ibm.xml'];
  L['cabinets'] = [SHAPES_PATH + '/mxCabinets.js', STENCIL_PATH + '/cabinets.xml'];
  L['archimate'] = [SHAPES_PATH + '/mxArchiMate.js'];
  L['archimate3'] = [SHAPES_PATH + '/mxArchiMate3.js'];
  L['sysml'] = [SHAPES_PATH + '/mxSysML.js'];
  L['eip'] = [SHAPES_PATH + '/mxEip.js', STENCIL_PATH + '/eip.xml'];
  L['networks'] = [SHAPES_PATH + '/mxNetworks.js', STENCIL_PATH + '/networks.xml'];
  L['aws3'] = [STENCIL_PATH + '/aws3.xml'];
  L['aws3d'] = [SHAPES_PATH + '/mxAWS3D.js', STENCIL_PATH + '/aws3d.xml'];
  L['aws4'] = [SHAPES_PATH + '/mxAWS4.js', STENCIL_PATH + '/aws4.xml'];
  L['aws4b'] = [SHAPES_PATH + '/mxAWS4.js', STENCIL_PATH + '/aws4.xml'];
  L['android'] = [SHAPES_PATH + '/mxAndroid.js', STENCIL_PATH + '/android/android.xml'];
  L['ios'] = [SHAPES_PATH + '/mockup/mxMockupiOS.js'];
  L['ios7icons'] = [STENCIL_PATH + '/ios7/icons.xml'];
  L['ios7ui'] = [SHAPES_PATH + '/ios7/mxIOS7Ui.js', STENCIL_PATH + '/ios7/misc.xml'];
  L['infographic'] = [SHAPES_PATH + '/mxInfographic.js'];
  L['rackGeneral'] = [SHAPES_PATH + '/rack/mxRack.js', STENCIL_PATH + '/rack/general.xml'];
  L['rackF5'] = [STENCIL_PATH + '/rack/f5.xml'];
}

export function isDrawioViewerLoaded(): boolean {
  const w = window as typeof window & { GraphViewer?: unknown };
  return loaded && typeof w.GraphViewer !== 'undefined';
}

export function ensureDrawioViewerLoaded(): Promise<void> {
  if (isDrawioViewerLoaded()) return Promise.resolve();
  if (loading) return loading;

  loading = (async () => {
    ensureDrawioStylesheet();
    configureDrawioGlobals();

    for (const src of VIEWER_SCRIPTS) {
      await loadScript(src);
    }

    registerDrawioStencilLibraries();

    const w = window as typeof window & { GraphViewer?: unknown };
    if (typeof w.GraphViewer === 'undefined') {
      throw new Error('DrawIO viewer scripts loaded but GraphViewer is unavailable');
    }

    loaded = true;
  })().catch((error) => {
    loading = null;
    throw error;
  });

  return loading;
}
