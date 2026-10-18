import { test } from "node:test";
import assert from "node:assert/strict";
import { isNewsIndexPage, newsDate, outletFromUrl } from "./news-noise.js";

test("newsroom and blog landing pages are index pages", () => {
  assert.equal(isNewsIndexPage("https://stripe.com/newsroom/news"), true);
  assert.equal(isNewsIndexPage("https://example.com/press/"), true);
  assert.equal(isNewsIndexPage("https://example.com/en-us/blog"), true);
});

test("articles are not index pages", () => {
  assert.equal(isNewsIndexPage("https://stripe.com/newsroom/news/stripe-series-i-employee-liquidity"), false);
  assert.equal(isNewsIndexPage("https://www.axios.com/2026/08/19/stripe-payments-openrouter-singularity"), false);
  assert.equal(isNewsIndexPage("https://www.lemonsqueezy.com/blog/2026-update"), false);
});

test("outlet is the bare hostname", () => {
  assert.equal(outletFromUrl("https://www.axios.com/2026/08/19/x"), "axios.com");
});

test("news date prefers the search date, then the URL path", () => {
  assert.equal(newsDate("Aug 19, 2026", "https://example.com/a"), "Aug 19, 2026");
  assert.equal(newsDate(undefined, "https://www.axios.com/2026/08/19/x"), "Aug 19, 2026");
  assert.equal(newsDate("3 days ago", "https://example.com/a", new Date("2026-10-17T12:00:00Z")), "Oct 14, 2026");
  assert.equal(newsDate(undefined, "https://example.com/a"), undefined);
});
