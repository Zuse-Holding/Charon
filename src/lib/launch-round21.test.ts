import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bioExcerpt, clearEndedRole, confirmBoardSeats, eftsDocUrl, filedBy, isBoardPage, isProfilePage, officialBioPages, roleDates, tiedToOrg,
} from "./person-sources.js";
import { PersonExtractionSchema } from "./llm.js";
import { applyPersonConsistency } from "./consistency.js";
import { personCandidates } from "./candidates.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { PersonResearchBundle } from "../types/research.js";

const personOf = (over: Partial<PersonResearchBundle>): PersonResearchBundle => ({
  query: "Jane Doe", generatedAt: "2026-10-28T00:00:00Z", person: { name: "Jane Doe" }, careerHistory: [], news: [], sources: [], ...over,
});

describe("round twenty-one: person search from the Oct 27 handoff", () => {
  it("finds the executive bio on the company's own site, first name or not", () => {
    const results = [
      { title: "Michael McCann - Chief Executive Officer - LinkedIn", url: "https://www.linkedin.com/in/mccann", snippet: "Limbach" },
      { title: "Limbach names new COO", url: "https://www.businesswire.com/news/home/1/en/limbach", snippet: "Michael McCann said" },
      { title: "Mike McCann | Limbach", url: "https://www.limbachinc.com/mike-mccann/", snippet: "President and CEO" },
      { title: "Leadership | Limbach", url: "https://www.limbachinc.com/leadership/", snippet: "Mike McCann, Jayme Brooks" },
    ];
    assert.deepEqual(officialBioPages(results, "Michael McCann", "Limbach Holdings").map((r) => r.url), ["https://www.limbachinc.com/mike-mccann/", "https://www.limbachinc.com/leadership/"]);
    assert.deepEqual(officialBioPages(results.slice(0, 2), "Michael McCann", "Limbach Holdings"), []);
  });

  it("cuts a long page down to the person's bio", () => {
    const filler = "Our directors oversee strategy. ".repeat(200);
    const text = `${filler} Mr. McCann chairs the meeting. ${filler} Michael M. McCann, age 62, has served as our Chief Executive Officer since March 2023 and as co-Chief Operating Officer since January 2019. He holds a B.S. in Mechanical Engineering from Worcester Polytechnic Institute and an MBA from Drexel University. ${filler}`;
    const excerpt = bioExcerpt(text, "Michael McCann", 1500)!;
    assert.match(excerpt, /age 62/);
    assert.match(excerpt, /Drexel University/);
    assert.equal(bioExcerpt("No one by that name here.", "Michael McCann"), undefined);
  });

  it("keeps board pages that name the person, and confirms them by the picked organization", () => {
    const cigna = { title: "Kathleen M. Mazzarella - Board of Directors - The Cigna Group", url: "https://investors.thecignagroup.com/board-of-directors/person-details/default.aspx", snippet: "" };
    assert.equal(isBoardPage(cigna, "Kathleen Mazzarella"), true);
    assert.equal(isBoardPage({ title: "Kathleen Mazzarella | LinkedIn", url: "https://www.linkedin.com/in/km", snippet: "board member" }, "Kathleen Mazzarella"), false);
    assert.equal(isBoardPage({ title: "Graybar reports results", url: "https://news.example.com/graybar", snippet: "Mazzarella said" }, "Kathleen Mazzarella"), false);
    assert.equal(tiedToOrg("Kathleen Mazzarella is chairman, president and CEO of Graybar Electric.", "Kathleen Mazzarella", "Graybar"), true);
    assert.equal(tiedToOrg("Kathleen Mazzarella, a retired teacher from Ohio.", "Kathleen Mazzarella", "Graybar"), false);
  });

  it("a board seat needs a tied source naming it, and the employer's own board isn't an outside seat", () => {
    const tied = [
      { url: "https://www.wm.com/board", text: "WM Board of Directors. Kathleen Mazzarella, non-executive chair; chairman and CEO of Graybar." },
      { url: "https://investors.thecignagroup.com/board", text: "The Cigna Group board: Kathleen M. Mazzarella, Graybar." },
    ];
    const seats = confirmBoardSeats([
      { organization: "WM", role: "Non-executive chair" },
      { organization: "The Cigna Group", role: "Director" },
      { organization: "Cigna Group", role: "Director" },
      { organization: "Graybar Electric", role: "Chairman" },
      { organization: "Acme Widgets", role: "Director" },
    ], { boardPages: tied, vouched: [] }, ["Graybar"]);
    assert.deepEqual(seats.map((s) => [s.organization, s.url]), [
      ["WM", "https://www.wm.com/board"],
      ["The Cigna Group", "https://investors.thecignagroup.com/board"],
    ]);
  });

  it("an ended role is never shown as current", () => {
    const person = { name: "Jane Doe", currentRole: "CEO", currentCompany: "Black Diamond" };
    assert.equal(clearEndedRole(person, [{ title: "CEO", company: "Black Diamond", start: "2012", current: false }]), "CEO, Black Diamond has ended");
    assert.equal(person.currentRole, undefined);
    const still = { name: "Jane Doe", currentRole: "CEO", currentCompany: "Graybar" };
    assert.equal(clearEndedRole(still, [{ title: "CEO", company: "Graybar", start: "Jun 2012" }, { title: "VP", company: "Graybar", end: "2012" }]), undefined);
    assert.equal(still.currentRole, "CEO");
    assert.equal(roleDates({ start: "Mar 2023" }), "since Mar 2023");
    assert.equal(roleDates({ start: "2012", current: false }), "2012 – end date not stated");
    assert.equal(roleDates({ start: "Jan 2019", end: "Mar 2023" }), "Jan 2019 – Mar 2023");
    assert.equal(roleDates({}), undefined);
  });

  it("profile and board pages stay out of Recent News", () => {
    assert.equal(isProfilePage("https://www.linkedin.com/in/jane-doe"), true);
    assert.equal(isProfilePage("https://www.crunchbase.com/person/jane-doe"), true);
    assert.equal(isProfilePage("https://www.forbes.com/profile/jane-doe/"), true);
    assert.equal(isProfilePage("https://acme.com/leadership/"), true);
    assert.equal(isProfilePage("https://fortune.com/2024/04/17/gecko-founding-jake-loosararian-robots"), false);
  });

  it("reads SEC hits filed by the organization, newest first", () => {
    const hits = [
      { _id: "0001606163-24-000010:lmb-def14a.htm", _source: { ciks: ["0001606163"], display_names: ["Limbach Holdings, Inc.  (LMB)  (CIK 0001606163)"], file_date: "2024-04-20" } },
      { _id: "0001606163-25-000012:lmb-def14a.htm", _source: { ciks: ["0001606163"], display_names: ["Limbach Holdings, Inc.  (LMB)  (CIK 0001606163)"], file_date: "2025-04-18" } },
      { _id: "0000000001-25-000001:other.htm", _source: { ciks: ["0000000001"], display_names: ["McCann Industries Corp (CIK 0000000001)"], file_date: "2025-06-01" } },
    ];
    const mine = filedBy(hits, "Limbach");
    assert.deepEqual(mine.map((h) => h._source?.file_date), ["2025-04-18", "2024-04-20"]);
    assert.equal(eftsDocUrl(mine[0]), "https://www.sec.gov/Archives/edgar/data/1606163/000160616325000012/lmb-def14a.htm");
  });

  it("extraction keeps dated roles, board seats, every degree and an announced departure", () => {
    const out = PersonExtractionSchema.parse({
      education: [{ degree: "BSME", school: "Worcester Polytechnic Institute" }, { degree: "MBA", school: "Drexel University" }],
      careerHistory: [
        { title: "CEO", company: "Limbach", start: "Mar 29, 2023", current: true },
        { title: "Co-COO", company: "Limbach", start: "Jan 2019", end: "present", current: false },
      ],
      boardSeats: [{ organization: "WM", role: "Non-executive chair", since: "2020" }, { role: "Director" }],
      announcedDeparture: "Announced in May 2026 that he will retire as CEO.",
    });
    assert.equal(out.education, "BSME, Worcester Polytechnic Institute; MBA, Drexel University");
    assert.deepEqual(out.careerHistory[0], { title: "CEO", company: "Limbach", start: "Mar 29, 2023", end: undefined, current: true });
    assert.equal(out.careerHistory[1].end, undefined, "\"present\" is not a date");
    assert.deepEqual(out.boardSeats, [{ organization: "WM", role: "Non-executive chair", start: "2020", end: undefined }]);
    assert.match(out.announcedDeparture!, /May 2026/);
  });

  it("officer records repeat across filings: one row each", () => {
    const bundle = personOf({
      person: { name: "Jane Doe", currentCompany: "Acme Robotics" },
      corporateAffiliations: [
        { companyName: "ACME ROBOTICS, INC.", position: "director" },
        { companyName: "Acme Robotics Inc", position: "Director" },
        { companyName: "Acme Robotics Inc", position: "president" },
      ],
    });
    applyPersonConsistency(bundle);
    assert.equal(bundle.corporateAffiliations?.length, 2);
  });

  it("the picker lists one match per organization", async () => {
    const searcher = {
      search: async () => [
        { title: "Michael McCann - Limbach", url: "https://www.limbachinc.com/mike-mccann/", snippet: "CEO" },
        { title: "Michael McCann - Limbach Holdings, Inc.", url: "https://www.example.com/mccann", snippet: "CEO" },
        { title: "Michael McCann - Drexel University", url: "https://drexel.edu/mccann", snippet: "Professor" },
      ],
      places: async () => [],
    };
    const { candidates } = await personCandidates("Michael McCann", undefined, searcher);
    assert.deepEqual(candidates.map((c) => c.subject), ["Michael McCann · Limbach", "Michael McCann · Drexel University"]);
  });

  it("the report dates each role, lists board seats and an announced departure", () => {
    const md = new ReportAgent().generatePerson(personOf({
      person: { name: "Jane Doe", affiliation: "Gecko Robotics", announcedDeparture: "Will step down as CEO in May 2026." },
      careerHistory: [{ title: "CEO", company: "Gecko Robotics", start: "2013" }, { title: "CEO", company: "Black Diamond", start: "2012", current: false }],
      boardSeats: [{ organization: "WM", role: "Director", start: "2015", url: "https://www.wm.com/board" }],
      companyNewsOrg: "Gecko Robotics",
      companyNews: [{ headline: "Gecko wins $300M Navy contract", url: "https://example.com/navy", date: "2026-09-01", outlet: "example.com" }],
      sources: [
        { url: "https://www.geckorobotics.com/about-us", title: "About Gecko", retrievedAt: "2026-10-28", usedFor: ["bio"] },
        { url: "https://www.wm.com/board", title: "WM board", retrievedAt: "2026-10-28", usedFor: ["board-seats"] },
        { url: "https://example.com/navy", title: "Navy contract", retrievedAt: "2026-10-28", usedFor: ["company-news"] },
      ],
    }));
    assert.match(md, /- CEO at Gecko Robotics _\(since 2013\)_/);
    assert.match(md, /- CEO at Black Diamond _\(2012 – end date not stated\)_/);
    assert.match(md, /## Board Seats\n- \[\*\*WM\*\*\]\(https:\/\/www\.wm\.com\/board\) — Director _\(since 2015\)_/);
    assert.match(md, /\*\*Announced departure:\*\* Will step down/);
    assert.match(md, /## Gecko Robotics News\n- \[Gecko wins \$300M Navy contract\]/);
  });
});
