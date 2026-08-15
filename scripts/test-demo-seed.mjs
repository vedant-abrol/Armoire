import assert from "node:assert/strict";
import { seedDemoWardrobe } from "../base44/shared/demo-seed.ts";

class MemoryEntity {
  constructor(name) {
    this.name = name;
    this.records = [];
    this.nextId = 1;
  }

  matches(record, query) {
    return Object.entries(query).every(([key, value]) => record[key] === value);
  }

  async create(data) {
    const id = `${this.name}-${this.nextId++}`;
    const now = new Date(this.nextId * 1000).toISOString();
    const record = { ...structuredClone(data), id, created_date: now, updated_date: now, created_by: "vedant1311nov@gmail.com" };
    this.records.push(record);
    return structuredClone(record);
  }

  async bulkCreate(rows) {
    return Promise.all(rows.map((row) => this.create(row)));
  }

  async list() {
    return structuredClone(this.records);
  }

  async filter(query) {
    return structuredClone(this.records.filter((record) => this.matches(record, query)));
  }

  async update(id, data) {
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) throw new Error(`${this.name} record not found: ${id}`);
    Object.assign(record, structuredClone(data), { updated_date: new Date().toISOString() });
    return structuredClone(record);
  }

  async bulkUpdate(rows) {
    return Promise.all(rows.map(({ id, ...data }) => this.update(id, data)));
  }

  async delete(id) {
    const index = this.records.findIndex((record) => record.id === id);
    if (index >= 0) this.records.splice(index, 1);
    return { success: index >= 0 };
  }

  async deleteMany(query) {
    const before = this.records.length;
    this.records = this.records.filter((record) => !this.matches(record, query));
    return { deleted: before - this.records.length };
  }
}

const entities = {
  WardrobeItem: new MemoryEntity("item"),
  WardrobeAppearance: new MemoryEntity("appearance"),
  Outfit: new MemoryEntity("outfit"),
};
const base44 = { entities };
const realItem = await entities.WardrobeItem.create({ name: "Real imported sweater", part: "upperbody", demoFixture: false, importJobId: "real-import" });

const first = await seedDemoWardrobe(base44);
assert.deepEqual(first.counts, { items: 80, appearances: 59, outfits: 8 });
assert.deepEqual(first.created, { items: 80, appearances: 59, outfits: 8 });
assert.equal(entities.WardrobeItem.records.length, 81);

const second = await seedDemoWardrobe(base44);
assert.deepEqual(second.counts, first.counts);
assert.deepEqual(second.created, { items: 0, appearances: 0, outfits: 0 });
assert.equal(entities.WardrobeItem.records.length, 81);
assert.ok(entities.WardrobeItem.records.some((record) => record.id === realItem.id));

const removedFixture = entities.WardrobeItem.records.find((record) => record.demoFixtureKey === "white-crew-tee");
await entities.WardrobeItem.delete(removedFixture.id);
const repaired = await seedDemoWardrobe(base44);
assert.deepEqual(repaired.counts, first.counts);
assert.equal(entities.WardrobeItem.records.length, 81);
const repairedItem = entities.WardrobeItem.records.find((record) => record.demoFixtureKey === "white-crew-tee");
assert.ok(entities.WardrobeAppearance.records.filter((record) => record.demoFixtureKey.startsWith("white-crew-tee:")).every((record) => record.wardrobeItemId === repairedItem.id));
assert.ok(entities.Outfit.records.filter((record) => record.garmentIds.includes(repairedItem.id)).length >= 1);

console.log("Demo seed is idempotent, repairs missing fixtures, and preserves real wardrobe records.");
