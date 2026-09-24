function tabWindowId(tabId) {
  const match = /^(\d+):\d+$/.exec(String(tabId));

  return match ? match[1] : "";
}

export function collectTabs(
  windows,
  readTabs,
  describeTab
) {
  const result = [];

  for (
    let windowIndex = 0;
    windowIndex < windows.length;
    windowIndex++
  ) {
    const window = windows[windowIndex];
    let tabs;

    try {
      tabs = readTabs(window);
    } catch (error) {
      continue;
    }

    if (!tabs) {
      continue;
    }

    for (let tabIndex = 0; tabIndex < tabs.length; tabIndex++) {
      try {
        result.push(
          describeTab(window, tabs[tabIndex], tabIndex + 1)
        );
      } catch (error) {
        // Safari's indexed tab reference can disappear during enumeration.
      }
    }
  }

  return result;
}

function tabFingerprint(tab) {
  return `${String(tab.title || "")}\u0000${String(tab.url || "")}`;
}

export function findOpenedTabs(before, after) {
  const openedCount = after.length - before.length;

  if (openedCount <= 0) {
    return [];
  }

  const previousFingerprints = new Set(
    before.map(tabFingerprint)
  );
  const candidates = after.filter(tab =>
    !previousFingerprints.has(tabFingerprint(tab))
  );

  return candidates.length === openedCount ? candidates : [];
}

export function findOpenedTabsAfterDelay(
  before,
  { delayMs = 800, listTabs, sleep }
) {
  sleep(delayMs);
  const tabs = listTabs();

  return {
    openedTabs: findOpenedTabs(before, tabs),
    tabs
  };
}

export function createTabIdentity(metadata) {
  return {
    id: String(metadata.id),
    windowId: tabWindowId(metadata.id),
    title: String(metadata.title || ""),
    url: String(metadata.url || "")
  };
}

export function retargetTabIdentity(identity, url) {
  identity.url = String(url);
  delete identity.documentId;
}

function updateTabIdentity(identity, metadata) {
  identity.id = String(metadata.id);
  identity.windowId = tabWindowId(metadata.id);
  identity.title = String(metadata.title || "");
  identity.url = String(metadata.url || "");

  return metadata;
}

export function completeTabNavigation(identity, metadata, documentId) {
  const targetChanged = String(metadata.id) !== identity.id;
  const expectedTarget =
    String(metadata.url || "") === identity.url;

  if (
    tabWindowId(metadata.id) !== identity.windowId ||
    targetChanged && !expectedTarget
  ) {
    throw new Error(
      "stale_tab_handle: navigation target changed " + identity.id
    );
  }

  if (documentId) identity.documentId = documentId;
  else delete identity.documentId;
  return updateTabIdentity(identity, metadata);
}

export function resolveTabIdentity(identity, tabs, inspectDocument) {
  if (identity.closed) {
    throw new Error("stale_tab_handle: tab closed " + identity.id);
  }

  const candidates = tabs.filter(tab =>
    tabWindowId(tab.id) === identity.windowId
  );
  const current = candidates.find(tab => tab.id === identity.id);

  // Coordinates and URLs can both be reused after an external tab closure.
  // Once verified, a document must never be replaced by a URL-only match.
  if (identity.documentId && inspectDocument) {
    const possible = [current, ...candidates.filter(tab =>
      tab !== current && String(tab.url || "") === identity.url
    )].filter(Boolean);

    for (const candidate of possible) {
      try {
        const state = inspectDocument(candidate.id);

        if (
          state.documentId === identity.documentId &&
          state.url === String(candidate.url || "")
        ) {
          return updateTabIdentity(identity, candidate);
        }
      } catch (error) {
        // An unreadable document cannot prove tab identity.
      }
    }

    throw new Error("stale_tab_handle: verified document not found " + identity.id);
  }

  if (current && String(current.url || "") === identity.url) {
    return updateTabIdentity(identity, current);
  }

  const exact = candidates.filter(tab =>
    String(tab.url || "") === identity.url
  );

  if (exact.length === 1) {
    return updateTabIdentity(identity, exact[0]);
  }

  if (exact.length > 1) {
    throw new Error(
      "stale_tab_handle: ambiguous candidates for " + identity.id
    );
  }

  throw new Error("stale_tab_handle: tab not found " + identity.id);
}

export function resolveTabForUrlWait(
  identity,
  tabs,
  expected,
  exact,
  inspectDocument
) {
  if (identity.closed) {
    throw new Error("stale_tab_handle: tab closed " + identity.id);
  }

  const matches = tab => {
    const url = String(tab.url || "");

    return exact ? url === expected : url.includes(expected);
  };
  let bound = null;

  try {
    bound = resolveTabIdentity(identity, tabs, inspectDocument);
  } catch (error) {
    if (identity.documentId) throw error;
    // The bound tab may be navigating to the expected URL.
  }

  if (bound) {
    return matches(bound) ? bound : null;
  }

  const candidates = tabs.filter(tab =>
    tabWindowId(tab.id) === identity.windowId && matches(tab)
  );

  if (candidates.length === 1) {
    return updateTabIdentity(identity, candidates[0]);
  }

  if (candidates.length > 1) {
    throw new Error(
      "stale_tab_handle: ambiguous URL candidates"
    );
  }

  return null;
}
