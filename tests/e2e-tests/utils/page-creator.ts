import { Page } from '@playwright/test';
import { testConfig } from '../config/test-config.js';
import type { RenderMacroType } from '../config/apps.js';
import { withLock } from './api-lock.js';
import {
  FORGE_MACROS_QUERY,
  forgeMacroNode,
  legacyMacroNode,
  selectForgeIdentity,
  type ForgeExtensionRow,
  type ForgeIdentity,
} from './forge-extension.js';

/** One emoji per diagram/macro kind (stable set for E2E page titles).
 *  Keyed on RenderMacroType, not MacroType: this class builds pages through the
 *  REST API and `MacroOptions` below carries exactly these five. AsyncAPI has no
 *  API-created form — its document is authored in Studio — so requiring an entry
 *  for it would be a key nothing can ever look up. */
const MACRO_EMOJI: Record<RenderMacroType, string> = {
  sequence: '💬',
  graph: '📐',
  openapi: '🔌',
  embed: '🧩',
  mermaid: '🌊',
};

interface MacroOptions {
  sequence?: boolean | { bodyOnly?: boolean };
  graph?: boolean;
  openapi?: boolean;
  embed?: boolean;
  mermaid?: boolean;
  /**
   * Write the bare macro key that pages migrated from the Connect app carry,
   * instead of the full Forge key of the environment under test. Refused when
   * the site has more than one environment of the app installed, because
   * Confluence then picks one of them itself (see utils/forge-extension.ts).
   * Check legacyMacroKeyUsable() first.
   */
  legacyMacroKey?: boolean;
}

/** One macro on the test page, before it is written as a Forge or a legacy node. */
interface MacroSpec {
  moduleKey: string;
  title: string;
  uuid: string;
  customContentId?: string;
  bodyContent?: string;
  updatedAt: string;
}

interface CustomContent {
  id: string;
  title: string;
}

export class PageCreator {
  private page: Page;

  private forgeMacros?: Promise<ForgeExtensionRow[]>;

  constructor(page: Page) {
    this.page = page;
  }

  /** The Forge install of the app under test that exposes the sequence macro. */
  async forgeIdentity(): Promise<ForgeIdentity> {
    return selectForgeIdentity(await this.listForgeMacros(), {
      appId: testConfig.forgeAppId,
      moduleKey: testConfig.sequenceMacroKey,
      environmentKey: testConfig.forgeEnvironment,
    });
  }

  /** True when a bare macro key can only resolve to the environment under test. */
  async legacyMacroKeyUsable(): Promise<boolean> {
    // Unpinned profiles write bare keys anyway; nothing to compare against.
    if (!testConfig.pinForgeKey) return true;
    return (await this.forgeIdentity()).environmentCount === 1;
  }

  // The query the editor's macro browser runs. The gateway answers a cookie
  // request without an Origin header with 403 (observed 2026-11-23), so send it.
  private listForgeMacros(): Promise<ForgeExtensionRow[]> {
    this.forgeMacros ??= (async () => {
      const origin = `https://${testConfig.domain}`;
      const tenant = await this.page.request.get(`${origin}/_edge/tenant_info`);
      if (!tenant.ok()) throw new Error(`tenant_info failed (${tenant.status()})`);
      const { cloudId } = await tenant.json();
      const response = await this.page.request.post(`${origin}/gateway/api/graphql`, {
        headers: { 'Content-Type': 'application/json', Origin: origin, Referer: `${origin}/wiki/` },
        data: {
          operationName: 'E2EForgeMacros',
          query: FORGE_MACROS_QUERY,
          variables: { cloudId, context: { spaceKey: testConfig.spaceKey }, types: ['xen:macro'], includeHidden: false },
        },
      });
      const body = await response.json().catch(() => ({}));
      const rows = body?.data?.confluence_forgeExtensionsByType;
      if (!response.ok() || !Array.isArray(rows)) {
        throw new Error(`Forge macro lookup failed (${response.status()}): ${JSON.stringify(body?.errors ?? body).slice(0, 500)}`);
      }
      return rows as ForgeExtensionRow[];
    })();
    return this.forgeMacros;
  }

  private get addonKey(): string {
    return testConfig.addonKey;
  }

  // Custom content type is derived from profile-specific keys
  // This matches the behavior in src/model/ApWrapper2.ts getContentKey()
  private get customContentType(): string {
    return `ac:${this.addonKey}:${testConfig.customContentKey}`;
  }

  async createTestPage(options: MacroOptions): Promise<string> {
    const title = this.buildPageTitle(options);

    // Serialize entire page creation to prevent overwhelming Confluence
    return await withLock(async () => {

      const space = await this.getSpace(testConfig.spaceKey);
      const draftPage = await this.createDraft(space.id, title);

      return await this.createPageContent(draftPage, options, title, space.id);
    });
  }

  private async createPageContent(draftPage: any, options: MacroOptions, title: string, spaceId: string): Promise<string> {

    try {
      // Create custom content for each macro type
      // All types use zenuml-content-sequence as the content key (see ApWrapper2.getContentKey())
      const [sequence, graph, openapi, embed, mermaid] = await Promise.all([
        options.sequence && this.createCustomContent(`Sequence custom content of page ${title}`, this.getDemoSequenceContent(), draftPage.id),
        options.graph && this.createCustomContent(`Graph custom content of page ${title}`, this.getDemoGraphContent(), draftPage.id),
        options.openapi && this.createCustomContent(`OpenAPI custom content of page ${title}`, this.getDemoOpenAPIContent(), draftPage.id),
        options.embed && this.createCustomContent(`Embed custom content of page ${title}`, this.getDemoSequenceContent(), draftPage.id),
        options.mermaid && this.createCustomContent(`Mermaid custom content of page ${title}`, this.getDemoMermaidContent(), draftPage.id)
      ]);

      // Create page content with proper macro structure
      const pageContent = await this.buildPageContent(options);
      const body = JSON.stringify(pageContent)
        .replaceAll('$$_SEQUENCE_CONTENT_ID', sequence?.id || '')
        .replaceAll('$$_GRAPH_CONTENT_ID', graph?.id || '')
        .replaceAll('$$_OPENAPI_CONTENT_ID', openapi?.id || '')
        .replaceAll('$$_EMBED_CONTENT_ID', embed?.id || '')
        .replaceAll('$$_MERMAID_CONTENT_ID', mermaid?.id || '');

      // Update page with final content
      const updateData = {
        id: draftPage.id,
        status: 'current',
        title,
        spaceId,
        body: { value: body, representation: 'atlas_doc_format' },
        version: { number: draftPage.version.number }
      };

      const finalPage = await this.updatePage(draftPage.id, updateData);
      return finalPage.id;
    } catch (error) {
      console.error('createTestPage error', error);
      await this.deletePage(draftPage.id);
      throw error;
    }
  }

  async deletePage(pageId: string): Promise<void> {
    try {
      await this.page.request.delete(`https://${testConfig.domain}/wiki/api/v2/pages/${pageId}`);
    } catch (error) {
      console.error('deletePage error', error);
    }
  }

  private async getSpace(spaceKey: string): Promise<any> {
    const response = await this.page.request.get(`https://${testConfig.domain}/wiki/api/v2/spaces?keys=${spaceKey}`);
    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`getSpace failed (${response.status()}): ${body}`);
    }
    const data = await response.json();
    const space = data.results?.[0];
    if (!space) {
      throw new Error(`Space "${spaceKey}" not found on ${testConfig.domain}. Response: ${JSON.stringify(data)}`);
    }
    return space;
  }

  private async createDraft(spaceId: string, title: string): Promise<any> {
    const response = await this.page.request.post(`https://${testConfig.domain}/wiki/api/v2/pages`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        spaceId,
        status: 'draft',
        title,
        body: { value: '', representation: 'storage' }
      }
    });
    return response.json();
  }

  private async createCustomContent(title: string, body: any, containerId: string): Promise<CustomContent> {
    const response = await this.page.request.post(`https://${testConfig.domain}/wiki/api/v2/custom-content`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        type: this.customContentType,
        title,
        pageId: containerId,
        body: { value: JSON.stringify(body), representation: 'raw' }
      }
    });
    return response.json();
  }

  private async updatePage(id: string, data: any): Promise<any> {
    const response = await this.page.request.put(`https://${testConfig.domain}/wiki/api/v2/pages/${id}`, {
      headers: { 'Content-Type': 'application/json' },
      data
    });
    return response.json();
  }

  private async buildPageContent(options: MacroOptions): Promise<any> {
    const content = { type: 'doc', content: [] as any[], version: 1 };
    const specs: MacroSpec[] = [];

    if (options.sequence) {
      const spec = this.getSequenceSpec();
      if (typeof options.sequence === 'object' && options.sequence.bodyOnly) delete spec.customContentId;
      specs.push(spec);
    }
    if (options.graph) specs.push(this.getGraphSpec());
    if (options.openapi) specs.push(this.getOpenAPISpec());
    if (options.embed) specs.push(this.getEmbedSpec());
    if (options.mermaid) specs.push(this.getMermaidSpec());

    if (!testConfig.pinForgeKey) {
      for (const spec of specs) content.content.push(this.legacyNode(spec));
      return content;
    }
    const identity = await this.forgeIdentity();
    // A body-only macro has no Forge form: its body lives in Connect macro params.
    const bodyOnly = typeof options.sequence === 'object' && !!options.sequence.bodyOnly;
    if ((options.legacyMacroKey || bodyOnly) && identity.environmentCount !== 1) {
      throw new Error(
        `A bare macro key is ambiguous on ${testConfig.domain}: ${identity.environmentCount} environments of app ${identity.appId} are installed. Check legacyMacroKeyUsable() first.`,
      );
    }
    for (const spec of specs) {
      content.content.push(options.legacyMacroKey || bodyOnly ? this.legacyNode(spec) : this.forgeNode(identity, spec));
    }
    return content;
  }

  private forgeNode(identity: ForgeIdentity, spec: MacroSpec) {
    const guestParams: Record<string, string> = { uuid: spec.uuid, updatedAt: spec.updatedAt };
    if (spec.customContentId) guestParams.customContentId = spec.customContentId;
    return forgeMacroNode(identity, spec.moduleKey, guestParams, this.generateLocalId());
  }

  private legacyNode(spec: MacroSpec) {
    const macroParams: Record<string, { value: string }> = { uuid: { value: spec.uuid } };
    if (spec.customContentId) macroParams.customContentId = { value: spec.customContentId };
    if (spec.bodyContent !== undefined) macroParams.__bodyContent = { value: spec.bodyContent };
    macroParams.updatedAt = { value: spec.updatedAt };
    return legacyMacroNode(spec.moduleKey, spec.title, macroParams);
  }

  private generateLocalId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `e2e-${this.generateUUID()}`;
  }

  private getModuleKeySuffix(): string {
    return testConfig.isLite ? '-lite' : '';
  }

  /** Compact UTC stamp for titles (avoids `Date`’s long default string with TZ name). */
  private titleTimestamp(): string {
    return new Date().toISOString().slice(0, 16).replace('T', ' ');
  }

  private activeMacroTypes(options: MacroOptions): RenderMacroType[] {
    const out: RenderMacroType[] = [];
    if (options.sequence) out.push('sequence');
    if (options.graph) out.push('graph');
    if (options.openapi) out.push('openapi');
    if (options.embed) out.push('embed');
    if (options.mermaid) out.push('mermaid');
    return out;
  }

  /**
   * Keeps the contiguous substring `E2E test page at` for scripts/filters (e.g. archive_pages.js).
   */
  private buildPageTitle(options: MacroOptions): string {
    const macros = this.activeMacroTypes(options);
    const emojiRun = macros.map((m) => MACRO_EMOJI[m]).join('');
    const macroSlug = macros.length ? macros.join('+') : 'unknown';
    const product = testConfig.productType;
    const ts = this.titleTimestamp();
    const suf = this.titleSuffix();
    const prefix = emojiRun ? `${emojiRun} · ` : '';
    return `E2E test page at ${prefix}${product} · ${macroSlug} · ${ts} - ${suf}`;
  }

  /** Short disambiguator for page titles only (macros still use `generateUUID`). */
  private titleSuffix(): string {
    let s = '';
    while (s.length < 3) {
      s += Math.random().toString(36).slice(2);
    }
    return s.slice(0, 3);
  }

  private generateUUID(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private getDemoSequenceContent() {
    return {
      title: 'Order Service (Demonstration only)',
      code: `title Order Service (Demonstration only)
// Styling participants with background colors is an experimental feature.
@Actor Client #FFEBE6
@Boundary OrderController #0747A6
@EC2 <<BFF>> OrderService #E3FCEF
group BusinessService {
  @Lambda PurchaseService
  @AzureFunction InvoiceService
}

@Starter(Client)
//\`POST /orders\`
OrderController.post(payload) {
  OrderService.create(payload) {
    order = new Order(payload)
    if(order != null) {
      par {
        PurchaseService.createPO(order)
        InvoiceService.createInvoice(order)      
      }      
    }
  }
}`,
      mermaidCode: 'graph TD; A-->B;',
      diagramType: 'sequence'
    };
  }

  private getDemoGraphContent() {
    return {
      diagramType: 'graph',
      graphXml: `<mxGraphModel dx="1426" dy="694" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169"><root><mxCell id="WIyWlLk6GJQsqaUBKTNV-0"/><mxCell id="WIyWlLk6GJQsqaUBKTNV-1" parent="WIyWlLk6GJQsqaUBKTNV-0"/><mxCell id="WIyWlLk6GJQsqaUBKTNV-3" value="Lamp doesn't work" style="rounded=1;whiteSpace=wrap;html=1;fontSize=12;glass=0;strokeWidth=1;shadow=0;" parent="WIyWlLk6GJQsqaUBKTNV-1" vertex="1"><mxGeometry x="160" y="80" width="120" height="40" as="geometry"/></mxCell></root></mxGraphModel>`
    };
  }

  private getDemoOpenAPIContent() {
    return {
      title: '',
      code: `openapi: 3.0.0
info:
  title: Sample API
  description: Optional multiline or single-line description
  version: 0.1.9
servers:
  - url: http://api.example.com/v1
    description: Main (production) server
paths:
  /users:
    get:
      summary: Returns a list of users.
      responses:
        '200':
          description: A JSON array of user names
          content:
            application/json:
              schema:
                type: array
                items:
                  type: string`,
      styles: '',
      mermaidCode: '',
      source: 'CustomContent'
    };
  }

  private getDemoMermaidContent() {
    return {
      title: 'Order Service (Demonstration only)',
      code: 'title Order Service (Demonstration only)',
      mermaidCode: `gantt
    title A Gantt Diagram
    dateFormat  YYYY-MM-DD
    section Section
    A task           :a1, 2014-01-01, 30d
    Another task     :after a1  , 20d
    section Another
    Task in sec      :2014-01-12  , 12d
    another task      : 24d`,
      diagramType: 'mermaid'
    };
  }

  private getSequenceSpec(): MacroSpec {
    return {
      moduleKey: testConfig.sequenceMacroKey,
      title: 'ZenUML Diagram',
      uuid: this.generateUUID(),
      customContentId: '$$_SEQUENCE_CONTENT_ID',
      bodyContent: this.getDemoSequenceContent().code,
      updatedAt: '2022-08-14T12:00:03Z',
    };
  }

  private getGraphSpec(): MacroSpec {
    return {
      moduleKey: `zenuml-graph-macro${this.getModuleKeySuffix()}`,
      title: 'ZenUML Graph',
      uuid: this.generateUUID(),
      customContentId: '$$_GRAPH_CONTENT_ID',
      updatedAt: '2022-08-21T06:12:37Z',
    };
  }

  private getOpenAPISpec(): MacroSpec {
    return {
      moduleKey: `zenuml-openapi-macro${this.getModuleKeySuffix()}`,
      title: 'ZenUML OpenAPI',
      uuid: this.generateUUID(),
      customContentId: '$$_OPENAPI_CONTENT_ID',
      updatedAt: '2022-08-14T12:34:06Z',
    };
  }

  private getEmbedSpec(): MacroSpec {
    return {
      moduleKey: `zenuml-embed-macro${this.getModuleKeySuffix()}`,
      title: 'Embed ZenUML Diagram',
      uuid: this.generateUUID(),
      customContentId: '$$_EMBED_CONTENT_ID',
      updatedAt: '2022-08-14T12:17:08Z',
    };
  }

  private getMermaidSpec(): MacroSpec {
    return {
      moduleKey: testConfig.sequenceMacroKey,
      title: 'ZenUML Diagram',
      uuid: this.generateUUID(),
      customContentId: '$$_MERMAID_CONTENT_ID',
      bodyContent: this.getDemoMermaidContent().mermaidCode,
      updatedAt: '2022-08-14T12:11:13Z',
    };
  }
}
