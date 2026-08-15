import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";
import { DEMO_EMAIL } from "../../shared/demo-fixtures.js";

const GAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    gap: {
      type: "object",
      additionalProperties: false,
      properties: {
        category: { type: "string", enum: ["top", "jacket", "trousers", "shoes", "accessory"] },
        color: { type: "string", minLength: 2, maxLength: 40 },
        description: { type: "string", minLength: 2, maxLength: 100 },
        shopifyQuery: { type: "string", minLength: 2, maxLength: 80 },
        compatibleWardrobeItemIds: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: { type: "string", minLength: 1 },
        },
      },
      required: ["category", "color", "description", "shopifyQuery", "compatibleWardrobeItemIds"],
    },
  },
  required: ["gap"],
};

type WardrobeItem = Record<string, unknown> & { id: string };
type Gap = {
  category: string;
  color: string;
  description: string;
  shopifyQuery: string;
  reason: string;
  compatibleWardrobeItemIds: string[];
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function parseResult(result: unknown) {
  if (typeof result === "string") return JSON.parse(result) as Record<string, unknown>;
  if (result && typeof result === "object") return result as Record<string, unknown>;
  throw new Error("Wardrobe gap analysis returned an invalid response.");
}

function reasonFor(description: string, count: number, occasion: string) {
  const ending = occasion ? ` and unlock more ${occasion.toLowerCase()} combinations.` : " and unlock several additional combinations.";
  return `A ${description} would complement ${count} ${count === 1 ? "piece" : "pieces"} already in your wardrobe${ending}`;
}

function normalizeGap(result: unknown, items: WardrobeItem[], anchorId: string, occasion: string): Gap {
  const record = parseResult(result).gap as Record<string, unknown> | undefined;
  if (!record) throw new Error("Wardrobe gap analysis did not return a recommendation.");
  const category = cleanText(record.category, 40);
  const color = cleanText(record.color, 40);
  const description = cleanText(record.description, 100);
  const shopifyQuery = cleanText(record.shopifyQuery, 80);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const compatibleIds = Array.isArray(record.compatibleWardrobeItemIds)
    ? [...new Set(record.compatibleWardrobeItemIds.filter((id): id is string => typeof id === "string" && itemMap.has(id)))]
    : [];
  if (itemMap.has(anchorId) && !compatibleIds.includes(anchorId)) compatibleIds.unshift(anchorId);
  const compatibleWardrobeItemIds = compatibleIds.slice(0, 12);
  if (!category || !color || !description || !shopifyQuery || !compatibleWardrobeItemIds.length) {
    throw new Error("Wardrobe gap analysis returned an incomplete recommendation.");
  }
  return {
    category,
    color,
    description,
    shopifyQuery,
    reason: reasonFor(description, compatibleWardrobeItemIds.length, occasion),
    compatibleWardrobeItemIds,
  };
}

function prioritizedCompatibleItems(items: WardrobeItem[], anchor: WardrobeItem, missingCategory: string) {
  const blockedPart = missingCategory === "jacket" ? "wholebody_up" : missingCategory === "shoes" ? "shoes" : "";
  return [...items]
    .filter((item) => item.part !== blockedPart)
    .sort((first, second) => {
      if (first.id === anchor.id) return -1;
      if (second.id === anchor.id) return 1;
      const firstOrder = Number(first.fixtureOrder ?? Number.MAX_SAFE_INTEGER);
      const secondOrder = Number(second.fixtureOrder ?? Number.MAX_SAFE_INTEGER);
      return firstOrder - secondOrder || String(first.name || "").localeCompare(String(second.name || ""));
    })
    .slice(0, 11)
    .map((item) => item.id);
}

function fallbackGap(items: WardrobeItem[], anchor: WardrobeItem, occasion: string): Gap {
  const anchorName = cleanText(anchor.name, 120).toLowerCase();
  const isNavyOvershirt = anchorName.includes("navy overshirt");
  let addition = { category: "jacket", color: "camel", description: "camel chore jacket", shopifyQuery: "camel chore jacket" };
  if (!isNavyOvershirt) {
    if (anchor.part === "upperbody") addition = { category: "trousers", color: "charcoal", description: "charcoal trousers", shopifyQuery: "charcoal trousers" };
    else if (anchor.part === "lowerbody") addition = { category: "top", color: "cream", description: "cream knit polo", shopifyQuery: "cream knit polo" };
    else if (anchor.part === "shoes") addition = { category: "trousers", color: "charcoal", description: "charcoal trousers", shopifyQuery: "charcoal trousers" };
    else if (anchor.part === "wholebody_up") addition = { category: "top", color: "cream", description: "cream knit polo", shopifyQuery: "cream knit polo" };
  }
  const compatibleWardrobeItemIds = prioritizedCompatibleItems(items, anchor, addition.category);
  return {
    ...addition,
    reason: isNavyOvershirt
      ? `A camel outer layer would complement ${compatibleWardrobeItemIds.length} pieces you already own and unlock additional smart-casual combinations.`
      : reasonFor(addition.description, compatibleWardrobeItemIds.length, occasion),
    compatibleWardrobeItemIds,
  };
}

function gapPrompt(items: WardrobeItem[], anchor: WardrobeItem, occasion: string) {
  const inventory = items.slice(0, 200).map((item) => ({
    id: item.id,
    name: item.name,
    category: item.part,
    color: item.color || null,
    secondaryColor: item.secondaryColor || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
  }));
  return `Identify exactly one high-utility wardrobe addition that complements the user's existing clothes.

Selected anchor: ${JSON.stringify({ id: anchor.id, name: anchor.name, category: anchor.part, color: anchor.color || null, tags: anchor.tags || [] })}
${occasion ? `Occasion: ${occasion}\n` : ""}Owned wardrobe: ${JSON.stringify(inventory)}

Rules:
- Recommend one missing item only: a versatile neutral layer, trouser, shoe, top, or restrained accessory.
- Favor repeat wear and compatibility over novelty or trendiness.
- shopifyQuery must be a concise 2-4 word product search such as "camel chore jacket".
- compatibleWardrobeItemIds may contain only exact IDs from the owned wardrobe above.
- Include the selected anchor when it is genuinely compatible.
- Return up to 12 compatible owned item IDs and never invent an owned item.
- Return only strict JSON matching the supplied schema.`;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timeout = setTimeout(() => reject(new Error("Wardrobe gap analysis timed out.")), milliseconds); }),
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
    const anchorWardrobeItemId = cleanText(input?.anchorWardrobeItemId, 100);
    const occasion = cleanText(input?.occasion, 80);
    const items = await base44.entities.WardrobeItem.list("created_date", 1000, 0) as WardrobeItem[];
    if (!items.length) return Response.json({ error: "Add wardrobe pieces before shopping a gap" }, { status: 409 });
    const anchor = items.find((item) => item.id === anchorWardrobeItemId) || items[0];

    if (email === DEMO_EMAIL && cleanText(anchor.name, 120).toLowerCase().includes("navy overshirt")) {
      const gap = fallbackGap(items, anchor, occasion);
      console.info(`[wardrobe-gap] ${JSON.stringify({ email, source: "demo-stable", category: gap.category, compatibleItemCount: gap.compatibleWardrobeItemIds.length })}`);
      return Response.json({ gap, source: "demo-stable" });
    }

    try {
      const result = await withTimeout(base44.integrations.Core.InvokeLLM({
        prompt: gapPrompt(items, anchor, occasion),
        response_json_schema: GAP_SCHEMA,
      }), 12_000);
      const gap = normalizeGap(result, items, anchor.id, occasion);
      console.info(`[wardrobe-gap] ${JSON.stringify({ email, source: "ai", category: gap.category, compatibleItemCount: gap.compatibleWardrobeItemIds.length })}`);
      return Response.json({ gap, source: "ai" });
    } catch {
      const gap = fallbackGap(items, anchor, occasion);
      console.warn(`[wardrobe-gap] ${JSON.stringify({ email, source: "reliable-fallback", category: gap.category, compatibleItemCount: gap.compatibleWardrobeItemIds.length })}`);
      return Response.json({ gap, source: "reliable-fallback" });
    }
  } catch (error) {
    const message = (error instanceof Error ? error.message : "A wardrobe gap could not be recommended.").slice(0, 300);
    return Response.json({ error: message }, { status: 500 });
  }
}
