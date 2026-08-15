import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";
import { DEMO_EMAIL } from "../../shared/demo-fixtures.js";
import { seedDemoWardrobe } from "../../shared/demo-seed.ts";

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : "The demo wardrobe could not be prepared.")
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
    if (email !== DEMO_EMAIL) return Response.json({ error: "Demo seeding is not available for this account" }, { status: 403 });

    const result = await seedDemoWardrobe(base44);
    console.info(`[demo-seed] ${JSON.stringify({ email, ...result })}`);
    return Response.json(result);
  } catch (error) {
    const message = safeMessage(error);
    console.error(`[demo-seed] ${JSON.stringify({ error: message })}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
