import { base44 } from "../api/base44Client.js";

const entity = base44.entities.WardrobeItem;
const STRING_FIELDS = ["name", "part", "color", "secondaryColor", "image", "thumbnail", "modeledImage", "status", "importJobId", "demoFixtureKey"];
const CLEARABLE_STRING_FIELDS = new Set(["secondaryColor", "modeledImage"]);

function wardrobePayload(item, { partial = false } = {}) {
  const payload = {};

  for (const field of STRING_FIELDS) {
    if (partial && !Object.hasOwn(item, field)) continue;
    const durableValue = field === "image"
      ? item.imageUri || item.image
      : field === "thumbnail"
        ? item.thumbnailUri || item.thumbnail
        : field === "modeledImage"
          ? item.modeledImageUri || item.modeledImage
          : item[field];
    const value = typeof durableValue === "string" ? durableValue.trim() : "";
    if (value || (partial && CLEARABLE_STRING_FIELDS.has(field))) payload[field] = value;
  }

  if (!partial || Object.hasOwn(item, "tags")) {
    payload.tags = Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  }
  if (!partial || Object.hasOwn(item, "palette")) {
    payload.palette = Array.isArray(item.palette) ? item.palette.filter(Boolean) : [];
  }
  for (const field of ["demoFixture", "demoSeedVersion", "fixtureOrder"]) {
    if (partial && !Object.hasOwn(item, field)) continue;
    if (typeof item[field] === "boolean" || Number.isFinite(item[field])) payload[field] = item[field];
  }
  return payload;
}

function isPrivateFileUri(value) {
  return typeof value === "string" && Boolean(value) && !/^(?:https?:|data:|blob:|\/)/i.test(value);
}

async function signedImageUrl(value) {
  if (!isPrivateFileUri(value)) return value || "";
  const { signed_url: signedUrl } = await base44.integrations.Core.CreateFileSignedUrl({
    file_uri: value,
    expires_in: 900,
  });
  return signedUrl;
}

async function normalizeWardrobeItem(item) {
  const imageUri = item.image || "";
  const thumbnailUri = item.thumbnail || imageUri;
  const modeledImageUri = item.modeledImage || "";
  const imagePromise = signedImageUrl(imageUri);
  const [image, thumbnail, modeledImage] = await Promise.all([
    imagePromise,
    thumbnailUri === imageUri ? imagePromise : signedImageUrl(thumbnailUri),
    signedImageUrl(modeledImageUri),
  ]);
  return {
    ...item,
    name: item.name || "",
    color: item.color || null,
    secondaryColor: item.secondaryColor || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    palette: Array.isArray(item.palette) ? item.palette : [],
    imageUri,
    thumbnailUri,
    modeledImageUri: modeledImageUri || null,
    image,
    thumbnail: thumbnail || image,
    modeledImage: modeledImage || null,
    status: item.status || "active",
    demoFixture: item.demoFixture === true,
    demoFixtureKey: item.demoFixtureKey || null,
    demoSeedVersion: Number.isFinite(item.demoSeedVersion) ? item.demoSeedVersion : null,
    fixtureOrder: Number.isFinite(item.fixtureOrder) ? item.fixtureOrder : null,
  };
}

export async function listWardrobeItems() {
  const items = await entity.list("created_date", 5000, 0);
  return Promise.all(items.map(normalizeWardrobeItem));
}

export async function createWardrobeItem(item) {
  const created = await entity.create(wardrobePayload({ status: "active", ...item }));
  return normalizeWardrobeItem(created);
}

export async function updateWardrobeItem(id, changes) {
  const updated = await entity.update(id, wardrobePayload(changes, { partial: true }));
  return normalizeWardrobeItem(updated);
}

export function deleteWardrobeItem(id) {
  return entity.delete(id);
}
