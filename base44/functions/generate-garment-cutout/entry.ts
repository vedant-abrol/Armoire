import { createClientFromRequest } from "npm:@base44/sdk@0.8.41";

const OPENAI_IMAGE_ENDPOINT = "https://api.openai.com/v1/images/edits";
const OPENAI_IMAGE_MODEL = "gpt-image-2";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ALLOWED_STAGES = new Set(["generation_ready", "garment_review", "failed"]);
const LEGACY_CANDIDATE_MESSAGE = "This candidate was created before garment generation was enabled. Please upload the source photo again.";

type Phase3Log = {
  authenticatedUserId: string;
  authenticatedUserEmail: string;
  importJobId: string;
  sourcePhotoId: string;
  importJobLookupSucceeded: boolean;
  sourcePhotoLookupSucceeded: boolean;
  importJobStage: string;
  importJobStatus: string;
  durableSourceFileUriExists: boolean;
  generationAttemptNumber: number;
};

function logPhase3(state: Phase3Log) {
  console.info(`[phase3] ${JSON.stringify(state)}`);
}

function belongsTo(record: Record<string, unknown>, userId: string, email: string) {
  const ownerId = typeof record.created_by_id === "string" ? record.created_by_id.trim() : "";
  if (ownerId) return Boolean(userId) && ownerId === userId;
  const ownerEmail = typeof record.created_by === "string" ? record.created_by.trim().toLowerCase() : "";
  return Boolean(email) && ownerEmail === email;
}

function safeError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "The garment could not be generated.";
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, "OpenAI credential")
    .replace(/https?:\/\/\S+/gi, "private file")
    .slice(0, 500);
}

function hexChannels(value: unknown) {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) return null;
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function chooseChromaKey(primary: unknown, secondary: unknown) {
  const garmentColors = [hexChannels(primary), hexChannels(secondary)].filter(Boolean) as number[][];
  const candidates = [
    [0, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
  ];
  const distance = (first: number[], second: number[]) => first.reduce(
    (total, channel, index) => total + ((channel - second[index]) ** 2),
    0,
  );
  const selected = candidates.sort((first, second) => {
    const firstDistance = garmentColors.length
      ? Math.min(...garmentColors.map((color) => distance(first, color)))
      : 0;
    const secondDistance = garmentColors.length
      ? Math.min(...garmentColors.map((color) => distance(second, color)))
      : 0;
    return secondDistance - firstDistance;
  })[0];
  return `#${selected.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function normalizedDirection(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function buildGarmentPrompt(job: Record<string, unknown>, chromaKey: string, direction: string) {
  const name = typeof job.name === "string" && job.name.trim() ? job.name.trim() : "clothing item";
  const category = typeof job.part === "string" && job.part.trim() ? job.part.trim() : "wardrobe item";
  const primary = typeof job.color === "string" && HEX_COLOR.test(job.color) ? job.color.toLowerCase() : "the exact visible primary color";
  const secondary = typeof job.secondaryColor === "string" && HEX_COLOR.test(job.secondaryColor)
    ? ` and the distinct secondary color ${job.secondaryColor.toLowerCase()}`
    : "";
  const details = Array.isArray(job.tags) && job.tags.length
    ? job.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 4).join(", ")
    : "all visibly supported construction and design details";
  const correction = direction
    ? `\nOwner correction for this regeneration: ${direction}. Apply this only to the extent supported by the original reference crop; it never authorizes inventing unsupported details.`
    : "";

  return `Use case: source-faithful wardrobe catalog cutout.

The input crop shows the exact selected physical garment, possibly worn by a person and possibly partly occluded. Reconstruct ONLY that one complete empty ${name} (${category}) as a clean, natural, front-facing catalog product image.

Preserve exactly what the reference supports: primary color ${primary}${secondary}; silhouette; material and texture; sleeve length; neckline; fit; seams; buttons, zippers, and other closures; visible pattern; visible graphics; and distinctive details (${details}). Preserve existing logos or words only when they are clearly legible in the reference. Do not invent, reinterpret, or add any logo, word, button, pocket, seam, hardware, color, pattern, or decoration that the crop does not support.

Remove the wearer, skin, hands, head, hair, every other garment, mannequin, hanger, retail tag, environment, prop, background object, cast shadow, contact shadow, reflection, caption, watermark, and border.

Output exactly one complete garment, centered, naturally arranged, approximately symmetrical, and fully visible with generous even padding. Use neutral diffuse catalog lighting contained on the garment.

The entire background must be one perfectly flat, uniform ${chromaKey} color from edge to edge, with no gradient, texture, vignette, floor, horizon, reflection, shadow, or lighting variation. Do not use ${chromaKey} on the garment. Keep a crisp, clean outer silhouette so the background can be removed without changing garment details.${correction}`;
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isDurablePrivateUri(value: unknown) {
  return typeof value === "string" && Boolean(value.trim()) && !/^(?:https?:|data:|blob:|\/)/i.test(value.trim());
}

async function openPrivateImage(base44: ReturnType<typeof createClientFromRequest>, privateFileUri: string, label: string) {
  const { signed_url: signedUrl } = await base44.integrations.Core.CreateFileSignedUrl({
    file_uri: privateFileUri,
    expires_in: 300,
  });
  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error(`The private ${label} could not be opened.`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error(`The ${label} is not a supported image.`);
  if (!blob.size || blob.size > 50 * 1024 * 1024) throw new Error(`The ${label} is empty or too large.`);
  return blob;
}

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  let ownedJob: Record<string, unknown> | null = null;
  let logState: Phase3Log = {
    authenticatedUserId: "",
    authenticatedUserEmail: "",
    importJobId: "",
    sourcePhotoId: "",
    importJobLookupSucceeded: false,
    sourcePhotoLookupSucceeded: false,
    importJobStage: "",
    importJobStatus: "",
    durableSourceFileUriExists: false,
    generationAttemptNumber: 0,
  };

  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

    const user = await base44.auth.me();
    const userId = typeof user?.id === "string" ? user.id.trim() : "";
    const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!userId || !email) return Response.json({ error: "Unauthorized" }, { status: 401 });
    logState = { ...logState, authenticatedUserId: userId, authenticatedUserEmail: email };

    const input = await req.json();
    const importJobId = typeof input?.importJobId === "string" ? input.importJobId.trim() : "";
    if (!importJobId) return Response.json({ error: "importJobId is required" }, { status: 400 });
    logState = { ...logState, importJobId };

    let job: Record<string, unknown>;
    try {
      job = await base44.entities.ImportJob.get(importJobId) as Record<string, unknown>;
    } catch {
      logPhase3(logState);
      return Response.json({ error: "Import job not found" }, { status: 404 });
    }
    if (!job) {
      logPhase3(logState);
      return Response.json({ error: "Import job not found" }, { status: 404 });
    }
    logState = {
      ...logState,
      importJobLookupSucceeded: true,
      importJobStage: String(job.stage || ""),
      importJobStatus: String(job.status || ""),
      generationAttemptNumber: Math.max(0, Number(job.generationAttempts) || 0) + 1,
    };
    if (!belongsTo(job, userId, email)) {
      logPhase3(logState);
      return Response.json({ error: "Import job does not belong to current user" }, { status: 403 });
    }
    ownedJob = job;

    const sourcePhotoId = typeof job.sourcePhotoId === "string" ? job.sourcePhotoId.trim() : "";
    logState = { ...logState, sourcePhotoId };
    if (!sourcePhotoId) {
      logPhase3(logState);
      return Response.json({ error: LEGACY_CANDIDATE_MESSAGE }, { status: 409 });
    }
    if (job.status !== "approved" || !ALLOWED_STAGES.has(String(job.stage || ""))) {
      logPhase3(logState);
      return Response.json({ error: "This candidate is not ready for garment generation" }, { status: 409 });
    }

    let source: Record<string, unknown>;
    try {
      source = await base44.entities.SourcePhoto.get(sourcePhotoId) as Record<string, unknown>;
    } catch {
      logPhase3(logState);
      return Response.json({ error: "Source photo record no longer exists" }, { status: 404 });
    }
    if (!source) {
      logPhase3(logState);
      return Response.json({ error: "Source photo record no longer exists" }, { status: 404 });
    }
    logState = {
      ...logState,
      sourcePhotoLookupSucceeded: true,
      durableSourceFileUriExists: isDurablePrivateUri(source.privateFileUri),
    };
    if (!belongsTo(source, userId, email)) {
      logPhase3(logState);
      return Response.json({ error: "Source photo does not belong to current user" }, { status: 403 });
    }
    if (!isDurablePrivateUri(source.privateFileUri)) {
      logPhase3(logState);
      return Response.json({ error: "Source photo is missing privateFileUri" }, { status: 409 });
    }

    const cropUri = typeof job.candidateCropUri === "string" ? job.candidateCropUri.trim() : "";
    if (!isDurablePrivateUri(cropUri)) {
      logPhase3(logState);
      return Response.json({ error: "The approved candidate crop is not ready" }, { status: 409 });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
    if (!apiKey) {
      logPhase3(logState);
      return Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
    }

    const direction = normalizedDirection(input?.regenerationDirection ?? job.regenerationDirection);
    const chromaKey = chooseChromaKey(job.color, job.secondaryColor);
    const prompt = buildGarmentPrompt(job, chromaKey, direction);
    const attempts = logState.generationAttemptNumber;

    await openPrivateImage(base44, String(source.privateFileUri), "source photo");
    const cropBlob = await openPrivateImage(base44, cropUri, "candidate crop");
    logPhase3(logState);

    if (input?.dryRun === true) {
      return Response.json({
        message: "Phase 3 prerequisites verified. Ready for one image generation request.",
        importJobId,
        sourcePhotoId,
        generationAttemptNumber: attempts,
      });
    }

    ownedJob = await base44.entities.ImportJob.update(importJobId, {
      stage: "generating_garment",
      generationStatus: "generating",
      generationAttempts: attempts,
      generationChromaKey: chromaKey,
      generationPrompt: prompt,
      regenerationDirection: direction,
      generationError: "",
      error: "",
    }) as Record<string, unknown>;

    const form = new FormData();
    form.set("model", OPENAI_IMAGE_MODEL);
    form.set("prompt", prompt);
    form.set("size", "1024x1024");
    form.set("quality", "high");
    form.set("output_format", "png");
    form.append("image[]", cropBlob, "candidate-crop.png");

    const openAIResponse = await fetch(OPENAI_IMAGE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const openAIResult = await openAIResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!openAIResponse.ok) {
      const apiError = openAIResult.error as Record<string, unknown> | undefined;
      const upstream = typeof apiError?.message === "string" ? apiError.message : `request failed (${openAIResponse.status})`;
      throw new Error(`OpenAI generation failed: ${safeError(upstream)}`);
    }
    const data = Array.isArray(openAIResult.data) ? openAIResult.data : [];
    const encoded = data[0] && typeof data[0] === "object" && typeof (data[0] as Record<string, unknown>).b64_json === "string"
      ? String((data[0] as Record<string, unknown>).b64_json)
      : "";
    if (!encoded) throw new Error("OpenAI returned no garment image data.");

    const generatedFile = new File(
      [decodeBase64(encoded)],
      `garment-${importJobId}-${attempts}.png`,
      { type: "image/png" },
    );
    const { file_uri: generatedSourceUri } = await base44.integrations.Core.UploadPrivateFile({
      file: generatedFile,
    });
    const updatedJob = await base44.entities.ImportJob.update(importJobId, {
      generatedSourceUri,
      stage: "preparing_cutout",
      generationStatus: "preparing_cutout",
      generationError: "",
      error: "",
    });

    return Response.json({ job: updatedJob, model: OPENAI_IMAGE_MODEL });
  } catch (error) {
    const message = safeError(error);
    logPhase3(logState);
    if (ownedJob && typeof ownedJob.id === "string") {
      try {
        await base44.entities.ImportJob.update(ownedJob.id, {
          stage: "failed",
          generationStatus: "failed",
          generationError: message,
          error: message,
        });
      } catch {
        // Keep the original generation failure as the response.
      }
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
