export type ForgeAppRequestBody = {
  eventType: 'avi:forge:installed:app' | 'avi:forge:upgraded:app',
  id: string,
  context: string,
  installerAccountId?: string,
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
