import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPlaceholderOrg } from "./index.js";
import { isNewsNoise } from "../../lib/news-noise.js";

describe("isPlaceholderOrg", () => {
  it("flags placeholder employers (\"Actor at Various\", the Chris Evans test)", () => {
    for (const c of ["Various", "various companies", "Multiple", "N/A", "Unknown", " none "]) {
      assert.equal(isPlaceholderOrg(c), true, c);
    }
  });

  it("keeps real organizations and missing companies", () => {
    for (const c of ["Marvel Studios", "23XI Racing", "Various Artists Records", undefined, ""]) {
      assert.equal(isPlaceholderOrg(c), false, String(c));
    }
  });
});

describe("person news noise", () => {
  it("drops the social posts and tag pages seen in person reports", () => {
    assert.equal(isNewsNoise("https://www.instagram.com/p/DXcV5ZxCbeM/"), true);
    assert.equal(isNewsNoise("https://x.com/BerkeleyCDSS/status/2057886258253234598"), true);
    assert.equal(isNewsNoise("https://www.facebook.com/EntertainmentTonight/videos/1/"), true);
    assert.equal(isNewsNoise("https://www.justjared.com/tags/chris-evans/"), true);
  });

  it("keeps real coverage", () => {
    assert.equal(isNewsNoise("https://www.npr.org/2026/02/16/g-s1-110249/michael-jordan-daytona-500-nascar-win"), false);
    assert.equal(isNewsNoise("https://ew.com/chris-evans-received-a-dozen-captain-america-pitches-12027048"), false);
  });
});
