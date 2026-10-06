import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saveEntityExtraction } from "../../database/knowledge-graph.js";
import type { KgStore, RelationshipRow, ReviewRow } from "../../database/kg-store.js";
import { normalizeBusinessName, normalizeIdentifierValue } from "./normalize.js";
import { parseOpenCorporatesUrl, recordsFromBundle } from "./records.js";
import { canonicalIdentifier, resolve, type EntityType, type Identifier, type KnownEntity } from "./resolve.js";

/** In-memory KgStore, enforcing the same identifier uniqueness as the DB. */
class MemoryStore implements KgStore {
  entities: { id: string; name: string; type: EntityType }[] = [];
  identifiers: { entityId: string; kind: string; issuer: string; value: string }[] = [];
  reviews: ReviewRow[] = [];
  relationships: RelationshipRow[] = [];
  private n = 0;

  async findByName(_u: string, name: string, type: EntityType) {
    return this.entities.find((e) => e.name === name && e.type === type)?.id;
  }
  async listKnown(): Promise<KnownEntity[]> {
    return this.entities.map((e) => ({
      ...e, identifiers: this.identifiers.filter((i) => i.entityId === e.id).map(({ kind, issuer, value }) => ({ kind: kind as Identifier["kind"], issuer, value })),
    }));
  }
  async insertEntity(_u: string, name: string, type: EntityType) {
    const id = `e${++this.n}`;
    this.entities.push({ id, name, type });
    return id;
  }
  async touchEntity() {}
  async addIdentifiers(_u: string, entityId: string, ids: Identifier[]) {
    for (const i of ids) {
      if (!this.identifiers.some((x) => x.kind === i.kind && x.issuer === i.issuer && x.value === i.value)) {
        this.identifiers.push({ entityId, kind: i.kind, issuer: i.issuer, value: i.value });
      }
    }
  }
  async addReviews(_u: string, rows: ReviewRow[]) { this.reviews.push(...rows); }
  async insertRelationships(_u: string, _r: string, rows: RelationshipRow[]) { this.relationships.push(...rows); }
}

const T = "2026-10-06T12:00:00.000Z";
const sen = (issuer: string, value: string): Identifier =>
  ({ kind: "state_entity_number", issuer, value, sourceName: "OpenCorporates", sourceUrl: `https://opencorporates.com/companies/${issuer}/${value}`, retrievedAt: T });

const personBundle = (affiliations: { companyName: string; companyUrl: string; position?: string }[]) => ({
  query: "Jane Doe", generatedAt: T, corporateAffiliations: affiliations,
});

describe("entity resolution (acceptance)", () => {
  it("two same-named businesses in different states with different entity numbers stay separate", async () => {
    const store = new MemoryStore();
    const records = recordsFromBundle(personBundle([
      { companyName: "Acme Holdings LLC", companyUrl: "https://opencorporates.com/companies/us_de/5512345", position: "Director" },
      { companyName: "ACME HOLDINGS, LLC", companyUrl: "https://opencorporates.com/companies/us_ca/201912345678", position: "Manager" },
    ]));
    await saveEntityExtraction("u1", "run1", {
      entities: [{ name: "Jane Doe", type: "person" }, { name: "Acme Holdings LLC", type: "company" }],
      relationships: [],
    }, { store, resolution: true, records, subject: { name: "Jane Doe", type: "person" } });

    const acmes = store.entities.filter((e) => normalizeBusinessName(e.name) === "acme holdings");
    const de = store.identifiers.find((i) => i.issuer === "us_de")!;
    const ca = store.identifiers.find((i) => i.issuer === "us_ca")!;
    assert.notEqual(de.entityId, ca.entityId, "different entity numbers must not share an entity");
    // the two records, plus the report's bare mention that can't say which it is
    assert.equal(acmes.length, 3);
    // Different states can be one company (formed in Delaware, registered
    // in California), so they're flagged for review, never merged.
    assert.ok(store.reviews.some((r) => r.status === "pending"
      && [de.entityId, ca.entityId].includes(r.entityId) && [de.entityId, ca.entityId].includes(r.candidateId)));
    const mention = acmes.find((e) => e.id !== de.entityId && e.id !== ca.entityId)!;
    assert.equal(store.reviews.filter((r) => r.entityId === mention.id && r.status === "pending").length, 2);
    // the person links to each company through its own record
    const jane = store.entities.find((e) => e.name === "Jane Doe")!;
    assert.deepEqual(store.relationships.map((r) => [r.fromId, r.toId, r.type]).sort(),
      [[jane.id, de.entityId, "DIRECTOR"], [jane.id, ca.entityId, "MANAGER"]].sort());
  });
});

describe("entity resolution", () => {
  it("two entity numbers from the same state are labeled distinct", async () => {
    const store = new MemoryStore();
    await saveEntityExtraction("u1", "r", { entities: [], relationships: [] }, {
      store, resolution: true,
      records: recordsFromBundle(personBundle([
        { companyName: "Acme LLC", companyUrl: "https://opencorporates.com/companies/us_de/1" },
        { companyName: "Acme LLC", companyUrl: "https://opencorporates.com/companies/us_de/2" },
      ])),
    });
    assert.equal(store.entities.length, 2);
    assert.deepEqual(store.reviews.map((r) => [r.status, r.reason]), [["distinct", "conflicting_identifiers"]]);
  });

  it("merges records that share a hard identifier, across runs", async () => {
    const store = new MemoryStore();
    const run = (name: string) => saveEntityExtraction("u1", "r", { entities: [], relationships: [] },
      { store, resolution: true, records: [{ name, type: "company", identifiers: [canonicalIdentifier(sen("us_de", "5512345"))!] }] });
    await run("Acme Holdings LLC");
    await run("Acme Holdings, L.L.C."); // spelled differently, same entity number
    assert.equal(store.entities.length, 1);
    assert.equal(store.reviews.length, 0);
  });

  it("a name match alone never merges: separate entity, flagged as a possible match", async () => {
    const store = new MemoryStore();
    const save = () => saveEntityExtraction("u1", "r", { entities: [{ name: "Stripe", type: "company" }], relationships: [] },
      { store, resolution: true });
    await save();
    await save();
    assert.equal(store.entities.length, 2);
    assert.deepEqual(store.reviews.map((r) => [r.status, r.reason]), [["pending", "name_only"]]);
  });

  it("a report's mention of the one record it found is that record", async () => {
    const store = new MemoryStore();
    await saveEntityExtraction("u1", "r", { entities: [{ name: "Acme Foundation", type: "company" }], relationships: [] }, {
      store, resolution: true,
      records: recordsFromBundle({ generatedAt: T, nonprofitFilings: [{ ein: "12-3456789", name: "ACME FOUNDATION", url: "https://projects.propublica.org/nonprofits/organizations/123456789" }] }),
    });
    assert.equal(store.entities.length, 1);
    assert.equal(store.identifiers[0].value, "123456789");
  });

  it("flag off: same name and type reuse one entity, as before", async () => {
    const store = new MemoryStore();
    const save = () => saveEntityExtraction("u1", "r", { entities: [{ name: "Stripe", type: "company" }], relationships: [] },
      { store, resolution: false, records: recordsFromBundle(personBundle([{ companyName: "X", companyUrl: "https://opencorporates.com/companies/us_de/1" }])) });
    await save();
    await save();
    assert.equal(store.entities.length, 1);
    assert.equal(store.identifiers.length, 0);
  });

  it("resolve: same name with conflicting identifiers is distinct; different types never match", () => {
    const known: KnownEntity[] = [
      { id: "a", name: "Acme LLC", type: "company", identifiers: [{ kind: "state_entity_number", issuer: "us_de", value: "1" }] },
      { id: "b", name: "Acme", type: "product", identifiers: [] },
    ];
    assert.deepEqual(resolve({ name: "Acme, Inc.", type: "company", identifiers: [canonicalIdentifier(sen("us_de", "2"))!] }, known),
      { action: "create", possibleMatches: [], distinctFrom: ["a"] });
    // the same number from another state is a different identifier
    assert.deepEqual(resolve({ name: "Acme", type: "company", identifiers: [canonicalIdentifier(sen("us_ca", "1"))!] }, known),
      { action: "create", possibleMatches: ["a"], distinctFrom: [] });
  });
});

describe("identifiers and names", () => {
  it("normalizes business names for search only", () => {
    assert.equal(normalizeBusinessName("The Acme Co., L.L.C."), "acme");
    assert.equal(normalizeBusinessName("Acme Holdings, Inc."), "acme holdings");
    assert.equal(normalizeBusinessName("Société Générale SA"), "societe generale");
    assert.equal(normalizeBusinessName("LLC"), "llc");
  });

  it("canonicalizes identifiers and drops unusable ones", () => {
    assert.equal(normalizeIdentifierValue("ein", "12-3456789"), "123456789");
    assert.equal(normalizeIdentifierValue("ein", "1234"), undefined);
    assert.equal(canonicalIdentifier({ ...sen("", "123") }), undefined, "an entity number needs its state");
    assert.equal(canonicalIdentifier(sen(" US_DE ", " 0012 3"))?.issuer, "us_de");
    assert.equal(canonicalIdentifier(sen("us_de", "0012 3"))?.value, "00123", "leading zeros are significant");
  });

  it("reads entity numbers from OpenCorporates links only", () => {
    assert.deepEqual(parseOpenCorporatesUrl("https://opencorporates.com/companies/us_de/5512345"), { issuer: "us_de", value: "5512345" });
    assert.deepEqual(parseOpenCorporatesUrl("https://opencorporates.com/companies/gb/01234567?x=1"), { issuer: "gb", value: "01234567" });
    assert.equal(parseOpenCorporatesUrl("https://opencorporates.com/officers/123"), undefined);
    assert.equal(parseOpenCorporatesUrl("https://evil.example/companies/us_de/1"), undefined);
  });
});
