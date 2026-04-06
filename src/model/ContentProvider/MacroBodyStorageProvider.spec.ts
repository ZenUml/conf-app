import MockAp from '@/model/MockAp'
import {NULL_DIAGRAM} from "@/model/Diagram/Diagram";
import {MacroBodyStorageProvider} from "@/model/ContentProvider/MacroBodyStorageProvider";
import ApWrapper2 from "@/model/ApWrapper2";

describe('MacroBodyStorageProvider', () => {
  test('macro body is empty', async () => {
    const mockAp = new MockAp(undefined);
    const storageProvider = new MacroBodyStorageProvider(new ApWrapper2());
    const diagram = await storageProvider.getDiagram(undefined)
    expect(diagram).toStrictEqual(NULL_DIAGRAM);
  })

  test('macro body', async () => {
    // In Forge-only mode, getMacroBody() always returns undefined.
    // MacroBodyStorageProvider returns NULL_DIAGRAM (empty diagram).
    const storageProvider = new MacroBodyStorageProvider(new ApWrapper2());

    const diagram = await storageProvider.getDiagram('fake-content-id')
    expect(diagram).toStrictEqual(NULL_DIAGRAM);
  })

})