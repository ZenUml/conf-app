import ApWrapper2 from "@/model/ApWrapper2";
import {IdProvider} from "@/model/ContentProvider/IdProvider";

export class MacroIdProvider implements IdProvider {
  private apWrapper: ApWrapper2;

  constructor(apWrapper: ApWrapper2) {
    this.apWrapper = apWrapper;
  }

  async getId(): Promise<string | undefined> {
    const macroData = await this.apWrapper.getMacroData();
    console.debug(`MacroIdProvider - loaded macroData:`, macroData);
    return macroData?.customContentId;
  }

  async getUuid() {
    const macroData = await this.apWrapper.getMacroData();
    return macroData?.uuid;
  }
}