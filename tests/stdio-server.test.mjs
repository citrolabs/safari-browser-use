import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";

test("starts from the Codex plugin manifest", async t => {
  const pluginRoot = new URL("../plugins/safari-browser-use/", import.meta.url);
  const manifest = JSON.parse(await readFile(
    new URL(".codex-plugin/plugin.json", pluginRoot),
    "utf8"
  ));
  const config = JSON.parse(await readFile(
    new URL(manifest.mcpServers, pluginRoot),
    "utf8"
  ));
  const servers = config.mcpServers ?? config.mcp_servers ?? config;
  const server = servers["safari-browser-use"];
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: fileURLToPath(pluginRoot),
    stderr: "pipe"
  });
  const client = new Client({
    name: "safari-browser-use-codex-config-test",
    version: "0.1.0"
  });

  t.after(async () => {
    await client.close();
  });

  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map(tool => tool.name),
    ["js", "js_reset"]
  );
});

test("starts the real MCP entrypoint over stdio", async t => {
  const entrypoint = process.env.MCP_ENTRYPOINT ?? fileURLToPath(new URL(
    "../plugins/safari-browser-use/dist/safari-repl.jxa.js",
    import.meta.url
  ));
  const transport = new StdioClientTransport({
    command: "/usr/bin/osascript",
    args: ["-l", "JavaScript", entrypoint],
    stderr: "pipe"
  });
  const client = new Client({
    name: "safari-browser-use-stdio-test",
    version: "0.1.0"
  });

  t.after(async () => {
    await client.close();
  });

  await client.connect(transport);

  const tools = await client.listTools();
  const first = await client.callTool({
    name: "js",
    arguments: {
      title: "Create a persistent value",
      code: "var answer = 42; answer"
    }
  });
  const second = await client.callTool({
    name: "js",
    arguments: {
      title: "Reuse the persistent value",
      code: "({ answer, browserType: typeof browser, releaseType: typeof browser.release })"
    }
  });

  assert.deepEqual(
    tools.tools.map(tool => tool.name),
    ["js", "js_reset"]
  );
  assert.equal(first.structuredContent.value, 42);
  assert.deepEqual(second.structuredContent.value, {
    answer: 42,
    browserType: "object",
    releaseType: "function"
  });
});

test("captures output and resets persistent JXA bindings", async t => {
  const entrypoint = fileURLToPath(new URL(
    "../plugins/safari-browser-use/dist/safari-repl.jxa.js",
    import.meta.url
  ));
  const transport = new StdioClientTransport({
    command: "/usr/bin/osascript",
    args: ["-l", "JavaScript", entrypoint],
    stderr: "pipe"
  });
  const client = new Client({
    name: "safari-browser-use-reset-test",
    version: "0.1.0"
  });

  t.after(async () => {
    await client.close();
  });

  await client.connect(transport);

  const first = await client.callTool({
    name: "js",
    arguments: {
      title: "Log and save",
      code: "console.log('tab', 7); var temporary = 5; temporary"
    }
  });
  await client.callTool({
    name: "js_reset",
    arguments: {}
  });
  const afterReset = await client.callTool({
    name: "js",
    arguments: {
      title: "Read cleared value",
      code: "temporary"
    }
  });

  assert.deepEqual(first.structuredContent, {
    value: 5,
    output: ["tab 7"]
  });
  assert.equal(afterReset.isError, true);
  assert.match(afterReset.content[0].text, /temporary/);
});

test("returns the operating guide at runtime over stdio", async t => {
  const entrypoint = fileURLToPath(new URL(
    "../plugins/safari-browser-use/dist/safari-repl.jxa.js",
    import.meta.url
  ));
  const transport = new StdioClientTransport({
    command: "/usr/bin/osascript",
    args: ["-l", "JavaScript", entrypoint],
    stderr: "pipe"
  });
  const client = new Client({
    name: "safari-browser-use-documentation-test",
    version: "0.1.0"
  });

  t.after(async () => {
    await client.close();
  });

  await client.connect(transport);

  const instructions = client.getInstructions();
  assert.match(instructions, /browser\.documentation\(\)/);
  assert.match(instructions, /untrusted content/i);
  assert.match(instructions, /new task-owned tab/i);
  assert.match(instructions, /explicitly asks.*reuse/i);

  const guide = await client.callTool({
    name: "js",
    arguments: {
      title: "Read the operating guide",
      code: "browser.documentation()"
    }
  });

  const text = guide.structuredContent.value;
  assert.match(text, /operating guide returned at runtime/);
  assert.match(text, /Safari Browser Use — Operating Guide/);
  assert.match(text, /Browser Safety/);
  assert.match(text, /Snapshot Discipline/);

  const troubleshooting = await client.callTool({
    name: "js",
    arguments: {
      title: "Read the troubleshooting topic",
      code: "browser.documentation(\"troubleshooting\")"
    }
  });

  const troubleshootingText = troubleshooting.structuredContent.value;
  assert.match(troubleshootingText, /Troubleshooting/);
  assert.match(troubleshootingText, /Automation Is Unavailable/i);
  assert.doesNotMatch(
    troubleshootingText,
    /Safari Browser Use — Operating Guide/
  );

  const unknownTopic = await client.callTool({
    name: "js",
    arguments: {
      title: "Request an unknown documentation topic",
      code: "browser.documentation(\"nope\")"
    }
  });

  assert.equal(unknownTopic.isError, true);
  const unknownText = unknownTopic.content
    .map((part) => part.text || "")
    .join("\n");
  assert.match(unknownText, /Unknown documentation topic/);
  assert.match(unknownText, /troubleshooting/);
});

test("exposes only REPL tools without API learning controls", async t => {
  const entrypoint = process.env.MCP_ENTRYPOINT ?? fileURLToPath(new URL(
    "../plugins/safari-browser-use/dist/safari-repl.jxa.js",
    import.meta.url
  ));
  const transport = new StdioClientTransport({
    command: "/usr/bin/osascript",
    args: ["-l", "JavaScript", entrypoint],
    stderr: "pipe"
  });
  const client = new Client({
    name: "safari-browser-use-webmcp-test",
    version: "0.1.0"
  });

  t.after(async () => {
    await client.close();
  });

  await client.connect(transport);

  assert.notEqual(client.getServerCapabilities()?.tools?.listChanged, true);

  const before = await client.listTools();
  assert.deepEqual(before.tools.map(tool => tool.name), ["js", "js_reset"]);

  const api = await client.callTool({
    name: "js",
    arguments: {
      title: "Verify removed API learning controls",
      code: "typeof browser.webmcp"
    }
  });
  assert.equal(api.structuredContent.value, "undefined");
});
