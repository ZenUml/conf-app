export interface ILocationContext {
  spaceKey: string;
  contentType: string;
  contentId: string;
  href: string;
  target: LocationTarget;
}

// Values match what AtlasPage.getLocationTarget() returns (#361).
export enum LocationTarget {
  ContentView = 'contentView',
  ContentEdit = 'contentEdit',
  ContentCreate = 'contentCreate'
}
export interface IContext {
  confluence: IConfluence;
}

export interface IConfluence {
  content: IContent;
  space: ISpace;
}
export interface IContent {
  plugin?: string; //e.g. ac:my-api:async-api-doc
  type: string; //e.g. custom/page
  version?: string; //e.g. 143
  id?: string; //e.g. 32997
}
export interface ISpace {
  key: string; //e.g. WHIMET4
  id?: string; //e.g. 163841
}