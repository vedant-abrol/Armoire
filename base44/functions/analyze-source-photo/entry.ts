import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";

const PARTS = new Set(["upperbody", "wholebody_up", "lowerbody", "accessories_up", "shoes"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          part: { type: "string", enum: ["upperbody", "wholebody_up", "lowerbody", "accessories_up", "shoes"] },
          color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          secondaryColor: {
            anyOf: [
              { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
              { type: "null" },
            ],
          },
          tags: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string", minLength: 1, maxLength: 40 },
          },
          boundingBox: {
            type: "object",
            additionalProperties: false,
            properties: {
              x: { type: "integer", minimum: 0, maximum: 999 },
              y: { type: "integer", minimum: 0, maximum: 999 },
              width: { type: "integer", minimum: 1, maximum: 1000 },
              height: { type: "integer", minimum: 1, maximum: 1000 },
            },
            required: ["x", "y", "width", "height"],
          },
          detectionConfidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name", "part", "color", "secondaryColor", "tags", "boundingBox", "detectionConfidence"],
      },
    },
  },
  required: ["items"],
};

const DETECTION_PROMPT = `Identify every distinct wearable clothing item visible in this image. A photo may show one isolated garment or a person wearing several items. Return one record per actual physical item that should enter a personal wardrobe.

Ignore the person's body, skin, hair, face, and all non-wearable background objects. Do not return furniture, packaging, hangers, mannequins, or duplicate records for the same garment. Include obscured garments only when enough of the item is visible to identify it reliably.

For each distinct wearable item:
- give it a concise, specific name based only on visible evidence;
- use exactly one of these category ids: upperbody, wholebody_up, lowerbody, accessories_up, shoes;
- return the dominant garment color as a six-digit hex value;
- return a secondary six-digit hex color only when a genuinely distinct color has meaningful visible coverage, otherwise null;
- return 1-4 useful lowercase tags describing visible material, construction, pattern, fit, or style without repeating the name or colors;
- return a tight bounding box around only that item using integer coordinates normalized to a 1000 by 1000 image: x and y are the top-left corner, followed by width and height. Boxes may overlap when garments overlap, but each box must focus on one distinct item;
- return detectionConfidence from 0 to 1 for confidence that the record is a distinct wearable item and the box identifies it correctly.

Return only data matching the supplied JSON schema. Do not include prose, markdown, a person's body, or background objects.`;

function normalizeBox(value: Record<string, unknown> = {}) {
  const integer = (key: string, fallback: number) => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  };
  const x = Math.max(0, Math.min(999, integer("x", 0)));
  const y = Math.max(0, Math.min(999, integer("y", 0)));
  const width = Math.max(1, Math.min(1000 - x, integer("width", 1000 - x)));
  const height = Math.max(1, Math.min(1000 - y, integer("height", 1000 - y)));
  return { x, y, width, height };
}

function normalizeItem(value: Record<string, unknown>) {
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 120) : "";
  const part = typeof value.part === "string" && PARTS.has(value.part) ? value.part : "";
  const color = typeof value.color === "string" && HEX_COLOR.test(value.color) ? value.color.toLowerCase() : "";
  const secondaryColor = typeof value.secondaryColor === "string" && HEX_COLOR.test(value.secondaryColor)
    ? value.secondaryColor.toLowerCase()
    : undefined;
  const tags = Array.isArray(value.tags)
    ? [...new Set(value.tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim().toLowerCase().slice(0, 40))
      .filter(Boolean))].slice(0, 4)
    : [];
  const confidence = Number(value.detectionConfidence);

  if (!name || !part || !color || !tags.length || !Number.isFinite(confidence)) return null;

  return {
    status: "pending",
    stage: "review",
    generationStatus: "idle",
    generationAttempts: 0,
    name,
    part,
    color,
    ...(secondaryColor && secondaryColor !== color ? { secondaryColor } : {}),
    tags,
    boundingBox: normalizeBox(value.boundingBox as Record<string, unknown>),
    detectionConfidence: Math.max(0, Math.min(1, confidence)),
  };
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "The photo could not be analyzed.";
  return message.replace(/https?:\/\/\S+/gi, "private file").slice(0, 500);
}

function belongsTo(record: Record<string, unknown>, userId: string, email: string) {
  const ownerId = typeof record.created_by_id === "string" ? record.created_by_id.trim() : "";
  if (ownerId) return Boolean(userId) && ownerId === userId;
  const ownerEmail = typeof record.created_by === "string" ? record.created_by.trim().toLowerCase() : "";
  return Boolean(email) && ownerEmail === email;
}

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  let sourcePhotoId = "";

  try {
    const user = await base44.auth.me();
    const userId = typeof user?.id === "string" ? user.id.trim() : "";
    const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!userId || !email) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const input = await req.json();
    sourcePhotoId = typeof input?.sourcePhotoId === "string" ? input.sourcePhotoId.trim() : "";
    if (!sourcePhotoId) return Response.json({ error: "sourcePhotoId is required" }, { status: 400 });

    let source;
    try {
      source = await base44.entities.SourcePhoto.get(sourcePhotoId);
    } catch {
      return Response.json({ error: "Source photo record no longer exists" }, { status: 404 });
    }
    if (!source) return Response.json({ error: "Source photo record no longer exists" }, { status: 404 });
    if (!belongsTo(source as Record<string, unknown>, userId, email)) {
      return Response.json({ error: "Source photo does not belong to current user" }, { status: 403 });
    }
    if (!source.privateFileUri) {
      return Response.json({ error: "Source photo is missing privateFileUri" }, { status: 409 });
    }

    const existing = await base44.entities.ImportJob.filter({ sourcePhotoId }, "created_date", 20, 0);
    if (existing.length) {
      const sourcePhoto = source.status === "review"
        ? source
        : await base44.entities.SourcePhoto.update(sourcePhotoId, {
          status: "review",
          detectedItemCount: existing.length,
          analysisError: "",
        });
      return Response.json({ sourcePhoto, jobs: existing });
    }

    await base44.entities.SourcePhoto.update(sourcePhotoId, {
      status: "analyzing",
      analysisError: "",
    });

    const { signed_url: signedUrl } = await base44.integrations.Core.CreateFileSignedUrl({
      file_uri: source.privateFileUri,
      expires_in: 300,
    });
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: DETECTION_PROMPT,
      file_urls: [signedUrl],
      response_json_schema: RESPONSE_SCHEMA,
    });
    const parsed = (typeof result === "string" ? JSON.parse(result) : result) as Record<string, unknown>;
    if (!Array.isArray(parsed.items)) throw new Error("AI analysis returned an invalid clothing list.");
    const rawItems = parsed.items;
    const candidates = rawItems.flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const normalized = normalizeItem(item as Record<string, unknown>);
      return normalized ? [{ ...normalized, sourcePhotoId }] : [];
    });
    if (candidates.length !== rawItems.length) throw new Error("AI analysis returned an invalid garment candidate.");

    const jobs = candidates.length
      ? await base44.entities.ImportJob.bulkCreate(candidates)
      : [];
    const sourcePhoto = await base44.entities.SourcePhoto.update(sourcePhotoId, {
      status: "review",
      detectedItemCount: jobs.length,
      analysisError: "",
    });

    return Response.json({ sourcePhoto, jobs });
  } catch (error) {
    const message = safeError(error);
    if (sourcePhotoId) {
      try {
        await base44.entities.SourcePhoto.update(sourcePhotoId, {
          status: "failed",
          analysisError: message,
        });
      } catch {
        // The original error remains the useful response when the status update also fails.
      }
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
