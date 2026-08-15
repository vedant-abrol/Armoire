import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";

const LEGACY_CANDIDATE_MESSAGE = "This candidate was created before garment generation was enabled. Please upload the source photo again.";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const REVIEW_THRESHOLD = 0.7;

const MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matchWardrobeItemId: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", minLength: 1, maxLength: 500 },
  },
  required: ["matchWardrobeItemId", "confidence", "reason"],
};

type EntityRecord = Record<string, unknown> & { id: string };

function belongsTo(record: Record<string, unknown>, userId: string, email: string) {
  const ownerId = typeof record.created_by_id === "string" ? record.created_by_id.trim() : "";
  if (ownerId) return Boolean(userId) && ownerId === userId;
  const ownerEmail = typeof record.created_by === "string" ? record.created_by.trim().toLowerCase() : "";
  return Boolean(email) && ownerEmail === email;
}

function isDurablePrivateUri(value: unknown) {
  return typeof value === "string" && Boolean(value.trim()) && !/^(?:https?:|data:|blob:|\/)/i.test(value.trim());
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "The garment could not be added to the wardrobe.";
  return message.replace(/https?:\/\/\S+/gi, "private file").slice(0, 500);
}

function channels(value: unknown) {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) return null;
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function colorSimilarity(first: unknown, second: unknown) {
  const firstChannels = channels(first);
  const secondChannels = channels(second);
  if (!firstChannels || !secondChannels) return 0;
  const distance = Math.sqrt(firstChannels.reduce((total, channel, index) => total + ((channel - secondChannels[index]) ** 2), 0));
  return Math.max(0, 1 - (distance / Math.sqrt(3 * (255 ** 2))));
}

function normalizedTags(value: unknown) {
  return new Set(Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().toLowerCase()).filter(Boolean)
    : []);
}

function tagOverlap(first: unknown, second: unknown) {
  const firstTags = normalizedTags(first);
  const secondTags = normalizedTags(second);
  if (!firstTags.size || !secondTags.size) return 0;
  const intersection = [...firstTags].filter((tag) => secondTags.has(tag)).length;
  return intersection / new Set([...firstTags, ...secondTags]).size;
}

function plausibleMatches(job: EntityRecord, items: EntityRecord[]) {
  return items
    .filter((item) => item.part === job.part && item.demoFixture !== true && item.status !== "archived")
    .map((item) => {
      const primarySimilarity = colorSimilarity(job.color, item.color);
      const secondarySimilarity = Math.max(
        colorSimilarity(job.color, item.secondaryColor),
        colorSimilarity(job.secondaryColor, item.color),
        colorSimilarity(job.secondaryColor, item.secondaryColor),
      );
      const overlap = tagOverlap(job.tags, item.tags);
      return { item, score: (Math.max(primarySimilarity, secondarySimilarity * .9) * .72) + (overlap * .28) };
    })
    .filter(({ score }) => score >= .48)
    .sort((first, second) => second.score - first.score)
    .slice(0, 5);
}

function deduplicationPrompt(job: EntityRecord, candidates: { item: EntityRecord; score: number }[]) {
  return `Determine whether this newly photographed garment is the exact same physical wardrobe item as one of the plausible existing candidates. Be conservative: false merging is worse than creating a duplicate. Similar category and color alone are never enough.

New garment: ${JSON.stringify({ name: job.name, category: job.part, primaryColor: job.color, secondaryColor: job.secondaryColor || null, tags: job.tags || [] })}

Plausible existing candidates: ${JSON.stringify(candidates.map(({ item, score }) => ({ id: item.id, name: item.name, category: item.part, primaryColor: item.color, secondaryColor: item.secondaryColor || null, tags: item.tags || [], metadataSimilarity: Number(score.toFixed(3)) })))}

Return matchWardrobeItemId only when construction, silhouette, material, color treatment, and distinctive details collectively support the same physical item. Otherwise return null. Confidence must express same-physical-item confidence, not general visual similarity. Return only strict JSON matching the supplied schema.`;
}

function parseMatch(value: unknown, candidates: { item: EntityRecord }[]) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object") throw new Error("Deduplication AI returned an invalid response.");
  const record = parsed as Record<string, unknown>;
  const candidateIds = new Set(candidates.map(({ item }) => item.id));
  const matchWardrobeItemId = typeof record.matchWardrobeItemId === "string" && candidateIds.has(record.matchWardrobeItemId)
    ? record.matchWardrobeItemId
    : null;
  const confidence = Number(record.confidence);
  const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, 500) : "";
  if (!Number.isFinite(confidence) || !reason) throw new Error("Deduplication AI returned incomplete reasoning.");
  return { matchWardrobeItemId, confidence: Math.max(0, Math.min(1, confidence)), reason };
}

async function ensureAppearance(base44: any, job: EntityRecord, wardrobeItemId: string, duplicateConfidence: number) {
  const existing = await base44.entities.WardrobeAppearance.filter({ importJobId: job.id }, "created_date", 1, 0);
  if (existing[0]) return existing[0];
  return base44.entities.WardrobeAppearance.create({
    wardrobeItemId,
    ...(typeof job.sourcePhotoId === "string" && job.sourcePhotoId ? { sourcePhotoId: job.sourcePhotoId } : {}),
    importJobId: job.id,
    ...(job.boundingBox ? { boundingBox: job.boundingBox } : {}),
    ...(Number.isFinite(Number(job.detectionConfidence)) ? { detectionConfidence: Number(job.detectionConfidence) } : {}),
    duplicateConfidence,
    demoFixture: false,
  });
}

async function createNewItem(base44: any, job: EntityRecord, cutoutUri: string) {
  const colors = [job.color, job.secondaryColor].filter((color): color is string => typeof color === "string" && Boolean(color));
  const item = await base44.entities.WardrobeItem.create({
    name: job.name,
    part: job.part,
    color: job.color,
    ...(job.secondaryColor ? { secondaryColor: job.secondaryColor } : {}),
    tags: Array.isArray(job.tags) ? job.tags : [],
    image: cutoutUri,
    thumbnail: cutoutUri,
    palette: colors,
    status: "active",
    importJobId: job.id,
    demoFixture: false,
  });
  await ensureAppearance(base44, job, item.id, 0);
  return item as EntityRecord;
}

async function completeJob(base44: any, job: EntityRecord, item: EntityRecord, deduplication: { status: string; matchWardrobeItemId?: string | null; confidence: number; reason: string }) {
  const updatedJob = await base44.entities.ImportJob.update(job.id, {
    status: "complete",
    stage: "complete",
    generationStatus: "approved",
    generationError: "",
    error: "",
    wardrobeItemId: item.id,
    deduplicationStatus: deduplication.status,
    ...(deduplication.matchWardrobeItemId ? { deduplicationMatchWardrobeItemId: deduplication.matchWardrobeItemId } : {}),
    deduplicationConfidence: deduplication.confidence,
    deduplicationReason: deduplication.reason,
  });
  return { item, job: updatedJob };
}

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const user = await base44.auth.me();
    const userId = typeof user?.id === "string" ? user.id.trim() : "";
    const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!userId || !email) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const input = await req.json();
    const importJobId = typeof input?.importJobId === "string" ? input.importJobId.trim() : "";
    const decision = typeof input?.deduplicationDecision === "string" ? input.deduplicationDecision : "";
    if (!importJobId) return Response.json({ error: "importJobId is required" }, { status: 400 });
    if (decision && !["same_item", "add_new"].includes(decision)) return Response.json({ error: "Invalid deduplicationDecision" }, { status: 400 });

    let job: EntityRecord;
    try {
      job = await base44.entities.ImportJob.get(importJobId) as EntityRecord;
    } catch {
      return Response.json({ error: "Import job not found" }, { status: 404 });
    }
    if (!job) return Response.json({ error: "Import job not found" }, { status: 404 });
    if (!belongsTo(job, userId, email)) return Response.json({ error: "Import job does not belong to current user" }, { status: 403 });

    if (job.status === "complete" && typeof job.wardrobeItemId === "string" && job.wardrobeItemId) {
      const item = await base44.entities.WardrobeItem.get(job.wardrobeItemId) as EntityRecord;
      if (!item || !belongsTo(item, userId, email)) return Response.json({ error: "Wardrobe item not found" }, { status: 404 });
      await ensureAppearance(base44, job, item.id, Number(job.deduplicationConfidence) || 0);
      return Response.json({ item, job, deduplication: { status: job.deduplicationStatus || "no_match", existingWardrobePieceRecognized: job.deduplicationStatus === "same_item" } });
    }

    const sourcePhotoId = typeof job.sourcePhotoId === "string" ? job.sourcePhotoId.trim() : "";
    const cutoutUri = typeof job.generatedCutoutUri === "string" ? job.generatedCutoutUri : "";
    if (!sourcePhotoId) return Response.json({ error: LEGACY_CANDIDATE_MESSAGE }, { status: 409 });
    if (!isDurablePrivateUri(cutoutUri)) return Response.json({ error: "The generated garment is not ready" }, { status: 409 });

    let source: EntityRecord;
    try {
      source = await base44.entities.SourcePhoto.get(sourcePhotoId) as EntityRecord;
    } catch {
      return Response.json({ error: "Source photo record no longer exists" }, { status: 404 });
    }
    if (!source || !belongsTo(source, userId, email)) return Response.json({ error: "Source photo does not belong to current user" }, { status: 403 });
    if (!isDurablePrivateUri(source.privateFileUri)) return Response.json({ error: "Source photo is missing privateFileUri" }, { status: 409 });
    if (job.stage !== "garment_review" || job.generationStatus !== "ready") return Response.json({ error: "The generated garment is not ready for approval" }, { status: 409 });

    const existingByImport = await base44.entities.WardrobeItem.filter({ importJobId }, "created_date", 1, 0) as EntityRecord[];
    if (existingByImport[0]) {
      if (!belongsTo(existingByImport[0], userId, email)) return Response.json({ error: "Wardrobe item not found" }, { status: 404 });
      await ensureAppearance(base44, job, existingByImport[0].id, 0);
      const completed = await completeJob(base44, job, existingByImport[0], { status: "no_match", confidence: 0, reason: "Existing idempotent import record reused." });
      return Response.json({ ...completed, deduplication: { status: "no_match", existingWardrobePieceRecognized: false } });
    }

    if (!decision && job.deduplicationStatus === "review_required" && typeof job.deduplicationMatchWardrobeItemId === "string") {
      const existingItem = await base44.entities.WardrobeItem.get(job.deduplicationMatchWardrobeItemId) as EntityRecord;
      if (!existingItem || !belongsTo(existingItem, userId, email) || existingItem.demoFixture === true) {
        return Response.json({ error: "The proposed wardrobe match is no longer available" }, { status: 409 });
      }
      return Response.json({
        job,
        item: null,
        deduplication: {
          status: "review_required",
          confidence: Number(job.deduplicationConfidence) || 0,
          reason: String(job.deduplicationReason || "Review this possible match."),
          existingItem,
          existingWardrobePieceRecognized: false,
        },
      });
    }

    if (decision === "same_item") {
      const matchId = typeof job.deduplicationMatchWardrobeItemId === "string" ? job.deduplicationMatchWardrobeItemId : "";
      if (job.deduplicationStatus !== "review_required" || !matchId) return Response.json({ error: "No reviewed wardrobe match is available" }, { status: 409 });
      const match = await base44.entities.WardrobeItem.get(matchId) as EntityRecord;
      if (!match || !belongsTo(match, userId, email) || match.demoFixture === true) return Response.json({ error: "Matched wardrobe item not found" }, { status: 404 });
      const confidence = Number(job.deduplicationConfidence) || 0;
      await ensureAppearance(base44, job, match.id, confidence);
      const completed = await completeJob(base44, job, match, { status: "same_item", matchWardrobeItemId: match.id, confidence, reason: String(job.deduplicationReason || "Confirmed by the user.") });
      return Response.json({ ...completed, deduplication: { status: "same_item", confidence, reason: job.deduplicationReason, existingWardrobePieceRecognized: true } });
    }

    if (decision === "add_new") {
      const item = await createNewItem(base44, job, cutoutUri);
      const confidence = Number(job.deduplicationConfidence) || 0;
      const completed = await completeJob(base44, job, item, { status: "add_new", matchWardrobeItemId: typeof job.deduplicationMatchWardrobeItemId === "string" ? job.deduplicationMatchWardrobeItemId : null, confidence, reason: "User chose to keep this as a distinct physical item." });
      return Response.json({ ...completed, deduplication: { status: "add_new", confidence, existingWardrobePieceRecognized: false } });
    }

    const wardrobeItems = await base44.entities.WardrobeItem.list("created_date", 5000, 0) as EntityRecord[];
    const candidates = plausibleMatches(job, wardrobeItems);
    let match = { matchWardrobeItemId: null as string | null, confidence: 0, reason: "No plausible existing item passed the metadata filter." };
    let unavailable = false;
    if (candidates.length) {
      try {
        match = parseMatch(await base44.integrations.Core.InvokeLLM({
          prompt: deduplicationPrompt(job, candidates),
          response_json_schema: MATCH_SCHEMA,
        }), candidates);
      } catch (error) {
        unavailable = true;
        match = { matchWardrobeItemId: null, confidence: 0, reason: `Similarity check unavailable: ${safeError(error)}` };
        console.warn(`[phase4-dedup] ${JSON.stringify({ email, importJobId, status: "unavailable", reason: match.reason })}`);
      }
    }

    if (match.matchWardrobeItemId && match.confidence >= REVIEW_THRESHOLD) {
      const existingItem = candidates.find(({ item }) => item.id === match.matchWardrobeItemId)?.item;
      if (!existingItem) throw new Error("The proposed wardrobe match is no longer available.");
      const updatedJob = await base44.entities.ImportJob.update(importJobId, {
        deduplicationStatus: "review_required",
        deduplicationMatchWardrobeItemId: existingItem.id,
        deduplicationConfidence: match.confidence,
        deduplicationReason: match.reason,
      });
      console.info(`[phase4-dedup] ${JSON.stringify({ email, importJobId, status: "review_required", matchWardrobeItemId: existingItem.id, confidence: match.confidence })}`);
      return Response.json({
        job: updatedJob,
        item: null,
        deduplication: { status: "review_required", confidence: match.confidence, reason: match.reason, existingItem, existingWardrobePieceRecognized: false },
      });
    }

    const item = await createNewItem(base44, job, cutoutUri);
    const status = unavailable ? "unavailable" : "no_match";
    const completed = await completeJob(base44, job, item, { status, confidence: match.confidence, reason: match.reason });
    console.info(`[phase4-dedup] ${JSON.stringify({ email, importJobId, status, confidence: match.confidence })}`);
    return Response.json({ ...completed, deduplication: { status, confidence: match.confidence, reason: match.reason, existingWardrobePieceRecognized: false } });
  } catch (error) {
    return Response.json({ error: safeError(error) }, { status: 500 });
  }
}
