import { captureError, captureInstalledMessage } from "./utils/sentry";
import {OkResponse} from "./OkResponse";
import {postData as postZarazData} from "./utils/zaraz";
import type {RequestBody} from "./RequestBody";
import {saveToBucket} from "./utils/R2Bucket";
import { KVEnv } from "./utils/KVEnv";
import { upsertClientInstallation } from "./utils/dbUtils";


export const onRequest: PagesFunction = async ({ request, env }) => {
  try {
    const body = await request.json() as RequestBody;
    console.log('installed body:', body);
    // {
    //   key: 'gptdock-confluence',
    //   clientKey: '59ee2c28-25d8-3faf-a773-964c1a075df6',
    //   publicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3vSKHN81aPnwYZzPN6i6eODKVOcZaNEGW8Lf32MSOWqM9WxlXn1Q/NatjJOjK7o+9o/3G+O2DRxK7x57yPsPb7CgJxQf/yT/rtFlOhPclGXe15ltvd0Bz9MC49G9RXM+9R1QihexIEt4q1Dan3aLOw3PZKaa0MbLOs5DBCIkEBwIDAQAB',
    //   sharedSecret: 'xxxx',
    //   serverVersion: '6452',
    //   pluginsVersion: '1000.0.0.7e508034f09e',
    //   baseUrl: 'https://zenuml-stg.atlassian.net/wiki',
    //   productType: 'confluence',
    //   description: 'Atlassian Confluence at null ',
    //   eventType: 'installed'
    // }

    // extract domain from baseUrl above

    captureInstalledMessage(body.key, body.clientKey, body.baseUrl);

    const domain = new URL(body.baseUrl).hostname;
    const isLite = body.key.includes('-lite');

    const saveKV = () => {
      const kv = env[KVEnv.CLIENT_INSTALLATION_KV];
      return kv && kv.put(`${isLite ? 'lite' : 'full'}/${domain}`, JSON.stringify({...body, timestamp: new Date()}));
    };

    await Promise.all([
      postZarazData(body.eventType, body.key, body.clientKey, domain),
      saveToBucket(env[KVEnv.EVENT_BUCKET], domain, body),
      saveKV(),
      await upsertClientInstallation((env as any).DB, body)
    ]);
  } catch (e) {
    console.log(`Error: ${e}`);
    captureError(e);
  }
  return OkResponse(undefined);
};
