import forgeGlobal from '@/model/globals/forgeGlobal';

export class AtlasDocFormat {
  private value: any;  

  constructor(content: string) {
    this.value = JSON.parse(content);
  }

  getMacros(macroKey?: string): Array<AtlasDocElement> {
    const result = [] as Array<AtlasDocElement>;
    const traverse = (node: any) => {
      if(node.type === AtlasDocElementType.Extension
          && ((!forgeGlobal.isForge && node.attrs.extensionType === AtlasDocExtensionType.Macro) 
            || (forgeGlobal.isForge && node.attrs.extensionType === AtlasDocExtensionType.Macro) //migrate old macros
            || (forgeGlobal.isForge && node.attrs.extensionType === AtlasDocExtensionType.ForgeMacro)
          )
          && (!macroKey || (forgeGlobal.isForge && node.attrs.extensionKey.includes(macroKey)) || (!forgeGlobal.isForge && node.attrs.extensionKey === macroKey))) {
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