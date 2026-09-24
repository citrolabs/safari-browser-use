import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import * as tabIdentity from "../plugins/safari-browser-use/server/src/tab-identity.mjs";
import { createPageStateSettler, shouldSynchronizeActionTab } from "../plugins/safari-browser-use/server/src/control-lifecycle.mjs";

async function createWaits() {
  const template = await readFile(new URL(
    "../plugins/safari-browser-use/server/src/jxa-server.template.js", import.meta.url
  ), "utf8");
  const source = template.slice(
    template.indexOf("  function waitForURL("),
    template.indexOf("  function callSafari(")
  );
  let clock = 0;
  const metadata = { id: "1:2", title: "Shanghai", url: "https://example.com/上海" };
  const state = {
    documentId: "article-document", url: metadata.url,
    readyState: "complete", navigationPending: false
  };
  const identity = tabIdentity.createTabIdentity(metadata);
  const context = {
    ...tabIdentity, createPageStateSettler,
    Date: { now: () => clock },
    foundation: { NSThread: { sleepForTimeInterval(seconds) { clock += seconds * 1000; } } },
    listTabs: () => [{ ...metadata }],
    inspectControlledDocument: () => ({ ...state, tabUrl: metadata.url }),
    runPage: () => ({ ...state }),
    controlLifecycle: { activate() {} },
    ensureControlIndicator: () => ({ ...state })
  };
  vm.runInNewContext(source, context);
  return { context, identity, metadata, state };
}

test("URL wait follows canonicalization during indicator restoration", async () => {
  const { context, identity, metadata, state } = await createWaits();
  context.ensureControlIndicator = () => {
    metadata.url = state.url = "https://example.com/上海市";
    return { ...state };
  };
  const result = context.waitForURL({ tabIdentity: identity, expected: "example.com" });
  assert.equal(result.url, metadata.url);
  assert.equal(identity.url, metadata.url);
});

test("load wait retains the same document after delayed canonicalization", async () => {
  const { context, identity, metadata, state } = await createWaits();
  context.waitForURL({ tabIdentity: identity, expected: "example.com" });
  metadata.url = state.url = "https://example.com/上海市";
  const result = context.waitForLoadState({ tabIdentity: identity });
  assert.equal(result.matched, true);
  assert.equal(identity.url, metadata.url);
});

test("load wait cannot adopt a replacement document at the same coordinate", async () => {
  const { context, identity, metadata, state } = await createWaits();
  context.waitForURL({ tabIdentity: identity, expected: "example.com" });
  metadata.url = state.url = "https://example.com/unrelated";
  state.documentId = "another-document";
  assert.throws(() => context.waitForLoadState({ tabIdentity: identity }), /stale_tab_handle/);
});

for (const sameUrl of [false, true]) {
  test(`a completed ${sameUrl ? "reload" : "navigation"} replaces the verified document identity`, async () => {
    const template = await readFile(new URL(
      "../plugins/safari-browser-use/server/src/jxa-server.template.js", import.meta.url
    ), "utf8");
    const source = template.slice(template.indexOf("  function synchronizeActionTab("), template.indexOf("  function completeNewTabTransition("));
    const identity = tabIdentity.createTabIdentity({ id: "1:2", url: "https://example.com/form" });
    identity.documentId = "before";
    const metadata = { id: identity.id, url: sameUrl ? identity.url : "https://example.com/done" };
    const context = { ...tabIdentity, tabMetadataForId: () => metadata };
    vm.runInNewContext(source, context);
    context.synchronizeActionTab(identity, identity.id, { documentId: "after", changed: true });
    assert.equal(identity.documentId, "after");
    assert.equal(tabIdentity.resolveTabIdentity(identity, [metadata], () => ({
      url: metadata.url, documentId: "after"
    })), metadata);
  });
}

for (const method of ["playwright.nativeClickAt", "playwright.gesture"]) {
  test(`${method} retains the handle when its action navigates`, async () => {
    const template = await readFile(new URL(
      "../plugins/safari-browser-use/server/src/jxa-server.template.js", import.meta.url
    ), "utf8");
    const identity = tabIdentity.createTabIdentity({ id: "1:2", url: "https://example.com/form" });
    identity.documentId = "before";
    let metadata = { id: identity.id, url: identity.url };
    let state = { documentId: "before", url: identity.url };
    const action = () => {
      metadata = { ...metadata, url: "https://example.com/done" };
      state = { documentId: "after", url: metadata.url, changed: true };
      return { clicked: true };
    };
    const context = {
      ...tabIdentity, shouldSynchronizeActionTab,
      ensureSafariAvailable() {},
      listTabs: () => [metadata],
      inspectControlledDocument: () => state,
      tabMetadataForId: () => metadata,
      controlLifecycle: { activate() {} },
      navigationInitialState: () => state,
      runNativeClick: action, runGesture: action,
      restoreAfterPossibleNavigation: () => state
    };
    vm.runInNewContext(
      template.slice(template.indexOf("  function synchronizeActionTab("), template.indexOf("  function completeNewTabTransition(")) +
      template.slice(template.indexOf("  function callSafari("), template.indexOf("  function doctor(")), context
    );
    context.callSafari(method, { tabIdentity: identity });
    assert.equal(identity.documentId, "after");
    assert.equal(tabIdentity.resolveTabIdentity(identity, [metadata], () => state), metadata);
  });
}
