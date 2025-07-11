import ApWrapper2 from "@/model/ApWrapper2";
import globals from "../globals";

export class AtlasDocFormat {
  private value: any;  
  private apWrapper: ApWrapper2;

  constructor(content: string, apWrapper: ApWrapper2 = globals.apWrapper) {
    this.value = JSON.parse(content);
    this.apWrapper = apWrapper;
  }

  getMacros(macroKey?: string): Array<AtlasDocElement> {
    const result = [] as Array<AtlasDocElement>;
    const traverse = (node: any) => {
      if(node.type === AtlasDocElementType.Extension
          && ((!this.apWrapper.isForge && node.attrs.extensionType === AtlasDocExtensionType.Macro) || (this.apWrapper.isForge && node.attrs.extensionType === AtlasDocExtensionType.ForgeMacro))
          && (!macroKey || (this.apWrapper.isForge && node.attrs.extensionKey.includes(macroKey)) || (!this.apWrapper.isForge && node.attrs.extensionKey === macroKey))) {
        result.push(node);
      } else if(node.content) {
        node.content.forEach(traverse);
      }
    };
    traverse(this.value);
    return result;
  }
}

enum AtlasDocElementType {
  Extension = 'extension',
}

export enum AtlasDocExtensionType {
  Macro = 'com.atlassian.confluence.macro.core',
  ForgeMacro = 'com.atlassian.ecosystem',
}

export interface AtlasDocElement {
  type: AtlasDocElementType;
  attrs: {
    extensionType: AtlasDocExtensionType;
    extensionKey: string;
    parameters: {
      macroParams?: MacroParams;
      guestParams?: ForgeGuestParams;
    }
  };
}

export interface MacroParams {
  uuid?: {
    value: string;
  },
  customContentId?: {
    value: string;
  }
}
export interface ForgeGuestParams {
  uuid?: {
    value: string;
  },
  customContentId?:string;
  updatedAt?:string;
}