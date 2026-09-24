import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const templateUrl = new URL(
  "../plugins/safari-browser-use/server/src/jxa-server.template.js",
  import.meta.url
);

async function loadNavigationRestorer() {
  const template = await readFile(templateUrl, "utf8");
  const source = template.match(
    /  function restoreControlForNavigation[\s\S]*?\n  function navigationInitialState/
  )?.[0];

  assert.ok(source, "expected to find navigation restoration helper");

  const events = [];
  const context = {
    ensureControlIndicator() {},
    ensureWebmcpRecorder(tabId) {
      events.push(`ensure:${tabId}`);
    },
    foundation: {
      NSThread: {
        sleepForTimeInterval() {}
      }
    },
    inspectControlledDocument(tabId) {
      events.push(`inspect:${tabId}`);
      return {
        controlVisible: false,
        documentId: "document-2",
        readyState: "loading",
        tabUrl: "https://example.com/products",
        url: "https://example.com/products"
      };
    },
    maybeAutoRecord(identity, tabId) {
      events.push(`auto:${identity.id}:${tabId}`);
    },
    restoreControlAfterNavigation(options) {
      return options.inspect();
    }
  };

  vm.runInNewContext(
    source.replace(/\n  function navigationInitialState$/, ""),
    context
  );

  return { context, events, template };
}

test("navigation inspection does not install a recorder", async () => {
  const { context, events } = await loadNavigationRestorer();
  const identity = { id: "1:2" };

  context.restoreControlForNavigation(
    "1:2",
    {
      documentId: "document-1",
      tabUrl: "about:blank"
    },
    { tabIdentity: identity }
  );

  assert.deepEqual(events, ["inspect:1:2"]);
});

test("page navigation contains no recording hooks", async () => {
  const { template } = await loadNavigationRestorer();
  const start = template.indexOf('    if (method === "page.navigate") {');
  const end = template.indexOf(
    '    if (method === "playwright.nativeClickAt")',
    start
  );
  const navigation = template.slice(start, end);

  assert.ok(start >= 0 && end > start, "expected to find page.navigate handler");
  assert.doesNotMatch(navigation, /drainWebmcp|maybeAutoRecord|ensureWebmcpRecorder/);
});

test("runtime contains no learning, memory, replay, or dynamic tool machinery", async () => {
  const { template } = await loadNavigationRestorer();
  for (const symbol of [
    "createWebmcpStore", "webmcpAuto", "webmcpMemory", "probeWebmcp",
    "startWebmcpRecording", "annotateSnapshot", "dynamicToolDefinitions",
    "shapeWebmcpResult", "refreshWebmcpExposure"
  ]) {
    assert.equal(template.includes(symbol), false, `${symbol} must be removed`);
  }
});
