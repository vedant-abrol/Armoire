import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";
import { shopifyErrorResponse, shopifyGraphQLResult } from "../../shared/shopify.ts";

const PRODUCT_SEARCH = `#graphql
  query ArmoireProductSearch($query: String!, $first: Int!) {
    search(
      first: $first
      query: $query
      types: [PRODUCT]
      unavailableProducts: HIDE
      sortKey: RELEVANCE
    ) {
      nodes {
        ... on Product {
          id
          title
          handle
          description
          availableForSale
          featuredImage {
            url
            altText
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          selectedOrFirstAvailableVariant {
            id
            availableForSale
            price {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

type ShopifyProduct = {
  id?: string;
  title?: string;
  handle?: string;
  description?: string;
  availableForSale?: boolean;
  featuredImage?: { url?: string; altText?: string | null } | null;
  priceRange?: { minVariantPrice?: { amount?: string; currencyCode?: string } };
  selectedOrFirstAvailableVariant?: { id?: string; availableForSale?: boolean; price?: { amount?: string; currencyCode?: string } } | null;
};

type ProductSearchResult = { search?: { nodes?: ShopifyProduct[] } };

function cleanQuery(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function broaderQuery(query: string) {
  const words = query.split(" ").filter(Boolean);
  if (words.length >= 3) return `${words[0]} ${words.at(-1)}`;
  if (words.length === 2) return words[1];
  return "";
}

function shortDescription(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177).trimEnd()}…` : normalized;
}

function normalizeProducts(nodes: ShopifyProduct[] = []) {
  return nodes.flatMap((product) => {
    const variant = product.selectedOrFirstAvailableVariant;
    const price = variant?.price || product.priceRange?.minVariantPrice;
    if (!product.id || !product.title || !product.handle || !variant?.id || !variant.availableForSale || !price?.amount || !price.currencyCode) return [];
    return [{
      id: product.id,
      title: product.title.trim().slice(0, 160),
      handle: product.handle,
      description: shortDescription(product.description),
      imageUrl: product.featuredImage?.url || null,
      imageAlt: product.featuredImage?.altText?.trim() || product.title,
      price: price.amount,
      currencyCode: price.currencyCode,
      merchandiseId: variant.id,
      available: true,
      source: "shopify",
    }];
  }).slice(0, 3);
}

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const input = await req.json();
    const query = cleanQuery(input?.query);
    if (query.length < 2) return Response.json({ error: "Enter a more specific product search" }, { status: 400 });

    const attempts = [query];
    const broader = broaderQuery(query);
    if (broader && broader.toLowerCase() !== query.toLowerCase()) attempts.push(broader);

    let authMode = null;
    for (const searchQuery of attempts) {
      const result = await shopifyGraphQLResult<ProductSearchResult>(req, "ArmoireProductSearch", PRODUCT_SEARCH, {
        query: searchQuery,
        first: 5,
      });
      authMode = result.authMode;
      const products = normalizeProducts(result.data.search?.nodes);
      if (products.length) {
        return Response.json({ products, query: searchQuery, requestedQuery: query, source: "shopify", authMode });
      }
    }

    return Response.json({ products: [], query: attempts.at(-1), requestedQuery: query, source: "shopify", authMode });
  } catch (error) {
    return shopifyErrorResponse(error);
  }
}
