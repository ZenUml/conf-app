// The single mapping from the build-time PRODUCT_TYPE axis to the analytics
// `product_type` property. Kept as a pure function taking the raw value,
// because `import.meta.env.PRODUCT_TYPE` is replaced by a string literal at
// transform time (vite.config.mjs `define`), so a resolver that reads the env
// directly cannot be driven from a test.
//
// `asyncapi` was missing from the allowlist from the initial public release
// (2026-05-03) until this fix, so every AsyncAPI event hit the `full` fallback
// and pooled into the paying tier's numbers — issues #367 and #416.
export type ProductType = "lite" | "full" | "diagramly" | "asyncapi";

const KNOWN_PRODUCT_TYPES: readonly ProductType[] = [
  "lite",
  "full",
  "diagramly",
  "asyncapi",
];

export function normalizeProductType(raw: string | undefined): ProductType {
  return KNOWN_PRODUCT_TYPES.includes(raw as ProductType)
    ? (raw as ProductType)
    : "full";
}
