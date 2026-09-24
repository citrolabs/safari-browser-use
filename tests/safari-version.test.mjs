import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSafariVersion,
  parseSafariMajor
} from "../plugins/safari-browser-use/server/src/safari-version.mjs";

test("parses the major version from a Safari version string", () => {
  assert.equal(parseSafariMajor("26.5"), 26);
});

test("accepts Safari 26", () => {
  assert.deepEqual(evaluateSafariVersion("26.5"), {
    supported: true,
    major: 26,
    known: true,
    reason: null
  });
});

test("accepts Safari versions older than 26", () => {
  assert.deepEqual(evaluateSafariVersion("25.6"), {
    supported: true,
    major: 25,
    known: true,
    reason: null
  });
});

test("supports Safari 27 through the existing JavaScript runtime", () => {
  assert.deepEqual(evaluateSafariVersion("27.0"), {
    supported: true,
    major: 27,
    known: true,
    reason: null
  });
});

test("future Safari versions remain available with unverified compatibility", () => {
  assert.deepEqual(evaluateSafariVersion("28.0"), {
    supported: true,
    major: 28,
    known: false,
    reason: null
  });
});

test("rejects malformed Safari versions", () => {
  assert.throws(
    () => parseSafariMajor("Safari"),
    /Invalid Safari version/
  );
});
