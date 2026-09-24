import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL(
  "../plugins/safari-browser-use/server/src/tab-identity.mjs",
  import.meta.url
);

async function loadTabIdentity() {
  const module = await import(moduleUrl).catch(() => null);

  assert.notEqual(
    module,
    null,
    "tab identity resolver must exist"
  );

  return module;
}

test("skips Safari windows that do not expose tabs", async () => {
  const { collectTabs } = await loadTabIdentity();
  const windows = [
    { id: "primary", tabs: [{ title: "Example" }] },
    { id: "auxiliary", tabs: null }
  ];

  assert.deepEqual(
    collectTabs(
      windows,
      window => window.tabs,
      (window, tab, tabIndex) => ({
        id: `${window.id}:${tabIndex}`,
        title: tab.title
      })
    ),
    [{ id: "primary:1", title: "Example" }]
  );
});

test("skips Safari windows whose tab collection fails", async () => {
  const { collectTabs } = await loadTabIdentity();
  const windows = [
    { id: "primary", tabs: [{ title: "Example" }] },
    { id: "oauth-popup" }
  ];

  assert.deepEqual(
    collectTabs(
      windows,
      window => {
        if (!window.tabs) {
          throw new TypeError(
            "null is not an object (evaluating 'tabs.length')"
          );
        }

        return window.tabs;
      },
      (window, tab, tabIndex) => ({
        id: `${window.id}:${tabIndex}`,
        title: tab.title
      })
    ),
    [{ id: "primary:1", title: "Example" }]
  );
});

test("skips a tab that disappears while Safari metadata is being collected", async () => {
  const { collectTabs } = await loadTabIdentity();
  const result = collectTabs([{}], () => ["first", "closed", "last"], (window, tab, index) => {
    if (tab === "closed") throw new Error("Invalid index");
    return { id: `1:${index}`, title: tab };
  });
  assert.deepEqual(result, [{ id: "1:1", title: "first" }, { id: "1:3", title: "last" }]);
});

test("reacquires a tab after its Safari index changes", async () => {
  const {
    createTabIdentity,
    resolveTabIdentity
  } = await loadTabIdentity();
  const identity = createTabIdentity({
    id: "63176:8",
    title: "Home / X",
    url: "https://x.com/home"
  });

  const resolved = resolveTabIdentity(identity, [
    {
      id: "63176:7",
      title: "Home / X",
      url: "https://x.com/home"
    }
  ]);

  assert.equal(resolved.id, "63176:7");
  assert.equal(identity.id, "63176:7");
});

test("never rebinds a stale handle to an unrelated tab", async () => {
  const {
    createTabIdentity,
    resolveTabIdentity
  } = await loadTabIdentity();
  const identity = createTabIdentity({
    id: "63176:8",
    title: "Home / X",
    url: "https://x.com/home"
  });

  assert.throws(
    () => resolveTabIdentity(identity, [{
      id: "63176:8",
      title: "GitHub",
      url: "https://github.com/"
    }]),
    /stale_tab_handle/
  );
});

test("follows a URL change only when the bound document is unchanged", async () => {
  const { createTabIdentity, resolveTabIdentity } = await loadTabIdentity();
  const identity = createTabIdentity({ id: "63176:8", url: "https://example.com/上海" });
  identity.documentId = "same-document";
  const current = { id: identity.id, url: "https://example.com/上海市" };

  assert.equal(resolveTabIdentity(identity, [current], () => ({
    documentId: "same-document", url: current.url
  })), current);
  assert.equal(identity.url, current.url);
});

test("does not adopt a shifted tab with another document", async () => {
  const { createTabIdentity, resolveTabIdentity } = await loadTabIdentity();
  const identity = createTabIdentity({ id: "63176:8", url: "https://example.com/上海" });
  identity.documentId = "original-document";
  assert.throws(() => resolveTabIdentity(identity, [{
    id: identity.id, url: "https://example.com/上海市"
  }], () => ({ documentId: "different-document", url: "https://example.com/上海市" })), /stale_tab_handle/);
});

test("keeps the verified document when a sibling still has its previous URL", async () => {
  const { createTabIdentity, resolveTabIdentity } = await loadTabIdentity();
  const identity = createTabIdentity({ id: "63176:8", url: "https://example.com/search" });
  identity.documentId = "search-document";
  const current = { id: identity.id, url: "https://example.com/search?q=Shanghai" };
  const sibling = { id: "63176:9", url: identity.url };
  const result = resolveTabIdentity(identity, [current, sibling], id => ({
    documentId: id === current.id ? "search-document" : "sibling-document", url: current.url
  }));
  assert.equal(result.id, current.id);
  assert.equal(identity.url, current.url);
});

test("a URL wait uses document identity before a sibling's matching old URL", async () => {
  const { createTabIdentity, resolveTabForUrlWait } = await loadTabIdentity();
  const identity = createTabIdentity({ id: "63176:8", url: "https://example.com/search" });
  identity.documentId = "search-document";
  const current = { id: identity.id, url: "https://example.com/search?q=Shanghai" };
  const sibling = { id: "63176:9", url: identity.url };
  assert.equal(resolveTabForUrlWait(identity, [current, sibling], current.url, true, id => ({
    documentId: id === current.id ? "search-document" : "sibling-document", url: current.url
  })), current);
});

test("does not recover a stale handle by origin alone", async () => {
  const {
    createTabIdentity,
    resolveTabIdentity
  } = await loadTabIdentity();
  const identity = createTabIdentity({
    id: "63176:8",
    title: "Home / X",
    url: "https://x.com/home"
  });

  assert.throws(
    () => resolveTabIdentity(identity, [
      {
        id: "63176:7",
        title: "Following / X",
        url: "https://x.com/example/following"
      }
    ]),
    /stale_tab_handle/
  );
});

test("finds the verified document after an external close shifts identical tabs", async () => {
  const { createTabIdentity, resolveTabIdentity } = await loadTabIdentity();
  const url = "https://example.com/form";
  const identity = createTabIdentity({ id: "1:2", url });
  identity.documentId = "original";
  const tabs = [{ id: "1:1", url }, { id: "1:2", url }];
  const inspect = id => ({ url, documentId: id === "1:1" ? "original" : "sibling" });
  assert.equal(resolveTabIdentity(identity, tabs, inspect).id, "1:1");
});

test("does not adopt an identical sibling when the original closes externally", async () => {
  const { createTabIdentity, resolveTabIdentity } = await loadTabIdentity();
  const url = "https://example.com/form";
  const identity = createTabIdentity({ id: "1:2", url });
  identity.documentId = "original";
  assert.throws(() => resolveTabIdentity(identity, [{ id: "1:2", url }], () => ({
    url, documentId: "sibling"
  })), /stale_tab_handle/);
});

test("a failed document read cannot fall back to a matching URL", async () => {
  const { createTabIdentity, resolveTabIdentity } = await loadTabIdentity();
  const url = "https://example.com/form";
  const identity = createTabIdentity({ id: "1:2", url });
  identity.documentId = "original";
  assert.throws(() => resolveTabIdentity(identity, [{ id: "1:2", url }], () => {
    throw new Error("page unavailable");
  }), /stale_tab_handle/);
});

test("URL wait rejects an unrelated destination after the original closes", async () => {
  const { createTabIdentity, resolveTabForUrlWait } = await loadTabIdentity();
  const identity = createTabIdentity({ id: "1:2", url: "https://example.com/form" });
  identity.documentId = "original";
  const url = "https://example.com/done";
  assert.throws(() => resolveTabForUrlWait(identity, [{ id: "1:2", url }], url, true,
    () => ({ url, documentId: "sibling" })), /stale_tab_handle/);
});

test("rejects ambiguous exact URL recovery", async () => {
  const {
    createTabIdentity,
    resolveTabIdentity
  } = await loadTabIdentity();
  const identity = createTabIdentity({
    id: "63176:8",
    title: "Home / X",
    url: "https://x.com/home"
  });

  assert.throws(
    () => resolveTabIdentity(identity, [
      {
        id: "63176:6",
        title: "Home / X",
        url: "https://x.com/home"
      },
      {
        id: "63176:7",
        title: "Home / X",
        url: "https://x.com/home"
      }
    ]),
    /stale_tab_handle.*ambiguous/
  );
});

test("waits on the bound tab when duplicate URLs are open", async () => {
  const {
    createTabIdentity,
    resolveTabForUrlWait
  } = await loadTabIdentity();
  const identity = createTabIdentity({
    id: "63176:8",
    title: "Product",
    url: "https://shop.example.com/item"
  });
  const duplicateTabs = [
    {
      id: "63176:7",
      title: "Product",
      url: "https://shop.example.com/item"
    },
    {
      id: "63176:8",
      title: "Product",
      url: "https://shop.example.com/item"
    }
  ];

  assert.equal(typeof resolveTabForUrlWait, "function");
  assert.deepEqual(
    resolveTabForUrlWait(
      identity,
      duplicateTabs,
      "shop.example.com",
      false
    ),
    duplicateTabs[1]
  );
});

test("ignores other matching URLs while the bound tab remains open", async () => {
  const {
    createTabIdentity,
    resolveTabForUrlWait
  } = await loadTabIdentity();
  const identity = createTabIdentity({
    id: "63176:8",
    title: "1688 Home",
    url: "https://www.1688.com/"
  });

  assert.equal(
    resolveTabForUrlWait(identity, [
      {
        id: "63176:7",
        title: "Search Results",
        url: "https://s.1688.com/selloffer/offer_search.htm"
      },
      {
        id: "63176:8",
        title: "1688 Home",
        url: "https://www.1688.com/"
      },
      {
        id: "63176:9",
        title: "Search Results",
        url: "https://s.1688.com/selloffer/offer_search.htm"
      }
    ], "s.1688.com", false),
    null
  );
});

test("retargets an identity before an explicit navigation", async () => {
  const {
    createTabIdentity,
    retargetTabIdentity
  } = await loadTabIdentity();
  const identity = createTabIdentity({
    id: "63176:8",
    title: "Home / X",
    url: "https://x.com/home"
  });

  assert.equal(typeof retargetTabIdentity, "function");

  retargetTabIdentity(identity, "https://example.com/dashboard");

  assert.equal(identity.url, "https://example.com/dashboard");
});

test("synchronizes an identity with Safari after navigation", async () => {
  const {
    completeTabNavigation,
    createTabIdentity
  } = await loadTabIdentity();
  const identity = createTabIdentity({
    id: "63176:8",
    title: "Untitled",
    url: "about:blank"
  });

  assert.equal(typeof completeTabNavigation, "function");

  completeTabNavigation(identity, {
    id: "63176:8",
    title: "Apple",
    url: "https://www.apple.com/"
  });

  assert.deepEqual(identity, {
    id: "63176:8",
    title: "Apple",
    url: "https://www.apple.com/",
    windowId: "63176"
  });
});

test("synchronizes navigation after the tab index changes", async () => {
  const {
    completeTabNavigation,
    createTabIdentity,
    retargetTabIdentity
  } = await loadTabIdentity();
  const identity = createTabIdentity({
    id: "63176:8",
    title: "Untitled",
    url: "about:blank"
  });

  retargetTabIdentity(identity, "https://example.com/dashboard");
  completeTabNavigation(identity, {
    id: "63176:7",
    title: "Dashboard",
    url: "https://example.com/dashboard"
  });

  assert.deepEqual(identity, {
    id: "63176:7",
    title: "Dashboard",
    url: "https://example.com/dashboard",
    windowId: "63176"
  });
});

test("rejects an index change to an unexpected navigation target", async () => {
  const {
    completeTabNavigation,
    createTabIdentity,
    retargetTabIdentity
  } = await loadTabIdentity();
  const identity = createTabIdentity({
    id: "63176:8",
    title: "Untitled",
    url: "about:blank"
  });

  retargetTabIdentity(identity, "https://example.com/dashboard");

  assert.throws(
    () => completeTabNavigation(identity, {
      id: "63176:7",
      title: "Unrelated",
      url: "https://example.com/unrelated"
    }),
    /stale_tab_handle/
  );
});

test("finds a newly opened tab even when later tab indexes shift", async () => {
  const { findOpenedTabs } = await loadTabIdentity();
  const before = [
    {
      id: "63176:7",
      title: "Home",
      url: "https://example.com/"
    },
    {
      id: "63176:8",
      title: "Search",
      url: "https://shop.example.com/"
    }
  ];
  const after = [
    {
      id: "63176:7",
      title: "Home",
      url: "https://example.com/"
    },
    {
      id: "63176:8",
      title: "Verification",
      url: "https://verify.example.com/challenge"
    },
    {
      id: "63176:9",
      title: "Search",
      url: "https://shop.example.com/"
    }
  ];

  assert.deepEqual(findOpenedTabs(before, after), [after[1]]);
});

test("does not mistake a same-tab navigation for an opened tab", async () => {
  const { findOpenedTabs } = await loadTabIdentity();
  const before = [{
    id: "63176:8",
    title: "Search",
    url: "https://example.com/search"
  }];
  const after = [{
    id: "63176:8",
    title: "Results",
    url: "https://example.com/results"
  }];

  assert.deepEqual(findOpenedTabs(before, after), []);
});

test("rechecks once for a delayed JavaScript popup", async () => {
  const { findOpenedTabsAfterDelay } = await loadTabIdentity();
  const before = [{
    id: "63176:8",
    title: "Search",
    url: "https://example.com/search"
  }];
  const after = [
    before[0],
    {
      id: "63176:9",
      title: "Results",
      url: "https://example.com/results"
    }
  ];
  const delays = [];

  assert.equal(typeof findOpenedTabsAfterDelay, "function");
  assert.deepEqual(
    findOpenedTabsAfterDelay(before, {
      delayMs: 800,
      listTabs: () => after,
      sleep: milliseconds => delays.push(milliseconds)
    }),
    {
      openedTabs: [after[1]],
      tabs: after
    }
  );
  assert.deepEqual(delays, [800]);
});
