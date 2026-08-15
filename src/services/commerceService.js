import { base44 } from "../api/base44Client.js";

function errorMessage(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback;
}

export async function recommendWardrobeGap(anchorWardrobeItemId, occasion = "") {
  const response = await base44.functions.invoke("recommend-wardrobe-gap", { anchorWardrobeItemId, occasion });
  return response.data;
}

export async function searchShopifyProducts(query) {
  try {
    const response = await base44.functions.invoke("search-shopify-products", { query });
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error, "Shopify products could not be loaded."));
  }
}

export async function createShopifyCart(merchandiseId, quantity = 1, authMode = undefined) {
  try {
    const response = await base44.functions.invoke("create-shopify-cart", {
      merchandiseId,
      quantity,
      ...(authMode === "public-token" ? { authMode } : {}),
    });
    return response.data;
  } catch (error) {
    throw new Error(errorMessage(error, "This item could not be added to a Shopify cart."));
  }
}
