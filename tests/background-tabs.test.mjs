import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const templateUrl = new URL(
  "../plugins/safari-browser-use/server/src/jxa-server.template.js",
  import.meta.url
);
const documentationUrl = new URL(
  "../plugins/safari-browser-use/server/src/documentation.md",
  import.meta.url
);

async function loadOpenTab() {
  const template = await readFile(templateUrl, "utf8");
  const source = template.match(
    /  function tabMetadata[\s\S]*?\n  function readBackgroundPageSource/
  )?.[0];

  assert.ok(source, "expected to find Safari tab helpers");

  const context = {
    collectTabs() {},
    result: null,
    safari: null
  };

  vm.runInNewContext(
    source.replace(/\n  function readBackgroundPageSource$/, ""),
    context
  );

  return context;
}

function createWindow(id) {
  let activeTab = createTab("about:start", 1);
  let activationCount = 0;
  const tabs = [activeTab];
  const tabsAccessor = () => tabs;
  tabsAccessor.push = tab => tabs.push(tab);
  const window = {
    id: () => id,
    tabs: tabsAccessor
  };

  Object.defineProperty(window, "currentTab", {
    get() {
      return () => activeTab;
    },
    set(tab) {
      activeTab = tab;
      activationCount += 1;
    }
  });

  return {
    window,
    tabs,
    get activationCount() {
      return activationCount;
    }
  };
}

function createTab(url, index) {
  let closeCount = 0;

  return {
    close: () => {
      closeCount += 1;
    },
    closeCount: () => closeCount,
    index: () => index,
    name: () => "",
    url: () => url
  };
}

test("opens an inactive tab in the current Safari window by default", async () => {
  const context = await loadOpenTab();
  const user = createWindow(101);

  context.safari = {
    Document: () => ({ make() {} }),
    Tab: ({ url }) => createTab(url, 2),
    windows: () => [user.window]
  };

  const result = context.openTab({});

  assert.equal(user.tabs.length, 2);
  assert.equal(user.activationCount, 0);
  assert.equal(result.id, "101:2");
});

test("opens an inactive tab only in the requested Safari window", async () => {
  const context = await loadOpenTab();
  const user = createWindow(101);
  const worker = createWindow(202);

  context.safari = {
    Document: () => ({ make() {} }),
    Tab: ({ url }) => createTab(url, 2),
    windows: () => [user.window, worker.window]
  };

  const result = context.openTab({ windowId: 202, active: false });

  assert.equal(user.tabs.length, 1);
  assert.equal(worker.tabs.length, 2);
  assert.equal(worker.activationCount, 0);
  assert.equal(result.id, "202:2");
});

test("does not fall back when the requested Safari window is missing", async () => {
  const context = await loadOpenTab();
  const user = createWindow(101);

  context.safari = {
    Document: () => ({ make() {} }),
    Tab: ({ url }) => createTab(url, 2),
    windows: () => [user.window]
  };

  assert.throws(
    () => context.openTab({ windowId: 999, active: false }),
    /Safari window not found: 999/
  );
  assert.equal(user.tabs.length, 1);
  assert.equal(user.activationCount, 0);
});

test("opens an inactive tab without requiring a Safari window ID", async () => {
  const context = await loadOpenTab();
  const user = createWindow(101);

  context.safari = {
    Document: () => ({ make() {} }),
    Tab: ({ url }) => createTab(url, 2),
    windows: () => [user.window]
  };

  const result = context.openTab({ active: false });

  assert.equal(result.id, "101:2");
  assert.equal(user.tabs.length, 2);
  assert.equal(user.activationCount, 0);
});

test("closes a background task tab without changing the selected tab", async () => {
  const context = await loadOpenTab();
  const user = createWindow(101);
  const taskTab = createTab("https://example.com/task", 2);
  user.tabs.push(taskTab);

  context.safari = {
    windows: () => [user.window]
  };

  context.closeTab("101:2");

  assert.equal(taskTab.closeCount(), 1);
  assert.equal(user.activationCount, 0);
});

test("refuses to close the selected Safari tab", async () => {
  const context = await loadOpenTab();
  const user = createWindow(101);
  const selectedTab = user.tabs[0];

  context.safari = {
    windows: () => [user.window]
  };

  assert.throws(
    () => context.closeTab("101:1"),
    /Refusing to close the selected Safari tab/
  );
  assert.equal(selectedTab.closeCount(), 0);
  assert.equal(user.activationCount, 0);
});

test("browser.tabs.new defaults to a background tab", async () => {
  const template = await readFile(templateUrl, "utf8");
  const body = template.match(
    /      new: function[^\{]*\{([\s\S]*?)\n      \}\n    \}\)/
  )?.[1];

  assert.ok(body, "expected to find browser.tabs.new");

  const calls = [];
  const context = {
    callSafari(method, params) {
      calls.push({ method, params });
      return { id: "202:2", title: "", url: "about:blank" };
    },
    options: {},
    result: null,
    wrapTab: value => value
  };

  vm.runInNewContext(
    `result = (function (options) {${body}\n})(options);`,
    context
  );

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      method: "tabs.open",
      params: { active: false }
    }
  ]);
});

test("documents non-disruptive task-tab creation and cleanup", async () => {
  const documentation = await readFile(documentationUrl, "utf8");

  assert.match(
    documentation,
    /browser\.tabs\.new\(\{\s*active:\s*false\s*\}\)/
  );
  assert.match(documentation, /selected tab remains unchanged/i);
  assert.match(documentation, /close.*by default/is);
  assert.match(documentation, /keep.*user.*(?:view|inspect)/is);
  assert.match(documentation, /does not expose inactive Tab Groups/i);
});

async function loadCloseHandler(closeTab) {
  const { createTabIdentity, resolveTabIdentity, resolveTabForUrlWait } = await import(
    "../plugins/safari-browser-use/server/src/tab-identity.mjs"
  );
  const template = await readFile(templateUrl, "utf8");
  const start = template.indexOf("  function callSafari(method, params) {");
  const end = template.indexOf('\n    if (method.indexOf("webmcp.") === 0)', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    ensureSafariAvailable() {},
    createTabIdentity,
    tabIdentities: [],
    SafariPlaywright: function () {},
    SafariWebmcp: function () {},
    controlLifecycle: { release() {} },
    listTabs: () => [{ id: "1:2", title: "Same", url: "https://example.com/same" }],
    resolveTabIdentity,
    inspectControlledDocument() { throw new Error("unexpected document inspection"); },
    closeTab
  };
  vm.runInNewContext(template.slice(start, end) + "\n  }", context);
  const constructorStart = template.indexOf("  function SafariTab(metadata) {");
  const constructorEnd = template.indexOf("\n  SafariTab.prototype.title", constructorStart);
  assert.ok(constructorStart >= 0 && constructorEnd > constructorStart);
  vm.runInNewContext(template.slice(constructorStart, constructorEnd), context);
  return {
    context,
    identity: createTabIdentity(context.listTabs()[0]),
    resolveTabIdentity,
    resolveTabForUrlWait
  };
}

test("closing a tab invalidates its shared identity before an identical tab takes its place", async () => {
  const { context, identity, resolveTabIdentity, resolveTabForUrlWait } = await loadCloseHandler(() => {});
  context.callSafari("tabs.close", { tabIdentity: identity });
  const replacement = context.listTabs();
  assert.throws(() => resolveTabIdentity(identity, replacement), /stale_tab_handle/);
  assert.throws(() => resolveTabForUrlWait(identity, replacement, identity.url, true), /stale_tab_handle/);
});

test("a refused close leaves the original identity usable", async () => {
  const { context, identity, resolveTabIdentity } = await loadCloseHandler(() => {
    throw new Error("Refusing to close the selected Safari tab");
  });
  assert.throws(() => context.callSafari("tabs.close", { tabIdentity: identity }), /Refusing/);
  assert.equal(resolveTabIdentity(identity, context.listTabs()).id, "1:2");
});

test("closing another wrapper invalidates all handles for that tab", async () => {
  const { context, resolveTabIdentity, resolveTabForUrlWait } = await loadCloseHandler(() => {});
  const metadata = context.listTabs()[0];
  const first = new context.SafariTab(metadata);
  const alias = new context.SafariTab(metadata);
  const sibling = new context.SafariTab({ ...metadata, id: "1:3" });

  context.callSafari("tabs.close", { tabIdentity: alias._identity });
  assert.throws(() => resolveTabIdentity(first._identity, context.listTabs()), /stale_tab_handle/);
  assert.throws(() => resolveTabForUrlWait(first._identity, context.listTabs(), metadata.url, true), /stale_tab_handle/);
  assert.equal(resolveTabIdentity(sibling._identity, context.listTabs()).id, "1:2");
});

test("a refused close preserves every wrapper for the selected tab", async () => {
  const { context, resolveTabIdentity } = await loadCloseHandler(() => {
    throw new Error("Refusing to close the selected Safari tab");
  });
  const first = new context.SafariTab(context.listTabs()[0]);
  const alias = new context.SafariTab(context.listTabs()[0]);

  assert.throws(() => context.callSafari("tabs.close", { tabIdentity: alias._identity }), /Refusing/);
  assert.equal(resolveTabIdentity(first._identity, context.listTabs()).id, "1:2");
  assert.equal(resolveTabIdentity(alias._identity, context.listTabs()).id, "1:2");
});

test("explicitly reacquiring a reused coordinate creates a new document identity", async () => {
  const { context } = await loadCloseHandler(() => {});
  const metadata = context.listTabs()[0];
  const old = new context.SafariTab(metadata);
  old._identity.documentId = "closed-document";
  context.inspectControlledDocument = () => ({ url: metadata.url, documentId: "replacement-document" });
  const fresh = new context.SafariTab(metadata);
  assert.notEqual(fresh._identity, old._identity);
  assert.equal(fresh._identity.documentId, "replacement-document");
  assert.equal(old._identity.documentId, "closed-document");
});

test("closing an earlier tab keeps both identical siblings at their new indexes", async () => {
  const { context, resolveTabIdentity } = await loadCloseHandler(() => {});
  let tabs = [
    { id: "1:2", title: "Spacer", url: "https://example.com/spacer" },
    { id: "1:3", title: "Same", url: "https://example.com/same" },
    { id: "1:4", title: "Same", url: "https://example.com/same" }
  ];
  context.listTabs = () => tabs;
  const spacer = new context.SafariTab(tabs[0]);
  const first = new context.SafariTab(tabs[1]);
  const second = new context.SafariTab(tabs[2]);
  const otherWindow = new context.SafariTab({ ...tabs[2], id: "2:4" });
  let released = false;
  context.controlLifecycle.release = () => { released = true; };
  context.closeTab = () => {
    assert.equal(released, true, "release the indicator before its coordinate changes");
    tabs = tabs.slice(1).map((tab, index) => ({ ...tab, id: `1:${index + 2}` }));
  };

  context.callSafari("tabs.close", { tabIdentity: spacer._identity });

  assert.equal(resolveTabIdentity(first._identity, tabs).id, "1:2");
  assert.equal(resolveTabIdentity(second._identity, tabs).id, "1:3");
  assert.equal(otherWindow.id, "2:4");
});
