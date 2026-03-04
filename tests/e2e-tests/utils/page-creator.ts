import { Page } from '@playwright/test';
import { testConfig } from '../config/test-config.js';
import { withLock } from './api-lock.js';

interface MacroOptions {
  sequence?: boolean | { bodyOnly?: boolean };
  graph?: boolean;
  openapi?: boolean;
  embed?: boolean;
  mermaid?: boolean;
}

interface CustomContent {
  id: string;
  title: string;
}

export class PageCreator {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
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
    const title = `E2E test page at ${new Date()} - ${this.generateUUID()}`;

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
      const pageContent = this.buildPageContent(options);
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

  private buildPageContent(options: MacroOptions): any {
    const content = { type: 'doc', content: [], version: 1 };

    if (options.sequence) {
      let extension = this.getSequenceExtension();
      if (typeof options.sequence === 'object' && options.sequence.bodyOnly) {
        extension = JSON.parse(JSON.stringify(extension));
        delete extension.attrs.parameters.macroParams.customContentId;
      }
      content.content.push(extension);
    }

    if (options.graph) {
      content.content.push(this.getGraphExtension());
    }

    if (options.openapi) {
      content.content.push(this.getOpenAPIExtension());
    }

    if (options.embed) {
      content.content.push(this.getEmbedExtension());
    }

    if (options.mermaid) {
      content.content.push(this.getMermaidExtension());
    }

    return content;
  }

  private getModuleKeySuffix(): string {
    return testConfig.isLite ? '-lite' : '';
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

  private getSequenceExtension() {
    return {
      type: 'extension',
      attrs: {
        layout: 'default',
        extensionType: 'com.atlassian.confluence.macro.core',
        extensionKey: testConfig.sequenceMacroKey,
        parameters: {
          macroParams: {
            uuid: { value: this.generateUUID() },
            customContentId: { value: '$$_SEQUENCE_CONTENT_ID' },
            __bodyContent: { value: this.getDemoSequenceContent().code },
            updatedAt: { value: '2022-08-14T12:00:03Z' }
          },
          macroMetadata: {
            macroId: { value: '' },
            schemaVersion: { value: '1' },
            placeholder: [{ type: 'icon', data: { url: '/image/zenuml_logo.png' } }],
            title: 'ZenUML Diagram'
          }
        },
        localId: ''
      }
    };
  }

  private getGraphExtension() {
    return {
      type: 'extension',
      attrs: {
        layout: 'default',
        extensionType: 'com.atlassian.confluence.macro.core',
        extensionKey: `zenuml-graph-macro${this.getModuleKeySuffix()}`,
        parameters: {
          macroParams: {
            uuid: { value: this.generateUUID() },
            customContentId: { value: '$$_GRAPH_CONTENT_ID' },
            updatedAt: { value: '2022-08-21T06:12:37Z' }
          },
          macroMetadata: {
            macroId: { value: '' },
            schemaVersion: { value: '1' },
            placeholder: [{ type: 'icon', data: { url: '/image/zenuml_logo.png' } }],
            title: 'ZenUML Graph'
          }
        },
        localId: ''
      }
    };
  }

  private getOpenAPIExtension() {
    return {
      type: 'extension',
      attrs: {
        layout: 'default',
        extensionType: 'com.atlassian.confluence.macro.core',
        extensionKey: `zenuml-openapi-macro${this.getModuleKeySuffix()}`,
        parameters: {
          macroParams: {
            uuid: { value: this.generateUUID() },
            customContentId: { value: '$$_OPENAPI_CONTENT_ID' },
            updatedAt: { value: '2022-08-14T12:34:06Z' }
          },
          macroMetadata: {
            macroId: { value: '' },
            schemaVersion: { value: '1' },
            placeholder: [{ type: 'icon', data: { url: '/image/zenuml_logo.png' } }],
            title: 'ZenUML OpenAPI'
          }
        },
        localId: ''
      }
    };
  }

  private getEmbedExtension() {
    return {
      type: 'extension',
      attrs: {
        layout: 'default',
        extensionType: 'com.atlassian.confluence.macro.core',
        extensionKey: `zenuml-embed-macro${this.getModuleKeySuffix()}`,
        parameters: {
          macroParams: {
            uuid: { value: this.generateUUID() },
            customContentId: { value: '$$_EMBED_CONTENT_ID' },
            updatedAt: { value: '2022-08-14T12:17:08Z' }
          },
          macroMetadata: {
            macroId: { value: '' },
            schemaVersion: { value: '1' },
            placeholder: [{ type: 'icon', data: { url: '/image/zenuml_logo.png' } }],
            title: 'Embed ZenUML Diagram'
          }
        },
        localId: ''
      }
    };
  }

  private getMermaidExtension() {
    return {
      type: 'extension',
      attrs: {
        layout: 'default',
        extensionType: 'com.atlassian.confluence.macro.core',
        extensionKey: testConfig.sequenceMacroKey,
        parameters: {
          macroParams: {
            uuid: { value: this.generateUUID() },
            customContentId: { value: '$$_MERMAID_CONTENT_ID' },
            __bodyContent: { value: this.getDemoMermaidContent().mermaidCode },
            updatedAt: { value: '2022-08-14T12:11:13Z' }
          },
          macroMetadata: {
            macroId: { value: '' },
            schemaVersion: { value: '1' },
            placeholder: [{ type: 'icon', data: { url: '/image/zenuml_logo.png' } }],
            title: 'ZenUML Diagram'
          }
        },
        localId: ''
      }
    };
  }
}