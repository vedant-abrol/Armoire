import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";
import { DEMO_EMAIL } from "../../shared/demo-fixtures.js";
import { seedDemoWardrobe } from "../../shared/demo-seed.ts";

const CONFIRMATION = "RESET_ARMOIRE_DEMO_FIXTURES";

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : "The demo wardrobe could not be reset.")
    .replace(/https?:\/\/\S+/gi, "private resource")
    .slice(0, 500);
}

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const user = await base44.auth.me();
    const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (email !== DEMO_EMAIL) return Response.json({ error: "Demo reset is not available for this account" }, { status: 403 });

    const input = await req.json().catch(() => ({}));
    if (input?.confirmation !== CONFIRMATION) return Response.json({ error: "Explicit reset confirmation is required" }, { status: 400 });
    const includeRealData = input?.includeRealData === true;

    const removed = includeRealData
      ? {
        appearances: (await base44.entities.WardrobeAppearance.deleteMany({})).deleted,
        outfits: (await base44.entities.Outfit.deleteMany({})).deleted,
        items: (await base44.entities.WardrobeItem.deleteMany({})).deleted,
      }
      : {
        appearances: (await base44.entities.WardrobeAppearance.deleteMany({ demoFixture: true })).deleted,
        outfits: (await base44.entities.Outfit.deleteMany({ demoFixture: true })).deleted,
        items: (await base44.entities.WardrobeItem.deleteMany({ demoFixture: true })).deleted,
      };
    const seeded = await seedDemoWardrobe(base44);
    console.info(`[demo-reset] ${JSON.stringify({ email, includeRealData, removed, seeded })}`);
    return Response.json({ includeRealData, removed, seeded });
  } catch (error) {
    const message = safeMessage(error);
    console.error(`[demo-reset] ${JSON.stringify({ error: message })}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
