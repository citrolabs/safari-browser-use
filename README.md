<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=220&section=header&text=Safari%20Browser%20Use&fontSize=52&fontColor=ffffff&animation=fadeIn&fontAlignY=38&desc=Native%20Safari%20Automation%20for%20AI%20Agents&descAlignY=60&descSize=18" width="100%" alt="Safari Browser Use"/>

**Control your existing Safari tabs with a persistent JavaScript REPL, including on macOS 27.**

[![Version](https://img.shields.io/badge/Version-0.2.0-6C63FF?style=for-the-badge)](https://github.com/citrolabs/safari-browser-use)
[![macOS](https://img.shields.io/badge/macOS-Required-000000?style=for-the-badge&logo=apple&logoColor=white)](https://www.apple.com/macos/)
[![Safari](https://img.shields.io/badge/Safari-26%20%7C%2027-006CFF?style=for-the-badge&logo=safari&logoColor=white)](https://www.apple.com/safari/)
[![License: MIT](https://img.shields.io/badge/License-MIT-00C4CC?style=for-the-badge)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/citrolabs/safari-browser-use?style=for-the-badge&logo=github&color=FFD700)](https://github.com/citrolabs/safari-browser-use/stargazers)
[![GitHub followers](https://img.shields.io/github/followers/citrolabs?style=for-the-badge&logo=github&color=181717)](https://github.com/citrolabs)
</div>

## Overview

Safari Browser Use gives **AI agents such as Codex, Claude Code, GitHub Copilot,
Cursor, Kiro, CodeBuddy, WorkBuddy, and Qoder** safe, visible control of the
Safari tabs you already have open. It preserves your current sessions and logins
while exposing a synchronous JavaScript REPL and a Playwright-style browser API.

It connects through the Apple Events support built into macOS.
Plugin mode does not require Node.js, npm, a Safari extension, a companion app,
Xcode, or an Apple Developer certificate. The Skill-only mode uses the Node.js
runtime available to the agent to preserve its script session between calls.

> [!NOTE]
> **macOS 27 and Safari 27 support:** The same persistent JavaScript REPL and
> Apple Events runtime runs on Safari 27. Safari 26 and earlier retain their
> existing compatibility. `browser.doctor()` checks Automation and webpage
> JavaScript access and reports the macOS, Safari, and runtime versions.
> Future Safari versions are marked unverified and use these same capability
> checks. Browser control always uses this plugin's JavaScript runtime.

## Demo

<p align="center">
  <img src="plugins/safari-browser-use/assets/safari-browser-use-demo.png" width="100%" alt="Safari Browser Use controlling an existing Safari tab with a visible perimeter glow and fake cursor"/>
</p>

<p align="center"><em>An AI agent inspecting an existing Safari tab with the visible control indicator enabled.</em></p>

## Installation

### 1. Plugin — one-line prompt with client routing

Paste this one-line prompt into a supported agent. It names the concrete route
for each client, so the agent must not assume that every client has the same
plugin installer:

```text
Install Safari Browser Use from https://github.com/citrolabs/safari-browser-use using the current client's plugin installer when supported: use `codex plugin marketplace add` then `codex plugin add` for Codex, `claude plugin marketplace add` then `claude plugin install` for Claude Code, `copilot plugin install citrolabs/safari-browser-use:plugins/safari-browser-use` for GitHub Copilot CLI, `codebuddy plugin marketplace add` then `codebuddy plugin install` for CodeBuddy or WorkBuddy, `qoder plugins marketplace add` then `qoder plugins install safari-browser-use` for Qoder, import this GitHub repository as an Agent Plugin/Power through Kiro's Add Custom Power flow for Kiro, and use the documented local checkout for Cursor; verify the result instead of claiming success. Stop after installation, then tell me whether to reload plugins or start a new session and give me one example request.
```

This is one routing prompt, not one universal shell command. Kiro requires a
user-visible Power import, and Cursor currently uses the local checkout below;
the agent must report those steps rather than claim that a background install
already happened.

### 2. Skill — one-line command

For agents that do not support plugins, install the standalone `control-safari`
Skill:

```sh
npx skills add citrolabs/safari-browser-use --skill control-safari -g
```

Select the target agent when prompted, then start a new agent session. This
installs the script-driven Skill without the MCP plugin.

### Manual plugin commands

<details>
<summary><strong>Codex</strong></summary>

```sh
codex plugin marketplace add citrolabs/safari-browser-use
codex plugin add safari-browser-use@citrolabs
```

Start a new Codex task after installation.

</details>

<details>
<summary><strong>Claude Code</strong></summary>

```sh
claude plugin marketplace add citrolabs/safari-browser-use --scope user
claude plugin install safari-browser-use@citrolabs --scope user
```

Run `/reload-plugins` after installation.

</details>

<details>
<summary><strong>GitHub Copilot CLI</strong></summary>

```sh
copilot plugin install citrolabs/safari-browser-use:plugins/safari-browser-use
```

Start a new Copilot CLI session after installation.

</details>

<details>
<summary><strong>CodeBuddy / WorkBuddy</strong></summary>

```sh
codebuddy plugin marketplace add citrolabs/safari-browser-use
codebuddy plugin install safari-browser-use@citrolabs
```

Run `/reload-plugins` after installation.

</details>

<details>
<summary><strong>Qoder</strong></summary>

```sh
qoder plugins marketplace add citrolabs/safari-browser-use
qoder plugins install safari-browser-use
```

Run `/plugins reload` or start a new Qoder CLI session after installation.

</details>

<details>
<summary><strong>Kiro</strong></summary>

Kiro loads the root Agent Plugins package as a Power. In **Kiro → Powers → Add
Custom Power**, choose **Import power from GitHub** and enter:

```text
https://github.com/citrolabs/safari-browser-use
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Until the plugin is available in Cursor Marketplace, install it from a local
checkout:

```sh
git clone --depth 1 https://github.com/citrolabs/safari-browser-use.git
mkdir -p "$HOME/.cursor/plugins/local"
cp -R safari-browser-use/plugins/safari-browser-use "$HOME/.cursor/plugins/local/"
```

Restart Cursor after installation.

</details>

## First-Time Setup

Before using browser automation, enable JavaScript from Apple Events in Safari.
Safari Browser Use cannot inspect or interact with web pages while this setting
is disabled.

1. Open **Safari Settings → Advanced**, then enable
   **Show features for web developers**.

<p align="center">
  <img src="plugins/safari-browser-use/assets/safari-setting-1.png" width="820" alt="Enable Show features for web developers in Safari Advanced settings"/>
</p>

2. Open **Safari Settings → Developer → Automation**, then enable
   **Allow JavaScript from Apple Events**.

<p align="center">
  <img src="plugins/safari-browser-use/assets/safari-setting-2.png" width="820" alt="Enable Allow JavaScript from Apple Events in Safari Developer settings"/>
</p>

Safari also asks for macOS Automation permission the first time the plugin
controls it. Approve that request only when you intend to let the current
client automate Safari.

## Quick Start

Open Safari, then ask your agent:

> Use Safari Browser Use to inspect my current Safari tab and summarize the
> page. Do not click or type anything.

The agent checks the connection, selects the active tab, and reads a structured
DOM snapshot. Variables persist between JavaScript cells until the transport
session is reset.

Selecting or operating a tab adds a non-interactive perimeter glow and visible
fake cursor to the controlled page. They share one control lifecycle: both are
removed with `browser.release()` when the task ends and clear automatically
after 60 seconds without tab activity. Navigation-capable operations restore
the indicator in the new page before the same browser call returns.

## Highlights

| Feature | What it provides |
| --- | --- |
| 🌐 Existing Safari session | Work with your open tabs, cookies, and signed-in state |
| ⚡ Persistent synchronous REPL | Reuse variables and browser state across tool calls |
| 🎭 Playwright-style API | Locate elements by role, label, text, test ID, or attribute |
| 📡 Native WebMCP | Discover and call tools through the browser's native WebMCP interface when available; unsupported pages continue through DOM automation without API recording or conversion |
| ✨ Visible control indicator | See a perimeter glow and fake cursor while AI control is active |
| 🔌 Plugin and Skill-only modes | Use native plugins or the standalone Agent Skill |
| 🛡️ Deliberate interactions | Inspect first, target unique elements, and verify every action |

## Safety

Safari Browser Use can inspect and interact with pages through your existing
browser session. Consequential actions—such as sending a message, submitting a
form, making a purchase, changing account settings, or deleting data—require
clear user authorization.

The control glow makes active automation visible, while `browser.release()`,
REPL reset, server shutdown, and the inactivity lease ensure that control does
not remain attached indefinitely.

## Support

Found a bug or have an idea? Open an
[issue](https://github.com/citrolabs/safari-browser-use/issues) or explore
more projects from [CitroLabs](https://github.com/citrolabs).

For development setup and regression commands, see the
[testing guide](tests/README.md).

<div align="center">

**Built for humans who want AI agents to work with the browser they already use.**

</div>

## License

Safari Browser Use is available under the [MIT License](LICENSE).
