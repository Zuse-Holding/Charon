import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPersonalLifeNews } from "./news-noise.js";

const personal = (h: string) => isPersonalLifeNews(h, undefined, "https://news.example/x");

describe("round fifteen (b): feuds and denials", () => {
  it("personal feuds and denials are still personal-life news", () => {
    assert.equal(personal("Crumbl co-founder outed on Grindr, report says"), true);
    assert.equal(personal("Crumbl founders' feud with ex-partner goes viral"), true);
    assert.equal(personal("Crumbl co-founder denies cheating claims"), true);
  });

  it("a feud or denial with something legal or commercial at stake is business news", () => {
    assert.equal(personal("Crumbl and Dirty Dough settle trademark feud"), false);
    assert.equal(personal("ACCO Engineered Systems denies discrimination claims in federal lawsuit"), false);
    assert.equal(personal("Limbach denies claims in shareholder suit"), false);
    assert.equal(personal("Graybar denies wage-theft claims filed by former drivers"), false);
  });
});
