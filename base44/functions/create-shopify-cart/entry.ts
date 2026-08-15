import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";
import { shopifyErrorResponse, shopifyGraphQLResult } from "../../shared/shopify.ts";

const CART_CREATE = `#graphql
  mutation ArmoireCartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        totalQuantity
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

type CartCreateResult = {
  cartCreate?: {
    cart?: { id?: string; checkoutUrl?: string; totalQuantity?: number } | null;
    userErrors?: Array<{ field?: string[] | null; message?: string; code?: string | null }>;
  };
};

function validVariantId(value: unknown): value is string {
  return typeof value === "string" && /^gid:\/\/shopify\/ProductVariant\/[^\s/?#]+$/.test(value);
}

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const input = await req.json();
    const merchandiseId = input?.merchandiseId;
    const quantity = Number(input?.quantity ?? 1);
    const preferredAuthMode = input?.authMode === "public-token" ? "public-token" : undefined;
    if (!validVariantId(merchandiseId)) {
      return Response.json({ error: "A valid Shopify ProductVariant ID is required" }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) {
      return Response.json({ error: "Quantity must be a whole number from 1 to 5" }, { status: 400 });
    }

    const result = await shopifyGraphQLResult<CartCreateResult>(req, "ArmoireCartCreate", CART_CREATE, {
      input: { lines: [{ merchandiseId, quantity }] },
    }, { preferredAuthMode });
    const payload = result.data.cartCreate;
    const userErrors = (payload?.userErrors || []).map((error) => ({
      field: Array.isArray(error.field) ? error.field.join(".") : null,
      message: typeof error.message === "string" ? error.message.slice(0, 300) : "Shopify rejected this cart item.",
      code: error.code || null,
    }));
    if (userErrors.length) {
      return Response.json({ error: userErrors[0].message, code: "SHOPIFY_CART_REJECTED", userErrors }, { status: 422 });
    }

    const cart = payload?.cart;
    if (!cart?.id || !cart.checkoutUrl || !cart.checkoutUrl.startsWith("https://")) {
      return Response.json({ error: "Shopify did not return a checkout URL", code: "SHOPIFY_CART_REJECTED" }, { status: 502 });
    }

    return Response.json({
      cartId: cart.id,
      checkoutUrl: cart.checkoutUrl,
      totalQuantity: cart.totalQuantity || quantity,
      authMode: result.authMode,
    });
  } catch (error) {
    return shopifyErrorResponse(error);
  }
}
