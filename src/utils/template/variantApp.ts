export interface LiteAppIdentity {
  appId: string;
  macroKey: string;
}

/**
 * Build-time identity used to route an ADF extension node to the Lite macro.
 * Forge view context supplies the environment id, but not the app id.
 */
export function liteAppIdentity(): LiteAppIdentity {
  if (import.meta.env.PRODUCT_TYPE !== "lite") {
    throw new Error("space-template offer is a Lite-only feature");
  }

  return {
    appId: "8ad26115-211f-4216-971b-0540f606303d",
    macroKey: "zenuml-sequence-macro-lite",
  };
}
