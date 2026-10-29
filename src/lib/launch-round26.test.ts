import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanCareer, confirmBoardSeats, educationFrom, isHomepage, mergeEducation, promoteNewestRole, settleTitles, startValue, verifyEducation,
} from "./person-sources.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { CareerEntry, PersonProfile } from "../types/research.js";

describe("round twenty-six: Oct 28 retest (5:36 PM)", () => {
  it("Darway: the newest open role is the current role, and the older one ends when it starts", () => {
    const person: PersonProfile = { name: "Chuck Darway", currentRole: "Executive Vice President, Construction", currentCompany: "ACCO Engineered Systems" };
    const career: CareerEntry[] = [
      { title: "Executive Vice President, Construction", company: "ACCO Engineered Systems", start: "2023" },
      { title: "President", company: "ACCO Engineered Systems", start: "Oct 2026" },
      { title: "Vice President", company: "ACCO Engineered Systems", start: "2015", end: "2023" },
    ];
    const settled = settleTitles(person, career, ["ACCO Engineered Systems"], { snippets: [] });
    assert.equal(person.currentRole, "President");
    assert.deepEqual(settled.careerHistory[0], { title: "President", company: "ACCO Engineered Systems", start: "Oct 2026", current: true });
    const evp = settled.careerHistory.find((c) => c.title.startsWith("Executive Vice President"))!;
    assert.deepEqual([evp.start, evp.end, evp.current], ["2023", "Oct 2026", false]);

    const md = new ReportAgent().generatePerson({
      query: "x", generatedAt: "2026-10-29T00:00:00Z", person, careerHistory: settled.careerHistory, news: [],
      sources: [{ url: "https://example.com/bio", title: "Bio", retrievedAt: "2026-10-29", usedFor: ["bio", "corporate-affiliations"] }],
      corporateAffiliations: [{ companyName: "ACCO ENGINEERED SYSTEMS, INC.", position: "Executive Vice President" }],
    });
    assert.match(md, /- \*\*Role:\*\* President\n/);
    assert.match(md, /## Corporate Affiliations\n- \*\*ACCO Engineered Systems\*\* — President _\(since Oct 2026\)_/);
    assert.match(md, /Executive Vice President, Construction at ACCO Engineered Systems _\(2023 – Oct 2026\)_/);
  });

  it("a newer role the current title already holds changes nothing (Mazzarella's Chairman)", () => {
    const person: PersonProfile = { name: "Kathleen Mazzarella", currentRole: "Chairman, President and CEO", currentCompany: "Graybar" };
    const career: CareerEntry[] = [
      { title: "President and CEO", company: "Graybar", start: "Jun 2012" },
      { title: "Chairman", company: "Graybar", start: "Jan 2013" },
    ];
    assert.equal(promoteNewestRole(person, career), undefined);
    assert.equal(person.currentRole, "Chairman, President and CEO");
    assert.ok(career.every((c) => !c.end));
  });

  it("a current role with no dated row isn't replaced", () => {
    const person: PersonProfile = { name: "Jane Doe", currentRole: "President", currentCompany: "Acme" };
    assert.equal(promoteNewestRole(person, [{ title: "EVP", company: "Acme", start: "2020" }]), undefined);
    assert.equal(person.currentRole, "President");
  });

  it("dates sort by year, month and day", () => {
    assert.ok(startValue("Oct 2026")! > startValue("2023")!);
    assert.ok(startValue("Mar 29, 2023")! > startValue("Mar 2023")!);
    assert.ok(startValue("Jan 2013")! > startValue("Jun 2012")!);
    assert.equal(startValue("recently"), undefined);
  });

  it("education: every degree a source names, with school and major", () => {
    const boyle = ["Father Gregory Boyle earned a bachelor’s degree in English from Gonzaga University and an M.Div. from the Weston Jesuit School of Theology. Boyle founded Homeboy Industries in 1988."];
    assert.equal(educationFrom(boyle, "Gregory Boyle"), "Bachelor’s degree in English, Gonzaga University; M.Div., Weston Jesuit School of Theology");
    // The model's honorary doctorate and the degrees read from the text, one per school.
    assert.equal(
      mergeEducation("Honorary doctorate, Loyola Marymount University", educationFrom(boyle, "Gregory Boyle")),
      "Honorary doctorate, Loyola Marymount University; Bachelor’s degree in English, Gonzaga University; M.Div., Weston Jesuit School of Theology",
    );
    const gellert = ["Ryan Gellert graduated from Western State College with a B.A. in Business."];
    assert.equal(educationFrom(gellert, "Ryan Gellert"), "B.A. in Business, Western State College");
    const mazz = ["Kathleen Mazzarella holds a bachelor’s degree from National Louis University and an MBA from Webster University."];
    assert.equal(educationFrom(mazz, "Kathleen Mazzarella"), "Bachelor’s degree, National Louis University; MBA, Webster University");
  });

  it("education: no school, no entry", () => {
    assert.equal(verifyEducation("Self-taught", ["Jason McGowan, self-taught, co-founded Crumbl."], "Jason McGowan"), undefined);
    assert.equal(
      verifyEducation("BA; MBA, Webster University", ["Kathleen Mazzarella earned an MBA from Webster University."], "Kathleen Mazzarella"),
      "MBA, Webster University",
    );
  });

  it("board seats: WM and Core & Main from Cigna's bio, by name or initials", () => {
    const cignaBio = [{ url: "https://investors.thecignagroup.com/board/mazzarella", text: "Kathleen M. Mazzarella - Board of Directors - The Cigna Group\nKathleen M. Mazzarella is Chairman, President and CEO of Graybar. She serves as non-executive chair of the board of Waste Management, Inc. and as a director of Core & Main." }];
    const seats = confirmBoardSeats(
      [{ organization: "The Cigna Group", role: "Director" }, { organization: "WM", role: "Non-executive chair" }, { organization: "Core & Main", role: "Director" }],
      { boardPages: cignaBio, vouched: [], tied: cignaBio }, ["Graybar"],
    );
    assert.deepEqual(seats.map((s) => s.organization), ["The Cigna Group", "WM", "Core & Main"]);
  });

  it("junk: placeholder titles, duplicate rows and homepages as news", () => {
    const career = cleanCareer([
      { title: "Role", company: "i.TV" },
      { title: "Founder", company: "Homeboy Industries" },
      { title: "Founder", company: "Homeboy Industries", start: "1988" },
      { title: "Co-founder and CEO", company: "Crumbl" },
    ]);
    assert.deepEqual(career.map((c) => [c.title, c.start]), [["Founder", "1988"], ["Co-founder and CEO", undefined]]);
    assert.equal(isHomepage("https://crumbl.com/"), true);
    assert.equal(isHomepage("https://crumbl.com/en-us/"), true);
    assert.equal(isHomepage("https://www.businesswire.com/news/home/20260518/en/"), false);
  });
});
