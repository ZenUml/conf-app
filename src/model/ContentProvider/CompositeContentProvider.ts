import {ContentProvider, IContentProvider} from "@/model/ContentProvider/ContentProvider";
import {MacroIdProvider} from "@/model/ContentProvider/MacroIdProvider";
import {CustomContentStorageProvider} from "@/model/ContentProvider/CustomContentStorageProvider";
import {ContentPropertyStorageProvider} from "@/model/ContentProvider/ContentPropertyStorageProvider";
import {MacroBodyStorageProvider} from "@/model/ContentProvider/MacroBodyStorageProvider";
import {Diagram, DiagramType, NULL_DIAGRAM} from "@/model/Diagram/Diagram";
import {getUrlParam, trackEvent} from "@/utils/window";
import {UrlIdProvider} from "@/model/ContentProvider/UrlIdProvider";
import {DialogCustomDataProvider} from "@/model/ContentProvider/DialogCustomDataProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import globals from '@/model/globals';

export class CompositeContentProvider implements IContentProvider{
  private readonly _contentProviders: Array<ContentProvider>;

  constructor(contentProviders: Array<ContentProvider>) {
    this._contentProviders = contentProviders;
  }

  async load(): Promise<{ id: string | undefined, doc: Diagram }> {
    for (const contentProvider of this._contentProviders) {
      try {
        const { id, doc } = await contentProvider.load();
        if (doc !== NULL_DIAGRAM) {
          console.debug('Loaded diagram from', contentProvider.constructor.name);
          if(doc.diagramType === undefined || doc.diagramType === DiagramType.Unknown) {
            console.warn('diagramType is undefined', doc);
            trackEvent('diagramType is undefined or unknown', 'load_macro', 'warn');
            doc.diagramType = DiagramType.Sequence;
          }
          return {id, doc};
        }
      } catch (e: any) {
        console.error(e);
        trackEvent(JSON.stringify(e), 'load_macro', 'error')
      }
    }
    return {id: undefined, doc: NULL_DIAGRAM};
  }
}

const defaultContentProvider = function getCompositeContentProvider(apWrapper: ApWrapper2): IContentProvider {
  const renderedFor = getUrlParam('rendered.for');

  if (renderedFor === 'custom-content-native') {
    const idProvider = globals.isEmbedded ? new UrlIdProvider() : new DialogCustomDataProvider(apWrapper);
    return new ContentProvider(idProvider, new CustomContentStorageProvider(apWrapper));
  }

  const macroIdProvider = new MacroIdProvider(apWrapper);
  return new CompositeContentProvider([
    new ContentProvider(macroIdProvider, new CustomContentStorageProvider(apWrapper)),
    new ContentProvider(macroIdProvider, new ContentPropertyStorageProvider(apWrapper)),
    new ContentProvider(undefined, new MacroBodyStorageProvider(apWrapper)),
  ]);
}

export default defaultContentProvider;
