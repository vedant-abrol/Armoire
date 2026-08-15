const DEFAULT_API_VERSION = "2026-07";
const SHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9.-]*\.myshopify\.com$/i;
const API_VERSION = /^\d{4}-(01|04|07|10)$/;

export class ShopifyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyConfigurationError";
  }
}

export class ShopifyRequestError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ShopifyRequestError";
    this.status = status;
  }
}

export type ShopifyAuthMode = "private-token" | "public-token" | "tokenless";

export type ShopifyConfig = {
  domain: string;
  apiVersion: string;
  privateToken?: string;
  publicToken?: string;
};

export type ShopifyAuthAttempt = {
  authMode: ShopifyAuthMode;
  httpStatus: number;
  errors: string[];
};

export type ShopifyGraphQLResult<T> = {
  data?: T;
  errors: string[];
  httpStatus: number;
  authMode: ShopifyAuthMode;
  attempts: ShopifyAuthAttempt[];
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string; extensions?: { code?: string } } | string>;
};

type ShopifyGraphQLOptions = {
  preferredAuthMode?: ShopifyAuthMode;
};

let cachedWorkingAuthMode: ShopifyAuthMode | undefined;

export function getShopifyConfig(): ShopifyConfig {
  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN")?.trim().toLowerCase() || "";
  const privateToken = Deno.env.get("SHOPIFY_STOREFRONT_PRIVATE_TOKEN")?.trim() || "";
  const publicToken = Deno.env.get("SHOPIFY_STOREFRONT_PUBLIC_TOKEN")?.trim() || "";
  const apiVersion = Deno.env.get("SHOPIFY_STOREFRONT_API_VERSION")?.trim() || DEFAULT_API_VERSION;

  if (!domain) {
    throw new ShopifyConfigurationError("Shopify is not configured. Add SHOPIFY_STORE_DOMAIN in Base44 environment variables.");
  }
  if (!SHOPIFY_DOMAIN.test(domain)) {
    throw new ShopifyConfigurationError("SHOPIFY_STORE_DOMAIN must be a valid myshopify.com domain without a protocol or path.");
  }
  if (!API_VERSION.test(apiVersion)) {
    throw new ShopifyConfigurationError("SHOPIFY_STOREFRONT_API_VERSION must be a supported YYYY-MM Shopify API version.");
  }

  return {
    domain,
    apiVersion,
    ...(privateToken ? { privateToken } : {}),
    ...(publicToken ? { publicToken } : {}),
  };
}

function normalizeIp(value: string | null) {
  if (!value) return undefined;
  let candidate = value.split(",", 1)[0].trim();
  if (!candidate || candidate.length > 64 || /[\r\n]/.test(candidate)) return undefined;

  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) {
    const octets = candidate.split(".").map(Number);
    return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
      ? candidate
      : undefined;
  }

  if (!candidate.includes(":") || !/^[0-9a-f:.]+$/i.test(candidate)) return undefined;
  try {
    new URL(`http://[${candidate}]/`);
    return candidate;
  } catch {
    return undefined;
  }
}

export function buyerIpFromRequest(req: Request) {
  return normalizeIp(req.headers.get("cf-connecting-ip"))
    || normalizeIp(req.headers.get("x-forwarded-for"))
    || normalizeIp(req.headers.get("x-real-ip"));
}

function configuredModes(config: ShopifyConfig): ShopifyAuthMode[] {
  return [
    ...(config.privateToken ? ["private-token" as const] : []),
    ...(config.publicToken ? ["public-token" as const] : []),
    "tokenless" as const,
  ];
}

function authModes(config: ShopifyConfig, preferredAuthMode?: ShopifyAuthMode) {
  const modes = configuredModes(config);
  const preferred = preferredAuthMode && modes.includes(preferredAuthMode)
    ? preferredAuthMode
    : cachedWorkingAuthMode && modes.includes(cachedWorkingAuthMode)
      ? cachedWorkingAuthMode
      : undefined;

  if (!preferred) return modes;
  if (preferred === "private-token") return modes;
  if (preferred === "public-token") {
    return [preferred, ...modes.filter((mode) => mode !== preferred && mode !== "private-token")];
  }
  return ["tokenless" as const];
}

function requestHeaders(config: ShopifyConfig, authMode: ShopifyAuthMode, buyerIp?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authMode === "private-token" && config.privateToken) {
    headers["Shopify-Storefront-Private-Token"] = config.privateToken;
    if (buyerIp) headers["Shopify-Storefront-Buyer-IP"] = buyerIp;
  } else if (authMode === "public-token" && config.publicToken) {
    headers["X-Shopify-Storefront-Access-Token"] = config.publicToken;
  }
  return headers;
}

function graphQLErrors<T>(payload: GraphQLResponse<T>) {
  return (payload.errors || []).map((error) => {
    if (typeof error === "string") return error.trim().slice(0, 500);
    if (typeof error.message === "string" && error.message.trim()) return error.message.trim().slice(0, 500);
    const code = error.extensions?.code;
    return code ? `GraphQL error (${String(code).slice(0, 80)})` : "GraphQL error without a message";
  }).filter(Boolean);
}

async function makeRequest<T>(
  req: Request,
  config: ShopifyConfig,
  authMode: ShopifyAuthMode,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(`https://${config.domain}/api/${config.apiVersion}/graphql.json`, {
      method: "POST",
      headers: requestHeaders(config, authMode, buyerIpFromRequest(req)),
      body: JSON.stringify({ operationName, query, variables }),
      signal: controller.signal,
    });
    let payload: GraphQLResponse<T> = {};
    try {
      payload = await response.json() as GraphQLResponse<T>;
    } catch {
      // The status remains useful when Shopify or an intermediary returns a non-JSON error.
    }
    return { data: payload.data, errors: graphQLErrors(payload), httpStatus: response.status };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ShopifyRequestError("Shopify took too long to respond. Please try again.");
    }
    throw new ShopifyRequestError("Shopify is temporarily unavailable. Please try again.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function shopifyGraphQLRaw<T>(
  req: Request,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  options: ShopifyGraphQLOptions = {},
): Promise<ShopifyGraphQLResult<T>> {
  const config = getShopifyConfig();
  const attempts: ShopifyAuthAttempt[] = [];
  const modes = authModes(config, options.preferredAuthMode);

  for (const authMode of modes) {
    const result = await makeRequest<T>(req, config, authMode, operationName, query, variables);
    attempts.push({ authMode, httpStatus: result.httpStatus, errors: result.errors });
    const authRejected = result.httpStatus === 401 || result.httpStatus === 403;
    if (authRejected && attempts.length < modes.length) continue;

    if (result.httpStatus >= 200 && result.httpStatus < 300) cachedWorkingAuthMode = authMode;
    return { ...result, authMode, attempts };
  }

  throw new ShopifyRequestError("Shopify storefront authentication was rejected.");
}

export async function shopifyGraphQLResult<T>(
  req: Request,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  options: ShopifyGraphQLOptions = {},
) {
  const result = await shopifyGraphQLRaw<T>(req, operationName, query, variables, options);
  if (result.httpStatus < 200 || result.httpStatus >= 300) {
    const authRejected = result.httpStatus === 401 || result.httpStatus === 403;
    const message = authRejected
      ? "Shopify storefront authentication was rejected."
      : result.errors.slice(0, 2).join(" ") || `Shopify returned HTTP ${result.httpStatus}.`;
    throw new ShopifyRequestError(message, result.httpStatus >= 500 ? 502 : 400);
  }
  if (result.errors.length) throw new ShopifyRequestError(result.errors.slice(0, 2).join(" "));
  if (!result.data) throw new ShopifyRequestError("Shopify returned an empty response.");
  return { ...result, data: result.data };
}

export async function shopifyGraphQL<T>(
  req: Request,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  options: ShopifyGraphQLOptions = {},
): Promise<T> {
  const result = await shopifyGraphQLResult<T>(req, operationName, query, variables, options);
  return result.data;
}

export function shopifyErrorResponse(error: unknown): Response {
  if (error instanceof ShopifyConfigurationError) {
    return Response.json({ error: error.message, code: "SHOPIFY_NOT_CONFIGURED" }, { status: 503 });
  }
  if (error instanceof ShopifyRequestError) {
    return Response.json({ error: error.message, code: "SHOPIFY_UNAVAILABLE" }, { status: error.status });
  }
  return Response.json(
    { error: "Shopify is temporarily unavailable. Please try again.", code: "SHOPIFY_UNAVAILABLE" },
    { status: 502 },
  );
}
