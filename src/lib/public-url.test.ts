import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, unsafeUrlReason } from "./public-url.js";

test("private, loopback, link-local and metadata addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test("public addresses are allowed", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "192.0.78.24"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("unsafeUrlReason refuses internal hosts and non-web schemes without a lookup", async () => {
  assert.equal(await unsafeUrlReason("http://169.254.169.254/latest/meta-data/"), "the address is on a private network");
  assert.equal(await unsafeUrlReason("http://[::1]:4000/"), "the address is on a private network");
  assert.equal(await unsafeUrlReason("http://localhost:4000/"), "the address is on a private network");
  assert.equal(await unsafeUrlReason("http://agent.railway.internal/"), "the address is on a private network");
  assert.equal(await unsafeUrlReason("file:///etc/passwd"), "the address isn't a web page");
  assert.equal(await unsafeUrlReason("http://user:pw@8.8.8.8/"), "the address isn't a web page");
  assert.equal(await unsafeUrlReason("https://8.8.8.8/"), null);
});
