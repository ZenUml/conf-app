/**
 * Debug-bundle service.
 *
 * Pure functions that collect identity + editor + saved-history data and
 * serialise a JSON bundle the user downloads via the viewer ⋯ menu.
 * See docs/superpowers/specs/2026-05-20-debug-bundle-download-design.md.
 */

import { DiagramType } from '@/model/Diagram/Diagram';
import { getCodeFromDiagram } from '@/model/Diagram/DiagramTypeConfig';

export interface AppVersion {
  gitHash: string;
  gitBranch: string;
  gitTag: string;
}

export interface IdentitySection {
  cloudId: string | null;
  hostname: string;
  clientDomain: string | null;
  pageId: string | null;
  customContentId: string | null;
  macroUuid: string | null;
  diagramType: DiagramType | string;
  productType: 'lite' | 'full' | 'diagramly' | string;
  environmentType: string | null;
  appVersion: AppVersion;
  userAgent: string;
  viewport: { w: number; h: number };
}

export interface EditorSection {
  active: string;
  byteLength: number;
  sha256: string;
}

export interface SavedVersion {
  versionNumber: number;
  createdAt: string | null;
  body: unknown;
  active: string | null;
  byteLength: number;
  sha256: string | null;
}

export interface BundleError {
  section: string;
  message: string;
}

export interface DebugBundle {
  bundleVersion: 1;
  capturedAt: string;
  identity: IdentitySection;
  editor: EditorSection;
  saved: { latest: SavedVersion | null; previous: SavedVersion[] };
  errors: BundleError[];
}

/** Minimal API the service depends on — passed in so tests can mock it. */
export interface DebugBundleDeps {
  apRequest: (url: string) => Promise<any>;
  getCustomContentId: () => Promise<string | null>;
  getMacroUuid: () => Promise<string | null>;
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// hashing + byte length
// ---------------------------------------------------------------------------

async function sha256Hex(s: string): Promise<string> {
  // Node test envs ship crypto.subtle in Node 20+; browsers always have it.
  const bytes = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

// ---------------------------------------------------------------------------
// collectors
// ---------------------------------------------------------------------------

export async function collectIdentity(
  diagramType: DiagramType | string,
  deps: Pick<DebugBundleDeps, 'getCustomContentId' | 'getMacroUuid'>,
): Promise<IdentitySection> {
  const fg = (typeof window !== 'undefined' && (window as any).forgeGlobal) || {};
  const ctx = fg.forgeContext || {};
  const ext = ctx.extension || {};

  // The Forge context exposes cloudId on the top-level ctx; older builds had
  // it nested. Tolerate both shapes — if neither carries it, leave it null and
  // let support engineers identify the tenant from hostname.
  const cloudId =
    ctx.cloudId
    ?? ctx.siteId
    ?? null;

  const hostname = (typeof window !== 'undefined' && window.location?.hostname) || '';

  // Strip the .atlassian.net suffix so this matches the Mixpanel/KV form.
  const clientDomain = hostname && hostname.endsWith('.atlassian.net')
    ? hostname.slice(0, -'.atlassian.net'.length)
    : null;

  const pageId = ext?.content?.id ? String(ext.content.id) : null;

  const customContentId = await safe(() => deps.getCustomContentId(), null);
  const macroUuid       = await safe(() => deps.getMacroUuid(),       null);

  const env = (import.meta as any).env ?? {};
  return {
    cloudId,
    hostname,
    clientDomain,
    pageId,
    customContentId,
    macroUuid,
    diagramType,
    productType: (env.PRODUCT_TYPE as string) || 'unknown',
    environmentType: ctx.environmentType ?? null,
    appVersion: {
      gitHash:   env.VITE_APP_GIT_HASH   || '',
      gitBranch: env.VITE_APP_GIT_BRANCH || '',
      gitTag:    env.VITE_APP_GIT_TAG    || '',
    },
    userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
    viewport: {
      w: typeof window !== 'undefined' ? window.innerWidth  : 0,
      h: typeof window !== 'undefined' ? window.innerHeight : 0,
    },
  };
}

export async function collectEditorContent(
  _diagramType: DiagramType | string,
  active: string,
): Promise<EditorSection> {
  return {
    active: active || '',
    byteLength: utf8ByteLength(active || ''),
    sha256: await sha256Hex(active || ''),
  };
}

/**
 * V2 customContent bodies wrap the diagram payload as a JSON string at
 * body.raw.value. Parse it and extract the active code field per diagramType
 * via the same helper the viewer uses for the Source panel's Copy, so the
 * bundle's saved.active is byte-identical to what we'd otherwise have shown.
 */
export function extractActiveField(body: any, diagramType: DiagramType | string): string | null {
  try {
    const raw = body?.raw?.value;
    if (typeof raw !== 'string') return null;
    const diagram = JSON.parse(raw);
    return getCodeFromDiagram(diagram, diagramType as DiagramType) || '';
  } catch {
    return null;
  }
}

async function readVersion(
  apRequest: (url: string) => Promise<any>,
  contentId: string,
  versionNumber: number,
  diagramType: DiagramType | string,
): Promise<SavedVersion> {
  const url = `/api/v2/custom-content/${contentId}?version=${versionNumber}&body-format=raw`;
  const data = await apRequest(url);
  const active = extractActiveField(data?.body, diagramType);
  return {
    versionNumber,
    createdAt: data?.version?.createdAt ?? data?.createdAt ?? null,
    body: data?.body ?? null,
    active,
    byteLength: active ? utf8ByteLength(active) : 0,
    sha256: active ? await sha256Hex(active) : null,
  };
}

export async function fetchContentHistory(
  contentId: string,
  diagramType: DiagramType | string,
  n: number,
  deps: Pick<DebugBundleDeps, 'apRequest'>,
): Promise<{ latest: SavedVersion | null; previous: SavedVersion[]; errors: BundleError[] }> {
  const errors: BundleError[] = [];

  let latest: SavedVersion | null = null;
  let latestVersionNumber: number | null = null;
  try {
    const head = await deps.apRequest(`/api/v2/custom-content/${contentId}?body-format=raw`);
    latestVersionNumber = head?.version?.number ?? head?.latestVersionNumber ?? head?.versionNumber ?? null;
    if (latestVersionNumber == null) {
      errors.push({ section: 'saved.latest', message: 'missing latest version number in response' });
    } else {
      const active = extractActiveField(head?.body, diagramType);
      latest = {
        versionNumber: latestVersionNumber,
        createdAt: head?.version?.createdAt ?? head?.createdAt ?? null,
        body: head?.body ?? null,
        active,
        byteLength: active ? utf8ByteLength(active) : 0,
        sha256: active ? await sha256Hex(active) : null,
      };
    }
  } catch (err: any) {
    errors.push({ section: 'saved.latest', message: String(err?.message ?? err) });
  }

  const previous: SavedVersion[] = [];
  if (latestVersionNumber != null) {
    const wanted = Math.max(0, n - 1);
    for (let i = 1; i <= wanted; i++) {
      const v = latestVersionNumber - i;
      if (v < 1) break;
      try {
        previous.push(await readVersion(deps.apRequest, contentId, v, diagramType));
      } catch (err: any) {
        errors.push({ section: `saved.previous[${i - 1}]`, message: String(err?.message ?? err) });
      }
    }
  }

  return { latest, previous, errors };
}

// ---------------------------------------------------------------------------
// assembly + filename + download
// ---------------------------------------------------------------------------

export function assembleBundle(args: {
  identity: IdentitySection;
  editor: EditorSection;
  history: { latest: SavedVersion | null; previous: SavedVersion[]; errors: BundleError[] };
  now?: Date;
}): DebugBundle {
  return {
    bundleVersion: 1,
    capturedAt: (args.now ?? new Date()).toISOString(),
    identity: args.identity,
    editor: args.editor,
    saved: { latest: args.history.latest, previous: args.history.previous },
    errors: args.history.errors,
  };
}

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

export function buildFilename(identity: IdentitySection, now: Date = new Date()): string {
  const stamp =
    `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}` +
    `-${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}`;
  const page = identity.pageId ?? 'unknown';
  const cc   = identity.customContentId ? identity.customContentId.slice(-6) : 'new';
  return `zenuml-debug-${page}-${cc}-${stamp}.json`;
}

export function downloadAsFile(bundle: DebugBundle, filename: string): void {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke; some browsers race the click otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---------------------------------------------------------------------------
// public entrypoint
// ---------------------------------------------------------------------------

export async function buildAndDownloadDebugBundle(
  args: {
    diagram: any;
    diagramType: DiagramType | string;
  },
  deps: DebugBundleDeps,
): Promise<{ bundle: DebugBundle; filename: string; serialisedSize: number }> {
  const identity = await collectIdentity(args.diagramType, deps);
  const active   = (getCodeFromDiagram(args.diagram, args.diagramType as DiagramType) ?? '') as string;
  const editor   = await collectEditorContent(args.diagramType, active);

  let history: { latest: SavedVersion | null; previous: SavedVersion[]; errors: BundleError[] };
  if (identity.customContentId) {
    history = await fetchContentHistory(identity.customContentId, args.diagramType, 4, deps);
  } else {
    history = {
      latest: null,
      previous: [],
      errors: [{ section: 'saved', message: 'no customContentId (new macro or non-customContent source)' }],
    };
  }

  const now = (deps.now ?? (() => new Date()))();
  const bundle = assembleBundle({ identity, editor, history, now });
  const filename = buildFilename(identity, now);
  const serialised = JSON.stringify(bundle, null, 2);
  downloadAsFile(bundle, filename);
  return { bundle, filename, serialisedSize: serialised.length };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
