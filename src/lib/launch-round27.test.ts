import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { confirmBoardSeats, educationFrom, settleTitles, statedDates } from "./person-sources.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { CareerEntry, PersonProfile } from "../types/research.js";

const MAZZ_TEXTS = [
  "Oct 15, 2026 — Graybar Chairman, President and CEO Kathleen Mazzarella received the 2026 Conference Board award.",
  "Kathleen Mazzarella joined Graybar in 1980 as a customer service representative. She was named president and CEO in June 2012 and became chairman in January 2013.",
  "Graybar CEO Kathleen Mazzarella to chair 2026 NAW board.",
];

describe("round twenty-seven: dates only as the sources state them", () => {
  it("Mazzarella: a 2026 article's date doesn't start or end a role", () => {
    const person: PersonProfile = { name: "Kathleen Mazzarella", currentRole: "Chairman, President & CEO", currentCompany: "Graybar" };
    // What the model returned: the article's year as a start, and as an end for the real role.
    const career: CareerEntry[] = [
      { title: "Chairman, President & CEO", company: "Graybar", start: "2026", current: true },
      { title: "President & CEO", company: "Graybar", start: "Jun 2012", end: "2026", current: false },
      { title: "Chairman", company: "Graybar", start: "Jan 2013" },
      { title: "Customer service representative", company: "Graybar", start: "1980" },
    ];
    const settled = settleTitles(person, career, ["Graybar"], { snippets: MAZZ_TEXTS, dated: MAZZ_TEXTS });
    assert.equal(person.currentRole, "Chairman, President & CEO");
    const row = (t: string) => settled.careerHistory.find((c) => c.title === t)!;
    assert.equal(settled.careerHistory[0].title, "Chairman, President & CEO");
    assert.equal(settled.careerHistory[0].start, undefined, "no \"since 2026\"");
    assert.deepEqual([row("President & CEO").start, row("President & CEO").end, row("President & CEO").current], ["Jun 2012", undefined, true]);
    assert.deepEqual([row("Chairman").start, row("Chairman").end, row("Chairman").current], ["Jan 2013", undefined, true]);
    assert.equal(row("Customer service representative").start, "1980");

    const seats = confirmBoardSeats(
      [{ organization: "WM", role: "Non-executive chair" }, { organization: "The Cigna Group", role: "Director" },
        { organization: "Core & Main", role: "Director" }, { organization: "National Association of Wholesaler-Distributors", role: "2026 Chair" }],
      {
        boardPages: [{ url: "https://investors.thecignagroup.com/board/mazzarella", text: "Kathleen M. Mazzarella - Board of Directors - The Cigna Group\nKathleen M. Mazzarella is Chairman, President and CEO of Graybar. She serves as non-executive chair of the board of Waste Management, Inc. and as a director of Core & Main." }],
        vouched: [],
        tied: [{ url: "https://www.inddist.com/naw", text: "Graybar CEO Kathleen Mazzarella to chair 2026 NAW board." }],
      },
      ["Graybar"],
    );
    assert.deepEqual(seats.map((s) => s.organization), ["WM", "The Cigna Group", "Core & Main", "National Association of Wholesaler-Distributors"]);

    const md = new ReportAgent().generatePerson({
      query: "x", generatedAt: "2026-10-29T00:00:00Z", news: [],
      person: { ...person, education: educationFrom(["Kathleen Mazzarella holds a bachelor’s degree from National Louis University and an MBA from Webster University."], person.name) },
      careerHistory: settled.careerHistory, boardSeats: seats,
      sources: [{ url: "https://www.graybar.com/mazzarella", title: "Bio", retrievedAt: "2026-10-29", usedFor: ["bio"] }],
    });
    const careerSection = md.slice(md.indexOf("## Career History"), md.indexOf("## Corporate Affiliations"));
    assert.doesNotMatch(careerSection, /2026/);
    assert.match(careerSection, /President & CEO at Graybar _\(since Jun 2012\)_/);
    assert.match(careerSection, /Chairman at Graybar _\(since Jan 2013\)_/);
    assert.match(careerSection, /Customer service representative at Graybar _\(1980 – end date not stated\)_/);
    assert.match(md, /## Education\n- Bachelor’s degree, National Louis University\n- MBA, Webster University/);
    for (const org of ["WM", "Cigna", "Core & Main", "National Association of Wholesaler-Distributors"]) assert.ok(md.includes(org), org);
  });

  it("Darway: a stated 2026 start still makes President current and ends EVP", () => {
    const texts = [
      "ACCO Engineered Systems named Chuck Darway president, effective October 1, 2026.",
      "Darway joined ACCO in 2023 as executive vice president of construction.",
    ];
    const person: PersonProfile = { name: "Chuck Darway", currentRole: "Executive Vice President, Construction", currentCompany: "ACCO Engineered Systems" };
    const settled = settleTitles(person, [
      { title: "Executive Vice President, Construction", company: "ACCO Engineered Systems", start: "2023" },
      { title: "President", company: "ACCO Engineered Systems", start: "Oct 2026" },
    ], ["ACCO Engineered Systems"], { snippets: texts, dated: texts });
    assert.equal(person.currentRole, "President");
    assert.deepEqual(settled.careerHistory[0], { title: "President", company: "ACCO Engineered Systems", start: "Oct 2026", current: true });
    const evp = settled.careerHistory.find((c) => c.title.startsWith("Executive"))!;
    assert.deepEqual([evp.start, evp.end, evp.current], ["2023", "Oct 2026", false]);
  });

  it("a year counts as a start only when worded as one", () => {
    const check = (start: string, text: string) => statedDates([{ title: "CEO", company: "Acme", start }], [text], "Jane Doe").careerHistory[0].start;
    assert.equal(check("2026", "Oct 15, 2026 — Acme CEO Jane Doe spoke at the summit."), undefined);
    assert.equal(check("2026", "Acme CEO Jane Doe said in a 2026 interview that sales grew."), undefined);
    assert.equal(check("2019", "Jane Doe has been Acme's CEO since 2019."), "2019");
    assert.equal(check("Mar 2023", "Jane Doe was appointed CEO of Acme in March 2023."), "Mar 2023");
    assert.equal(check("2014", "In 2014, Doe was named CEO of Acme."), "2014");
    const end = (e: string, text: string) => statedDates([{ title: "President", company: "Black Diamond", start: "2012", end: e }], [text], "Ryan Gellert").careerHistory[0].end;
    assert.equal(end("2014", "Ryan Gellert was president of Black Diamond from 2012 to 2014."), "2014");
    assert.equal(end("2026", "Ryan Gellert, a former Black Diamond president, spoke on Oct 2, 2026."), undefined);
  });
});
