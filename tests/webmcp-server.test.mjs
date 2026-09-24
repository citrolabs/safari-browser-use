import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as tabIdentity from "../plugins/safari-browser-use/server/src/tab-identity.mjs";
import { runWebmcpPageOperation } from "../plugins/safari-browser-use/server/src/webmcp-page.mjs";

const template = await readFile(new URL(
  "../plugins/safari-browser-use/server/src/jxa-server.template.js", import.meta.url
), "utf8");

function section(start, end) {
  const first = template.indexOf(start);
  const last = template.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `missing server section: ${start}`);
  return template.slice(first, last);
}

function createBridge() {
  // Native API doubles run in a separate realm. The production page serializer,
  // dispatcher, and polling code cross the same JSON boundary as Safari.
  let clock = 0;
  let timerId = 0;
  const timers = new Map();
  const page = vm.createContext({
    AbortController,
    Date: { now: () => clock },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, deadline: clock + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id)
  }, { microtaskMode: "afterEvaluate" });
  const evaluate = code => vm.runInContext(code, page);
  evaluate(`
    var window = globalThis;
    var executions = 0;
    var executionSignal;
    var finishDiscovery;
    var finishExecution;
    var nativeTool = {
      name: 'search', description: 'Search articles', window: window,
      inputSchema: {type:'object'}, annotations: {readOnlyHint:true}
    };
    var discover = () => Promise.resolve([nativeTool]);
    var execute = args => Promise.resolve(JSON.stringify({query:args.query}));
    var document = {modelContext: {
      getTools() { return discover(); },
      executeTool(tool, args, options) {
        if (tool !== nativeTool) throw new Error('wrong native descriptor');
        executions++;
        executionSignal = options.signal;
        return execute(args);
      }
    }};
  `);

  const metadata = { id: "1:2", title: "Test", url: "https://example.com/test" };
  const identity = tabIdentity.createTabIdentity(metadata);
  const bridge = { evaluate, failNextPoll: false, requests: [] };
  bridge.advance = milliseconds => {
    clock += milliseconds;
    if (!bridge.suspendTimers) {
      for (const [id, timer] of timers) {
        if (timer.deadline <= clock) {
          timers.delete(id);
          timer.callback();
        }
      }
    }
  };
  const server = vm.createContext({
    ...tabIdentity, runWebmcpPageOperation,
    Date: { now: () => clock },
    listTabs: () => [metadata],
    inspectControlledDocument: () => ({ documentId: "doc-1", url: metadata.url }),
    foundation: { NSThread: { sleepForTimeInterval(seconds) {
      bridge.advance(seconds * 1000);
      bridge.onSleep?.();
    } } },
    runPage(method, params) {
      bridge.requests.push({ method, abort: params.abort === true });
      bridge.beforeRequest?.(method, params);
      if (method === "webmcp.callStatus" && bridge.failNextPoll) {
        bridge.failNextPoll = false;
        throw new Error("Safari result read failed");
      }
      const envelope = JSON.parse(evaluate(server.pageJavaScript(method, params)));
      if (!envelope.ok) throw new Error(envelope.error);
      bridge.afterRequest?.(method, params);
      return envelope.value;
    }
  });
  vm.runInContext(
    section("  function pageJavaScript(", "  function runPageInTab(") +
    section("  function pollWebmcpCall(", "  function restoreControlForNavigation("),
    server
  );
  bridge.call = (method, params = {}) => server.handleWebmcp(method, {
    tabId: identity.id, tabIdentity: identity, ...params
  });
  bridge.pendingCount = () => evaluate("Object.keys(window.__safari_browser_use_webmcp_calls__).length");
  bridge.timerCount = () => timers.size;
  return bridge;
}

test("native discovery crosses the Safari JSON boundary without owner windows", () => {
  const bridge = createBridge();
  const result = bridge.call("webmcp.pageTools");
  assert.equal(result.available, true);
  assert.deepEqual(result.tools, [{
    name: "search", description: "Search articles",
    inputSchema: { type: "object" }, annotations: { readOnlyHint: true }
  }]);
  assert.equal(bridge.evaluate("executions"), 0);
  assert.equal(bridge.pendingCount(), 0);
});

test("the synchronous REPL returns the native result unchanged", () => {
  const bridge = createBridge();
  const result = bridge.call("webmcp.callTool", { name: "search", args: { query: "上海" } });
  assert.equal(result, '{"query":"上海"}');
  assert.equal(bridge.evaluate("executions"), 1);
  assert.equal(bridge.pendingCount(), 0);
});

test("a discovery timeout prevents execution after the REPL returns an error", () => {
  const bridge = createBridge();
  bridge.evaluate("discover = () => new Promise(resolve => {finishDiscovery=resolve})");
  assert.throws(() => bridge.call("webmcp.callTool", {
    name: "search", options: { timeoutMs: 25 }
  }), /webmcp_call_timeout/);
  bridge.evaluate("finishDiscovery([nativeTool])");
  assert.equal(bridge.evaluate("executions"), 0);
  assert.equal(bridge.pendingCount(), 0);
});

test("a failed result read prevents delayed native execution", () => {
  const bridge = createBridge();
  bridge.evaluate("discover = () => new Promise(resolve => {finishDiscovery=resolve})");
  bridge.failNextPoll = true;
  assert.throws(() => bridge.call("webmcp.callTool", { name: "search" }), /Safari result read failed/);
  bridge.evaluate("finishDiscovery([nativeTool])");
  assert.equal(bridge.evaluate("executions"), 0);
  assert.equal(bridge.pendingCount(), 0);
});

test("a failed result read aborts an executing native tool", () => {
  const bridge = createBridge();
  bridge.evaluate("execute = () => new Promise(resolve => {finishExecution=resolve})");
  bridge.failNextPoll = true;
  assert.throws(() => bridge.call("webmcp.callTool", { name: "search" }), /Safari result read failed/);
  assert.equal(bridge.evaluate("executionSignal.aborted"), true);
  bridge.evaluate("finishExecution('late result')");
  assert.equal(bridge.pendingCount(), 0);
});

test("native execution errors propagate without retry and the next call still works", () => {
  const bridge = createBridge();
  bridge.evaluate("execute = () => Promise.reject(new Error('native denied'))");
  assert.throws(() => bridge.call("webmcp.callTool", { name: "search" }), /native denied/);
  assert.equal(bridge.evaluate("executions"), 1);
  assert.equal(bridge.pendingCount(), 0);
  bridge.evaluate("execute = () => Promise.resolve('recovered')");
  assert.equal(bridge.call("webmcp.callTool", { name: "search" }), "recovered");
  assert.equal(bridge.evaluate("executions"), 2);
});

test("discovery that resolves after the deadline cannot start a tool", () => {
  const bridge = createBridge();
  bridge.suspendTimers = true; // Background tabs can delay timer callbacks.
  bridge.evaluate("discover = () => new Promise(resolve => {finishDiscovery=resolve})");
  bridge.onSleep = () => bridge.evaluate("finishDiscovery([nativeTool])");
  assert.throws(() => bridge.call("webmcp.callTool", {
    name: "search", options: { timeoutMs: 25 }
  }), /webmcp_call_timeout/);
  assert.equal(bridge.evaluate("executions"), 0);
  assert.equal(bridge.pendingCount(), 0);
  assert.equal(bridge.timerCount(), 0);
});

test("a late native result is not reported as success", () => {
  const bridge = createBridge();
  bridge.suspendTimers = true;
  bridge.evaluate("execute = () => new Promise(resolve => {finishExecution=resolve})");
  bridge.onSleep = () => bridge.evaluate("finishExecution('late result')");
  assert.throws(() => bridge.call("webmcp.callTool", {
    name: "search", options: { timeoutMs: 25 }
  }), /webmcp_call_timeout/);
  assert.equal(bridge.evaluate("executionSignal.aborted"), true);
  assert.equal(bridge.pendingCount(), 0);
});

test("losing the initial dispatch reply still cancels pending discovery", () => {
  const bridge = createBridge();
  bridge.evaluate("discover = () => new Promise(resolve => {finishDiscovery=resolve})");
  bridge.afterRequest = method => {
    if (method === "webmcp.execute") throw new Error("dispatch reply lost");
  };
  assert.throws(() => bridge.call("webmcp.callTool", { name: "search" }), /dispatch reply lost/);
  bridge.evaluate("finishDiscovery([nativeTool])");
  assert.equal(bridge.evaluate("executions"), 0);
  assert.equal(bridge.pendingCount(), 0);
});

test("the page expires abandoned discovery even when host cancellation is unreachable", () => {
  const bridge = createBridge();
  bridge.evaluate("discover = () => new Promise(resolve => {finishDiscovery=resolve})");
  bridge.beforeRequest = method => {
    if (method === "webmcp.callStatus") throw new Error("Safari unreachable");
  };
  assert.throws(() => bridge.call("webmcp.callTool", {
    name: "search", options: { timeoutMs: 25 }
  }), /Safari unreachable/);
  bridge.advance(100);
  bridge.evaluate("finishDiscovery([nativeTool])");
  assert.equal(bridge.evaluate("executions"), 0);
  assert.equal(bridge.pendingCount(), 0);
  assert.equal(bridge.timerCount(), 0);
});

test("an abandoned running tool receives cancellation from its page deadline", () => {
  const bridge = createBridge();
  bridge.evaluate("execute = () => new Promise(resolve => {finishExecution=resolve})");
  bridge.beforeRequest = method => {
    if (method === "webmcp.callStatus") throw new Error("Safari unreachable");
  };
  assert.throws(() => bridge.call("webmcp.callTool", {
    name: "search", options: { timeoutMs: 25 }
  }), /Safari unreachable/);
  bridge.advance(100);
  assert.equal(bridge.evaluate("executionSignal.aborted"), true);
  bridge.evaluate("finishExecution('too late')");
  assert.equal(bridge.pendingCount(), 0);
});

test("the page eventually discards an unread completed result", () => {
  const bridge = createBridge();
  bridge.beforeRequest = method => {
    if (method === "webmcp.callStatus") throw new Error("Safari unreachable");
  };
  assert.throws(() => bridge.call("webmcp.callTool", {
    name: "search", options: { timeoutMs: 25 }
  }), /Safari unreachable/);
  assert.equal(bridge.evaluate("executions"), 1);
  bridge.advance(100);
  assert.equal(bridge.pendingCount(), 0);
  assert.equal(bridge.timerCount(), 0);
});

test("invalid timeouts fail before dispatching native operations", () => {
  for (const timeoutMs of [0, -1, NaN, Infinity]) {
    const bridge = createBridge();
    assert.throws(() => bridge.call("webmcp.callTool", {
      name: "search", options: { timeoutMs }
    }), /webmcp_invalid_timeout/);
    assert.equal(bridge.requests.length, 0);
    assert.equal(bridge.evaluate("executions"), 0);
  }
});

test("the timeout budget includes waiting for the initial dispatch reply", () => {
  const bridge = createBridge();
  bridge.afterRequest = method => {
    if (method === "webmcp.execute") bridge.advance(100);
  };
  assert.throws(() => bridge.call("webmcp.callTool", {
    name: "search", options: { timeoutMs: 25 }
  }), /webmcp_call_timeout/);
  assert.equal(bridge.pendingCount(), 0);
});
