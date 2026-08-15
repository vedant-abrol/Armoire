import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DEMO_APPEARANCE_COUNTS,
  DEMO_FIXTURE_SUMMARY,
  DEMO_ITEMS,
  DEMO_OUTFITS,
} from "../base44/shared/demo-fixtures.js";
import { DEMO_COMMERCE_FIXTURES } from "../src/demoCommerceFixtures.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedCategories = { upperbody: 28, wholebody_up: 10, lowerbody: 18, shoes: 12, accessories_up: 12 };
const failures = [];
const keys = new Set();

for (const fixture of DEMO_ITEMS) {
  if (keys.has(fixture.key)) failures.push(`Duplicate item fixture key: ${fixture.key}`);
  keys.add(fixture.key);
  if (!expectedCategories[fixture.part]) failures.push(`Unknown category for ${fixture.key}: ${fixture.part}`);
  if (!Array.isArray(fixture.tags) || fixture.tags.length < 2 || fixture.tags.length > 5) failures.push(`Invalid tags for ${fixture.key}`);
  const assetPath = path.join(root, "public", fixture.image.replace(/^\//, ""));
  try {
    await access(assetPath);
    const svg = await readFile(assetPath, "utf8");
    if (!svg.startsWith("<?xml") || !svg.includes("<svg") || svg.includes("<rect width=\"512\" height=\"512\"")) failures.push(`Invalid or opaque SVG: ${fixture.image}`);
  } catch {
    failures.push(`Missing SVG: ${fixture.image}`);
  }
}

const categoryCounts = DEMO_ITEMS.reduce((counts, fixture) => ({ ...counts, [fixture.part]: (counts[fixture.part] || 0) + 1 }), {});
for (const [part, expected] of Object.entries(expectedCategories)) {
  if (categoryCounts[part] !== expected) failures.push(`${part} expected ${expected}, found ${categoryCounts[part] || 0}`);
}

for (const outfit of DEMO_OUTFITS) {
  if (outfit.garmentFixtureKeys.some((key) => !keys.has(key))) failures.push(`Outfit ${outfit.key} references a missing fixture.`);
  if (!outfit.garmentFixtureKeys.includes(outfit.anchorFixtureKey)) failures.push(`Outfit ${outfit.key} does not contain its anchor.`);
  const parts = outfit.garmentFixtureKeys.map((key) => DEMO_ITEMS.find((fixture) => fixture.key === key)?.part);
  if (parts.filter((part) => part === "upperbody").length !== 1 || parts.filter((part) => part === "lowerbody").length !== 1) failures.push(`Outfit ${outfit.key} must contain exactly one top and bottom.`);
}

for (const key of Object.keys(DEMO_APPEARANCE_COUNTS)) if (!keys.has(key)) failures.push(`Appearance count references missing fixture: ${key}`);
for (const fixture of DEMO_COMMERCE_FIXTURES) {
  if (fixture.source !== "demo-fixture") failures.push(`Commerce fixture ${fixture.id} must be marked demo-fixture.`);
  if (fixture.merchandiseId) failures.push(`Commerce fixture ${fixture.id} must not contain a Shopify variant ID.`);
  try {
    await access(path.join(root, "public", fixture.imageUrl.replace(/^\//, "")));
  } catch {
    failures.push(`Missing commerce fixture SVG: ${fixture.imageUrl}`);
  }
}
if (DEMO_ITEMS.length !== 80 || DEMO_OUTFITS.length !== 8 || DEMO_FIXTURE_SUMMARY.appearances !== 59) failures.push("Canonical fixture totals changed unexpectedly.");
if (DEMO_COMMERCE_FIXTURES.length !== 3) failures.push(`Expected 3 demo commerce fixtures, found ${DEMO_COMMERCE_FIXTURES.length}.`);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ items: DEMO_ITEMS.length, categories: categoryCounts, outfits: DEMO_OUTFITS.length, appearances: DEMO_FIXTURE_SUMMARY.appearances, commerceFixtures: DEMO_COMMERCE_FIXTURES.length }, null, 2));
}
