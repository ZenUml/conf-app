import ApWrapper2 from "@/model/ApWrapper2";
import {StorageProvider} from "@/model/ContentProvider/StorageProvider";
import {Diagram, NULL_DIAGRAM} from "@/model/Diagram/Diagram";
import { SearchResults } from "../ICustomContent";
import { ICustomContentResponseBodyV2 } from "../ICustomContentResponseBody";

export class CustomContentStorageProvider implements StorageProvider {
  private apWrapper: ApWrapper2;

  constructor(apWrapper: ApWrapper2) {
    this.apWrapper = apWrapper;
  }

  async getDiagram(id: string | undefined): Promise<Diagram> {
    if (!id) {
      return NULL_DIAGRAM;
    }
    const customContent = await this.apWrapper.getCustomContentForCurrentPage(id);
    // @ts-ignore
    return customContent?.value;
  }

  async getCustomContentList(maxItems?: number) {
    return await this.apWrapper.searchCustomContent(maxItems);
  }

  async searchPagedCustomContent(pageSize?: number,keyword: string='',onlyMine: boolean=false,docType: string='', ids: number[] = []): Promise<SearchResults> {
    return await this.apWrapper.searchPagedCustomContent(pageSize,keyword,onlyMine,docType,ids);
  }
  async searchNextPageCustomContent(nextPageUrl: string): Promise<SearchResults> {
    return await this.apWrapper.searchPagedCustomContentByUrl(nextPageUrl);
  }

  async save(diagram: Diagram): Promise<ICustomContentResponseBodyV2 | any> {
    console.debug('CustomContentStorageProvider save', diagram);
    
    if (diagram?.source === 'custom-content' && diagram?.id && !diagram?.isCopy) {
      return await this.apWrapper.saveCustomContentV2(diagram.id, diagram);
    }

    return await this.apWrapper.createCustomContent(diagram);
  }
}