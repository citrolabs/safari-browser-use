import {
  copyFile,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildPlaywrightAriaSnapshot
} from "./build-playwright-aria-snapshot.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);
const templatePath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/jxa-server.template.js"
);
const pageRuntimePath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/page-runtime.mjs"
);
const safariVersionPath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/safari-version.mjs"
);
const toolDefinitionsPath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/tool-definitions.mjs"
);
const nativeInputPath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/native-input.mjs"
);
const googleAccountsPath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/google-accounts.mjs"
);
const googleDocsPath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/google-docs.mjs"
);
const googleSheetsPath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/google-sheets.mjs"
);
const googleWorkspaceEditorPath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/google-workspace-editor.mjs"
);
const controlLifecyclePath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/control-lifecycle.mjs"
);
const tabIdentityPath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/tab-identity.mjs"
);
const webmcpPagePath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/webmcp-page.mjs"
);
const documentationPath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/documentation.md"
);
const troubleshootingPath = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/server/src/documentation-troubleshooting.md"
);
const defaultOutfile = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/dist/safari-repl.jxa.js"
);
const defaultSkillOutfile = resolve(
  repositoryRoot,
  "skills/control-safari/scripts/runtime/safari-repl.jxa.js"
);
const pluginReferencesDirectory = resolve(
  repositoryRoot,
  "plugins/safari-browser-use/skills/control-safari/references"
);
const skillReferencesDirectory = resolve(
  repositoryRoot,
  "skills/control-safari/references"
);
const sharedReferenceNames = [
  "captcha.md",
  "google-accounts.md",
  "google-docs.md",
  "google-sheets.md"
];

export async function buildPlugin({
  outfile = defaultOutfile,
  skillOutfile
} = {}) {
  const [
    template,
    pageRuntime,
    playwrightAriaSnapshot,
    safariVersion,
    toolDefinitions,
    nativeInput,
    googleAccounts,
    googleDocs,
    googleSheets,
    googleWorkspaceEditor,
    controlLifecycle,
    tabIdentity,
    webmcpPage,
    documentation,
    troubleshooting
  ] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(pageRuntimePath, "utf8"),
    buildPlaywrightAriaSnapshot(),
    readFile(safariVersionPath, "utf8"),
    readFile(toolDefinitionsPath, "utf8"),
    readFile(nativeInputPath, "utf8"),
    readFile(googleAccountsPath, "utf8"),
    readFile(googleDocsPath, "utf8"),
    readFile(googleSheetsPath, "utf8"),
    readFile(googleWorkspaceEditorPath, "utf8"),
    readFile(controlLifecyclePath, "utf8"),
    readFile(tabIdentityPath, "utf8"),
    readFile(webmcpPagePath, "utf8"),
    readFile(documentationPath, "utf8"),
    readFile(troubleshootingPath, "utf8")
  ]);
  const withoutExports = source =>
    source.replace(/^export\s+/gm, "");
  const replacements = [
    ["/*__SBU_PAGE_RUNTIME__*/", withoutExports(pageRuntime)],
    [
      "/*__SBU_PLAYWRIGHT_ARIA_SNAPSHOT_SOURCE__*/",
      `var SBU_PLAYWRIGHT_ARIA_SNAPSHOT_SOURCE = ${
        JSON.stringify(playwrightAriaSnapshot)
      };`
    ],
    ["/*__SBU_SAFARI_VERSION__*/", withoutExports(safariVersion)],
    ["/*__SBU_TOOL_DEFINITIONS__*/", withoutExports(toolDefinitions)],
    ["/*__SBU_NATIVE_INPUT__*/", withoutExports(nativeInput)],
    ["/*__SBU_GOOGLE_ACCOUNTS__*/", withoutExports(googleAccounts)],
    ["/*__SBU_GOOGLE_DOCS__*/", withoutExports(googleDocs)],
    ["/*__SBU_GOOGLE_SHEETS__*/", withoutExports(googleSheets)],
    [
      "/*__SBU_GOOGLE_WORKSPACE_EDITOR__*/",
      withoutExports(googleWorkspaceEditor)
    ],
    ["/*__SBU_CONTROL_LIFECYCLE__*/", withoutExports(controlLifecycle)],
    ["/*__SBU_TAB_IDENTITY__*/", withoutExports(tabIdentity)],
    ["/*__SBU_WEBMCP_PAGE__*/", withoutExports(webmcpPage)],
    [
      "/*__SBU_DOCUMENTATION__*/",
      `var SBU_DOCUMENTATION_TEXT = ${JSON.stringify(documentation)};`
    ],
    [
      "/*__SBU_DOCUMENTATION_TROUBLESHOOTING__*/",
      `var SBU_DOCUMENTATION_TROUBLESHOOTING_TEXT = ${
        JSON.stringify(troubleshooting)
      };`
    ]
  ];
  const output = replacements.reduce(
    (source, [marker, replacement]) =>
      source.replace(marker, () => replacement),
    template
  );

  await mkdir(dirname(outfile), { recursive: true });
  await writeFile(outfile, output);

  if (skillOutfile) {
    await mkdir(dirname(skillOutfile), { recursive: true });
    await writeFile(skillOutfile, output);
  }
}

export async function buildDistribution() {
  await buildPlugin({
    outfile: defaultOutfile,
    skillOutfile: defaultSkillOutfile
  });
  await mkdir(skillReferencesDirectory, { recursive: true });

  await Promise.all(sharedReferenceNames.map(name =>
    copyFile(
      resolve(pluginReferencesDirectory, name),
      resolve(skillReferencesDirectory, name)
    )
  ));
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await buildDistribution();
}
