import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { evaluateSafariVersion } from "../plugins/safari-browser-use/server/src/safari-version.mjs";

const template = await readFile(new URL(
  "../plugins/safari-browser-use/server/src/jxa-server.template.js", import.meta.url
), "utf8");
const source = template.slice(template.indexOf("  function doctor()"), template.indexOf("  function locatorStep("));

function createDoctor() {
  const calls = [];
  const safari = {
    running: () => true,
    windows: () => [{ currentTab: () => "test-tab" }],
    doJavaScript(code) { calls.push(code); return 2; }
  };
  const context = {
    safari, evaluateSafariVersion, safariVersion: () => "27.0",
    serverVersion: "test-build",
    ObjC: { unwrap: value => value },
    foundation: { NSProcessInfo: { processInfo: {
      operatingSystemVersionString: "Version 27.0 (Build 26A428)"
    } } }
  };
  vm.runInNewContext(source, context);
  return { safari, calls, context, doctor: () => JSON.parse(JSON.stringify(context.doctor())) };
}

test("doctor reports a usable macOS 27 runtime without reading page content", () => {
  const { doctor, calls } = createDoctor();
  const result = doctor();
  assert.equal(result.ready, true);
  assert.equal(result.macosVersion, "Version 27.0 (Build 26A428)");
  assert.equal(result.runtimeVersion, "test-build");
  assert.equal(result.safariSupported, true);
  assert.equal(result.safariVersionStatus, "known");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(calls, ["1 + 1"]);
});

test("doctor distinguishes an unverified version from unavailable automation", () => {
  const { context, doctor } = createDoctor();
  context.safariVersion = () => "28.0";
  const result = doctor();
  assert.equal(result.ready, true);
  assert.equal(result.safariVersionStatus, "unverified");
  assert.deepEqual(result.issues, []);
});

for (const scenario of ["not running", "no window", "automation denied", "JavaScript failed"]) {
  test(`doctor reports ${scenario} without claiming the runtime is ready`, () => {
    const { safari, doctor } = createDoctor();
    if (scenario === "not running") safari.running = () => false;
    if (scenario === "no window") safari.windows = () => [];
    if (scenario === "automation denied") safari.windows = () => { throw new Error("Not authorized to send Apple events"); };
    if (scenario === "JavaScript failed") safari.doJavaScript = () => { throw new Error("JavaScript from Apple Events is disabled"); };
    const result = doctor();
    assert.equal(result.ready, false);
    assert.equal(result.javascriptFromAppleEvents, false);
    assert.equal(result.issues.length, 1);
    assert.doesNotMatch(result.issues.join(" "), /safaridriver|native MCP/);
  });
}
