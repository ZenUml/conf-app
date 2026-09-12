export function liteAppIdentity(): { appId: string; macroKey: string } {
  if (import.meta.env.PRODUCT_TYPE !== 'lite') throw new Error('space-template offer is a Lite-only feature')
  return { appId: '8ad26115-211f-4216-971b-0540f606303d', macroKey: 'zenuml-sequence-macro-lite' }
}
