import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boardsNamed, cleanCareer, confirmBoardSeats, educationFor, roleDates, seatsFromBoardPages, settleTitles } from "./person-sources.js";
import { BUILD_ID } from "./build.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { CareerEntry, PersonProfile } from "../types/research.js";

const ACCO_RELEASE = {
  url: "https://www.accoes.com/news/acco-board-2019",
  text: "ACCO Engineered Systems elects Chuck Darway to its board of directors. Darway holds a B.S. in Mechanical Engineering from California Polytechnic State University, San Luis Obispo.",
};
const NAMESAKE = {
  url: "https://www.linkedin.com/in/charles-darway-ee",
  text: "Chuck Darway - Electrical Engineer - Entergy. Education: B.S. in Electrical Engineering from University of Louisiana at Lafayette.",
};

describe("round twenty-eight: namesake education, role ends, board seats, cache", () => {
  it("Darway: education only from sources tied to ACCO, the company's own word first", () => {
    // The model mixed the namesake's degree in; the namesake page names his employer, not ACCO.
    const extracted = "Electrical engineering, University of Louisiana at Lafayette; B.S. in Mechanical Engineering, California Polytechnic State University";
    const edu = educationFor(extracted, [ACCO_RELEASE, NAMESAKE], "Chuck Darway", "ACCO Engineered Systems", ["ACCO Engineered Systems", "Entergy"]);
    assert.match(edu!, /Mechanical Engineering, California Polytechnic State University/);
    assert.doesNotMatch(edu!, /Louisiana|Electrical/);

    // A namesake page that names ACCO still loses to ACCO's own release on a bachelor's degree.
    const mixed = { url: "https://www.zoominfo.com/p/chuck-darway", text: "Chuck Darway, ACCO Engineered Systems. B.S. in Electrical Engineering from University of Louisiana at Lafayette." };
    assert.doesNotMatch(educationFor(undefined, [ACCO_RELEASE, mixed], "Chuck Darway", "ACCO Engineered Systems", [])!, /Louisiana/);
    // ...and adds a degree of another level.
    const mba = { url: "https://example.com/acco-darway", text: "Chuck Darway of ACCO Engineered Systems earned an MBA from Pepperdine University." };
    assert.match(educationFor(undefined, [ACCO_RELEASE, mba], "Chuck Darway", "ACCO Engineered Systems", [])!, /California Polytechnic State University; MBA, Pepperdine University/);
    // No ACCO source at all: nothing, not the namesake's school.
    assert.equal(educationFor(extracted, [NAMESAKE], "Chuck Darway", "ACCO Engineered Systems", ["Entergy"]), undefined);
  });

  it("Darway: a role ends when the next one at ACCO starts", () => {
    const person: PersonProfile = { name: "Chuck Darway", currentRole: "President", currentCompany: "ACCO Engineered Systems" };
    const career: CareerEntry[] = [
      { title: "President", company: "ACCO Engineered Systems", start: "Oct 2026", current: true },
      { title: "EVP, Construction", company: "ACCO Engineered Systems", start: "2023" },
      { title: "EVP, Corporate Operations", company: "ACCO Engineered Systems", start: "2020", current: false },
    ];
    const settled = settleTitles(person, career, ["ACCO Engineered Systems"], { snippets: [] });
    const dates = (t: string) => roleDates(settled.careerHistory.find((c) => c.title === t)!);
    assert.equal(dates("President"), "since Oct 2026");
    assert.equal(dates("EVP, Construction"), "2023 – Oct 2026");
    assert.equal(dates("EVP, Corporate Operations"), "2020 – 2023");
  });

  it("Mazzarella: the Graybar board chair is part of her title, and control characters go", () => {
    const person: PersonProfile = { name: "Kathleen Mazzarella", currentRole: "Chairman, President\u001d & CEO", currentCompany: "Graybar" };
    const career: CareerEntry[] = [
      { title: "President & CEO", company: "Graybar", start: "Jun 2012" },
      { title: "Chairman", company: "Graybar", start: "Jan 2013" },
      { title: "Chairman of Graybar board of directors", company: "Graybar", current: false },
      { title: "Customer service representative", company: "Graybar", start: "1980" },
      { title: "Senior Vice President,\u001d Human Resources", company: "Graybar", start: "2008" },
    ];
    const settled = settleTitles(person, career, ["Graybar"], { snippets: [] });
    assert.equal(person.currentRole, "Chairman, President & CEO");
    const row = (t: string) => settled.careerHistory.find((c) => c.title === t)!;
    assert.equal(row("Chairman of Graybar board of directors").current, true);
    assert.deepEqual([row("President & CEO").end, row("Chairman").end], [undefined, undefined]);
    // Four years before she became CEO: closed then. 1980 is too far back to say.
    assert.equal(roleDates(row("Senior Vice President, Human Resources")), "2008 – Jun 2012");
    assert.equal(roleDates(row("Customer service representative")), "1980 – end date not stated");
    assert.ok(settled.careerHistory.every((c) => !/[\u0000-\u001f]/.test(c.title)));
    assert.equal(cleanCareer([{ title: "Director\u001d", company: "Acme\u0007 Inc" }])[0].company, "Acme Inc");

    const md = new ReportAgent().generatePerson({
      query: "x", generatedAt: "2026-10-29T00:00:00Z", news: [], person, careerHistory: settled.careerHistory, sources: [],
    });
    assert.doesNotMatch(md, /past role/);
    assert.doesNotMatch(md, /[\u0000-\u0008\u000b-\u001f]/);
  });

  it("Mazzarella: board seats as her bios and the NAW story word them", () => {
    const texts = [
      "Kathleen Mazzarella is chairman, president and CEO of Graybar. She serves on the boards of directors of The Cigna Group, Core & Main and WM (non-executive chair).",
      "In 2026 Mazzarella was named chair of the National Association of Wholesaler-Distributors, Graybar said.",
      // Someone else's seat in the same story isn't hers.
      "Graybar's Kathleen Mazzarella spoke. Robert Smith is chairman of Acme Corp.",
    ];
    const named = boardsNamed(texts, "Kathleen Mazzarella");
    assert.deepEqual(named.map((s) => [s.organization, s.role]), [
      ["The Cigna Group", "Director"], ["Core & Main", "Director"], ["WM", "non-executive chair"], ["National Association of Wholesaler-Distributors", "chair"],
    ]);
    const page = { url: "https://investors.thecignagroup.com/board/mazzarella", title: "Kathleen M. Mazzarella - Board of Directors - The Cigna Group" };
    assert.deepEqual(seatsFromBoardPages([page], "Kathleen Mazzarella").map((s) => s.organization), ["The Cigna Group"]);

    const seats = confirmBoardSeats([...named, { organization: "Graybar", role: "Chairman" }], {
      boardPages: [], vouched: [], tied: texts.map((text, i) => ({ url: `https://example.com/${i}`, text })),
    }, ["Graybar"]);
    assert.deepEqual(seats.map((s) => s.organization), ["The Cigna Group", "Core & Main", "WM", "National Association of Wholesaler-Distributors"]);
  });

  it("every person report names the build that wrote it", () => {
    const md = new ReportAgent().generatePerson({ query: "x", generatedAt: "2026-10-29T00:00:00Z", news: [], person: { name: "Jane Doe" }, careerHistory: [], sources: [] });
    assert.match(md, new RegExp(`\\*Generated 2026-10-29T00:00:00Z · build ${BUILD_ID}\\*`));
  });
});
