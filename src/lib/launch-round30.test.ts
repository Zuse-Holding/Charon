import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isEnforcementAction, mentionsCompany } from "./news-noise.js";
import { newsAboutSubject } from "./entities/subject.js";
import { parseFormD } from "../agents/public-filings-agent/index.js";

// Oct 29 Stripe run (the sample-report candidate): namesakes and people who
// used Stripe were reported as Stripe's news, charges and filings.
const stripe = { name: "Stripe", domain: "stripe.com", anchor: {} } as never;

describe("round thirty: one-word company names (Stripe)", () => {
  it("doesn't take the common word for the company", () => {
    assert.equal(newsAboutSubject("Ohio State football transfer kicker loses black stripe: Buckeye Breakfast", "https://www.cleveland.com/osu/2026/10/x.html", stripe), false);
    assert.equal(newsAboutSubject("Ohio State kicker Marcello Diomede sheds black stripe", "https://247sports.com/x", stripe), false);
    assert.equal(newsAboutSubject("Stripe launches Treasury for AI agents", "https://thepaypers.com/x", stripe), true);
    assert.equal(mentionsCompany("bids for highway stripe painting contracts", "Stripe"), false);
  });

  it("doesn't make a person's DOJ case a charge against the company they used", () => {
    const names = ["Stripe", "Stripe, Inc."];
    assert.equal(isEnforcementAction({ title: "Gastonia Man Is Indicted For Laundering Over $380,000 In Wire Fraud Scheme", url: "https://www.justice.gov/usao-wdnc/pr/gastonia-man-indicted-laundering-over-380000-wire-fraud-scheme", snippet: "The defendant received the stolen funds through accounts at Stripe, Inc. and PayPal." }, names), false);
    assert.equal(isEnforcementAction({ title: "Rochester man pleads guilty for conspiring to defraud victims, including taxpayers", url: "https://www.justice.gov/usao-wdny/pr/rochester-man-pleads-guilty-conspiring-defraud-victims-including-taxpayers-more", snippet: "payments were processed through Stripe." }, names), false);
    assert.equal(isEnforcementAction({ title: "North Dakota Company Charged with Rigging Highway Striping Bids", url: "https://www.justice.gov/archive/atr/public/press_releases/1994/211898.htm", snippet: "bids for highway stripe painting contracts" }, names), false);
    // A charge against the company itself still counts.
    assert.equal(isEnforcementAction({ title: "FTC Charges Stripe, Inc. Over Merchant Fees", url: "https://www.ftc.gov/news-events/news/press-releases/2026/x", snippet: "" }, names), true);
  });

  it("keeps only OSHA inspections of the company's own establishments", () => {
    const osha = (who: string) => ({ title: `Inspection: 1056877.015 - ${who}`, url: "https://www.osha.gov/ords/imis/establishment.inspection_detail?id=1056877.015", snippet: "Stripe" });
    assert.equal(isEnforcementAction(osha("Double O Seal & Stripe"), ["Stripe"]), false);
    assert.equal(isEnforcementAction(osha("Crown Car Wash Company/David E. Smith"), ["Stripe"]), false);
    assert.equal(isEnforcementAction(osha("Acco Engineered Systems, Inc."), ["ACCO Engineered Systems"]), true);
  });

  it("reads the Form D issuer's state so a namesake elsewhere can be skipped", () => {
    const xml = "<primaryIssuer><entityName>Stripe, Inc.</entityName><issuerAddress><street1>1 Main St</street1><city>Austin</city><stateOrCountry>TX</stateOrCountry></issuerAddress></primaryIssuer><relatedPersonInfo><relatedPersonAddress><stateOrCountry>CA</stateOrCountry></relatedPersonAddress></relatedPersonInfo>";
    assert.equal(parseFormD(xml).state, "TX");
  });
});
