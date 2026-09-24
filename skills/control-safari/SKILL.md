---
name: control-safari
description: Control the user's existing Safari session through a persistent script-driven JavaScript REPL. Use for inspecting, navigating, clicking, filling, selecting, uploading, or verifying webpages in Safari when an MCP/plugin transport is unavailable.
---

# Control Safari

Use only the bundled script runtime. Do not look for or call MCP tools from this
Skill. Every command returns JSON on stdout and is synchronous from the agent's
perspective.

## Start

Start one isolated session and keep its `sessionId` for every later command:

```bash
node {baseDir}/scripts/safari-repl.mjs start
```

Check Safari, then read and follow the complete operating guide:

```bash
node {baseDir}/scripts/safari-repl.mjs doctor --session SESSION_ID
node {baseDir}/scripts/safari-repl.mjs documentation --session SESSION_ID
```

Stop if the doctor reports `ready: false`. Safari 27 on macOS 27 uses this same
runtime. An `unverified` Safari version status alone does not stop automation;
follow the Automation and JavaScript from Apple Events capability results.

## Run

Run short cells directly:

```bash
node {baseDir}/scripts/safari-repl.mjs run \
  --session SESSION_ID \
  --title "Inspect the task tab" \
  --code 'var tabs = browser.tabs.list(); tabs'
```

For multiline or quote-heavy JavaScript, write it to a temporary file and use
`--code-file`:

```bash
node {baseDir}/scripts/safari-repl.mjs run \
  --session SESSION_ID \
  --title "Operate the page" \
  --code-file /absolute/path/to/cell.js
```

Bindings declared with `var` persist within the same session. Never reuse a
`sessionId` from another task. Image-producing cells return local paths in the
`images` array; inspect those files with the current agent's image-reading tool.

Use a new task-owned Safari tab by default. Use separate task-owned tabs for
different websites, and reuse a user tab only when the user explicitly requests
it. Follow all confirmation and safety rules returned by `documentation`.

Read these references only when applicable:

- CAPTCHA or human verification: [references/captcha.md](references/captcha.md)
- Google account choice: [references/google-accounts.md](references/google-accounts.md)
- Google Docs: [references/google-docs.md](references/google-docs.md)
- Google Sheets: [references/google-sheets.md](references/google-sheets.md)

## Reset and cleanup

Reset bindings only when a clean REPL is required:

```bash
node {baseDir}/scripts/safari-repl.mjs reset --session SESSION_ID
```

Before every final response, including failures, release the control indicator
and stop the session:

```bash
node {baseDir}/scripts/safari-repl.mjs release --session SESSION_ID
node {baseDir}/scripts/safari-repl.mjs stop --session SESSION_ID
```

Do not leave the background session running and do not mix this script transport
with an MCP transport in the same browser task.
