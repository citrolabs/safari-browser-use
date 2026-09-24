import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { buildPlugin } from "../scripts/build-plugin.mjs";
import {
  runPageOperation
} from "../plugins/safari-browser-use/server/src/page-runtime.mjs";

const nativeInputModule = new URL(
  "../plugins/safari-browser-use/server/src/native-input.mjs",
  import.meta.url
);

const viewport = {
  innerHeight: 1330,
  innerWidth: 2213,
  outerHeight: 1410,
  outerWidth: 2213,
  visualOffsetLeft: 0,
  visualOffsetTop: 0,
  visualScale: 1
};

const windowBounds = {
  height: 1410,
  width: 2213,
  x: 1512,
  y: -259
};

test("uses the Safari window bounds when its script ID differs from the Core Graphics ID", async () => {
  const template = await readFile(new URL(
    "../plugins/safari-browser-use/server/src/jxa-server.template.js", import.meta.url
  ), "utf8");
  const actualBounds = { x: 81, y: 33, width: 1324, height: 949 };
  const context = {
    findTab: () => ({ window: { bounds: () => actualBounds } }),
    parseTabId: () => ({ windowId: 39773 }),
    ObjC: { deepUnwrap: value => value },
    foundation: { CGWindowListCopyWindowInfo: () => [{
      kCGWindowNumber: 39773, kCGWindowLayer: 0,
      kCGWindowBounds: { X: 382, Y: 98, Width: 967, Height: 808 }
    }] }
  };
  vm.runInNewContext(template.slice(
    template.indexOf("  function nativeWindowBounds("),
    template.indexOf("  function focusNativeTarget(")
  ), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.nativeWindowBounds("39773:26"))), actualBounds);
});

test("does not send native input when Safari fails to become frontmost", async () => {
  const template = await readFile(new URL(
    "../plugins/safari-browser-use/server/src/jxa-server.template.js", import.meta.url
  ), "utf8");
  const context = {
    findTab: () => ({ window: {}, tab: {} }),
    safari: { activate() {}, frontmost: () => false },
    foundation: { NSThread: { sleepForTimeInterval() {} } },
    currentTabMetadata: () => ({ id: "39773:26" })
  };
  vm.runInNewContext(template.slice(
    template.indexOf("  function focusNativeTarget("),
    template.indexOf("  function postNativeClick(")
  ), context);
  assert.throws(() => context.focusNativeTarget("39773:26"), /native_click_target_not_frontmost/);
});

for (const covered of [true, false]) {
  test(`native focus ${covered ? "rejects a covering Safari dialog" : "accepts the visible target window"}`, async () => {
    const template = await readFile(new URL(
      "../plugins/safari-browser-use/server/src/jxa-server.template.js", import.meta.url
    ), "utf8");
    const context = {
      findTab: () => ({ window: { bounds: () => ({ x: 81, y: 33, width: 1324, height: 949 }) }, tab: {} }),
      safari: { activate() {}, frontmost: () => true },
      foundation: { AXIsProcessTrusted: () => true, NSThread: { sleepForTimeInterval() {} } },
      systemEvents: { processes: { byName: () => ({ windows: () => [{
        position: () => covered ? [0, 33] : [81, 33],
        size: () => covered ? [1512, 949] : [1324, 949],
        subrole: () => covered ? "AXDialog" : "AXStandardWindow"
      }] }) } },
      currentTabMetadata: () => ({ id: "39773:26" })
    };
    vm.runInNewContext(template.slice(
      template.indexOf("  function focusNativeTarget("),
      template.indexOf("  function postNativeClick(")
    ), context);
    if (covered) assert.throws(() => context.focusNativeTarget("39773:26"), /native_click_target_not_frontmost/);
    else assert.doesNotThrow(() => context.focusNativeTarget("39773:26"));
  });
}

for (const trusted of [true, false]) {
  test(`native mouse events ${trusted ? "reach the system event stream" : "require Accessibility permission"}`, async () => {
    const template = await readFile(new URL(
      "../plugins/safari-browser-use/server/src/jxa-server.template.js", import.meta.url
    ), "utf8");
    const posted = [];
    const context = {
      systemEvents: { processes: { byName: () => ({ exists: () => true, click() {} }) } },
      foundation: {
        AXIsProcessTrusted: () => trusted,
        CGPointMake: (x, y) => ({ x, y }),
        kCGEventMouseMoved: 5,
        kCGEventLeftMouseDown: 1,
        kCGEventLeftMouseUp: 2,
        kCGMouseButtonLeft: 0,
        kCGMouseEventClickState: 1,
        kCGHIDEventTap: 0,
        CGEventCreateMouseEvent: (source, type, point, button) => ({ type, point, button }),
        CGEventSetIntegerValueField(event, field, value) { event.clickCount = value; },
        CGEventPost(tap, event) { posted.push({ ...event }); },
        CFRelease() { throw new Error("JXA owns the event reference"); },
        NSThread: { sleepForTimeInterval() {} }
      }
    };
    vm.runInNewContext(template.slice(
      template.indexOf("  function postNativeClick("),
      template.indexOf("  function saveNativeClipboard(")
    ), context);
    if (!trusted) {
      assert.throws(() => context.postNativeClick({ x: 449, y: 320 }), /native_input_permission_denied/);
      assert.deepEqual(posted, []);
      return;
    }
    context.postNativeClick({ x: 449, y: 320 });
    assert.deepEqual(posted.map(event => event.type), [5, 1, 2]);
    assert.ok(posted.every(event => event.point.x === 449 && event.point.y === 320));
    assert.deepEqual(posted.slice(1).map(event => event.clickCount), [1, 1]);
  });
}

test("reports the viewport metrics needed for native input", () => {
  assert.deepEqual(
    runPageOperation(
      {},
      {
        innerHeight: 700,
        innerWidth: 1000,
        outerHeight: 780,
        outerWidth: 1000,
        visualViewport: {
          offsetLeft: 0,
          offsetTop: 0,
          scale: 1
        }
      },
      "playwright.viewportMetrics"
    ),
    {
      innerHeight: 700,
      innerWidth: 1000,
      outerHeight: 780,
      outerWidth: 1000,
      visualOffsetLeft: 0,
      visualOffsetTop: 0,
      visualScale: 1
    }
  );
});

test("maps viewport coordinates into a multi-display screen point", async () => {
  const { viewportPointToScreen } = await import(nativeInputModule);

  assert.deepEqual(
    viewportPointToScreen(
      { x: 100, y: 200 },
      viewport,
      windowBounds
    ),
    { x: 1612, y: 21 }
  );
});

test("rejects a native click outside the visible viewport", async () => {
  const { viewportPointToScreen } = await import(nativeInputModule);

  assert.throws(
    () => viewportPointToScreen(
      { x: 2213, y: 200 },
      viewport,
      windowBounds
    ),
    /native_click_outside_viewport/
  );
});

test("rejects a transformed visual viewport", async () => {
  const { viewportPointToScreen } = await import(nativeInputModule);

  assert.throws(
    () => viewportPointToScreen(
      { x: 100, y: 200 },
      { ...viewport, visualScale: 1.25 },
      windowBounds
    ),
    /native_click_unsupported_viewport_transform/
  );
});

test("focuses the target tab before posting one native click", async () => {
  const { createNativeInput } = await import(nativeInputModule);
  const calls = [];
  const nativeInput = createNativeInput({
    focus(tabId) {
      calls.push(["focus", tabId]);
    },
    readViewport(tabId) {
      calls.push(["viewport", tabId]);
      return viewport;
    },
    readWindowBounds(tabId) {
      calls.push(["window", tabId]);
      return windowBounds;
    },
    postClick(point) {
      calls.push(["click", point]);
    }
  });

  assert.deepEqual(
    nativeInput.clickAt("71009:19", 100, 200),
    {
      clicked: true,
      screen: { x: 1612, y: 21 },
      viewport: { x: 100, y: 200 }
    }
  );
  assert.deepEqual(calls, [
    ["focus", "71009:19"],
    ["viewport", "71009:19"],
    ["window", "71009:19"],
    ["click", { x: 1612, y: 21 }]
  ]);
});

test("pastes rich content with a native shortcut and restores the clipboard", async () => {
  const { createNativeInput } = await import(nativeInputModule);
  const calls = [];
  const nativeInput = createNativeInput({
    focus(tabId) {
      calls.push(["focus", tabId]);
    },
    readViewport() {
      return viewport;
    },
    readWindowBounds() {
      return windowBounds;
    },
    postClick() {},
    saveClipboard() {
      calls.push(["saveClipboard"]);
      return { items: ["saved"] };
    },
    writeClipboard(content) {
      calls.push(["writeClipboard", content]);
    },
    readClipboard() {
      return { text: "copied", html: "<b>copied</b>" };
    },
    restoreClipboard(saved) {
      calls.push(["restoreClipboard", saved]);
    },
    postShortcut(key, modifiers) {
      calls.push(["shortcut", key, modifiers]);
    },
    sleep(milliseconds) {
      calls.push(["sleep", milliseconds]);
    }
  });

  assert.deepEqual(
    nativeInput.paste(
      "71009:19",
      { text: "Hello", html: "<b>Hello</b>" }
    ),
    { pasted: true }
  );
  assert.deepEqual(calls, [
    ["focus", "71009:19"],
    ["saveClipboard"],
    [
      "writeClipboard",
      { text: "Hello", html: "<b>Hello</b>" }
    ],
    ["shortcut", "v", ["command"]],
    ["sleep", 150],
    ["restoreClipboard", { items: ["saved"] }]
  ]);
});

test("copies a native selection without leaving user clipboard changes", async () => {
  const { createNativeInput } = await import(nativeInputModule);
  const calls = [];
  const nativeInput = createNativeInput({
    focus(tabId) {
      calls.push(["focus", tabId]);
    },
    readViewport() {
      return viewport;
    },
    readWindowBounds() {
      return windowBounds;
    },
    postClick() {},
    saveClipboard() {
      calls.push(["saveClipboard"]);
      return "saved";
    },
    writeClipboard() {},
    readClipboard() {
      calls.push(["readClipboard"]);
      return { text: "A\tB", html: "<table></table>" };
    },
    restoreClipboard(saved) {
      calls.push(["restoreClipboard", saved]);
    },
    postShortcut(key, modifiers) {
      calls.push(["shortcut", key, modifiers]);
    },
    sleep(milliseconds) {
      calls.push(["sleep", milliseconds]);
    }
  });

  assert.deepEqual(
    nativeInput.copy("71009:19"),
    { text: "A\tB", html: "<table></table>" }
  );
  assert.deepEqual(calls, [
    ["focus", "71009:19"],
    ["saveClipboard"],
    ["shortcut", "c", ["command"]],
    ["sleep", 150],
    ["readClipboard"],
    ["restoreClipboard", "saved"]
  ]);
});

test("restores the clipboard when a native paste fails", async () => {
  const { createNativeInput } = await import(nativeInputModule);
  const restored = [];
  const nativeInput = createNativeInput({
    focus() {},
    readViewport() {
      return viewport;
    },
    readWindowBounds() {
      return windowBounds;
    },
    postClick() {},
    saveClipboard() {
      return "saved";
    },
    writeClipboard() {},
    readClipboard() {
      return {};
    },
    restoreClipboard(saved) {
      restored.push(saved);
    },
    postShortcut() {
      throw new Error("native keyboard denied");
    },
    sleep() {}
  });

  assert.throws(
    () => nativeInput.paste("71009:19", { text: "Hello" }),
    /native keyboard denied/
  );
  assert.deepEqual(restored, ["saved"]);
});

test("posts a trusted keyboard shortcut after focusing its tab", async () => {
  const { createNativeInput } = await import(nativeInputModule);
  const calls = [];
  const nativeInput = createNativeInput({
    focus(tabId) {
      calls.push(["focus", tabId]);
    },
    readViewport() {
      return viewport;
    },
    readWindowBounds() {
      return windowBounds;
    },
    postClick() {},
    saveClipboard() {},
    writeClipboard() {},
    readClipboard() {},
    restoreClipboard() {},
    postShortcut(key, modifiers) {
      calls.push(["shortcut", key, modifiers]);
    },
    sleep(milliseconds) {
      calls.push(["sleep", milliseconds]);
    }
  });

  assert.deepEqual(
    nativeInput.shortcut("71009:19", "a", ["command", "shift"]),
    { pressed: true }
  );
  assert.deepEqual(calls, [
    ["focus", "71009:19"],
    ["shortcut", "a", ["command", "shift"]],
    ["sleep", 75]
  ]);
});

test("build exposes nativeClickAt without changing clickAt", async t => {
  const directory = await mkdtemp(
    join(tmpdir(), "safari-browser-use-native-input-")
  );
  const outfile = join(directory, "server.jxa.js");

  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  await buildPlugin({ outfile });

  const bundle = await readFile(outfile, "utf8");

  assert.match(bundle, /function viewportPointToScreen/);
  assert.match(bundle, /function createNativeInput/);
  assert.match(
    bundle,
    /SafariPlaywright\.prototype\.nativeClickAt/
  );
  assert.match(
    bundle,
    /SafariPlaywright\.prototype\.clickAt/
  );
  assert.match(bundle, /Application\("System Events"\)/);
  assert.doesNotMatch(bundle, /CGWindowListCopyWindowInfo/);
  assert.match(bundle, /CGEventPost/);
});

test("documents native input as an explicit cross-origin fallback", async () => {
  const [guide, captchaReference] = await Promise.all([
    readFile(
      new URL(
        "../plugins/safari-browser-use/server/src/documentation.md",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../plugins/safari-browser-use/skills/control-safari/references/captcha.md",
        import.meta.url
      ),
      "utf8"
    )
  ]);

  assert.match(guide, /nativeClickAt\(\)/);
  assert.match(guide, /foreground/i);
  assert.match(guide, /cross-origin iframe/i);
  assert.match(captchaReference, /nativeClickAt\(\)/);
  assert.match(captchaReference, /explicit confirmation/i);
  assert.match(captchaReference, /authoritative signal/i);
});
