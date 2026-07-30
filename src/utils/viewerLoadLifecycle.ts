import type { MacroTypeValue, ContentSource } from '@/utils/analytics/catalog';
import { trackViewerLoadOutcome } from '@/utils/analytics/trackRenderTime';
import * as renderPerf from '@/utils/analytics/renderPerf';
import { decompress } from '@/utils/compress';
import type { Diagram } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import {
  getCachedContent,
  hashContent,
  putCachedContent,
  removeCachedContent,
  type ViewerContentIdentity,
} from '@/utils/renderCache/contentCacheStore';
import type {
  ViewerRenderCompletion,
  ViewerRenderReporter,
} from '@/utils/viewerRenderReporter';
import {
  initialViewerLoadState,
  type ViewerEmptyReason,
  type ViewerFailureReason,
  type ViewerLoadState,
} from '@/utils/viewerLoadState';

export type ViewerTargetResolution<TTarget> =
  | {
      status: 'loadable';
      target: TTarget;
      cacheIdentity?: ViewerContentIdentity;
    }
  | { status: 'empty'; reason: ViewerEmptyReason }
  | { status: 'failed'; reason: ViewerFailureReason };

export interface ViewerContentAdapter<TContext, TTarget> {
  resolve(context: TContext): Promise<ViewerTargetResolution<TTarget>>;
  load(target: TTarget): Promise<Diagram | undefined>;
}

export interface ViewerLoadLifecycleOptions<TContext, TTarget> {
  macroType: MacroTypeValue;
  initializeContext?: () => Promise<void>;
  getContext: () => Promise<TContext>;
  adapter: ViewerContentAdapter<TContext, TTarget>;
  mount: (doc: Diagram, reporter: ViewerRenderReporter) => void | Promise<void>;
  /** Dedicated viewers mount a stable shell on a cache miss. */
  loadingDocument?: Diagram;
  /** Evaluate/mount a dedicated-viewer paywall shell before cache access. */
  mountLoadingBeforeCache?: boolean;
  /** Optional mount deferral such as the Sequence viewport gate. */
  beforeMount?: () => void | Promise<void>;
  afterFreshLoad?: (doc: Diagram, target: TTarget) => void | Promise<void>;
  onError?: (error: unknown, reason: ViewerFailureReason) => void;
  isDisplayMode?: boolean;
}

export interface ViewerLoadSession {
  readonly reporter: ViewerRenderReporter;
  readonly state: ViewerLoadState;
}

interface PublishedRevision {
  revision: number;
  source: ContentSource;
}

interface PendingRenderFailure extends PublishedRevision {
  error?: unknown;
}

/**
 * Normalize legacy compressed Graph content at the single publication
 * boundary. The raw value remains in the SWR cache so its hash is comparable
 * with the next source-of-truth response.
 */
export function normalizeViewerDocument(doc: Diagram): Diagram {
  if (doc.compressed && doc.graphXml && !doc.graphXml.startsWith('<mxGraphModel')) {
    return { ...doc, graphXml: decompress(doc.graphXml), compressed: false };
  }
  return doc;
}

class ViewerLoadSessionImplementation<TContext, TTarget> implements ViewerLoadSession {
  private currentState: ViewerLoadState = initialViewerLoadState();
  private currentRevision?: PublishedRevision;
  private currentDocument?: Diagram;
  private nextRevision = 1;
  private mounted = false;
  private mounting?: Promise<boolean>;
  private terminalTracked = false;
  private revalidationPending = false;
  private pendingRenderFailure?: PendingRenderFailure;

  readonly reporter: ViewerRenderReporter = {
    captureRevision: () => this.currentRevision?.revision ?? 0,
    rendered: (revision, completion) => this.rendered(revision, completion),
    failed: (revision, error) => this.renderFailed(revision, error),
  };

  constructor(private readonly options: ViewerLoadLifecycleOptions<TContext, TTarget>) {
    this.setState(initialViewerLoadState());
  }

  get state(): ViewerLoadState {
    return this.currentState;
  }

  async start(): Promise<void> {
    let context: TContext;
    try {
      await this.options.initializeContext?.();
      context = await this.options.getContext();
    } catch (error) {
      this.fail('context', error);
      return;
    }

    let resolution: ViewerTargetResolution<TTarget>;
    try {
      resolution = await this.options.adapter.resolve(context);
    } catch (error) {
      this.fail('target_resolution', error);
      return;
    }

    if (resolution.status !== 'loadable') {
      if (!(await this.mountLoadingDocument())) return;
      if (resolution.status === 'empty') {
        this.empty(resolution.reason);
      } else {
        this.fail(resolution.reason);
      }
      return;
    }

    const { target, cacheIdentity } = resolution;
    if (this.options.mountLoadingBeforeCache && !(await this.mountLoadingDocument())) return;
    const cached = getCachedContent(cacheIdentity);
    if (cached) {
      let cachedDocument: Diagram | undefined;
      try {
        const parsed = JSON.parse(cached.doc) as Diagram;
        if (!parsed || typeof parsed !== 'object') throw new Error('cached document is not an object');
        cachedDocument = normalizeViewerDocument(parsed);
      } catch (error) {
        removeCachedContent(cacheIdentity);
        console.warn('[content-swr] corrupt cache ignored; falling back to fetch', error);
      }
      if (cachedDocument) {
        this.revalidationPending = true;
        // Invoke load before publication/mount. This is intentionally not
        // awaited: revalidation must start even when beforeMount defers an
        // offscreen Sequence renderer.
        void this.revalidate(target, cacheIdentity, cached.hash);
        await this.publish(cachedDocument, 'swr_cache');
        return;
      }
    }

    if (!(await this.mountLoadingDocument())) return;
    await this.loadFresh(target, cacheIdentity);
  }

  private async mountLoadingDocument(): Promise<boolean> {
    if (!this.options.loadingDocument) return true;
    return this.ensureMounted(this.options.loadingDocument);
  }

  private async loadFresh(
    target: TTarget,
    cacheIdentity: ViewerContentIdentity | undefined,
  ): Promise<void> {
    let document: Diagram | undefined;
    try {
      document = await renderPerf.time('fetch', () => this.options.adapter.load(target));
    } catch (error) {
      this.fail('content_load', error);
      return;
    }

    if (!document) {
      this.empty('content_not_found');
      return;
    }

    const serialized = this.serializeForCache(document);
    if (serialized !== undefined) putCachedContent(cacheIdentity, serialized);
    renderPerf.markContentSource('fetch');
    await this.publish(document, 'fetch');
    this.runAfterFreshLoad(document, target);
  }

  private async revalidate(
    target: TTarget,
    cacheIdentity: ViewerContentIdentity | undefined,
    cachedHash: string,
  ): Promise<void> {
    let changed = false;
    try {
      const fresh = await renderPerf.time('fetch', () => this.options.adapter.load(target));
      if (fresh) {
        const serialized = this.serializeForCache(fresh);
        if (serialized !== undefined) putCachedContent(cacheIdentity, serialized);
        this.runAfterFreshLoad(fresh, target);
        if (serialized === undefined || hashContent(serialized) !== cachedHash) {
          changed = true;
          renderPerf.markContentSource('fetch');
          await this.publish(fresh, 'fetch');
        }
      }
    } catch (error) {
      console.warn('[content-swr] background revalidate failed; cached render stands', error);
    } finally {
      this.revalidationPending = false;
      if (!changed) this.finishPendingRenderFailure();
    }
  }

  private runAfterFreshLoad(document: Diagram, target: TTarget): void {
    if (!this.options.afterFreshLoad) return;
    try {
      Promise.resolve(this.options.afterFreshLoad(document, target)).catch((error) => {
        console.warn('[viewer-load] afterFreshLoad failed', error);
      });
    } catch (error) {
      console.warn('[viewer-load] afterFreshLoad failed', error);
    }
  }

  private serializeForCache(document: Diagram): string | undefined {
    try {
      return JSON.stringify(document);
    } catch (error) {
      console.warn('[content-swr] document is not serializable; cache write skipped', error);
      return undefined;
    }
  }

  private async publish(rawDocument: Diagram, source: ContentSource): Promise<void> {
    const document = normalizeViewerDocument(rawDocument);
    const published = { revision: this.nextRevision++, source };
    this.currentRevision = published;
    this.currentDocument = document;
    this.pendingRenderFailure = undefined;
    this.setState({ status: 'rendering', ...published });
    // Publication precedes mount so a synchronously-completing Graph renderer
    // captures the right revision and immutable source.
    store.state.diagram = document;
    window.diagram = document;
    renderPerf.markContentSource(source);
    await this.ensureMounted(document);
  }

  private async ensureMounted(fallbackDocument: Diagram): Promise<boolean> {
    if (this.mounted) return true;
    if (!this.mounting) {
      this.mounting = (async () => {
        await this.options.beforeMount?.();
        await this.options.mount(this.currentDocument ?? fallbackDocument, this.reporter);
        this.mounted = true;
        return true;
      })().catch((error) => {
        const revision = this.currentRevision?.revision;
        if (revision !== undefined) {
          this.renderFailed(revision, error);
        } else {
          this.fail('render', error);
        }
        return false;
      });
    }
    return this.mounting;
  }

  private rendered(revision: number, completion?: ViewerRenderCompletion): void {
    const current = this.currentRevision;
    if (!current || current.revision !== revision) return;
    this.pendingRenderFailure = undefined;
    this.setState({ status: 'rendered', ...current });
    this.trackTerminal('rendered', current.source, completion);
  }

  private renderFailed(revision: number, error?: unknown): void {
    const current = this.currentRevision;
    if (!current || current.revision !== revision) return;
    if (current.source === 'swr_cache' && this.revalidationPending) {
      this.pendingRenderFailure = { ...current, error };
      return;
    }
    this.fail('render', error, current.source);
  }

  private finishPendingRenderFailure(): void {
    const pending = this.pendingRenderFailure;
    const current = this.currentRevision;
    if (!pending || !current || current.revision !== pending.revision) return;
    this.pendingRenderFailure = undefined;
    this.fail('render', pending.error, pending.source);
  }

  private empty(reason: ViewerEmptyReason): void {
    this.setState({ status: 'empty', reason });
    this.trackTerminal('empty');
  }

  private fail(
    reason: ViewerFailureReason,
    error?: unknown,
    source?: ContentSource,
  ): void {
    this.setState({ status: 'failed', reason });
    if (error !== undefined) this.options.onError?.(error, reason);
    this.trackTerminal('failed', source);
  }

  private trackTerminal(
    outcome: 'rendered' | 'empty' | 'failed',
    contentSource?: ContentSource,
    completion?: ViewerRenderCompletion,
  ): void {
    if (this.terminalTracked) return;
    this.terminalTracked = true;
    trackViewerLoadOutcome(
      this.options.macroType,
      this.options.isDisplayMode ?? true,
      {
        outcome,
        ...(contentSource !== undefined ? { contentSource } : {}),
        ...(completion?.renderMode !== undefined
          ? { renderMode: completion.renderMode }
          : {}),
        ...(completion?.cacheSource !== undefined
          ? { cacheSource: completion.cacheSource }
          : {}),
      },
    );
  }

  private setState(state: ViewerLoadState): void {
    this.currentState = state;
    store.state.viewerLoadState = state;
  }
}

export async function runViewerLoadLifecycle<TContext, TTarget>(
  options: ViewerLoadLifecycleOptions<TContext, TTarget>,
): Promise<ViewerLoadSession> {
  const session = new ViewerLoadSessionImplementation(options);
  await session.start();
  return session;
}
