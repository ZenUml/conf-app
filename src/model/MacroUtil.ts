import {MacroIdProvider} from "@/model/ContentProvider/MacroIdProvider";
import globals from '@/model/globals';
import ApWrapper2 from "@/model/ApWrapper2";

export default {
  async isCreateNew() {
    const macroIdProvider = new MacroIdProvider(globals.apWrapper as ApWrapper2);
    const customContentId = await macroIdProvider.getId();
    return customContentId == null;
  }
};
