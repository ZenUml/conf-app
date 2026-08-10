import { Env } from '../../utils/KVEnv';

interface SpaceMetrics {
  space: string;
  total: number;
  sequence: number;
  graph: number;
  openapi: number;
  mermaid: number;
  plantuml: number;
  unknown: number;
  isLite: boolean;
  lastUpdated?: string;
}

interface DomainData {
  domain: string;
  spaces: Record<string, SpaceMetrics>;
}

type InspectStatus = 'ok' | 'stale' | 'no_data' | 'ambiguous_product';

const STALE_THRESHOLD_HOURS = 24;

/** Every product whose writer can stamp `metrics:<domain>:<productType>`. */
const PRODUCT_TYPES = ['full', 'lite', 'diagramly', 'asyncapi'] as const;
type ProductType = (typeof PRODUCT_TYPES)[number];

function isProductType(value: string): value is ProductType {
  return (PRODUCT_TYPES as readonly string[]).includes(value);
}

/**
 * Map an addonKey to its product. Deliberately returns undefined rather than
 * guessing: an unrecognised key falls through to probing, never to `full`.
 * The `-lite` test comes first because `confluence-addon-lite` also contains
 * `confluence-addon`, and callers pass short forms like `zenuml-lite` too.
 */
function productFromAddonKey(addonKey: string): ProductType | undefined {
  if (!addonKey) return undefined;
  if (addonKey.includes('-lite')) return 'lite';
  if (addonKey.includes('gptdock')) return 'diagramly';
  if (addonKey === 'my-api' || addonKey.includes('asyncapi')) return 'asyncapi';
  if (addonKey.includes('confluence-addon')) return 'full';
  return undefined;
}

function metricsKey(domain: string, product: ProductType): string {
  return `metrics:${domain}:${product}`;
}

function newestUpdate(domainData: DomainData): string | null {
  const stamps = Object.values(domainData.spaces)
    .map((s) => s.lastUpdated)
    .filter((s): s is string => Boolean(s))
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
}

function computeAgeHours(lastUpdated: string | undefined): number {
  if (!lastUpdated) return Infinity;
  const updatedAt = new Date(lastUpdated).getTime();
  const now = Date.now();
  return Math.round((now - updatedAt) / (1000 * 60 * 60) * 10) / 10;
}

function computeStatus(spaceFound: boolean, ageHours: number): InspectStatus {
  if (!spaceFound) return 'no_data';
  if (ageHours >= STALE_THRESHOLD_HOURS) return 'stale';
  return 'ok';
}

interface ProductContext {
  productType: ProductType;
  resolvedBy: 'explicit' | 'addonKey' | 'sole-match';
}

function buildSpaceResponse(
  kvKey: string,
  domainData: DomainData | null,
  space: string,
  product?: ProductContext
) {
  const kvHasData = domainData !== null;
  const domainSpaces = domainData ? Object.keys(domainData.spaces) : [];
  const spaceData = domainData?.spaces?.[space] ?? null;
  const spaceFound = spaceData !== null;
  const ageHours = spaceData ? computeAgeHours(spaceData.lastUpdated) : 0;
  const status = computeStatus(spaceFound, ageHours);

  return {
    status,
    data: spaceData,
    diagnosis: {
      kvKey,
      kvHasData,
      domainSpaces,
      spaceFound,
      lastUpdated: spaceData?.lastUpdated ?? null,
      ageHours: spaceFound ? ageHours : null,
      staleThresholdHours: STALE_THRESHOLD_HOURS,
      ...(product
        ? { productType: product.productType, productResolvedBy: product.resolvedBy }
        : {}),
    },
  };
}

function buildDomainResponse(
  kvKey: string,
  domainData: DomainData | null,
  product?: ProductContext
) {
  if (!domainData || Object.keys(domainData.spaces).length === 0) {
    return {
      status: 'no_data' as InspectStatus,
      data: null,
      diagnosis: {
        kvKey,
        kvHasData: domainData !== null,
        domainSpaces: [],
        staleThresholdHours: STALE_THRESHOLD_HOURS,
      },
    };
  }

  const spaces: Record<string, ReturnType<typeof buildSpaceResponse>> = {};
  for (const spaceKey of Object.keys(domainData.spaces)) {
    spaces[spaceKey] = buildSpaceResponse(kvKey, domainData, spaceKey, product);
  }

  return {
    status: 'ok' as InspectStatus,
    spaces,
    diagnosis: {
      kvKey,
      kvHasData: true,
      domainSpaces: Object.keys(domainData.spaces),
      staleThresholdHours: STALE_THRESHOLD_HOURS,
      ...(product
        ? { productType: product.productType, productResolvedBy: product.resolvedBy }
        : {}),
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  const domain = url.searchParams.get('domain');
  const space = url.searchParams.get('space');
  const addonKey = url.searchParams.get('addonKey') || '';
  const requestedProduct = url.searchParams.get('productType') || '';

  if (!domain) {
    return json({ error: 'Missing domain parameter' }, 400);
  }
  if (requestedProduct && !isProductType(requestedProduct)) {
    return json(
      {
        error: `Unknown productType '${requestedProduct}'`,
        validProductTypes: PRODUCT_TYPES,
      },
      400
    );
  }

  const read = (product: ProductType) =>
    env.confluence_plugin_features.get(metricsKey(domain, product), 'json') as Promise<DomainData | null>;

  const render = (product: ProductContext, data: DomainData | null) => {
    const kvKey = metricsKey(domain, product.productType);
    return json(
      space
        ? buildSpaceResponse(kvKey, data, space, product)
        : buildDomainResponse(kvKey, data, product)
    );
  };

  // An explicitly named product is authoritative — one read, no probing.
  const named: ProductType | undefined = requestedProduct
    ? (requestedProduct as ProductType)
    : productFromAddonKey(addonKey);
  if (named) {
    const resolvedBy = requestedProduct ? 'explicit' : 'addonKey';
    return render({ productType: named, resolvedBy }, await read(named));
  }

  // Nothing named: probe every product instead of assuming one. Assuming `full`
  // here is what served a Lite-only tenant a stale `full` record left behind by a
  // past writer bug (458 of 767 domains carry more than one product key).
  const probes = await Promise.all(
    PRODUCT_TYPES.map(async (product) => ({ product, data: await read(product) }))
  );
  const withData = probes.filter(
    (p): p is { product: ProductType; data: DomainData } =>
      p.data !== null && Object.keys(p.data.spaces ?? {}).length > 0
  );

  if (withData.length === 1) {
    return render({ productType: withData[0].product, resolvedBy: 'sole-match' }, withData[0].data);
  }

  if (withData.length === 0) {
    return json({
      status: 'no_data' as InspectStatus,
      data: null,
      diagnosis: {
        kvKey: null,
        kvHasData: false,
        domainSpaces: [],
        productsProbed: [...PRODUCT_TYPES],
        staleThresholdHours: STALE_THRESHOLD_HOURS,
      },
    });
  }

  // Several products hold data. Report the fork; the caller picks with
  // `?productType=` rather than us guessing which one it meant.
  const products: Record<string, unknown> = {};
  for (const { product, data } of withData) {
    products[product] = {
      kvKey: metricsKey(domain, product),
      spaceCount: Object.keys(data.spaces).length,
      newestUpdate: newestUpdate(data),
    };
  }

  return json({
    status: 'ambiguous_product' as InspectStatus,
    data: null,
    diagnosis: {
      domain,
      products,
      hint: 'Several product keys hold data for this domain — re-request with '
        + `?productType=<${PRODUCT_TYPES.join('|')}>. A product the tenant holds no `
        + 'license for is residue from a past writer bug, not a second install.',
      staleThresholdHours: STALE_THRESHOLD_HOURS,
    },
  });
};
