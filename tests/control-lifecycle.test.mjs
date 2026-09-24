import assert from "node:assert/strict";
import test from "node:test";

const lifecycleModule = new URL(
  "../plugins/safari-browser-use/server/src/control-lifecycle.mjs",
  import.meta.url
);

async function createRecorder() {
  const { createControlLifecycle } = await import(lifecycleModule);
  const events = [];
  const lifecycle = createControlLifecycle({
    show(tabId) {
      events.push(`show:${tabId}`);
    },
    refresh(tabId) {
      events.push(`refresh:${tabId}`);
    },
    hide(tabId) {
      events.push(`hide:${tabId}`);
    }
  });

  return { events, lifecycle };
}

test("activating the current tab refreshes its indicator lease", async () => {
  const { events, lifecycle } = await createRecorder();

  lifecycle.activate("10:1");
  lifecycle.activate("10:1");

  assert.deepEqual(events, ["show:10:1", "refresh:10:1"]);
});

test("activating another tab hides the previous indicator first", async () => {
  const { events, lifecycle } = await createRecorder();

  lifecycle.activate("10:1");
  lifecycle.activate("10:2");

  assert.deepEqual(events, [
    "show:10:1",
    "hide:10:1",
    "show:10:2"
  ]);
});

test("releasing control hides the active indicator once", async () => {
  const { events, lifecycle } = await createRecorder();

  lifecycle.activate("10:1");
  lifecycle.release();
  lifecycle.release();

  assert.deepEqual(events, ["show:10:1", "hide:10:1"]);
});

test("restores control before a navigation operation returns", async () => {
  const lifecycle = await import(lifecycleModule);
  const restoreAfterNavigation =
    lifecycle.restoreControlAfterNavigation;
  let clock = 0;
  let inspections = 0;
  let restoreAttempts = 0;
  let controlVisible = false;

  const result = typeof restoreAfterNavigation === "function"
    ? restoreAfterNavigation({
        initialDocumentId: "document-1",
        initialUrl: "https://example.com/start",
        inspect() {
          inspections++;

          if (inspections === 1) {
            throw new Error("document is being replaced");
          }

          return {
            controlVisible,
            documentId: "document-2",
            readyState: inspections === 2
              ? "loading"
              : "interactive",
            tabUrl: "https://example.com/next",
            url: "https://example.com/next"
          };
        },
        now: () => clock,
        restore() {
          restoreAttempts++;

          if (restoreAttempts === 1) {
            throw new Error("new document is not ready");
          }

          controlVisible = true;
        },
        sleep(milliseconds) {
          clock += milliseconds;
        },
        timeoutMs: 1000
      })
    : null;

  assert.deepEqual(result, {
    changed: true,
    documentId: "document-2",
    restored: true,
    urlChanged: true
  });
  assert.equal(restoreAttempts, 2);
});

test("does not delay a browser action when its document stays active", async () => {
  const lifecycle = await import(lifecycleModule);
  const restoreAfterNavigation =
    lifecycle.restoreControlAfterNavigation;
  let clock = 0;
  let restores = 0;

  const result = typeof restoreAfterNavigation === "function"
    ? restoreAfterNavigation({
        changeTimeoutMs: 100,
        initialDocumentId: "document-1",
        initialUrl: "https://example.com/start",
        inspect() {
          return {
            controlVisible: true,
            documentId: "document-1",
            readyState: "complete",
            tabUrl: "https://example.com/start",
            url: "https://example.com/start"
          };
        },
        now: () => clock,
        restore() {
          restores++;
        },
        sleep(milliseconds) {
          clock += milliseconds;
        },
        timeoutMs: 1000
      })
    : null;

  assert.deepEqual(result, {
    changed: false,
    documentId: "document-1",
    restored: false,
    urlChanged: false
  });
  assert.equal(restores, 0);
});

test("restores an indicator removed from the current document", async () => {
  const lifecycle = await import(lifecycleModule);
  const restoreAfterNavigation =
    lifecycle.restoreControlAfterNavigation;
  let controlVisible = false;
  let restores = 0;

  const result = typeof restoreAfterNavigation === "function"
    ? restoreAfterNavigation({
        initialDocumentId: "document-1",
        initialUrl: "https://example.com/start",
        inspect() {
          return {
            controlVisible,
            documentId: "document-1",
            readyState: "complete",
            tabUrl: "https://example.com/start",
            url: "https://example.com/start"
          };
        },
        now: () => 0,
        restore() {
          restores++;
          controlVisible = true;
        },
        sleep() {},
        timeoutMs: 1000
      })
    : null;

  assert.deepEqual(result, {
    changed: false,
    documentId: "document-1",
    restored: true,
    urlChanged: false
  });
  assert.equal(restores, 1);
});

test("returns a pending transition instead of misreporting a slow navigation", async () => {
  const lifecycle = await import(lifecycleModule);
  const restoreAfterNavigation =
    lifecycle.restoreControlAfterNavigation;
  let clock = 0;

  const result = restoreAfterNavigation({
    initialDocumentId: "document-1",
    initialUrl: "https://example.com/start",
    inspect() {
      return {
        controlVisible: false,
        documentId: "document-1",
        readyState: "complete",
        tabUrl: "https://example.com/slow",
        url: "https://example.com/start"
      };
    },
    now: () => clock,
    restore() {},
    returnOnTimeout: true,
    sleep(milliseconds) {
      clock += milliseconds;
    },
    timeoutMs: 100
  });

  assert.deepEqual(result, {
    changed: true,
    documentId: "document-1",
    pending: true,
    restored: false,
    urlChanged: true
  });
});

test("reports same-document URL changes after JavaScript navigation", async () => {
  const lifecycle = await import(lifecycleModule);
  const restoreAfterNavigation =
    lifecycle.restoreControlAfterNavigation;

  const result = restoreAfterNavigation({
    initialDocumentId: "document-1",
    initialUrl: "https://example.com/search",
    inspect() {
      return {
        controlVisible: true,
        documentId: "document-1",
        readyState: "complete",
        tabUrl: "https://example.com/results",
        url: "https://example.com/results"
      };
    },
    now: () => 0,
    restore() {},
    sleep() {},
    timeoutMs: 1000
  });

  assert.deepEqual(result, {
    changed: false,
    documentId: "document-1",
    restored: false,
    urlChanged: true
  });
});

test("synchronizes a tab when navigation was observed but not predicted", async () => {
  const { shouldSynchronizeActionTab } = await import(lifecycleModule);

  assert.equal(
    shouldSynchronizeActionTab(false, {
      changed: false,
      restored: false,
      urlChanged: true
    }),
    true
  );
  assert.equal(
    shouldSynchronizeActionTab(false, {
      changed: false,
      restored: false,
      urlChanged: false
    }),
    false
  );
});

test("waits for a redirected document to settle before returning", async () => {
  const { restoreControlAfterNavigation } = await import(lifecycleModule);
  let clock = 0;
  let inspection = 0;
  let finalControlVisible = false;

  const result = restoreControlAfterNavigation({
    initialDocumentId: "document-1",
    initialUrl: "https://example.com/start",
    inspect() {
      inspection++;

      if (inspection === 1) {
        return {
          controlVisible: true,
          documentId: "document-2",
          readyState: "complete",
          tabUrl: "https://example.com/intermediate",
          url: "https://example.com/intermediate"
        };
      }

      if (inspection === 2) {
        return {
          controlVisible: false,
          documentId: "document-3",
          readyState: "loading",
          tabUrl: "https://example.com/final",
          url: "https://example.com/final"
        };
      }

      return {
        controlVisible: finalControlVisible,
        documentId: "document-3",
        readyState: "complete",
        tabUrl: "https://example.com/final",
        url: "https://example.com/final"
      };
    },
    now: () => clock,
    restore() {
      finalControlVisible = true;
    },
    settleTimeMs: 100,
    sleep(milliseconds) {
      clock += milliseconds;
    },
    timeoutMs: 1000
  });

  assert.deepEqual(result, {
    changed: true,
    documentId: "document-3",
    restored: true,
    urlChanged: true
  });
});

test("does not settle a load while the redirected document is replacing", async () => {
  const { createPageStateSettler } = await import(lifecycleModule);
  const settler = createPageStateSettler({
    settleTimeMs: 100,
    state: "complete"
  });

  assert.equal(settler.observe({
    documentId: "old-document",
    navigationPending: true,
    readyState: "complete",
    url: "https://example.com/final"
  }, "https://example.com/final", 0), false);
  assert.equal(settler.observe({
    documentId: "old-document",
    navigationPending: true,
    readyState: "complete",
    url: "https://example.com/final"
  }, "https://example.com/final", 150), false);
  assert.equal(settler.observe({
    documentId: "final-document",
    readyState: "loading",
    url: "https://example.com/final"
  }, "https://example.com/final", 50), false);
  assert.equal(settler.observe({
    documentId: "final-document",
    readyState: "complete",
    url: "https://example.com/final"
  }, "https://example.com/final", 100), false);
  assert.equal(settler.observe({
    documentId: "final-document",
    readyState: "complete",
    url: "https://example.com/final"
  }, "https://example.com/final", 200), true);
});

for (const reason of ["URL mismatch", "pending unload"]) {
  test(`does not restore control on an intermediate document with ${reason}`, async () => {
    const { restoreControlAfterNavigation } = await import(lifecycleModule);
    let clock = 0;
    const result = restoreControlAfterNavigation({
      initialDocumentId: "initial", initialUrl: "https://example.com/start",
      inspect() {
        const intermediate = clock < 300;
        return {
          controlVisible: true,
          documentId: intermediate ? "intermediate" : "final",
          readyState: "complete",
          navigationPending: intermediate && reason === "pending unload",
          url: intermediate && reason === "URL mismatch"
            ? "https://example.com/intermediate" : "https://example.com/final",
          tabUrl: "https://example.com/final"
        };
      },
      restore() {}, now: () => clock,
      sleep(milliseconds) { clock += milliseconds; },
      settleTimeMs: 100, timeoutMs: 1000
    });
    assert.equal(result.documentId, "final");
  });
}
