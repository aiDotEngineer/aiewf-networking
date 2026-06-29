import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMagicLinkUrl,
  hashLoginToken,
  normalizeLoginEmail,
  safeRedirectPath,
} from "../../convex/authHelpers.ts";

test("normalizes login email without accepting malformed addresses", () => {
  assert.equal(normalizeLoginEmail("  Priya@Example.COM "), "priya@example.com");
  assert.equal(normalizeLoginEmail("not-an-email"), "");
  assert.equal(normalizeLoginEmail("a@"), "");
});

test("builds magic links only to safe in-app paths", () => {
  assert.equal(safeRedirectPath("/?surface=directory"), "/?surface=directory");
  assert.equal(safeRedirectPath("https://evil.example/phish"), "/");
  assert.equal(safeRedirectPath("//evil.example/phish"), "/");
  assert.equal(safeRedirectPath("admin"), "/");

  const url = buildMagicLinkUrl({
    baseUrl: "https://networking.example/",
    token: "abc123",
    redirectPath: "/?surface=directory",
  });

  assert.equal(url, "https://networking.example/?surface=directory&authToken=abc123");
});

test("hashes magic login tokens with a salt", async () => {
  const first = await hashLoginToken("token-value", "salt-a");
  const second = await hashLoginToken("token-value", "salt-a");
  const otherSalt = await hashLoginToken("token-value", "salt-b");

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, otherSalt);
});
