import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formationFrom, fundNames, isHealthcare, nlrbCase, parseFormD, parseNppes } from "./index.js";
import { matchingUeis } from "../usaspending-agent/index.js";
import { systemsInUse } from "../domain-posture-agent/index.js";

describe("registry checks (launch fixes 12-18)", () => {
  it("reads an NPI record's authorized official", () => {
    const [r] = parseNppes({ results: [{
      number: 1234567890,
      basic: { organization_name: "PROMISE ABA LLC", authorized_official_first_name: "LILIT", authorized_official_last_name: "GEVOGLANIAN", authorized_official_title_or_position: "OWNER", enumeration_date: "2017-05-02" },
      addresses: [{ address_purpose: "LOCATION", city: "BURBANK", state: "CA" }],
      taxonomies: [{ desc: "Behavior Analyst", primary: true }],
    }, { number: 2, basic: { organization_name: "PROMISE HEALTH INC" } }] }, "Promise ABA");
    assert.equal(r.official, "Lilit Gevoglanian, Owner");
    assert.equal(r.location, "Burbank, CA");
    assert.equal(r.url, "https://npiregistry.cms.hhs.gov/provider-view/1234567890");
    assert.ok(isHealthcare("Applied behavior analysis (ABA) therapy provider"));
    assert.ok(!isHealthcare("commercial mechanical contractor"));
  });

  it("reads an NLRB case page and a state formation record", () => {
    const c = nlrbCase({ title: "ACCO Engineered Systems, Inc. | National Labor Relations Board", url: "https://www.nlrb.gov/case/27-CA-374248", snippet: "Date Filed: 09/12/2025" }, "ACCO Engineered Systems");
    assert.equal(c?.docketNumber, "27-CA-374248");
    assert.equal(c?.filed, "09/12/2025");
    assert.equal(nlrbCase({ title: "Other Co", url: "https://www.nlrb.gov/case/27-CA-1" }, "ACCO Engineered Systems"), undefined);
    const f = formationFrom({ title: "PROMISE ABA LLC :: California (US) :: OpenCorporates", url: "https://opencorporates.com/companies/us_ca/201712345678",
      snippet: "Promise ABA LLC. Company Number 201712345678. Incorporation Date 3 March 2017." }, "Promise ABA");
    assert.equal(f?.date.slice(0, 4), "2017");
    assert.equal(formationFrom({ title: "Promise ABA reviews", url: "https://www.yelp.com/biz/x", snippet: "Formation date: 2017" }, "Promise ABA"), undefined);
  });

  it("searches Form D under the company's own fund names and reads amounts", () => {
    assert.deepEqual(fundNames(["MJW Investments launched MJW Student Housing Fund II, targeting $100M.", "Blackstone Real Estate Partners"], "MJW Investments"),
      ["MJW Student Housing Fund II"]);
    const d = parseFormD("<entityName>MJW Fund LP</entityName><totalOfferingAmount>100000000</totalOfferingAmount><totalAmountSold>62500000</totalAmountSold>");
    assert.deepEqual(d, { issuer: "MJW Fund LP", offered: "$100,000,000", sold: "$62,500,000" });
  });

  it("matches USAspending recipients on UEI", () => {
    assert.deepEqual(matchingUeis({ results: [
      { recipient_name: "ACCO ENGINEERED SYSTEMS, INC.", uei: "abc123def456" },
      { recipient_name: "ACCOR HOTELS", uei: "ZZZ" },
    ] }, ["acco engineered systems"]), ["ABC123DEF456"]);
  });

  it("turns MX and SPF records into systems in use", () => {
    assert.deepEqual(systemsInUse(["mx0a-001.pphosted.com"], ["v=spf1 include:spf.protection.outlook.com -all"]), ["Microsoft 365", "Proofpoint"]);
    assert.deepEqual(systemsInUse(["mx.paubox.com"], ["v=spf1 include:paubox.com ~all"]), ["Paubox (HIPAA email)"]);
    assert.ok(systemsInUse([], ["v=spf1 include:_spf.oracleemaildelivery.com include:12345.spf.hubspotemail.net -all"]).includes("HubSpot"));
  });
});
