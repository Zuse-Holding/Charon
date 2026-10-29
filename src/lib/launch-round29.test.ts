import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boardsNamed, confirmBoardSeats, cutShort, roleDates, settleTitles, statedSeatDates } from "./person-sources.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { CareerEntry, PersonProfile } from "../types/research.js";

// Holdout round (Oct 29): fixtures from three of the five new names. The
// names in regression/people-holdout.json stay out of every test.

describe("round twenty-nine: holdout names, dates per office", () => {
  it("Lisa Su: Chair doesn't take the CEO start; each office keeps its own date", () => {
    const texts = [
      "Lisa Su became president and chief executive officer of AMD in October 2014.",
      "AMD's board of directors elected Dr. Lisa Su as chair effective February 2022.",
    ];
    const person: PersonProfile = { name: "Lisa Su", currentRole: "Chair and CEO", currentCompany: "AMD" };
    const career: CareerEntry[] = [
      { title: "Chair and CEO", company: "AMD", start: "Oct 2014", current: true },
      { title: "President and CEO", company: "AMD", start: "Oct 2014" },
      { title: "Chair", company: "AMD", start: "Oct 2014" },
    ];
    const settled = settleTitles(person, career, ["AMD"], { snippets: texts, dated: texts });
    const row = (t: string) => settled.careerHistory.find((c) => c.title === t)!;
    assert.equal(settled.careerHistory[0].title, "Chair and CEO");
    assert.equal(settled.careerHistory[0].start, undefined, "the combined title borrows no date");
    assert.equal(row("President and CEO").start, "Oct 2014");
    assert.equal(row("Chair").start, undefined, "Oct 2014 isn't when she became chair");

    // Dated as the release dates it: kept.
    const right = settleTitles({ ...person }, [{ title: "Chair", company: "AMD", start: "Feb 2022" }], ["AMD"], { snippets: texts, dated: texts });
    assert.equal(right.careerHistory.find((c) => c.title === "Chair")!.start, "Feb 2022");
  });

  it("David Taylor: Delta chairman isn't dated by joining the board", () => {
    const texts = ["David Taylor, retired chairman, president and CEO of Procter & Gamble, joined Delta's board of directors in August 2019."];
    const [chair, director] = statedSeatDates([
      { organization: "Delta Air Lines", role: "Chairman", start: "Aug 2019" },
      { organization: "Delta Air Lines", role: "Director", start: "Aug 2019" },
    ], texts, "David Taylor");
    assert.equal(chair.start, undefined);
    assert.equal(director.start, "Aug 2019");

    const md = new ReportAgent().generatePerson({
      query: "x", generatedAt: "2026-10-29T00:00:00Z", news: [],
      sources: [{ url: "https://news.delta.com/board", title: "Delta board", retrievedAt: "2026-10-29", usedFor: ["board-seats"] }],
      person: { name: "David Taylor", currentRole: "Chairman", currentCompany: "Procter & Gamble" },
      careerHistory: [{ title: "Chairman", company: "Procter & Gamble", current: true }],
      boardSeats: [chair],
    });
    assert.match(md, /\*\*Delta Air Lines\*\* — Chairman\n/);
    assert.doesNotMatch(md, /Aug 2019/);
  });

  it("Wendy Kopp: Teach For America ends when the source says how long she led it", () => {
    const summary = "Wendy Kopp founded Teach For America in 1990 and led it for 24 years before co-founding Teach For All.";
    const person: PersonProfile = { name: "Wendy Kopp", currentRole: "CEO", currentCompany: "Teach For All", summary };
    const career: CareerEntry[] = [
      { title: "CEO", company: "Teach For All" },
      { title: "CEO", company: "Teach For America", start: "1990", current: true },
    ];
    const settled = settleTitles(person, career, ["Teach For All"], { snippets: [summary], summary, dated: [summary] });
    const tfa = settled.careerHistory.find((c) => c.company === "Teach For America")!;
    assert.equal(roleDates(tfa), "1990 – 2014");

    // Still leading it: no end.
    const still = "Jane Roe founded Acme Schools in 2001 and has led it for 20 years.";
    const open = settleTitles({ name: "Jane Roe", currentRole: "Director", currentCompany: "Other Org" },
      [{ title: "CEO", company: "Acme Schools", start: "2001" }], ["Other Org"], { snippets: [still], dated: [still] });
    const acme = open.careerHistory.find((c) => c.company === "Acme Schools")!;
    assert.equal(acme.end, undefined);
    assert.equal(acme.current, false, "another organization's role is never current without a dated source");
  });

  it("truncated or partial organization names never become affiliations", () => {
    const texts = [
      "Lisa Su serves on the boards of Cisco and the Global Semiconductor Alliance.",
      "Lisa Su, AMD chair and CEO, also sits on the Global Semicond…",
      "Wendy Kopp of Teach For All. Kopp, Cata…",
      "Wendy Kopp, Teach For All, chairs Great Hearts Academies.",
    ];
    assert.equal(cutShort(texts, "Global Semicond"), true);
    assert.equal(cutShort(texts, "Cata"), true);
    assert.equal(cutShort(texts, "Great"), true);
    assert.equal(cutShort(texts, "Global Semiconductor Alliance"), false);
    assert.equal(cutShort(["WM Board of Directors. Kathleen Mazzarella, non-executive chair."], "WM"), false);
    assert.equal(cutShort(["Mazzarella sits on the board of The Cigna Group."], "Cigna"), false);

    const seats = confirmBoardSeats(
      [...boardsNamed(texts, "Lisa Su"), { organization: "Global Semicond", role: "Director" }, { organization: "Cata" }, { organization: "Great", role: "Chair" }],
      { boardPages: [], vouched: [], tied: texts.map((text, i) => ({ url: `https://example.com/${i}`, text })) },
      ["AMD"],
    );
    assert.deepEqual(seats.map((s) => s.organization), ["Cisco", "Global Semiconductor Alliance"]);
  });
});
