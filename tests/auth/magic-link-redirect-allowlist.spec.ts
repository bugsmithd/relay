// Pure-logic unit test for safeRedirectTarget(). No browser, no DB.
// Run via: node --import tsx --test tests/auth/magic-link-redirect-allowlist.spec.ts
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { safeRedirectTarget } from "../../lib/auth/redirect-allowlist.ts";

test("rejects external absolute URL", () => {
  assert.equal(safeRedirectTarget("https://evil.com/x"), "/");
});

test("rejects protocol-relative URL", () => {
  assert.equal(safeRedirectTarget("//evil.com/x"), "/");
});

test("rejects javascript: scheme", () => {
  assert.equal(safeRedirectTarget("javascript:alert(1)"), "/");
});

test("rejects internal path not in allowlist", () => {
  assert.equal(safeRedirectTarget("/admin"), "/");
  assert.equal(safeRedirectTarget("/w/foo/bar"), "/");
  assert.equal(safeRedirectTarget("/w/UPPER"), "/");
});

test("allows root", () => {
  assert.equal(safeRedirectTarget("/"), "/");
});

test("allows /w/<slug> and /w/<slug>/", () => {
  assert.equal(safeRedirectTarget("/w/team-alpha"), "/w/team-alpha");
  assert.equal(safeRedirectTarget("/w/team-alpha/"), "/w/team-alpha/");
});

test("falls back to / for null/undefined/empty", () => {
  assert.equal(safeRedirectTarget(null), "/");
  assert.equal(safeRedirectTarget(undefined), "/");
  assert.equal(safeRedirectTarget(""), "/");
});
