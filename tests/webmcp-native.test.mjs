import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { runWebmcpPageOperation } from "../plugins/safari-browser-use/server/src/webmcp-page.mjs";

function createPage(modelContext) {
  const window = new Window({ url: "https://example.com/app" });
  if (modelContext) Object.defineProperty(window.document, "modelContext", { value: modelContext });
  let requests = 0;
  window.fetch = () => { requests++; throw new Error("unexpected HTTP request"); };
  return {
    window,
    get requests() { return requests; },
    run(method, params = {}) {
      return runWebmcpPageOperation(window.document, window, method, params);
    }
  };
}

async function complete(page, method, params = {}) {
  const started = page.run(method, { token: "test-call", ...params });
  if (started.status === "done") return started;
  await new Promise(resolve => setImmediate(resolve));
  return page.run("webmcp.callStatus", { token: "test-call" });
}

test("a registration-only API is not reported as usable native WebMCP", () => {
  const page = createPage({ registerTool() {} });
  assert.equal(page.run("webmcp.pageTools").available, false);
});

test("unsupported pages stay unavailable without patching or probing HTTP", async () => {
  const page = createPage();
  const fetch = page.window.fetch;
  const open = page.window.XMLHttpRequest.prototype.open;
  const send = page.window.XMLHttpRequest.prototype.send;
  const result = await complete(page, "webmcp.pageTools");
  assert.equal(result.available, false);
  assert.deepEqual(result.tools, []);
  assert.throws(() => page.run("webmcp.execute", { token: "execute", name: "get_api_feed" }), /webmcp_unavailable/);
  assert.equal(page.requests, 0);
  assert.equal(page.window.fetch, fetch);
  assert.equal(page.window.XMLHttpRequest.prototype.open, open);
  assert.equal(page.window.XMLHttpRequest.prototype.send, send);
  assert.equal(page.window.__safari_browser_use_webmcp_captures__, undefined);
});

test("lists only native tool metadata without serializing owner windows", async () => {
  const owner = { circular: null };
  owner.circular = owner;
  const tool = {
    name: "search", title: "文章搜索", description: "Search articles", origin: "https://example.com",
    inputSchema: { type: "object" }, annotations: { readOnlyHint: true }, window: owner
  };
  const context = {
    getTools() { assert.equal(this, context); return Promise.resolve([tool]); },
    executeTool() { throw new Error("discovery must not execute tools"); }
  };
  const page = createPage(context);
  const result = await complete(page, "webmcp.pageTools");
  assert.equal(result.available, true);
  assert.deepEqual(result.tools, [{
    name: tool.name, title: tool.title, description: tool.description, origin: tool.origin,
    inputSchema: tool.inputSchema, annotations: tool.annotations
  }]);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(page.requests, 0);
});

test("executes the freshly discovered RegisteredTool through its native context", async () => {
  const old = { name: "search", annotations: { readOnlyHint: true } };
  const current = { ...old, window: {} };
  let active = old;
  const executions = [];
  const context = {
    getTools: async () => [active],
    executeTool(tool, args, options) {
      assert.equal(this, context);
      executions.push({ tool, args, signal: options.signal });
      return Promise.resolve('{"items":["上海"]}');
    }
  };
  const page = createPage(context);
  await complete(page, "webmcp.pageTools");
  active = current;
  const result = await complete(page, "webmcp.execute", { name: "search", args: { query: "上海" } });
  assert.equal(result.status, "done");
  assert.equal(result.result, '{"items":["上海"]}');
  assert.equal(executions.length, 1);
  assert.equal(executions[0].tool, current);
  assert.deepEqual(executions[0].args, { query: "上海" });
  assert.equal(executions[0].signal.aborted, false);
  assert.equal(page.requests, 0);
});

for (const [name, tools, error] of [
  ["missing", [], "webmcp_unknown_tool"],
  ["duplicate", [{ name: "search" }, { name: "search" }], "webmcp_ambiguous_tool"]
]) {
  test(`does not execute a ${name} native tool`, async () => {
    let calls = 0;
    const page = createPage({ getTools: async () => tools, executeTool() { calls++; } });
    const result = await complete(page, "webmcp.execute", { name: "search", options: { confirmed: true } });
    assert.equal(result.status, "error");
    assert.match(result.error, new RegExp(error));
    assert.equal(calls, 0);
    assert.equal(page.requests, 0);
  });
}

for (const annotations of [undefined, { readOnlyHint: false }, { readOnlyHint: true, consequentialHint: true }]) {
  test(`native writes require confirmation: ${JSON.stringify(annotations)}`, async () => {
    let calls = 0;
    const page = createPage({
      getTools: async () => [{ name: "change", annotations }],
      executeTool: async () => { calls++; return "changed"; }
    });
    const blocked = await complete(page, "webmcp.execute", { name: "change" });
    assert.equal(blocked.status, "error");
    assert.match(blocked.error, /webmcp_confirmation_required/);
    assert.equal(calls, 0);
    const allowed = await complete(page, "webmcp.execute", { name: "change", options: { confirmed: true } });
    assert.equal(allowed.result, "changed");
    assert.equal(calls, 1);
  });
}

test("native discovery failures are surfaced without converting HTTP APIs", async () => {
  const page = createPage({
    getTools: async () => { throw new Error("native permission denied"); }, executeTool() {}
  });
  const result = await complete(page, "webmcp.pageTools");
  assert.equal(result.status, "error");
  assert.match(result.error, /native permission denied/);
  assert.equal(page.requests, 0);
});

test("aborting a native call cancels its signal and removes the pending result", async () => {
  let signal;
  let finish;
  const page = createPage({
    getTools: async () => [{ name: "slow", annotations: { readOnlyHint: true } }],
    executeTool(tool, args, options) {
      signal = options.signal;
      return new Promise(resolve => { finish = resolve; });
    }
  });
  page.run("webmcp.execute", { token: "slow", name: "slow" });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(signal, "execution must receive the native cancellation signal");
  page.run("webmcp.callStatus", { token: "slow", abort: true });
  assert.equal(signal.aborted, true);
  finish("too late");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.run("webmcp.callStatus", { token: "slow" }).status, "unknown");
});

test("removed recording and probing operations cannot be invoked", () => {
  const page = createPage();
  for (const method of ["install", "uninstall", "drain", "probe", "status"]) {
    assert.throws(() => page.run("webmcp." + method), /unsupported_webmcp_method/);
  }
  assert.equal(page.requests, 0);
});

test("cancelling discovery prevents a later tool execution", async () => {
  let discover;
  let executions = 0;
  const page = createPage({
    getTools: () => new Promise(resolve => { discover = resolve; }),
    executeTool() { executions++; }
  });
  page.run("webmcp.execute", { token: "cancelled", name: "search" });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(discover, "execution must first discover native tools");
  page.run("webmcp.callStatus", { token: "cancelled", abort: true });
  discover([{ name: "search", annotations: { readOnlyHint: true } }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(executions, 0);
  assert.equal(page.run("webmcp.callStatus", { token: "cancelled" }).status, "unknown");
});
