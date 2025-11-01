// define the type of RequestBody
export type RequestBody = {
  key: string,
  clientKey: string,
  publicKey: string,
  sharedSecret: string,
  serverVersion: string,
  pluginsVersion: string,
  baseUrl: string,
  productType: string,
  description: string,
  eventType: string
}

export type ForgeAppRequestBody = {
  eventType: 'avi:forge:installed:app' | 'avi:forge:upgraded:app',
  id: string,
  context: string,
  app: {
    id: string,
    name: string,
    ownerAccountId: string,
    version: string
  },
  environment: {
    id: string,
  },
  permissions: {
    scopes: string[],
    external: {
      fetch: {
        backend: string[],
        client: string[]
      }
    }
    frames: string[],
    scripts: string[],
  },
}
