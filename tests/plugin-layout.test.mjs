import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../plugins/safari-browser-use/", import.meta.url);
const repositoryRoot = new URL("../", import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, pluginRoot), "utf8"));
}

async function readRepositoryJson(path) {
  return JSON.parse(await readFile(new URL(path, repositoryRoot), "utf8"));
}

test("all client manifests expose the shared skill and native MCP config", async () => {
  const manifests = [
    [".codex-plugin/plugin.json", "./.mcp.json"],
    [".claude-plugin/plugin.json", "./.mcp.json"],
    ["plugin.json", "./copilot.mcp.json"],
    [".cursor-plugin/plugin.json", "./cursor.mcp.json"]
  ];
  let sharedVersion;

  for (const [path, mcpServers] of manifests) {
    const manifest = await readJson(path);

    assert.equal(manifest.name, "safari-browser-use");
    assert.equal(manifest.version, "0.2.0");
    sharedVersion ??= manifest.version;
    assert.equal(manifest.version, sharedVersion);
    assert.equal(manifest.skills, "./skills/");
    assert.equal(manifest.mcpServers, mcpServers);
  }
});

test("Claude and Codex publish one MCP configuration source", async () => {
  const claudeManifest = await readJson(".claude-plugin/plugin.json");
  const codexManifest = await readJson(".codex-plugin/plugin.json");
  const configPaths = new Set(["./.mcp.json"]);
  configPaths.add(claudeManifest.mcpServers);
  configPaths.add(codexManifest.mcpServers);

  assert.deepEqual([...configPaths], ["./.mcp.json"]);
  for (const path of ["claude.mcp.json", "codex.mcp.json"]) {
    await assert.rejects(
      access(new URL(path, pluginRoot)),
      error => error.code === "ENOENT"
    );
  }
});

test("client MCP configurations start the bundled JXA server", async () => {
  const sharedLauncher = "plugin_root=$CLAUDE_PLUGIN_ROOT; if [ -z \"$plugin_root\" ]; then plugin_root=$PWD; fi; exec /usr/bin/osascript -l JavaScript \"$plugin_root/dist/safari-repl.jxa.js\"";
  const configurations = [
    {
      path: ".mcp.json",
      command: "sh",
      args: ["-c", sharedLauncher]
    },
    {
      path: "copilot.mcp.json",
      command: "/usr/bin/osascript",
      args: [
        "-l",
        "JavaScript",
        "${PLUGIN_ROOT}/dist/safari-repl.jxa.js"
      ]
    },
    {
      path: "cursor.mcp.json",
      command: "/usr/bin/osascript",
      args: [
        "-l",
        "JavaScript",
        "${CURSOR_PLUGIN_ROOT}/dist/safari-repl.jxa.js"
      ]
    }
  ];

  for (const { path, command, args } of configurations) {
    const config = await readJson(path);
    const servers = config.mcpServers ?? config.mcp_servers ?? config;
    const server = servers["safari-browser-use"];

    assert.equal(server.command, command);
    assert.deepEqual(server.args, args);
  }

  const codex = await readJson(".mcp.json");
  assert.equal(
    codex.mcpServers["safari-browser-use"].cwd,
    "."
  );

  const copilot = await readJson("copilot.mcp.json");
  assert.deepEqual(
    copilot.mcpServers["safari-browser-use"].tools,
    ["*"]
  );

  await access(new URL(
    "dist/safari-repl.jxa.js",
    pluginRoot
  ));
  await assert.rejects(
    access(new URL("dist/server.jxa.js", pluginRoot))
  );
});

test("the Claude marketplace publishes the shared plugin directory", async () => {
  const marketplace = await readRepositoryJson(
    ".claude-plugin/marketplace.json"
  );

  assert.equal(marketplace.name, "citrolabs");
  assert.match(marketplace.description, /Safari browser automation/);
  assert.deepEqual(marketplace.plugins.map(plugin => ({
    name: plugin.name,
    source: plugin.source
  })), [{
    name: "safari-browser-use",
    source: "./plugins/safari-browser-use"
  }]);
});

test("the Codex marketplace uses the public publisher name", async () => {
  const marketplace = await readRepositoryJson(
    ".agents/plugins/marketplace.json"
  );

  assert.equal(marketplace.name, "citrolabs");
  assert.equal(marketplace.interface.displayName, "CitroLabs");
});

test("GitHub Copilot and Cursor marketplaces publish the shared plugin directory", async () => {
  const copilot = await readRepositoryJson(
    ".github/plugin/marketplace.json"
  );
  assert.equal(copilot.name, "citrolabs");
  assert.deepEqual(copilot.plugins.map(plugin => ({
    name: plugin.name,
    source: plugin.source,
    version: plugin.version
  })), [{
    name: "safari-browser-use",
    source: "./plugins/safari-browser-use",
    version: "0.2.0"
  }]);

  const cursor = await readRepositoryJson(
    ".cursor-plugin/marketplace.json"
  );
  assert.equal(cursor.name, "citrolabs");
  assert.deepEqual(cursor.plugins.map(plugin => ({
    name: plugin.name,
    source: plugin.source
  })), [{
    name: "safari-browser-use",
    source: "./plugins/safari-browser-use"
  }]);
});

test("repository installation guide covers every supported client", async () => {
  const readme = await readFile(
    new URL("README.md", repositoryRoot),
    "utf8"
  );
  const pluginOption = readme.indexOf(
    "### 1. Plugin — one-line prompt"
  );
  const skillOption = readme.indexOf(
    "### 2. Skill — one-line command"
  );

  assert.ok(pluginOption >= 0);
  assert.ok(skillOption > pluginOption);
  assert.match(readme, /GitHub Copilot/);
  assert.match(
    readme,
    /codex plugin marketplace add citrolabs\/safari-browser-use/
  );
  assert.match(
    readme,
    /codex plugin add safari-browser-use@citrolabs/
  );
  assert.match(
    readme,
    /claude plugin marketplace add citrolabs\/safari-browser-use/
  );
  assert.match(
    readme,
    /claude plugin install safari-browser-use@citrolabs/
  );
  assert.match(
    readme,
    /copilot plugin install citrolabs\/safari-browser-use:plugins\/safari-browser-use/
  );
  assert.match(readme, /Cursor/);
  assert.match(readme, /\.cursor\/plugins\/local/);
  assert.match(
    readme,
    /npx skills add citrolabs\/safari-browser-use --skill control-safari -g/
  );
  assert.match(
    readme,
    /agents that do not support plugins/i
  );
  assert.match(readme, /Skill-only/i);
  assert.doesNotMatch(readme, /\bPi\b/);
  assert.doesNotMatch(readme, /\bpi install\b/);
  assert.match(readme, /using the current client's plugin installer/);
  assert.match(readme, /Stop after installation/);
  assert.match(readme, /give me one example request/);
  assert.match(readme, /Allow JavaScript from Apple Events/);
  assert.match(readme, /does not\s+require Node\.js/i);
  assert.doesNotMatch(readme, /safari-browser-use@personal/);
  assert.doesNotMatch(readme, /plugin marketplace add "\$PWD"/);
  assert.doesNotMatch(readme, /Only install the plugin|native plugin system/);
  assert.doesNotMatch(readme, /then connect it to Safari/);
  assert.doesNotMatch(readme, /if setup or connection fails/);
  assert.doesNotMatch(readme, /npm ci|npm run build/);
  assert.doesNotMatch(readme, /\bawait\b/);
  assert.doesNotMatch(
    readme,
    /xcodeproj|signing team|Safari Settings > Extensions/i
  );

  await assert.rejects(
    access(new URL("README.md", pluginRoot)),
    error => error.code === "ENOENT"
  );
});

test("skill uses Apple Events without an extension bridge", async () => {
  const skill = await readFile(
    new URL("skills/control-safari/SKILL.md", pluginRoot),
    "utf8"
  );

  assert.match(skill, /Apple Events/);
  assert.match(skill, /synchronous/i);
  assert.match(skill, /browser\.release\(\)/);
  assert.match(skill, /control indicator/i);
  assert.match(skill, /do not fall back/i);
  assert.doesNotMatch(skill, /\bawait\b/);
  assert.doesNotMatch(skill, /bridge|Safari extension/i);
});

test("runtime guide only selects a user tab when explicitly requested", async () => {
  const guide = await readFile(
    new URL(
      "server/src/documentation.md",
      pluginRoot
    ),
    "utf8"
  );

  assert.match(guide, /browser\.tabs\.list\(\)/);
  assert.match(
    guide,
    /Only use `browser\.tabs\.selected\(\)`.*explicitly asks.*current tab/is
  );
  assert.match(guide, /Do not inspect an unrelated current tab/i);
  assert.doesNotMatch(
    guide,
    /current tab or provides no target/i
  );
});

test("runtime guide creates task-owned tabs instead of reusing user tabs by default", async () => {
  const guide = await readFile(
    new URL(
      "server/src/documentation.md",
      pluginRoot
    ),
    "utf8"
  );

  assert.match(guide, /new task-owned tab.*by default/is);
  assert.match(
    guide,
    /do not reuse.*user.*tab.*unless the user explicitly asks/is
  );
  assert.match(
    guide,
    /different (?:websites|sites).*separate\s+task-owned tabs/is
  );
  assert.match(
    guide,
    /same (?:website|site).*same task-owned tab/is
  );
  assert.doesNotMatch(
    guide,
    /Prefer operating an already-open tab/
  );
});

test("Codex prompts create a task tab unless reuse is explicitly requested", async () => {
  const agent = await readFile(
    new URL(
      "skills/control-safari/agents/openai.yaml",
      pluginRoot
    ),
    "utf8"
  );
  const manifest = await readJson(".codex-plugin/plugin.json");

  assert.match(agent, /new task tab by default/i);
  assert.match(agent, /only reuse.*when I explicitly request/i);
  assert.match(
    manifest.interface.defaultPrompt,
    /new task tab by default/i
  );
  assert.match(
    manifest.interface.defaultPrompt,
    /only reuse.*when I explicitly request/i
  );
});

test("skill bootstrap defers operating guidance to runtime documentation", async () => {
  const skill = await readFile(
    new URL("skills/control-safari/SKILL.md", pluginRoot),
    "utf8"
  );

  assert.match(skill, /browser\.doctor\(\)/);
  assert.match(skill, /browser\.documentation\(\)/);
  assert.match(skill, /generated by the running server/i);
  assert.doesNotMatch(skill, /## Snapshot Discipline/);
  assert.doesNotMatch(skill, /Hard Constraints For Playwright/);
});

test("runtime guide is the source of truth for operating rules", async () => {
  const guide = await readFile(
    new URL("server/src/documentation.md", pluginRoot),
    "utf8"
  );

  assert.match(guide, /returned at runtime by `browser\.documentation\(\)`/);
  assert.match(guide, /## Browser Safety/);
  assert.match(guide, /untrusted content/i);
  assert.match(guide, /### Snapshot Discipline/);
  assert.match(guide, /### Hard Constraints For Playwright/);
  assert.match(guide, /perimeter glow/i);
  assert.match(guide, /(?:fake|visible) cursor/i);
});

test("runtime guide documents how to release the active tab", async () => {
  const guide = await readFile(
    new URL("server/src/documentation.md", pluginRoot),
    "utf8"
  );

  assert.match(guide, /browser\.release\(\)/);
  assert.match(guide, /control indicator/i);
});

test("navigation docs prefer state waits and stable tab recovery", async () => {
  const guide = await readFile(
    new URL("server/src/documentation.md", pluginRoot),
    "utf8"
  );

  assert.match(guide, /waitForURL/);
  assert.match(guide, /waitForLoadState/);
  assert.match(guide, /stale_tab_handle/);
  assert.match(guide, /href.*localized text/is);
  assert.match(guide, /automatically reacquire/i);
  assert.match(
    guide,
    /same browser\s+call.*restore.*control indicator/is
  );
});

test("runtime guide documents bounded virtualized-list collection", async () => {
  const guide = await readFile(
    new URL("server/src/documentation.md", pluginRoot),
    "utf8"
  );

  assert.match(guide, /virtualized/i);
  assert.match(guide, /scrollIntoView/);
  assert.match(guide, /scrollBy/);
  assert.match(guide, /allRecords/);
  assert.match(guide, /three consecutive/i);
  assert.doesNotMatch(guide, /press\(["'](?:End|PageDown|Space|Tab)/);
  assert.match(guide, /allAttributes/);
  assert.match(guide, /synthetic/i);
});

test("runtime guide prevents unmanaged file chooser dialogs", async () => {
  const guide = await readFile(
    new URL("server/src/documentation.md", pluginRoot),
    "utf8"
  );

  assert.match(guide, /uploadFiles/);
  assert.match(
    guide,
    /never click.*upload.*before.*uploadFiles/is
  );
  assert.match(guide, /dynamic.*file input/is);
  assert.match(guide, /system file chooser/i);
});

test("control indicator docs describe only the page overlay", async () => {
  const documents = await Promise.all([
    readFile(new URL("README.md", repositoryRoot), "utf8"),
    readFile(
      new URL("skills/control-safari/SKILL.md", pluginRoot),
      "utf8"
    ),
    readFile(
      new URL("server/src/documentation.md", pluginRoot),
      "utf8"
    )
  ]);

  for (const document of documents) {
    assert.match(document, /perimeter glow/i);
    assert.match(document, /(?:fake|visible) cursor/i);
    assert.doesNotMatch(document, /favicon/i);
    assert.doesNotMatch(document, /compact Safari\s+tabs/i);
  }
});

test("control indicator inactivity lease is 60 seconds", async () => {
  const [template, pageRuntime, ...documents] = await Promise.all([
    readFile(
      new URL("server/src/jxa-server.template.js", pluginRoot),
      "utf8"
    ),
    readFile(
      new URL("server/src/page-runtime.mjs", pluginRoot),
      "utf8"
    ),
    readFile(new URL("README.md", repositoryRoot), "utf8"),
    readFile(
      new URL("server/src/documentation.md", pluginRoot),
      "utf8"
    ),
    readFile(
      new URL(
        "server/src/documentation-troubleshooting.md",
        pluginRoot
      ),
      "utf8"
    )
  ]);

  assert.equal((template.match(/leaseMs: 60000/g) || []).length, 3);
  assert.doesNotMatch(template, /leaseMs: 45000/);
  assert.match(pageRuntime, /: 60_000;/);
  assert.doesNotMatch(pageRuntime, /: 45_000;/);

  for (const document of documents) {
    assert.match(document, /60 seconds|60-second/);
    assert.doesNotMatch(document, /45 seconds|45-second/);
  }
});

test("static reference docs are removed in favor of runtime documentation", async () => {
  const removed = [
    "skills/control-safari/references/runtime-api.md",
    "skills/control-safari/references/troubleshooting.md",
    "skills/control-safari/references/safety.md"
  ];

  for (const relativePath of removed) {
    await assert.rejects(
      access(new URL(relativePath, pluginRoot)),
      /ENOENT/,
      `${relativePath} should be folded into the runtime documentation`
    );
  }
});

test("troubleshooting is a runtime documentation topic source", async () => {
  const topic = await readFile(
    new URL("server/src/documentation-troubleshooting.md", pluginRoot),
    "utf8"
  );

  assert.match(topic, /browser\.documentation\("troubleshooting"\)/);
  assert.match(topic, /Automation Is Unavailable/i);
  assert.match(topic, /Allow JavaScript from Apple Events/);
  assert.match(topic, /browser\.release\(\)/);
});

test("repository quick start describes a zero-dependency synchronous REPL", async () => {
  const readme = await readFile(
    new URL("README.md", repositoryRoot),
    "utf8"
  );

  assert.match(readme, /does not require Node\.js/i);
  assert.match(readme, /synchronous/i);
  assert.match(readme, /using the current client's plugin installer/);
  assert.match(readme, /Stop after installation/);
  assert.match(readme, /give me one example request/);
  assert.doesNotMatch(readme, /Only install the plugin|native plugin system/);
  assert.doesNotMatch(readme, /then connect it to Safari/);
  assert.doesNotMatch(readme, /if setup or connection fails/);
  assert.doesNotMatch(readme, /\bawait\b/);
});

test("ships without a Safari app or Web Extension", async () => {
  await assert.rejects(
    access(new URL("safari/", pluginRoot)),
    error => error.code === "ENOENT"
  );

  const packageJson = await readRepositoryJson("package.json");
  assert.deepEqual(packageJson.dependencies ?? {}, {});
});

test("runtime guide documents native WebMCP without API conversion", async () => {
  const documentation = await readFile(
    new URL(
      "../plugins/safari-browser-use/server/src/documentation.md",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(documentation, /## Native WebMCP/);
  assert.match(documentation, /document\.modelContext\.getTools\(\)/);
  assert.match(documentation, /document\.modelContext\.executeTool\(\)/);
  assert.match(documentation, /tab\.webmcp\.pageTools\(\)/);
  assert.match(documentation, /tab\.webmcp\.callTool\(/);
  assert.match(documentation, /available: false, tools: \[\]/);
  assert.match(documentation, /\{ confirmed: true \}/);
  assert.match(documentation, /untrusted web content/);
  assert.doesNotMatch(documentation, /browser\.webmcp\.|tab\.webmcp\.(?:record|probe|suggest|describe|status|stop)\(/);
  assert.doesNotMatch(documentation, /# webmcp:|web__<site>|learns those APIs automatically/);
});
