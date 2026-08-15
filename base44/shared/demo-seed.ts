import {
  DEMO_APPEARANCE_COUNTS,
  DEMO_FIXTURE_SUMMARY,
  DEMO_ITEMS,
  DEMO_OUTFITS,
  DEMO_SEED_VERSION,
} from "./demo-fixtures.js";

type EntityRecord = Record<string, unknown> & { id: string };

function byFixtureKey(records: EntityRecord[]) {
  return new Map(records
    .filter((record) => typeof record.demoFixtureKey === "string" && record.demoFixtureKey)
    .map((record) => [String(record.demoFixtureKey), record]));
}

async function canonicalize(entity: any, records: EntityRecord[]) {
  const groups = new Map<string, EntityRecord[]>();
  for (const record of records) {
    const key = typeof record.demoFixtureKey === "string" ? record.demoFixtureKey : "";
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  const duplicates: EntityRecord[] = [];
  for (const group of groups.values()) {
    group.sort((first, second) => String(first.created_date || first.id).localeCompare(String(second.created_date || second.id)));
    duplicates.push(...group.slice(1));
  }
  if (duplicates.length) await Promise.all(duplicates.map((record) => entity.delete(record.id)));
  return records.filter((record) => !duplicates.some((duplicate) => duplicate.id === record.id));
}

function itemPayload(fixture: (typeof DEMO_ITEMS)[number], fixtureOrder: number) {
  return {
    name: fixture.name,
    part: fixture.part,
    color: fixture.color,
    ...(fixture.secondaryColor ? { secondaryColor: fixture.secondaryColor } : {}),
    tags: fixture.tags,
    image: fixture.image,
    thumbnail: fixture.image,
    palette: [fixture.color, fixture.secondaryColor].filter(Boolean),
    status: "active",
    demoFixture: true,
    demoFixtureKey: fixture.key,
    demoSeedVersion: DEMO_SEED_VERSION,
    fixtureOrder,
  };
}

function appearanceFixtures(itemsByKey: Map<string, EntityRecord>) {
  return Object.entries(DEMO_APPEARANCE_COUNTS).flatMap(([itemKey, count]) => {
    const wardrobeItem = itemsByKey.get(itemKey);
    if (!wardrobeItem) throw new Error(`Demo appearance references missing item fixture: ${itemKey}`);
    return Array.from({ length: count }, (_, index) => ({
      wardrobeItemId: wardrobeItem.id,
      duplicateConfidence: 1,
      demoFixture: true,
      demoFixtureKey: `${itemKey}:appearance:${index + 1}`,
      demoSeedVersion: DEMO_SEED_VERSION,
    }));
  });
}

function outfitPayload(fixture: (typeof DEMO_OUTFITS)[number], itemsByKey: Map<string, EntityRecord>) {
  const garmentIds = fixture.garmentFixtureKeys.map((key) => {
    const garment = itemsByKey.get(key);
    if (!garment) throw new Error(`Demo outfit ${fixture.key} references missing item fixture: ${key}`);
    return garment.id;
  });
  const anchor = itemsByKey.get(fixture.anchorFixtureKey);
  if (!anchor) throw new Error(`Demo outfit ${fixture.key} references a missing anchor fixture.`);
  return {
    name: fixture.name,
    occasion: fixture.occasion,
    season: fixture.season,
    garmentIds,
    anchorGarmentId: anchor.id,
    reason: fixture.reason,
    status: "saved",
    demoFixture: true,
    demoFixtureKey: fixture.key,
    demoSeedVersion: DEMO_SEED_VERSION,
  };
}

export async function seedDemoWardrobe(base44: any) {
  const itemEntity = base44.entities.WardrobeItem;
  const appearanceEntity = base44.entities.WardrobeAppearance;
  const outfitEntity = base44.entities.Outfit;
  const created = { items: 0, appearances: 0, outfits: 0 };
  const updated = { items: 0, appearances: 0, outfits: 0 };

  let itemRecords = await canonicalize(
    itemEntity,
    await itemEntity.filter({ demoFixture: true }, "created_date", 500, 0) as EntityRecord[],
  );
  let itemsByKey = byFixtureKey(itemRecords);
  const missingItems = DEMO_ITEMS
    .map((fixture, index) => ({ fixture, payload: itemPayload(fixture, index) }))
    .filter(({ fixture }) => !itemsByKey.has(fixture.key));
  if (missingItems.length) {
    const inserted = await itemEntity.bulkCreate(missingItems.map(({ payload }) => payload)) as EntityRecord[];
    itemRecords = [...itemRecords, ...inserted];
    created.items += inserted.length;
  }
  const itemUpdates = DEMO_ITEMS.flatMap((fixture, index) => {
    const existing = byFixtureKey(itemRecords).get(fixture.key);
    if (!existing || Number(existing.demoSeedVersion) === DEMO_SEED_VERSION) return [];
    return [{ id: existing.id, ...itemPayload(fixture, index) }];
  });
  if (itemUpdates.length) {
    await itemEntity.bulkUpdate(itemUpdates);
    updated.items += itemUpdates.length;
  }
  itemRecords = await canonicalize(
    itemEntity,
    await itemEntity.filter({ demoFixture: true }, "created_date", 500, 0) as EntityRecord[],
  );
  itemsByKey = byFixtureKey(itemRecords);

  const desiredAppearances = appearanceFixtures(itemsByKey);
  let appearanceRecords = await canonicalize(
    appearanceEntity,
    await appearanceEntity.filter({ demoFixture: true }, "created_date", 500, 0) as EntityRecord[],
  );
  let appearancesByKey = byFixtureKey(appearanceRecords);
  const missingAppearances = desiredAppearances.filter((fixture) => !appearancesByKey.has(fixture.demoFixtureKey));
  if (missingAppearances.length) {
    const inserted = await appearanceEntity.bulkCreate(missingAppearances) as EntityRecord[];
    appearanceRecords = [...appearanceRecords, ...inserted];
    created.appearances += inserted.length;
  }
  const appearanceUpdates = desiredAppearances.flatMap((fixture) => {
    const existing = byFixtureKey(appearanceRecords).get(fixture.demoFixtureKey);
    if (!existing || (Number(existing.demoSeedVersion) === DEMO_SEED_VERSION && existing.wardrobeItemId === fixture.wardrobeItemId)) return [];
    return [{ id: existing.id, ...fixture }];
  });
  if (appearanceUpdates.length) {
    await appearanceEntity.bulkUpdate(appearanceUpdates);
    updated.appearances += appearanceUpdates.length;
  }
  appearanceRecords = await canonicalize(
    appearanceEntity,
    await appearanceEntity.filter({ demoFixture: true }, "created_date", 500, 0) as EntityRecord[],
  );
  appearancesByKey = byFixtureKey(appearanceRecords);

  const desiredOutfits = DEMO_OUTFITS.map((fixture) => ({
    key: fixture.key,
    payload: outfitPayload(fixture, itemsByKey),
  }));
  let outfitRecords = await canonicalize(
    outfitEntity,
    await outfitEntity.filter({ demoFixture: true }, "created_date", 100, 0) as EntityRecord[],
  );
  const outfitsByKey = byFixtureKey(outfitRecords);
  const missingOutfits = desiredOutfits.filter(({ key }) => !outfitsByKey.has(key));
  if (missingOutfits.length) {
    const inserted = await outfitEntity.bulkCreate(missingOutfits.map(({ payload, key }) => ({
      ...payload,
      demoFixtureKey: key,
    }))) as EntityRecord[];
    outfitRecords = [...outfitRecords, ...inserted];
    created.outfits += inserted.length;
  }
  const outfitUpdates = desiredOutfits.flatMap(({ key, payload }) => {
    const existing = byFixtureKey(outfitRecords).get(key);
    const idsChanged = JSON.stringify(existing?.garmentIds || []) !== JSON.stringify(payload.garmentIds);
    if (!existing || (!idsChanged && Number(existing.demoSeedVersion) === DEMO_SEED_VERSION)) return [];
    return [{ id: existing.id, ...payload, demoFixtureKey: key }];
  });
  if (outfitUpdates.length) {
    await outfitEntity.bulkUpdate(outfitUpdates);
    updated.outfits += outfitUpdates.length;
  }
  outfitRecords = await canonicalize(
    outfitEntity,
    await outfitEntity.filter({ demoFixture: true }, "created_date", 100, 0) as EntityRecord[],
  );

  const counts = {
    items: itemRecords.filter((record) => DEMO_ITEMS.some((fixture) => fixture.key === record.demoFixtureKey)).length,
    appearances: [...appearancesByKey.keys()].filter((key) => desiredAppearances.some((fixture) => fixture.demoFixtureKey === key)).length,
    outfits: outfitRecords.filter((record) => DEMO_OUTFITS.some((fixture) => fixture.key === record.demoFixtureKey)).length,
  };
  if (counts.items !== DEMO_FIXTURE_SUMMARY.items || counts.appearances !== DEMO_FIXTURE_SUMMARY.appearances || counts.outfits !== DEMO_FIXTURE_SUMMARY.outfits) {
    throw new Error(`Demo seed incomplete: ${JSON.stringify(counts)}`);
  }

  return { seedVersion: DEMO_SEED_VERSION, counts, created, updated };
}
