import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Opt in: this suite opens and closes its own background tabs in real Safari.
test("real Safari interaction regressions", {
  skip: process.env.SAFARI_LIVE_TEST !== "1"
}, async t => {
  let feedRequests = 0;
  let canonicalResponse;
  let historyPageId = 0;
  const historyResponses = new Map();
  const items = [
    { id: 1, title: "Review item alpha" },
    { id: 2, title: "Review item beta" },
    { id: 3, title: "Review item gamma" }
  ];
  const server = http.createServer(async (request, response) => {
    if (request.url.startsWith("/history-change?")) {
      historyResponses.set(new URL(request.url, "http://localhost").searchParams.get("id"), response);
      return;
    }
    if (request.url === "/history-page") {
      const id = String(++historyPageId);
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(`<title>History page ${id}</title><h1>Page ${id}</h1>
        <button onclick="document.querySelector('output').textContent='marked ${id}'">Mark document</button>
        <output>unchanged ${id}</output>
        <script>fetch('/history-change?id=${id}').then(() => history.replaceState(null,'','/history-final'));</script>`);
      return;
    }
    if (request.url === "/canonicalize") {
      canonicalResponse = response;
      return;
    }
    if (request.url.startsWith("/redirect/")) {
      response.writeHead(302, {
        Location: request.url === "/redirect/start" ? "/redirect/middle" : "/next"
      });
      response.end();
      return;
    }
    if (request.url === "/canonical") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<title>Canonical article</title><h1>上海市</h1><output>original URL</output>
        <script>fetch('/canonicalize').then(() => {
          history.replaceState(null, '', '/canonical-final');
          document.querySelector('output').textContent='canonical URL';
        });</script>`);
      return;
    }
    if (request.url.startsWith("/submitted?")) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      const search = new URL(request.url, "http://localhost").searchParams;
      response.end(`<title>Search submitted</title><h1>${search.get("q")}</h1><output>${search.get("action")}</output>`);
      return;
    }
    if (request.url === "/api/feed") {
      feedRequests++;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ items }));
      return;
    }
    if (request.url === "/native") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Origin-Agent-Cluster", "?1");
      response.end(`<title>Native WebMCP fixture</title><output>Checking native support</output>
        <script>
          const context = document.modelContext;
          const status = document.querySelector('output');
          if (context && typeof context.registerTool === 'function' &&
              typeof context.getTools === 'function' && typeof context.executeTool === 'function') {
            context.registerTool({
              name: 'fixture_search', description: 'Search local test articles',
              inputSchema: {type:'object',properties:{query:{type:'string'}},required:['query']},
              annotations: {readOnlyHint:true},
              execute: async args => ({query:args.query,items:${JSON.stringify(items)}})
            }, {exposedTo:[location.origin]}).then(() => {
              status.textContent = 'Native tool ready';
            }).catch(error => {status.textContent = 'Native registration failed: ' + error.message;});
          } else {
            status.textContent = 'Native WebMCP unavailable';
          }
        </script>`);
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(request.url === "/next"
      ? `<title>Next</title><h1>Navigation successful</h1>
        <button onclick="document.querySelector('output').textContent='changed'">Mark tab</button><output>unchanged</output>`
      : `<!doctype html><title>Safari regression fixture</title>
        <label>Normal<input aria-label="Normal" value="original" oninput="document.querySelector('output').textContent=this.value"></label>
        <label>Read only<input aria-label="Read only" readonly value="locked"></label>
        <label>Disabled<input aria-label="Disabled" disabled value="locked"></label>
        <fieldset disabled><legend><input aria-label="Legend"></legend><input aria-label="Inherited disabled" value="locked"></fieldset>
        <button disabled>Disabled button</button>
        <input type="checkbox" aria-label="Check me" onclick="document.querySelector('output').textContent='checkbox clicked'">
        <input type="checkbox" aria-label="Cancelled" onclick="event.preventDefault()">
        <input type="number" aria-label="Quantity" value="2">
        <input type="search" aria-label="Search products">
        <form action="/submitted">
          <input type="search" aria-label="Submit search" name="q" required>
          <button name="action" value="search">Submit query</button>
        </form>
        <form onsubmit="event.preventDefault();this.dataset.count=Number(this.dataset.count||0)+1;document.querySelector('output').textContent='JS submissions '+this.dataset.count">
          <input aria-label="JS search" onkeydown="if(event.key==='Enter'){event.preventDefault();this.form.requestSubmit()}">
          <button>JS submit</button>
        </form>
        <input type="checkbox" role="button" aria-label="Language menu" id="language-toggle">
        <div id="language-menu" hidden><a href="/next">English</a></div>
        <div hidden><button>Duplicate action</button></div>
        <button onclick="document.querySelector('output').textContent='visible action clicked'">Duplicate action</button>
        <div id="shadow-host"></div>
        <iframe srcdoc="<button onclick=&quot;parent.document.querySelector('output').textContent='frame clicked'&quot;>Frame action</button>"></iframe>
        <button onclick="fetch('/api/feed').then(r=>r.json()).then(()=>document.querySelector('output').textContent='API ready')">Load API feed</button>
        <button onclick="const request=new XMLHttpRequest();request.open('GET','/api/feed');request.onload=()=>document.querySelector('output').textContent='XHR ready';request.send()">Load XHR feed</button>
        <a href="/next">Next page</a><output>ready</output>
        <script>
          const shadow = document.querySelector('#shadow-host').attachShadow({mode:'open'});
          shadow.innerHTML = '<button>Shadow action</button>';
          shadow.querySelector('button').onclick = () => document.querySelector('output').textContent='shadow clicked';
          document.addEventListener('click', event => {
            if (event.target.id === 'language-toggle') {
              event.preventDefault();
              document.querySelector('#language-menu').hidden=false;
            }
          });
        </script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: "safari-live-regressions", version: "1.0.0" });
  const external = new Client({ name: "safari-external-tab-actions", version: "1.0.0" });
  t.after(async () => {
    try {
      await cell("try { if (typeof secondTwin !== 'undefined') secondTwin.close(); } finally { try { if (typeof twin !== 'undefined' && !twinClosed) twin.close(); } finally { try { if (typeof fixture !== 'undefined' && !fixtureClosed) fixture.close(); } finally { browser.release(); } } }");
    } finally {
      canonicalResponse?.end();
      for (const response of historyResponses.values()) response.end();
      await client.close();
      await external.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
  const transportOptions = {
    command: "/usr/bin/osascript",
    args: ["-l", "JavaScript", process.env.MCP_ENTRYPOINT || fileURLToPath(new URL(
      "../plugins/safari-browser-use/dist/safari-repl.jxa.js", import.meta.url
    ))],
    stderr: "pipe"
  };
  await client.connect(new StdioClientTransport(transportOptions));
  await external.connect(new StdioClientTransport(transportOptions));
  async function cell(code, session = client) {
    const result = await session.callTool({ name: "js", arguments: {
      title: "Run local Safari regression", code
    } });
    if (process.env.SAFARI_LIVE_TRACE) {
      appendFileSync(process.env.SAFARI_LIVE_TRACE, JSON.stringify({ code, result }) + "\n");
    }
    if (result.isError) throw new Error(result.content.map(part => part.text || "").join("\n"));
    return result.structuredContent.value;
  }
  const doctor = await cell("browser.doctor()");
  assert.equal(doctor.ready, true);
  assert.equal(doctor.safariSupported, true);
  assert.equal(doctor.automationAvailable, true);
  assert.equal(doctor.javascriptFromAppleEvents, true);
  t.diagnostic(JSON.stringify(doctor));
  await cell("browser.documentation()");
  assert.equal((await cell("browser.doctor()", external)).ready, true);
  await cell("browser.documentation()", external);
  const snapshot = await cell(`var fixtureClosed=false; var twinClosed=false; var fixture=browser.tabs.new(); fixture.goto(${JSON.stringify(url)}); fixture.playwright.domSnapshot()`);
  assert.match(snapshot, /textbox "Read only"/);
  assert.match(snapshot, /status: ready/);

  await t.test("removed API learning controls are absent from the live REPL", async () => {
    const controls = await cell("[typeof browser.webmcp].concat(['record','stop','status','probe','suggest','describe'].map(function(name){return typeof fixture.webmcp[name]}))");
    assert.deepEqual(controls, Array(7).fill("undefined"));
  });
  await t.test("normal Chinese input still works", async () => {
    const snapshot = await cell("fixture.playwright.getByRole('textbox',{name:'Normal',exact:true}).fill('hello 中文'); fixture.playwright.domSnapshot()");
    assert.match(snapshot, /status: hello 中文/);
  });
  for (const name of ["Read only", "Disabled"]) {
    await t.test(`rejects filling ${name}`, async () => {
      await assert.rejects(cell(`fixture.playwright.getByRole('textbox',{name:${JSON.stringify(name)},exact:true}).fill('changed')`), /element_(?:readonly|disabled)/);
      assert.match(await cell("fixture.playwright.domSnapshot()"), new RegExp(`textbox "${name}".*: locked`));
    });
  }
  // Happy DOM does not implement inherited :disabled; verify it in Safari.
  await t.test("inherited disability and legend exception", async () => {
    assert.equal(await cell("fixture.playwright.getByRole('textbox',{name:'Inherited disabled',exact:true}).isEnabled()"), false);
    assert.equal(await cell("fixture.playwright.getByRole('textbox',{name:'Legend',exact:true}).isEnabled()"), true);
  });
  await t.test("disabled button reports failure", async () => {
    await assert.rejects(cell("fixture.playwright.getByRole('button',{name:'Disabled button',exact:true}).click()"), /element_disabled/);
    await cell("fixture.playwright.domSnapshot()");
  });
  await t.test("snapshot status can be located", async () => {
    assert.equal(await cell("fixture.playwright.getByRole('status').count()"), 1);
  });
  await t.test("checkbox activates business handler", async () => {
    const snapshot = await cell("fixture.playwright.getByRole('checkbox',{name:'Check me',exact:true}).check(); fixture.playwright.domSnapshot()");
    assert.match(snapshot, /status: checkbox clicked/);
  });
  await t.test("cancelled checkbox reports failure", async () => {
    await assert.rejects(cell("fixture.playwright.getByRole('checkbox',{name:'Cancelled',exact:true}).check()"), /checked_state_not_changed/);
    await cell("fixture.playwright.domSnapshot()");
  });
  for (const [name, expected] of [
    ["Shadow action", "shadow clicked"],
    ["Frame action", "frame clicked"],
    ["Duplicate action", "visible action clicked"]
  ]) {
    await t.test(`snapshot-to-click round trip for ${name}`, async () => {
      const before = await cell("fixture.playwright.domSnapshot()");
      assert.equal((before.match(new RegExp(`button "${name}"`, "g")) || []).length, 1);
      const locator = `fixture.playwright.getByRole('button',{name:${JSON.stringify(name)},exact:true})`;
      assert.equal(await cell(`${locator}.count()`), 1);
      const after = await cell(`${locator}.click(); fixture.playwright.domSnapshot()`);
      assert.match(after, new RegExp(`status: ${expected}`));
    });
  }
  for (const [role, name, value] of [
    ["spinbutton", "Quantity", "42"],
    ["searchbox", "Search products", "上海"]
  ]) {
    await t.test(`snapshot-to-fill round trip for ${role}`, async () => {
      assert.match(await cell("fixture.playwright.domSnapshot()"), new RegExp(`${role} "${name}"`));
      const after = await cell(`fixture.playwright.getByRole(${JSON.stringify(role)},{name:${JSON.stringify(name)},exact:true}).fill(${JSON.stringify(value)}); fixture.playwright.domSnapshot()`);
      assert.match(after, new RegExp(`${role} "${name}":.*${value}`));
    });
  }
  await t.test("checkbox-role language menu reaches a delegated click handler", async () => {
    const snapshot = await cell("fixture.playwright.getByRole('button',{name:'Language menu',exact:true}).click(); fixture.playwright.domSnapshot()");
    assert.match(snapshot, /link "English"/);
  });
  await t.test("Enter keeps native form validation", async () => {
    await cell("fixture.playwright.getByRole('searchbox',{name:'Submit search',exact:true}).press('Enter')");
    assert.equal(await cell("fixture.url()"), url + "/");
  });
  await t.test("Enter does not duplicate a JavaScript-managed submission", async () => {
    const snapshot = await cell("fixture.playwright.getByRole('textbox',{name:'JS search',exact:true}).fill('上海'); fixture.playwright.getByRole('textbox',{name:'JS search',exact:true}).press('Enter'); fixture.playwright.domSnapshot()");
    assert.match(snapshot, /status: JS submissions 1/);
  });
  await t.test("loading JSON does not create tools or send extra HTTP requests", async () => {
    const snapshot = await cell("fixture.playwright.getByRole('button',{name:'Load API feed',exact:true}).click(); fixture.playwright.getByText('API ready',{exact:true}).waitFor({state:'visible'}); fixture.playwright.domSnapshot()");
    assert.doesNotMatch(snapshot, /# webmcp:/);
    const native = await cell("fixture.webmcp.pageTools()");
    assert.equal(typeof native.available, "boolean");
    assert.deepEqual(native.tools, []);
    assert.deepEqual(await cell("fixture.webmcp.listTools()"), []);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), ["js", "js_reset"]);
    await assert.rejects(cell("fixture.webmcp.callTool('get_api_feed')"), /webmcp_(?:unavailable|unknown_tool)/);
    assert.equal(feedRequests, 1);
    t.diagnostic(`Native WebMCP available: ${native.available}; JSON feed requests: ${feedRequests}`);
  });
  await t.test("XMLHttpRequest stays ordinary HTTP without learned tools", async () => {
    await cell("fixture.playwright.domSnapshot(); fixture.playwright.getByRole('button',{name:'Load XHR feed',exact:true}).click(); fixture.playwright.getByText('XHR ready',{exact:true}).waitFor({state:'visible'})");
    assert.deepEqual(await cell("fixture.webmcp.listTools()"), []);
    assert.doesNotMatch(await cell("fixture.playwright.domSnapshot()"), /# webmcp:/);
    assert.equal(feedRequests, 2, "fetch and XHR each issue only their original request");
  });
  await t.test("executes a site's tool only through actual native WebMCP", async t => {
    try {
      await cell(`fixture.goto(${JSON.stringify(url + "/native")}); fixture.playwright.waitForLoadState(); fixture.playwright.domSnapshot()`);
      const native = await cell("fixture.webmcp.pageTools()");
      if (!native.available) {
        assert.deepEqual(native.tools, []);
        assert.match(await cell("fixture.playwright.domSnapshot()"), /Native WebMCP unavailable/);
        t.skip("Safari does not provide the native WebMCP interface");
        return;
      }
      await cell("fixture.playwright.getByText('Native tool ready',{exact:true}).waitFor({state:'visible'})");
      const tools = await cell("fixture.webmcp.listTools()");
      assert.ok(tools.some(tool => tool.name === "fixture_search"));
      const result = await cell("fixture.webmcp.callTool('fixture_search',{query:'上海'})");
      assert.deepEqual(JSON.parse(result), { query: "上海", items });
    } finally {
      await cell(`fixture.goto(${JSON.stringify(url)}); fixture.playwright.domSnapshot()`);
    }
  });
  await t.test("navigation and waits still work", async () => {
    await cell("fixture.playwright.waitForLoadState()");
    const snapshot = await cell(`fixture.playwright.getByRole('link',{name:'Next page',exact:true}).click(); fixture.playwright.waitForURL(${JSON.stringify(url + "/next")},{exact:true}); fixture.playwright.waitForLoadState(); fixture.playwright.domSnapshot()`);
    assert.match(snapshot, /Navigation successful/);
  });
  await t.test("Enter submits Chinese search through the default button", async () => {
    await cell(`fixture.goto(${JSON.stringify(url)}); fixture.playwright.domSnapshot()`);
    const snapshot = await cell("fixture.playwright.getByRole('searchbox',{name:'Submit search',exact:true}).fill('上海'); fixture.playwright.getByRole('searchbox',{name:'Submit search',exact:true}).press('Enter'); fixture.playwright.waitForURL('/submitted?'); fixture.playwright.waitForLoadState(); fixture.playwright.domSnapshot()");
    assert.match(snapshot, /heading "上海"/);
    assert.match(snapshot, /status: search/);
  });
  await t.test("same handle follows chained HTTP redirects", async () => {
    const snapshot = await cell(`fixture.goto(${JSON.stringify(url + "/redirect/start")}); fixture.playwright.waitForURL(${JSON.stringify(url + "/next")},{exact:true}); fixture.playwright.waitForLoadState(); fixture.playwright.domSnapshot()`);
    assert.match(snapshot, /Navigation successful/);
  });
  await t.test("same handle survives canonicalization after URL wait returns", async () => {
    await cell(`fixture.goto(${JSON.stringify(url + "/canonical")}); fixture.playwright.waitForURL(${JSON.stringify(url + "/canonical")},{exact:true})`);
    assert.ok(canonicalResponse, "page has armed its canonicalization request");
    canonicalResponse.end();
    const snapshot = await cell("fixture.playwright.waitForLoadState(); fixture.playwright.domSnapshot()");
    assert.match(snapshot, /status: canonical URL/);
    assert.equal(await cell("fixture.url()"), url + "/canonical-final");
    await cell(`fixture.goto(${JSON.stringify(url + "/next")})`);
  });
  await t.test("a late URL change keeps the original document beside an identical sibling", async () => {
    let originalId;
    try {
      await cell(`fixture.goto(${JSON.stringify(url + "/history-page")}); fixture.playwright.waitForLoadState(); fixture.playwright.domSnapshot(); var historyTwin=browser.tabs.new(); historyTwin.goto(${JSON.stringify(url + "/history-page")}); historyTwin.playwright.waitForLoadState()`);
      assert.equal(historyResponses.size, 2);
      originalId = await cell("fixture.id");
      historyResponses.get("1").end();
      let changed = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        // Safari can defer a background fetch completion until page script runs.
        await cell("fixture.playwright.domSnapshot()");
        const urlNow = await cell(`browser.tabs.list().filter(function(tab){return tab.id === ${JSON.stringify(originalId)}})[0].url`);
        if (urlNow === url + "/history-final") { changed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(changed, true, "the original document must have changed its URL");
      const snapshot = await cell("fixture.playwright.domSnapshot()");
      assert.match(snapshot, /heading "Page 1"/);
      assert.equal(await cell("fixture.id"), originalId);
      await cell("fixture.playwright.getByRole('button',{name:'Mark document',exact:true}).click()");
      assert.match(await cell("fixture.playwright.domSnapshot()"), /status: marked 1/);
      assert.match(await cell("historyTwin.playwright.domSnapshot()"), /status: unchanged 2/);
    } finally {
      // Reacquire the test-owned coordinate for cleanup if the old resolver rebound it.
      if (originalId) await cell(`fixture=browser.tabs.get(${JSON.stringify(originalId)})`);
      await cell("if (typeof historyTwin !== 'undefined') historyTwin.close()");
      for (const response of historyResponses.values()) response.end();
      await cell(`fixture.goto(${JSON.stringify(url + "/next")})`);
    }
  });
  for (const externally of [false, true]) {
    await t.test(`${externally ? "externally " : ""}closing an earlier tab preserves two identical sibling handles`, async () => {
      let firstId;
      let secondId;
      let spacerClosed = false;
      const shifted = id => id.replace(/\d+$/, index => String(Number(index) - 1));
      try {
        await cell(`var indexSpacer=browser.tabs.new(); var indexFirst=browser.tabs.new(); indexFirst.goto(${JSON.stringify(url + "/next")}); indexFirst.playwright.waitForLoadState(); var indexSecond=browser.tabs.new(); indexSecond.goto(${JSON.stringify(url + "/next")}); indexSecond.playwright.waitForLoadState()`);
        [firstId, secondId] = await cell("[indexFirst.id,indexSecond.id]");
        const spacerId = await cell("indexSpacer.id");
        await cell(externally ? `browser.tabs.get(${JSON.stringify(spacerId)}).close()` : "indexSpacer.close()", externally ? external : client);
        spacerClosed = true;
        await cell("indexFirst.playwright.getByRole('button',{name:'Mark tab',exact:true}).click()");
        assert.match(await cell("indexSecond.playwright.domSnapshot()"), /status: unchanged/);
        assert.match(await cell("indexFirst.playwright.domSnapshot()"), /status: changed/);
        assert.equal(await cell("indexFirst.id"), shifted(firstId));
        assert.equal(await cell("indexSecond.id"), shifted(secondId));
      } finally {
        // The known test-owned coordinates let cleanup survive a wrong rebind.
        for (const id of [secondId, firstId].filter(Boolean)) {
          await cell(`browser.tabs.get(${JSON.stringify(spacerClosed ? shifted(id) : id)}).close()`, external);
        }
        if (!spacerClosed) await cell("if (typeof indexSpacer !== 'undefined') indexSpacer.close()");
      }
    });
  }
  for (const sameUrl of [false, true]) {
    await t.test(`externally closed handle rejects a ${sameUrl ? "same-URL" : "destination-URL"} sibling`, async () => {
      let survivorId;
      try {
        const ids = await cell(`var externalTarget=browser.tabs.new(); externalTarget.goto(${JSON.stringify(url + "/next")}); externalTarget.playwright.waitForLoadState(); var externalSibling=browser.tabs.new(); externalSibling.goto(${JSON.stringify(url + (sameUrl ? "/next" : "/canonical-final"))}); externalSibling.playwright.waitForLoadState(); [externalTarget.id,externalSibling.id]`);
        await cell(`browser.tabs.get(${JSON.stringify(ids[0])}).close()`, external);
        survivorId = ids[1].replace(/\d+$/, index => String(Number(index) - 1));
        await assert.rejects(cell("externalTarget.playwright.domSnapshot()"), /stale_tab_handle/);
        await assert.rejects(cell(`externalTarget.playwright.waitForURL(${JSON.stringify(url + (sameUrl ? "/next" : "/canonical-final"))},{exact:true,timeoutMs:100})`), /stale_tab_handle/);
        assert.equal(await cell(`browser.tabs.get(${JSON.stringify(survivorId)}).url()`, external), url + (sameUrl ? "/next" : "/canonical-final"));
      } finally {
        if (survivorId) await cell(`browser.tabs.get(${JSON.stringify(survivorId)}).close()`, external);
      }
    });
  }
  await t.test("closed handle cannot bind to identical sibling", async () => {
    await cell(`var twin=browser.tabs.new(); twin.goto(${JSON.stringify(url + "/next")}); fixture.close(); fixtureClosed=true`);
    await assert.rejects(cell("fixture.url()"), /stale_tab_handle/);
    await assert.rejects(cell(`fixture.playwright.waitForURL(${JSON.stringify(url + "/next")},{exact:true,timeoutMs:100})`), /stale_tab_handle/);
    assert.equal(await cell("twin.url()"), url + "/next");
  });
  await t.test("closing a second wrapper also invalidates the original handle", async () => {
    await cell(`var secondTwin=browser.tabs.new(); secondTwin.goto(${JSON.stringify(url + "/next")}); twin.playwright.domSnapshot(); var twinAlias=browser.tabs.get(twin.id); twinAlias.close(); twinClosed=true`);
    await assert.rejects(cell("twin.url()"), /stale_tab_handle/);
    await assert.rejects(cell("twin.playwright.getByRole('button',{name:'Mark tab',exact:true}).click()"), /stale_tab_handle/);
    await assert.rejects(cell(`twin.playwright.waitForURL(${JSON.stringify(url + "/next")},{exact:true,timeoutMs:100})`), /stale_tab_handle/);
    assert.match(await cell("secondTwin.playwright.domSnapshot()"), /status: unchanged/);
  });
  assert.equal(feedRequests, 2, "later navigation must not probe or replay the JSON API");
  t.diagnostic(`Final JSON feed requests: ${feedRequests} (one fetch and one XHR)`);
});
