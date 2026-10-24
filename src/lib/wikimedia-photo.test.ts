import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findPersonPhoto } from "./wikimedia-photo.js";

type Page = Record<string, unknown>;

const ELON: Page = {
  title: "Elon Musk", fullurl: "https://en.wikipedia.org/wiki/Elon_Musk",
  description: "Businessman and entrepreneur (born 1971)",
  extract: "Elon Reeve Musk is a businessman known for his leadership of Tesla, SpaceX and X.",
  pageprops: { wikibase_item: "Q317521" }, pageimage: "Elon_Musk.jpg",
  thumbnail: { source: "https://upload.wikimedia.org/thumb/Elon_Musk.jpg/320px.jpg" },
};

function fakeFetch(page: Page | null, p31: string[] = ["Q5"]) {
  const calls: string[] = [];
  const fn = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    let body: unknown;
    if (url.startsWith("https://en.wikipedia.org/")) {
      body = { query: { pages: [page ?? { title: "Nobody", missing: true }] } };
    } else if (url.startsWith("https://www.wikidata.org/")) {
      body = { claims: { P31: p31.map((id) => ({ mainsnak: { datavalue: { value: { id } } } })) } };
    } else {
      body = { query: { pages: [{ imageinfo: [{
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Elon_Musk.jpg",
        extmetadata: {
          Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Gage">Gage Skidmore</a>' },
          LicenseShortName: { value: "CC BY-SA 4.0" },
          LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
        },
      }] }] } };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

describe("findPersonPhoto", () => {
  it("returns the Wikipedia lead image with its Commons credit", async () => {
    const { fn, calls } = fakeFetch(ELON);
    const photo = await findPersonPhoto("elon musk", { fetchFn: fn });
    assert.deepEqual(photo, {
      imageUrl: "https://upload.wikimedia.org/thumb/Elon_Musk.jpg/320px.jpg",
      filePageUrl: "https://commons.wikimedia.org/wiki/File:Elon_Musk.jpg",
      wikipediaUrl: "https://en.wikipedia.org/wiki/Elon_Musk",
      wikipediaTitle: "Elon Musk",
      wikidataId: "Q317521",
      description: "Businessman and entrepreneur (born 1971)",
      artist: "Gage Skidmore",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    });
    assert.ok(calls[0].includes("pilicense=free"), "only freely licensed images");
  });

  it("no photo without an article", async () => {
    assert.equal(await findPersonPhoto("Daniel Olmos", { fetchFn: fakeFetch(null).fn }), null);
  });

  it("no photo for a disambiguation page", async () => {
    const page = { ...ELON, title: "John Smith", pageprops: { wikibase_item: "Q1", disambiguation: "" } };
    assert.equal(await findPersonPhoto("John Smith", { fetchFn: fakeFetch(page).fn }), null);
  });

  it("no photo when the article isn't about a human", async () => {
    assert.equal(await findPersonPhoto("Apple Inc.", { fetchFn: fakeFetch(ELON, ["Q4830453"]).fn }), null);
  });

  it("no photo when the article has no free image", async () => {
    const page = { ...ELON, pageimage: undefined, thumbnail: undefined };
    assert.equal(await findPersonPhoto("Elon Musk", { fetchFn: fakeFetch(page).fn }), null);
  });

  it("an affiliation the article doesn't mention means no photo", async () => {
    assert.equal(await findPersonPhoto("Elon Musk", { affiliation: "csun", fetchFn: fakeFetch(ELON).fn }), null);
    assert.ok(await findPersonPhoto("Elon Musk", { affiliation: "tesla", fetchFn: fakeFetch(ELON).fn }));
  });

  it("never runs an image search", async () => {
    const { fn, calls } = fakeFetch(ELON);
    await findPersonPhoto("Elon Musk", { fetchFn: fn });
    for (const url of calls) {
      assert.match(new URL(url).host, /^(en\.wikipedia|www\.wikidata|commons\.wikimedia)\.org$/);
    }
  });
});
