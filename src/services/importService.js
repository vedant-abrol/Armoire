import { base44 } from "../api/base44Client.js";

const sourcePhotos = base44.entities.SourcePhoto;
const importJobs = base44.entities.ImportJob;
export const LEGACY_CANDIDATE_MESSAGE = "This candidate was created before garment generation was enabled. Please upload the source photo again.";

function isPrivateFileUri(value) {
  return typeof value === "string" && Boolean(value) && !/^(?:https?:|data:|blob:|\/)/i.test(value);
}

function normalizeSourcePhoto(photo) {
  return {
    ...photo,
    detectedItemCount: Number.isFinite(photo.detectedItemCount) ? photo.detectedItemCount : 0,
    analysisError: photo.analysisError || "",
  };
}

function normalizeImportJob(job) {
  return {
    ...job,
    secondaryColor: job.secondaryColor || null,
    tags: Array.isArray(job.tags) ? job.tags : [],
    boundingBox: job.boundingBox || { x: 0, y: 0, width: 1000, height: 1000 },
    detectionConfidence: Number.isFinite(job.detectionConfidence) ? job.detectionConfidence : 0,
    candidateCropUri: job.candidateCropUri || job.cropUri || "",
    generatedSourceUri: job.generatedSourceUri || "",
    generatedCutoutUri: job.generatedCutoutUri || job.cutoutUri || "",
    generationStatus: job.generationStatus || "idle",
    generationAttempts: Number.isFinite(job.generationAttempts) ? job.generationAttempts : 0,
    generationError: job.generationError || job.error || "",
    regenerationDirection: job.regenerationDirection || "",
    deduplicationStatus: job.deduplicationStatus || "not_checked",
    deduplicationMatchWardrobeItemId: job.deduplicationMatchWardrobeItemId || "",
    deduplicationConfidence: Number.isFinite(job.deduplicationConfidence) ? job.deduplicationConfidence : 0,
    deduplicationReason: job.deduplicationReason || "",
  };
}

function normalizeBox(value = {}) {
  const integer = (key, fallback) => Number.isFinite(Number(value[key])) ? Math.round(Number(value[key])) : fallback;
  const x = Math.max(0, Math.min(999, integer("x", 0)));
  const y = Math.max(0, Math.min(999, integer("y", 0)));
  const width = Math.max(1, Math.min(1000 - x, integer("width", 1000 - x)));
  const height = Math.max(1, Math.min(1000 - y, integer("height", 1000 - y)));
  return { x, y, width, height };
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not prepare this image.")), "image/png");
  });
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The private image could not be decoded."));
    };
    image.src = url;
  });
}

async function fetchPrivateImage(privateFileUri) {
  const signedUrl = await createPrivatePreviewUrl(privateFileUri);
  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error("The private image could not be opened.");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("The private file is not a supported image.");
  return blob;
}

async function cropCandidateImage(sourceBlob, boundingBox) {
  const image = await loadImage(sourceBlob);
  const box = normalizeBox(boundingBox);
  const rawLeft = (box.x / 1000) * image.naturalWidth;
  const rawTop = (box.y / 1000) * image.naturalHeight;
  const rawWidth = (box.width / 1000) * image.naturalWidth;
  const rawHeight = (box.height / 1000) * image.naturalHeight;
  const padding = Math.max(12, Math.round(Math.max(rawWidth, rawHeight) * 0.08));
  const left = Math.max(0, Math.floor(rawLeft - padding));
  const top = Math.max(0, Math.floor(rawTop - padding));
  const right = Math.min(image.naturalWidth, Math.ceil(rawLeft + rawWidth + padding));
  const bottom = Math.min(image.naturalHeight, Math.ceil(rawTop + rawHeight + padding));
  const cropWidth = Math.max(1, right - left);
  const cropHeight = Math.max(1, bottom - top);
  const scale = Math.min(1, 2048 / Math.max(cropWidth, cropHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas);
}

function parseHex(value) {
  const match = typeof value === "string" ? value.match(/^#([0-9a-f]{6})$/i) : null;
  return match ? [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16)) : null;
}

async function removeGeneratedBackground(sourceBlob, chromaKey) {
  const target = parseHex(chromaKey);
  if (!target) throw new Error("The generated background color is invalid.");
  const image = await loadImage(sourceBlob);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const keyedChannels = target.map((channel, index) => channel > 200 ? index : null).filter((index) => index !== null);
  const neutralChannels = target.map((channel, index) => channel < 55 ? index : null).filter((index) => index !== null);
  const tolerance = 48;
  const feather = 86;
  let transparentPixels = 0;
  let visiblePixels = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const distance = Math.sqrt(
      ((pixels[index] - target[0]) ** 2)
      + ((pixels[index + 1] - target[1]) ** 2)
      + ((pixels[index + 2] - target[2]) ** 2),
    );
    if (distance <= tolerance) {
      pixels[index] = 0;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      pixels[index + 3] = 0;
      transparentPixels += 1;
      continue;
    }
    visiblePixels += 1;
    if (distance < tolerance + feather) {
      pixels[index + 3] = Math.round(pixels[index + 3] * ((distance - tolerance) / feather));
    }
    const keyedLevel = keyedChannels.reduce((total, channel) => total + pixels[index + channel], 0) / keyedChannels.length;
    const neutralLevel = neutralChannels.reduce((total, channel) => total + pixels[index + channel], 0) / neutralChannels.length;
    const spill = Math.max(0, keyedLevel - neutralLevel);
    if (spill > 0 && distance < tolerance + (feather * 1.75)) {
      for (const channel of keyedChannels) pixels[index + channel] = Math.max(0, Math.round(pixels[index + channel] - spill));
    }
  }

  const totalPixels = canvas.width * canvas.height;
  if (transparentPixels < totalPixels * 0.02 || visiblePixels < totalPixels * 0.005) {
    throw new Error("The generated background was not clean enough to remove safely. Regenerate the garment to try again.");
  }
  context.putImageData(imageData, 0, 0);
  return canvasBlob(canvas);
}

function generationMessage(error) {
  return (error?.response?.data?.error || error?.message || "The garment could not be generated.")
    .replace(/https?:\/\/\S+/gi, "private file")
    .slice(0, 500);
}

export async function listPhotoImports() {
  const [photos, jobs] = await Promise.all([
    sourcePhotos.list("-created_date", 500, 0),
    importJobs.list("created_date", 2000, 0),
  ]);
  return {
    photos: photos.map(normalizeSourcePhoto),
    jobs: jobs.map(normalizeImportJob),
  };
}

export async function createSourcePhoto(file) {
  const { file_uri: privateFileUri } = await base44.integrations.Core.UploadPrivateFile({ file });
  const photo = await sourcePhotos.create({
    privateFileUri,
    originalFilename: file.name || "Untitled photo",
    status: "uploaded",
    detectedItemCount: 0,
  });
  return normalizeSourcePhoto(photo);
}

export async function analyzeSourcePhoto(sourcePhotoId) {
  const response = await base44.functions.invoke("analyze-source-photo", { sourcePhotoId });
  return {
    sourcePhoto: normalizeSourcePhoto(response.data.sourcePhoto),
    jobs: (response.data.jobs || []).map(normalizeImportJob),
  };
}

export async function createPrivatePreviewUrl(privateFileUri) {
  const { signed_url: signedUrl } = await base44.integrations.Core.CreateFileSignedUrl({
    file_uri: privateFileUri,
    expires_in: 900,
  });
  return signedUrl;
}

export const createSourcePreviewUrl = createPrivatePreviewUrl;

export async function updateImportCandidate(id, changes) {
  const updated = await importJobs.update(id, changes);
  return normalizeImportJob(updated);
}

export async function prepareCandidateCrop(job, sourcePrivateFileUri) {
  try {
    await updateImportCandidate(job.id, {
      status: "approved",
      stage: "preparing_crop",
      generationStatus: "preparing_crop",
      generationError: "",
      error: "",
    });
    const sourceBlob = await fetchPrivateImage(sourcePrivateFileUri);
    const cropBlob = await cropCandidateImage(sourceBlob, job.boundingBox);
    const cropFile = new File([cropBlob], `candidate-${job.id}.png`, { type: "image/png" });
    const { file_uri: candidateCropUri } = await base44.integrations.Core.UploadPrivateFile({ file: cropFile });
    return updateImportCandidate(job.id, {
      candidateCropUri,
      cropUri: candidateCropUri,
      stage: "generation_ready",
      generationStatus: "ready_to_generate",
      generationError: "",
      error: "",
    });
  } catch (error) {
    const message = generationMessage(error);
    await updateImportCandidate(job.id, {
      stage: "failed",
      generationStatus: "failed",
      generationError: message,
      error: message,
    }).catch(() => {});
    throw error;
  }
}

export async function verifyGarmentGenerationPrerequisites(job, regenerationDirection = "") {
  const response = await base44.functions.invoke("generate-garment-cutout", {
    importJobId: job.id,
    regenerationDirection: regenerationDirection.trim().slice(0, 500),
    dryRun: true,
  });
  if (response.data?.message !== "Phase 3 prerequisites verified. Ready for one image generation request.") {
    throw new Error("Phase 3 prerequisite verification returned an unexpected response.");
  }
  return response.data;
}

export async function generateGarmentCutout(job, regenerationDirection = "") {
  try {
    const response = await base44.functions.invoke("generate-garment-cutout", {
      importJobId: job.id,
      regenerationDirection: regenerationDirection.trim().slice(0, 500),
    });
    const generated = normalizeImportJob(response.data.job);
    const sourceBlob = await fetchPrivateImage(generated.generatedSourceUri);
    const cutoutBlob = await removeGeneratedBackground(sourceBlob, generated.generationChromaKey);
    const cutoutFile = new File(
      [cutoutBlob],
      `wardrobe-${generated.id}-${generated.generationAttempts}.png`,
      { type: "image/png" },
    );
    const { file_uri: generatedCutoutUri } = await base44.integrations.Core.UploadPrivateFile({ file: cutoutFile });
    return updateImportCandidate(generated.id, {
      generatedCutoutUri,
      cutoutUri: generatedCutoutUri,
      stage: "garment_review",
      generationStatus: "ready",
      generationError: "",
      error: "",
    });
  } catch (error) {
    const message = generationMessage(error);
    await updateImportCandidate(job.id, {
      stage: "failed",
      generationStatus: "failed",
      generationError: message,
      error: message,
    }).catch(() => {});
    throw error;
  }
}

export async function rejectGeneratedGarment(jobId) {
  return updateImportCandidate(jobId, {
    status: "rejected",
    stage: "rejected",
    generationStatus: "rejected",
    generationError: "",
    error: "",
  });
}

export async function approveGeneratedGarment(jobId, deduplicationDecision = "") {
  const response = await base44.functions.invoke("approve-garment-import", {
    importJobId: jobId,
    ...(deduplicationDecision ? { deduplicationDecision } : {}),
  });
  const deduplication = response.data.deduplication || { status: "no_match" };
  if (deduplication.existingItem) {
    const existingImageUri = deduplication.existingItem.thumbnail || deduplication.existingItem.image || "";
    deduplication.existingItem = {
      ...deduplication.existingItem,
      imageUri: existingImageUri,
      image: isPrivateFileUri(existingImageUri) ? await createPrivatePreviewUrl(existingImageUri) : existingImageUri,
    };
  }
  return {
    job: normalizeImportJob(response.data.job),
    item: response.data.item,
    deduplication,
  };
}
