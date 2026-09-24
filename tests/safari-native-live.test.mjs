import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execute = promisify(execFile);

// Opt in separately: native input activates a test window and moves the mouse.
test("real Safari trusted mouse input", {
  skip: process.env.SAFARI_NATIVE_LIVE_TEST !== "1"
}, async t => {
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(request.url === "/result"
      ? `<title>Native result</title><h1>Trusted navigation complete</h1>
        <button onclick="document.querySelector('output').textContent='continued'">Continue</button><output>ready</output>`
      : `<!doctype html><title>Native input fixture</title><h1>Native input fixture</h1>
        <canvas id="board" width="480" height="180" aria-label="Native input canvas"></canvas>
        <output>ready</output><script>
          const board=document.getElementById('board'), context=board.getContext('2d');
          context.fillStyle='#c8f5d6';context.fillRect(0,0,480,180);
          context.fillStyle='#123';context.fillText('Click left to verify input; right to navigate',20,90);
          const events=[];
          for(const type of ['pointerdown','pointerup','click'])board.addEventListener(type,event=>{
            events.push({type,trusted:event.isTrusted});
            document.querySelector('output').textContent=JSON.stringify(events);
            if(type==='click'&&event.isTrusted&&event.offsetX>240)location.href='/result';
          });
        </script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: "safari-native-regression", version: "1.0.0" });
  let windowId;
  t.after(async () => {
    await client.callTool({ name: "js", arguments: {
      title: "Release native test control", code: "browser.release()"
    } }).catch(() => {});
    await client.close();
    if (windowId) {
      // The public API protects selected tabs from closing. Teardown owns only
      // this new window; preserve it if the user has added an unrelated page.
      await execute("/usr/bin/osascript", ["-l", "JavaScript", "-e", `
        var windows=Application('Safari').windows();
        for(var i=0;i<windows.length;i++)if(Number(windows[i].id())===${windowId}){
          var tabs=windows[i].tabs();
          if(tabs.every(function(tab){return String(tab.url()||'').indexOf(${JSON.stringify(url + "/")})===0;}))windows[i].close();
        }
      `]);
    }
    await new Promise(resolve => server.close(resolve));
  });
  await client.connect(new StdioClientTransport({
    command: "/usr/bin/osascript",
    args: ["-l", "JavaScript", process.env.MCP_ENTRYPOINT || fileURLToPath(new URL(
      "../plugins/safari-browser-use/dist/safari-repl.jxa.js", import.meta.url
    ))],
    stderr: "pipe"
  }));
  async function cell(code) {
    const result = await client.callTool({ name: "js", arguments: {
      title: "Verify native Safari input", code
    } });
    if (result.isError) throw new Error(result.content.map(part => part.text || "").join("\n"));
    return result.structuredContent.value;
  }
  const doctor = await cell("browser.doctor()");
  assert.equal(doctor.ready, true);
  t.diagnostic(JSON.stringify(doctor));
  await cell("browser.documentation()");
  const created = await execute("/usr/bin/osascript", ["-l", "JavaScript", "-e",
    "var safari=Application('Safari');safari.Document().make();Number(safari.windows()[0].id());"
  ]);
  windowId = Number(created.stdout.trim());
  assert.ok(Number.isSafeInteger(windowId) && windowId > 0);
  await cell(`var fixture=browser.tabs.get('${windowId}:1');fixture.goto(${JSON.stringify(url + "/")});fixture.playwright.waitForLoadState()`);

  await t.test("synthetic input is distinguishable from trusted input", async () => {
    await cell("var picture=fixture.playwright.canvasSnapshot('#board');var point=picture.source.viewport;fixture.playwright.clickAt(point.x+120,point.y+90)");
    const events = JSON.parse(await cell("fixture.playwright.locator('output').innerText()"));
    assert.ok(events.length > 0);
    assert.ok(events.every(event => event.trusted === false));
  });
  await t.test("native input delivers trusted pointer down, up and click", async () => {
    await cell(`fixture.goto(${JSON.stringify(url + "/")});fixture.playwright.waitForLoadState()`);
    await cell("picture=fixture.playwright.canvasSnapshot('#board');point=picture.source.viewport;fixture.playwright.nativeClickAt(point.x+120,point.y+90)");
    const events = JSON.parse(await cell("fixture.playwright.locator('output').innerText()"));
    assert.deepEqual(events, [
      { type: "pointerdown", trusted: true },
      { type: "pointerup", trusted: true },
      { type: "click", trusted: true }
    ]);
  });
  await t.test("the same handle continues after trusted navigation", async () => {
    await cell("picture=fixture.playwright.canvasSnapshot('#board');point=picture.source.viewport;fixture.playwright.nativeClickAt(point.x+360,point.y+90)");
    const snapshot = await cell("fixture.playwright.waitForURL('/result');fixture.playwright.waitForLoadState();fixture.playwright.domSnapshot()");
    assert.match(snapshot, /Trusted navigation complete/);
    await cell("fixture.playwright.getByRole('button',{name:'Continue',exact:true}).click()");
    assert.equal(await cell("fixture.playwright.locator('output').innerText()"), "continued");
  });
});
