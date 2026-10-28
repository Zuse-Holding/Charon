import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  confirmBoardSeats, fullerTitle, orderCareer, otherCeoOf, recentEnough, roleDates, verifyEducation, verifyNetWorth,
} from "./person-sources.js";
import { applyPersonConsistency } from "./consistency.js";
import { ReportAgent } from "../agents/report-agent/index.js";
import type { CareerEntry, PersonProfile, PersonResearchBundle } from "../types/research.js";

const personOf = (over: Partial<PersonResearchBundle>): PersonResearchBundle => ({
  query: "Jane Doe", generatedAt: "2026-10-29T00:00:00Z", person: { name: "Jane Doe" }, careerHistory: [], news: [], sources: [], ...over,
});

describe("round twenty-four: Oct 28 deploy regressions", () => {
  describe("P1: the current title is never stripped", () => {
    it("a title phrase is never read as another CEO's name", () => {
      const cases: [string, string, string][] = [
        ["Gecko Robotics CEO and co-founder Jake Loosararian spoke at the summit.", "Gecko Robotics", "Jake Loosararian"],
        ["Mazzarella, who became president and CEO of Graybar in 2012, joined in 1980.", "Graybar", "Kathleen Mazzarella"],
        ["The board named its new president and CEO of Graybar Electric.", "Graybar", "Kathleen Mazzarella"],
        ["Kathleen Mazzarella, Chairman, President and CEO of Graybar", "Graybar", "Kathleen Mazzarella"],
        ["Patagonia CEO Ryan Gellert said the company would", "Patagonia", "Ryan Gellert"],
        ["Patagonia Chief Executive Officer Ryan Gellert", "Patagonia", "Ryan Gellert"],
      ];
      for (const [text, org, person] of cases) assert.equal(otherCeoOf([text], org, person), undefined, text);
    });

    it("someone else named as CEO still conflicts, in every wording", () => {
      assert.equal(otherCeoOf(["Thomas Vozzo, Homeboy’s CEO, said the bakery grew."], "Homeboy Industries", "Gregory Boyle"), "Thomas Vozzo");
      assert.equal(otherCeoOf(["Homeboy Industries CEO Thomas Vozzo said"], "Homeboy Industries", "Gregory Boyle"), "Thomas Vozzo");
      assert.equal(otherCeoOf(["Thomas Vozzo, chief executive officer of Homeboy Industries"], "Homeboy Industries", "Gregory Boyle"), "Thomas Vozzo");
    });

    it("the fuller title wins when About and the role field disagree", () => {
      const boyle: PersonProfile = { name: "Gregory Boyle", currentRole: "Executive Director", currentCompany: "Homeboy Industries" };
      fullerTitle(boyle, [], ["Father Gregory Boyle is the founder and executive director of Homeboy Industries in Los Angeles."], true);
      assert.equal(boyle.currentRole, "Founder and Executive Director");

      const mazz: PersonProfile = { name: "Kathleen Mazzarella", currentRole: "Chairman, President", currentCompany: "Graybar Electric Company" };
      fullerTitle(mazz, [], ["Kathleen Mazzarella is Chairman, President and CEO of Graybar, a Fortune 500 distributor."]);
      assert.equal(mazz.currentRole, "Chairman, President and CEO");

      const jake: PersonProfile = { name: "Jake Loosararian", currentRole: "Co-Founder", currentCompany: "Gecko Robotics" };
      fullerTitle(jake, [{ title: "Co-Founder and CEO", company: "Gecko Robotics", start: "2013" }], []);
      assert.equal(jake.currentRole, "Co-Founder and CEO");
    });

    it("no CEO title comes back where someone else is CEO", () => {
      const boyle: PersonProfile = { name: "Gregory Boyle", currentRole: "Founder", currentCompany: "Homeboy Industries" };
      assert.equal(fullerTitle(boyle, [], ["Gregory Boyle, founder and CEO of Homeboy Industries"], true), undefined);
      assert.equal(boyle.currentRole, "Founder");
    });

    it("career history starts with the current role and its start date", () => {
      const person: PersonProfile = { name: "Ryan Gellert", currentRole: "CEO", currentCompany: "Patagonia" };
      const career: CareerEntry[] = [
        { title: "President", company: "Black Diamond Equipment", start: "2012" },
        { title: "CEO", company: "Patagonia", start: "Sep 2020" },
        { title: "General Manager, EMEA", company: "Patagonia", start: "2014", end: "2020" },
      ];
      const ordered = orderCareer(person, career);
      assert.deepEqual(ordered[0], { title: "CEO", company: "Patagonia", start: "Sep 2020", current: true });
      const bd = ordered.find((c) => c.company === "Black Diamond Equipment")!;
      assert.equal(roleDates(bd), "2012 – end date not stated", "a past role never reads as \"since 2012\"");
      assert.equal(roleDates(ordered.find((c) => c.title.startsWith("General"))!), "2014 – 2020");
    });

    it("roles the current title holds stay current; other open roles are past", () => {
      const person: PersonProfile = { name: "Kathleen Mazzarella", currentRole: "Chairman, President and CEO", currentCompany: "Graybar" };
      const ordered = orderCareer(person, [
        { title: "Chairman", company: "Graybar", start: "Jan 2013" },
        { title: "President and CEO", company: "Graybar", start: "Jun 2012" },
        { title: "Customer service representative", company: "Graybar", start: "Jan 1980" },
        { title: "Non-executive chair", company: "WM", start: "2020", current: true },
      ]);
      assert.equal(ordered[0].title, "Chairman, President and CEO");
      assert.equal(roleDates(ordered.find((c) => c.title === "Chairman")!), "since Jan 2013");
      assert.equal(roleDates(ordered.find((c) => c.title.startsWith("Customer"))!), "Jan 1980 – end date not stated");
      assert.equal(roleDates(ordered.find((c) => c.company === "WM")!), "since 2020");
    });

    it("affiliations: one row per organization, the conflicting CEO title dropped", () => {
      const bundle = personOf({
        person: { name: "Gregory Boyle", affiliation: "Homeboy Industries" },
        officerConflicts: [{ org: "Homeboy Industries", ceo: "Thomas Vozzo" }],
        corporateAffiliations: [
          { companyName: "HOMEBOY INDUSTRIES", position: "Founder and Chief Executive Officer" },
          { companyName: "Homeboy Industries", position: "Executive Director" },
        ],
      });
      applyPersonConsistency(bundle);
      assert.equal(bundle.corporateAffiliations?.length, 1);
      assert.doesNotMatch(bundle.corporateAffiliations![0].position!, /chief executive|ceo/i);
    });
  });

  describe("P2: overcorrections", () => {
    it("outside board seats stay, below the operating role", () => {
      const tied = [{ url: "https://www.graybar.com/news/mazzarella", text: "Kathleen Mazzarella, chairman and CEO of Graybar, serves as non-executive chair of the WM board. She is also a director of The Cigna Group and Core & Main." }];
      const seats = confirmBoardSeats(
        [{ organization: "WM", role: "Non-executive chair" }, { organization: "The Cigna Group", role: "Director" }, { organization: "Core & Main", role: "Director" }, { organization: "Amnesty International USA" }],
        { boardPages: [], vouched: [], tied }, ["Graybar"],
      );
      assert.deepEqual(seats.map((s) => s.organization), ["WM", "The Cigna Group", "Core & Main"]);

      const md = new ReportAgent().generatePerson(personOf({
        person: { name: "Kathleen Mazzarella", currentRole: "Chairman, President and CEO", currentCompany: "Graybar" },
        careerHistory: [{ title: "Chairman, President and CEO", company: "Graybar", start: "Jun 2012", current: true }],
        boardSeats: seats,
        sources: [{ url: "https://www.graybar.com/news/mazzarella", title: "Graybar", retrievedAt: "2026-10-29", usedFor: ["bio"] }],
      }));
      const section = md.slice(md.indexOf("## Corporate Affiliations"));
      assert.match(section, /^## Corporate Affiliations\n- \*\*Graybar\*\* — Chairman, President and CEO _\(since Jun 2012\)_\n- \[\*\*WM\*\*\]/);
      assert.match(section, /Cigna/);
      assert.match(section, /Core & Main/);
    });

    it("a degree's field of study stays; only an invented abbreviation goes", () => {
      const tied = ["Jake Loosararian earned a B.S. in Electrical Engineering from Grove City College before founding Gecko Robotics."];
      assert.equal(verifyEducation("B.A.Sc. in Electrical Engineering, Grove City College", tied, "Jake Loosararian"), "Electrical Engineering, Grove City College");
      assert.equal(verifyEducation("B.S. in Electrical Engineering, Grove City College", tied, "Jake Loosararian"), "B.S. in Electrical Engineering, Grove City College");
      assert.equal(verifyEducation("Electrical Engineering, Grove City College", tied, "Jake Loosararian"), "Electrical Engineering, Grove City College");
    });

    it("a net worth no source states is dropped", () => {
      assert.equal(verifyNetWorth("$9M", ["Michael McCann is CEO of Limbach Holdings."], "Michael McCann"), undefined);
      assert.equal(verifyNetWorth("$9M", ["Michael McCann's net worth is estimated at $9 million, based on his Limbach stock."], "Michael McCann"), "$9M");
    });
  });

  describe("P3: Recent News", () => {
    it("drops items older than two years", () => {
      const now = new Date("2026-10-29T00:00:00Z");
      assert.equal(recentEnough("2011-12-15", now), false);
      assert.equal(recentEnough("2024-11-01", now), true);
      assert.equal(recentEnough(undefined, now), false);
    });
  });
});
