import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ExclusionGuard, ExclusionService, LIMIT_INDIVIDUAL, LIMIT_TEAM, MAX_CODE_ATTEMPTS, canonicalize, hashIdentifier, hintFor,
  identifiersInQuery, normalizeDob, normalizePhone, type EntryRow, type ExclusionStore, type Identifier, type Messenger,
} from "./index.js";

const KEY = "k".repeat(32);

class MemoryStore implements ExclusionStore {
  rows: EntryRow[] = [];
  private n = 0;
  async listForOwner(owner: string) { return this.rows.filter((r) => r.ownerUserId === owner); }
  async insert(row: Omit<EntryRow, "id" | "createdAt">) {
    const r = { ...row, id: `x${++this.n}`, createdAt: new Date().toISOString() };
    this.rows.push(r);
    return r;
  }
  async update(id: string, patch: Partial<EntryRow>) { Object.assign(this.rows.find((r) => r.id === id)!, patch); }
  async remove(id: string, owner: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.id === id && r.ownerUserId === owner));
    return this.rows.length < before;
  }
  async findByTokenHash(h: string) { return this.rows.find((r) => r.verifyTokenHash === h); }
  async deleteExpiredPending(owner: string, now: Date) {
    this.rows = this.rows.filter((r) => !(r.ownerUserId === owner && r.status === "pending" && r.verifyExpiresAt && Date.parse(r.verifyExpiresAt) < now.getTime()));
  }
  async activeAmong(hashes: string[]) { return new Set(this.rows.filter((r) => r.status === "active" && hashes.includes(r.identifierHash)).map((r) => r.identifierHash)); }
}

class FakeMessenger implements Messenger {
  links: { to: string; link: string }[] = [];
  sms: string[] = [];
  code = "123456";
  async sendLink(to: string, _k: unknown, link: string) { this.links.push({ to, link }); return true; }
  async startSms(phone: string) { this.sms.push(phone); return true; }
  async checkSms(_p: string, code: string) { return code === this.code; }
}

function setup() {
  const store = new MemoryStore();
  const msg = new FakeMessenger();
  const svc = new ExclusionService(store, msg, KEY, (t) => `https://metis.test/exclusion-confirm?token=${t}`);
  const tokenOf = (i = msg.links.length - 1) => new URL(msg.links[i].link).searchParams.get("token")!;
  return { store, msg, svc, tokenOf, guard: new ExclusionGuard(store, KEY) };
}

const email = (v: string) => canonicalize("email", v)!;

describe("self-exclusion (acceptance)", () => {
  it("expansion from a business does not follow an officer's excluded email", async () => {
    const { svc, tokenOf, guard } = setup();
    await svc.add("u1", "jane@acme.com", "pro", { kind: "email", value: "Jane.Officer@Acme.com" });
    assert.equal(await svc.confirmLink(tokenOf()), true);

    // A two-hop walk the way Feature 4 will do it: from the business to
    // its officers' identifiers, then on to whatever each one leads to.
    const officers: Identifier[] = [email("jane.officer@acme.com"), email("bob@acme.com")];
    const furtherRecords: Record<string, string[]> = {
      "jane.officer@acme.com": ["Jane's other LLC"],
      "bob@acme.com": ["Bob's other LLC"],
    };
    const followed = await guard.followable(officers);
    const reached = followed.flatMap((id) => furtherRecords[id.canonical]);
    assert.deepEqual(followed.map((i) => i.canonical), ["bob@acme.com"]);
    assert.deepEqual(reached, ["Bob's other LLC"]);
  });
});

describe("adding and confirming", () => {
  it("email: pending until the link sent to that address is used", async () => {
    const { svc, msg, tokenOf, guard } = setup();
    const r = await svc.add("u1", "owner@x.com", "pro", { kind: "email", value: "me@example.com" });
    assert.ok(r.ok && r.next === "check_email");
    assert.equal(msg.links[0].to, "me@example.com");
    assert.equal(await guard.blocksQuery("me@example.com"), false, "no effect before confirmation");
    assert.equal(await svc.confirmLink(tokenOf()), true);
    assert.equal(await guard.blocksQuery("who is ME@example.com"), true);
    assert.equal(await svc.confirmLink(tokenOf()), false, "a link works once");
  });

  it("phone: takes effect only with the right SMS code for the same number", async () => {
    const { svc, msg, store, guard } = setup();
    const r = await svc.add("u1", "o@x.com", "pro", { kind: "phone", value: "(415) 555-0100" });
    assert.ok(r.ok && r.next === "enter_code");
    assert.deepEqual(msg.sms, ["+14155550100"]);
    const id = r.ok ? r.entry.id : "";
    assert.equal((await svc.confirmCode("u1", id, "+1 415 555 0199", "123456")).ok, false, "different number");
    assert.equal((await svc.confirmCode("u2", id, "+1 415 555 0100", "123456")).ok, false, "someone else's entry");
    assert.equal((await svc.confirmCode("u1", id, "+1 415 555 0100", "000000")).ok, false, "wrong code");
    assert.equal((await svc.confirmCode("u1", id, "4155550100", "123456")).ok, true);
    assert.equal(store.rows[0].status, "active");
    assert.equal(await guard.blocksQuery("call 415.555.0100"), true);
  });

  it("phone: locks after too many wrong codes", async () => {
    const { svc } = setup();
    const r = await svc.add("u1", "o@x.com", "pro", { kind: "phone", value: "+14155550100" });
    const id = r.ok ? r.entry.id : "";
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) await svc.confirmCode("u1", id, "+14155550100", "000000");
    assert.match((await svc.confirmCode("u1", id, "+14155550100", "123456")).error!, /Too many attempts/);
  });

  it("name + date of birth: needs the owner's statement and their account email's confirmation", async () => {
    const { svc, msg, tokenOf, guard } = setup();
    const value = { name: "Jane Q. Doe", dob: "March 7, 1984" };
    assert.equal((await svc.add("u1", "jane@x.com", "pro", { kind: "name_dob", value, attest: false })).ok, false);
    const r = await svc.add("u1", "jane@x.com", "pro", { kind: "name_dob", value, attest: true });
    assert.ok(r.ok && r.next === "check_account_email");
    assert.equal(msg.links[0].to, "jane@x.com");
    await svc.confirmLink(tokenOf());
    assert.equal(await guard.blocksQuery("Jane Q Doe 1984-03-07"), true);
    assert.equal(await guard.blocksQuery("Jane Q Doe"), false, "a name alone isn't the identifier");
  });

  it("an expired link does nothing, and expired pending entries free their slot", async () => {
    const store = new MemoryStore();
    const msg = new FakeMessenger();
    let now = new Date("2026-10-06T00:00:00Z");
    const svc = new ExclusionService(store, msg, KEY, (t) => `https://m.test/c?token=${t}`, () => now);
    for (let i = 0; i < LIMIT_INDIVIDUAL; i++) await svc.add("u1", "o@x.com", "pro", { kind: "email", value: `a${i}@x.com` });
    now = new Date("2026-10-08T00:00:00Z");
    assert.equal(await svc.confirmLink(new URL(msg.links[0].link).searchParams.get("token")!), false);
    assert.ok((await svc.add("u1", "o@x.com", "pro", { kind: "email", value: "new@x.com" })).ok);
  });
});

describe("limits, storage and removal", () => {
  it("5 entries per individual seat, 25 per team account", async () => {
    const { svc } = setup();
    for (let i = 0; i < LIMIT_INDIVIDUAL; i++) assert.ok((await svc.add("u1", "o@x.com", "pro", { kind: "email", value: `a${i}@x.com` })).ok);
    const over = await svc.add("u1", "o@x.com", "pro", { kind: "email", value: "a9@x.com" });
    assert.ok(!over.ok && /allows 5/.test(over.error));
    for (let i = 0; i < LIMIT_TEAM; i++) assert.ok((await svc.add("t1", "o@x.com", "team", { kind: "email", value: `b${i}@x.com` })).ok);
    assert.equal((await svc.add("t1", "o@x.com", "team", { kind: "email", value: "b99@x.com" })).ok, false);
  });

  it("stores only a keyed hash and a masked hint, never the identifier", async () => {
    const { svc, store } = setup();
    await svc.add("u1", "o@x.com", "pro", { kind: "email", value: "secret.person@example.com" });
    await svc.add("u1", "o@x.com", "pro", { kind: "phone", value: "+14155550100" });
    const dump = JSON.stringify(store.rows);
    assert.ok(!dump.includes("secret.person") && !dump.includes("example.com") && !dump.includes("5550100"));
    assert.equal(store.rows[0].hint, "s•••@e•••");
    assert.equal(store.rows[1].hint, "•••• 00");
    assert.notEqual(hashIdentifier(email("a@b.co"), KEY), hashIdentifier(email("a@b.co"), "z".repeat(32)), "the key matters");
  });

  it("removal is one call and takes effect immediately", async () => {
    const { svc, tokenOf, guard } = setup();
    const r = await svc.add("u1", "o@x.com", "pro", { kind: "email", value: "me@example.com" });
    await svc.confirmLink(tokenOf());
    assert.equal(await svc.remove("u2", r.ok ? r.entry.id : ""), false, "only the owner can remove it");
    assert.equal(await svc.remove("u1", r.ok ? r.entry.id : ""), true);
    assert.equal(await guard.blocksQuery("me@example.com"), false);
  });
});

describe("reading identifiers", () => {
  it("finds emails, phone numbers and a name with a date of birth in a search", () => {
    const ids = identifiersInQuery("Jane Doe born 3/7/1984, jane@acme.com, +44 20 7946 0958");
    assert.deepEqual(ids.map((i) => `${i.kind}:${i.canonical}`).sort(),
      ["email:jane@acme.com", "name_dob:jane doe|1984-03-07", "phone:+442079460958"].sort());
    assert.deepEqual(identifiersInQuery("Stripe"), []);
    assert.deepEqual(identifiersInQuery("Acme 2024 annual report"), []);
  });

  it("canonical forms", () => {
    assert.equal(normalizePhone("415-555-0100"), "+14155550100");
    assert.equal(normalizePhone("12345"), undefined);
    assert.equal(normalizeDob("1984-02-30"), undefined);
    assert.equal(normalizeDob("Mar 7 1984"), "1984-03-07");
    assert.equal(normalizeDob("2999-01-01"), undefined);
    assert.equal(hintFor(canonicalize("name_dob", { name: "jane doe", dob: "1984-03-07" })!), "J. D. · date of birth");
  });
});
