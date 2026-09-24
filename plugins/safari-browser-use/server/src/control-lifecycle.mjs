export function createControlLifecycle({ show, refresh, hide }) {
  let activeTabId = null;

  return {
    activate(tabId) {
      const nextTabId = String(tabId);

      if (activeTabId === nextTabId) {
        refresh(nextTabId);
        return;
      }

      if (activeTabId !== null && activeTabId !== nextTabId) {
        hide(activeTabId);
      }

      activeTabId = nextTabId;
      show(nextTabId);
    },

    release() {
      if (activeTabId === null) {
        return;
      }

      const releasedTabId = activeTabId;
      activeTabId = null;
      hide(releasedTabId);
    }
  };
}

export function shouldSynchronizeActionTab(
  navigationExpected,
  restoration
) {
  return Boolean(
    navigationExpected ||
    restoration &&
      (
        restoration.changed ||
        restoration.urlChanged ||
        restoration.pending
      )
  );
}

export function createPageStateSettler(options = {}) {
  const expectedState = options.state || "complete";
  const settleTimeMs = options.settleTimeMs ?? 150;
  let candidateKey = null;
  let candidateSince = 0;

  return {
    observe(pageState, expectedUrl, now = Date.now()) {
      const ready =
        pageState.readyState === "complete" ||
        expectedState === "interactive" &&
          pageState.readyState === "interactive";
      const matches =
        pageState.url === expectedUrl &&
        pageState.navigationPending !== true &&
        ready;

      if (!matches) {
        candidateKey = null;
        return false;
      }

      const key = `${pageState.documentId}\u0000${pageState.url}`;

      if (candidateKey !== key) {
        candidateKey = key;
        candidateSince = now;
        return settleTimeMs === 0;
      }

      return now - candidateSince >= settleTimeMs;
    }
  };
}

export function restoreControlAfterNavigation(options) {
  const inspect = options.inspect;
  const restore = options.restore;
  const sleep = options.sleep;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const settleTimeMs = Math.max(
    0,
    Math.min(options.settleTimeMs ?? 0, timeoutMs)
  );
  const changeTimeoutMs = Math.min(
    options.changeTimeoutMs ?? 250,
    timeoutMs
  );
  const startedAt = now();
  const changeDeadline = startedAt + changeTimeoutMs;
  const deadline = startedAt + timeoutMs;
  let navigationStarted = false;
  let lastDocumentId = options.initialDocumentId;
  let lastUrlChanged = false;
  let settleKey = null;
  let settleStartedAt = 0;
  let settleResult = null;

  function result(changed, restored, documentId, urlChanged) {
    return { changed, documentId, restored, urlChanged };
  }

  function restoreAndVerify(state, changed, urlChanged) {
    if (
      state.readyState !== "interactive" &&
      state.readyState !== "complete"
    ) {
      return null;
    }

    if (state.controlVisible) {
      return result(
        changed,
        false,
        state.documentId,
        urlChanged
      );
    }

    try {
      restore();
      const verified = inspect();

      if (
        verified.documentId === state.documentId &&
        verified.url === verified.tabUrl &&
        verified.navigationPending !== true &&
        verified.controlVisible
      ) {
        return result(
          changed,
          true,
          state.documentId,
          urlChanged
        );
      }
    } catch (error) {
      // The replacement document may still be loading.
    }

    return null;
  }

  function settled(candidate, state) {
    if (!candidate || settleTimeMs === 0) {
      return candidate;
    }

    const key = `${state.documentId}\u0000${state.tabUrl}`;

    if (settleKey !== key) {
      settleKey = key;
      settleStartedAt = now();
      settleResult = candidate;
      return null;
    }

    settleResult.changed = settleResult.changed || candidate.changed;
    settleResult.restored = settleResult.restored || candidate.restored;
    settleResult.urlChanged =
      settleResult.urlChanged || candidate.urlChanged;

    return now() - settleStartedAt >= settleTimeMs
      ? settleResult
      : null;
  }

  while (now() <= deadline) {
    try {
      const state = inspect();
      const changed =
        state.documentId !== options.initialDocumentId;
      const tabUrlChanged = state.tabUrl !== options.initialUrl;
      const pageMatchesTab = state.url === state.tabUrl;
      const stateKey = `${state.documentId}\u0000${state.tabUrl}`;
      lastDocumentId = state.documentId;
      lastUrlChanged = tabUrlChanged;

      if (settleKey !== null && settleKey !== stateKey) {
        settleKey = null;
        settleResult = null;
      }

      if (!pageMatchesTab || state.navigationPending === true) {
        navigationStarted = true;
        settleKey = null;
        settleResult = null;
        sleep(intervalMs);
        continue;
      }

      if (changed) {
        navigationStarted = true;
        const restored = settled(restoreAndVerify(
          state,
          true,
          tabUrlChanged
        ), state);

        if (restored) {
          return restored;
        }
      } else if (!state.controlVisible && pageMatchesTab) {
        const restored = settled(restoreAndVerify(
          state,
          false,
          tabUrlChanged
        ), state);

        if (restored) {
          return restored;
        }
      } else if (tabUrlChanged && pageMatchesTab) {
        const restored = settled(
          result(false, false, state.documentId, true),
          state
        );

        if (restored) {
          return restored;
        }
      } else if (!navigationStarted && now() >= changeDeadline) {
        return result(false, false, state.documentId, false);
      }
    } catch (error) {
      navigationStarted = true;
    }

    sleep(intervalMs);
  }

  if (navigationStarted) {
    if (options.returnOnTimeout) {
      return {
        changed: true,
        documentId: lastDocumentId,
        pending: true,
        restored: false,
        urlChanged: lastUrlChanged
      };
    }

    throw new Error("control_indicator_restore_timeout");
  }

  return result(false, false, lastDocumentId, lastUrlChanged);
}
