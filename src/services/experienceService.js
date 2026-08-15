import { base44 } from "../api/base44Client.js";
import { recommendWardrobeGap } from "./commerceService.js";

const outfits = base44.entities.Outfit;
const appearances = base44.entities.WardrobeAppearance;

function normalizeOutfit(outfit) {
  return {
    ...outfit,
    name: outfit.name || "Saved outfit",
    occasion: outfit.occasion || "",
    season: Array.isArray(outfit.season) ? outfit.season : [],
    garmentIds: Array.isArray(outfit.garmentIds) ? outfit.garmentIds : [],
    anchorGarmentId: outfit.anchorGarmentId || null,
    reason: outfit.reason || "",
    status: outfit.status || "saved",
    demoFixture: outfit.demoFixture === true,
    demoFixtureKey: outfit.demoFixtureKey || null,
  };
}

export async function listWardrobeAppearances() {
  return appearances.list("created_date", 5000, 0);
}

export async function listOutfits() {
  const records = await outfits.list("created_date", 1000, 0);
  return records.map(normalizeOutfit);
}

export async function prepareDemoWardrobe() {
  const response = await base44.functions.invoke("seed-demo-wardrobe", {});
  return response.data;
}

export async function styleWardrobeItem(anchorWardrobeItemId) {
  const [styleResult, gapResult] = await Promise.allSettled([
    base44.functions.invoke("style-this", { anchorWardrobeItemId }),
    recommendWardrobeGap(anchorWardrobeItemId),
  ]);
  if (styleResult.status === "rejected") throw styleResult.reason;
  return {
    outfits: (styleResult.value.data?.outfits || []).map(normalizeOutfit),
    source: styleResult.value.data?.source || "ai",
    gap: gapResult.status === "fulfilled" ? gapResult.value?.gap || null : null,
    gapSource: gapResult.status === "fulfilled" ? gapResult.value?.source || "ai" : null,
    gapError: gapResult.status === "rejected"
      ? gapResult.reason?.response?.data?.error || gapResult.reason?.message || "A wardrobe gap could not be prepared."
      : "",
  };
}

export async function saveOutfit(suggestion, validWardrobeItemIds) {
  const validIds = new Set(validWardrobeItemIds);
  const garmentIds = [...new Set(Array.isArray(suggestion.garmentIds) ? suggestion.garmentIds : [])];
  if (garmentIds.length < 2 || garmentIds.some((id) => !validIds.has(id))) {
    throw new Error("This suggestion contains a garment that is no longer in your wardrobe.");
  }
  const created = await outfits.create({
    name: String(suggestion.name || "Styled look").trim().slice(0, 120),
    occasion: String(suggestion.occasion || "").trim().slice(0, 120),
    season: Array.isArray(suggestion.season) ? suggestion.season : [],
    garmentIds,
    ...(suggestion.anchorGarmentId ? { anchorGarmentId: suggestion.anchorGarmentId } : {}),
    reason: String(suggestion.reason || "").trim().slice(0, 800),
    status: "saved",
    demoFixture: false,
  });
  return normalizeOutfit(created);
}

export function deleteOutfit(id) {
  return outfits.delete(id);
}
