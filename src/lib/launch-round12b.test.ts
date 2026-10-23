import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseOpenInsider } from "../agents/form4-agent/index.js";
import { insiderSelling, officersFromFilings } from "./insiders.js";
import { settleSiteTitles } from "./leadership.js";

const row = (trade: string, name: string, title: string, type: string, price: string, qty: string, value: string, acc: string) =>
  `<tr><td></td><td>${trade} 16:07:13</td><td><div>${trade}</div></td><td><b><a href="/LMB" onmouseover="Tip('x', DELAY, 1)" onmouseout="UnTip()">LMB</a></b></td>`
  + `<td><a href="/insider/x">${name}</a></td><td>${title}</td><td>${type}</td><td align=right>${price}</td><td align=right>${qty}</td><td align=right>1,000</td><td align=right>-3%</td><td align=right>${value}</td><td></td><td></td><td></td><td></td>`
  + `<a href="http://www.sec.gov/Archives/edgar/data/1606163/${acc}/form4.xml">x</a></tr>`;
const page = `<table width="100%" class="tinytable"><thead><tr><th>X</th><th>Filing&nbsp;Date</th></tr></thead><tbody>
${row("2026-04-30", "Brooks Jayme L.", "CFO", "S - Sale", "$100.00", "-3,440", "-$344,000", "1")}
${row("2026-04-02", "Brooks Jayme L.", "CFO", "S - Sale", "$98.00", "-5,000", "-$490,000", "2")}
${row("2026-03-17", "Brooks Jayme L.", "CFO", "S - Sale+OE", "$95.00", "-4,000", "-$380,000", "3")}
${row("2026-09-15", "Krzeminski Laurel J", "Dir", "P - Purchase", "$50.58", "+500", "+$25,288", "4")}
${row("2025-03-14", "Horowitz Joshua", "Dir", "S - Sale", "$95.00", "-20,000", "-$1,900,000", "5")}
</tbody></table>`;

describe("round twelve (b): fixes for the devs' list", () => {
  it("reads a ticker's insider filings from the OpenInsider table", () => {
    const rows = parseOpenInsider(page);
    assert.equal(rows.length, 5);
    assert.deepEqual(rows[0], { filerName: "Jayme L. Brooks", relationship: "CFO", transactionType: "Sell", shares: "3,440", value: "$344,000", date: "2026-04-30",
      filingUrl: "http://www.sec.gov/Archives/edgar/data/1606163/1/form4.xml" });
    assert.equal(rows[3].transactionType, "Buy");
    assert.equal(rows[3].relationship, "Director");
    assert.deepEqual(officersFromFilings(rows).map((o) => `${o.name} | ${o.title}`), ["Jayme L. Brooks | CFO"]);
  });

  it("insider selling counts the last year only, with the filings' totals", () => {
    const facts = insiderSelling(parseOpenInsider(page), Date.parse("2026-10-23")).map((f) => f.text);
    assert.deepEqual(facts, ["Insider selling: Jayme L. Brooks (CFO) sold about $1.2M in 3 sales (2026-03-17 to 2026-04-30)"]);
  });

  it("a second CEO read off the site must be backed by the text near the name", () => {
    const texts = ["Leadership. Ryan Gellert, CEO of Patagonia, leads the company. Our board: Charles Conn, Board Chair. Ayana Elizabeth Johnson, Board Member and marine biologist."];
    const out = settleSiteTitles([{ name: "Ryan Gellert", title: "CEO" }, { name: "Charles Conn", title: "CEO" }, { name: "Ayana Elizabeth Johnson", title: "CEO" }], texts);
    assert.deepEqual(out.map((l) => `${l.name} | ${l.title}`), ["Ryan Gellert | CEO", "Charles Conn | Board Chair", "Ayana Elizabeth Johnson | Board Member"]);
    // A lone CEO is never touched, backed or not.
    assert.deepEqual(settleSiteTitles([{ name: "Ryan Gellert", title: "CEO" }], ["nothing here"]).map((l) => l.title), ["CEO"]);
  });
});
