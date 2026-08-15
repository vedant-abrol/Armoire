import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";
import { DEMO_EMAIL, DEMO_OUTFITS } from "../../shared/demo-fixtures.js";

const STYLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    outfits: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80 },
          garmentIds: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", minLength: 1 } },
          occasion: { type: "string", minLength: 1, maxLength: 80 },
          reason: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: ["name", "garmentIds", "occasion", "reason"],
      },
    },
  },
  required: ["outfits"],
};

type WardrobeItem = Record<string, unknown> & { id: string };
type StyledOutfit = { name: string; garmentIds: string[]; occasion: string; reason: string };

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : "Outfit suggestions could not be prepared.")
    .replace(/https?:\/\/\S+/gi, "private resource")
    .slice(0, 500);
}

function parseResult(result: unknown) {
  if (typeof result === "string") return JSON.parse(result) as Record<string, unknown>;
  if (result && typeof result === "object") return result as Record<string, unknown>;
  throw new Error("Styling AI returned an invalid response.");
}

function normalizeSuggestions(result: unknown, itemMap: Map<string, WardrobeItem>, anchorId: string) {
  const parsed = parseResult(result);
  const raw = Array.isArray(parsed.outfits) ? parsed.outfits : [];
  const combinations = new Set<string>();
  const suggestions: StyledOutfit[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const ids = Array.isArray(record.garmentIds)
      ? [...new Set(record.garmentIds.filter((id): id is string => typeof id === "string" && itemMap.has(id)))].slice(0, 5)
      : [];
    if (!ids.includes(anchorId) || ids.length < 2 || ids.length !== (Array.isArray(record.garmentIds) ? new Set(record.garmentIds).size : 0)) continue;
    const items = ids.map((id) => itemMap.get(id) as WardrobeItem);
    if (items.filter((item) => item.part === "upperbody").length !== 1) continue;
    if (items.filter((item) => item.part === "lowerbody").length !== 1) continue;
    if (items.filter((item) => item.part === "wholebody_up").length > 1) continue;
    if (items.filter((item) => item.part === "shoes").length > 1) continue;
    const combination = [...ids].sort().join(":");
    if (combinations.has(combination)) continue;
    const name = typeof record.name === "string" ? record.name.trim().slice(0, 80) : "";
    const occasion = typeof record.occasion === "string" ? record.occasion.trim().slice(0, 80) : "";
    const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, 500) : "";
    if (!name || !occasion || !reason) continue;
    combinations.add(combination);
    suggestions.push({ name, garmentIds: ids, occasion, reason });
    if (suggestions.length === 3) break;
  }
  return suggestions;
}

function fallbackSuggestions(items: WardrobeItem[], anchor: WardrobeItem) {
  const fixtureMap = new Map(items
    .filter((item) => typeof item.demoFixtureKey === "string" && item.demoFixtureKey)
    .map((item) => [String(item.demoFixtureKey), item]));
  const suggestions: StyledOutfit[] = [];
  const combinations = new Set<string>();
  const prioritized = [...DEMO_OUTFITS].sort((first, second) => {
    const firstHasAnchor = first.garmentFixtureKeys.includes(String(anchor.demoFixtureKey));
    const secondHasAnchor = second.garmentFixtureKeys.includes(String(anchor.demoFixtureKey));
    return Number(secondHasAnchor) - Number(firstHasAnchor);
  });

  for (const fixture of prioritized) {
    let garments = fixture.garmentFixtureKeys.map((key) => fixtureMap.get(key)).filter(Boolean) as WardrobeItem[];
    if (!garments.some((item) => item.id === anchor.id)) {
      const replaceIndex = garments.findIndex((item) => item.part === anchor.part);
      if (replaceIndex >= 0) garments[replaceIndex] = anchor;
      else if (garments.length < 5) garments.push(anchor);
    }
    garments = [...new Map(garments.map((item) => [item.id, item])).values()];
    if (!garments.some((item) => item.id === anchor.id)) continue;
    if (garments.filter((item) => item.part === "upperbody").length !== 1) continue;
    if (garments.filter((item) => item.part === "lowerbody").length !== 1) continue;
    if (garments.filter((item) => item.part === "wholebody_up").length > 1) continue;
    if (garments.filter((item) => item.part === "shoes").length > 1) continue;
    const garmentIds = garments.map((item) => item.id);
    const combination = [...garmentIds].sort().join(":");
    if (combinations.has(combination)) continue;
    combinations.add(combination);
    suggestions.push({
      name: fixture.name,
      garmentIds,
      occasion: fixture.occasion,
      reason: fixture.reason,
    });
    if (suggestions.length === 3) break;
  }
  if (suggestions.length !== 3) throw new Error("The demo fallback could not build three valid owned-garment outfits.");
  return suggestions;
}

function stylingPrompt(items: WardrobeItem[], anchor: WardrobeItem) {
  const inventory = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.part,
    primaryColor: item.color || null,
    secondaryColor: item.secondaryColor || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
  }));
  return `Create exactly three distinct outfits around the selected anchor garment using ONLY the supplied wardrobe item IDs.

Selected anchor: ${JSON.stringify({ id: anchor.id, name: anchor.name, category: anchor.part, primaryColor: anchor.color, secondaryColor: anchor.secondaryColor || null, tags: anchor.tags || [] })}

Owned wardrobe: ${JSON.stringify(inventory)}

Rules:
- Every suggestion must contain the selected anchor ID.
- Every suggestion must contain exactly one upperbody top and exactly one lowerbody bottom.
- Add at most one wholebody_up outer layer, at most one shoes item, and at most one restrained accessories_up item.
- Never invent, alter, or return an ID that is not in the supplied owned wardrobe.
- Favor tonal or analogous harmony; use complementary contrast selectively with one dominant color or statement.
- Balance silhouette and visual weight: fuller bottoms need cleaner tops, and heavier layers need a simple base.
- Keep layering physically plausible, use outerwear to frame or repeat color, and diversify garment use across the three looks.
- Give each look a concise editorial name, a short occasion, and a concrete reason.

Return only strict JSON matching the supplied schema.`;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timeout = setTimeout(() => reject(new Error("Styling AI timed out.")), milliseconds); }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const user = await base44.auth.me();
    const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const input = await req.json();
    const anchorWardrobeItemId = typeof input?.anchorWardrobeItemId === "string" ? input.anchorWardrobeItemId.trim() : "";
    if (!anchorWardrobeItemId) return Response.json({ error: "anchorWardrobeItemId is required" }, { status: 400 });

    const items = await base44.entities.WardrobeItem.list("created_date", 5000, 0) as WardrobeItem[];
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const anchor = itemMap.get(anchorWardrobeItemId);
    if (!anchor) return Response.json({ error: "Anchor wardrobe item not found" }, { status: 404 });
    if (items.filter((item) => item.part === "upperbody").length < 1 || items.filter((item) => item.part === "lowerbody").length < 1) {
      return Response.json({ error: "Add at least one top and one bottom before styling an outfit" }, { status: 409 });
    }

    try {
      const aiResult = await withTimeout(base44.integrations.Core.InvokeLLM({
        prompt: stylingPrompt(items, anchor),
        response_json_schema: STYLE_SCHEMA,
      }), 15000);
      const outfits = normalizeSuggestions(aiResult, itemMap, anchor.id);
      if (outfits.length !== 3) throw new Error("Styling AI returned suggestions that referenced invalid or unowned garments.");
      console.info(`[style-this] ${JSON.stringify({ email, anchorWardrobeItemId, source: "ai", outfitCount: outfits.length })}`);
      return Response.json({ outfits, source: "ai" });
    } catch (aiError) {
      const reason = safeMessage(aiError);
      if (email !== DEMO_EMAIL) {
        console.error(`[style-this] ${JSON.stringify({ email, anchorWardrobeItemId, source: "error", reason })}`);
        return Response.json({ error: reason }, { status: 502 });
      }
      const outfits = fallbackSuggestions(items, anchor);
      console.warn(`[style-this] ${JSON.stringify({ email, anchorWardrobeItemId, source: "demo-fallback", reason, outfitCount: outfits.length })}`);
      return Response.json({ outfits, source: "demo-fallback" });
    }
  } catch (error) {
    return Response.json({ error: safeMessage(error) }, { status: 500 });
  }
}
