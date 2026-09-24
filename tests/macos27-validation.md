# macOS 27 validation — 0.2.0

Validated on September 25, 2026 with macOS 27.0 (26A428), Safari 27.0
(22625.1.29.11.27), and Apple Silicon. Browser tasks used the project's JXA
runtime through fresh MCP clients. No official Safari MCP server was used.

## Changes verified

- Safari 27 uses the persistent JavaScript REPL and Apple Events path. Future
  versions are unverified rather than rejected solely by their version number.
- `browser.doctor()` reports runtime, macOS and Safari versions and probes
  Automation and webpage JavaScript access.
- A verified tab handle follows its document after tab renumbering. It rejects
  a closed document instead of adopting a same-URL replacement or another tab
  that happens to match a URL wait.
- Navigation, redirects and history changes preserve the intended document and
  restore the control indicator.
- Native coordinates come from the Safari window's bounds. Safari Apple Events
  IDs are not Core Graphics window IDs. Native clicks post mouse events and
  require a visible, matching Accessibility window before sending input.
- API recording, learning, probing and HTTP-to-WebMCP conversion are removed.
  Native WebMCP discovery and execution remain optional.

## Automated and manual browser checks

See [the testing guide](README.md) for commands and opt-in requirements.

| Check | Result |
| --- | --- |
| `npm test` | 281 passed, 0 failed; the two opt-in live suites skipped by default |
| Background Safari regression suite | 30 scenarios passed; one native WebMCP scenario skipped |
| Foreground native Safari suite | All three scenarios passed again after the window-visibility guard was added |
| Independent-session tab closure | Correct document recovered after renumbering; closed handles rejected |
| Chinese forms, validation, checkbox cancellation, roles, hidden controls, shadow DOM, same-origin frames | Passed |
| Fetch and XMLHttpRequest on a page without native WebMCP | No converted tools; exactly the two requested JSON requests |
| SauceDemo shopping intent | Login, price sort, add/cart, empty checkout validation, cancel, remove, logout passed |
| Wikipedia research intent | Chinese search and Enter navigation to the Shanghai article passed |
| Local file intent | UTF-8 sample upload and resulting filename/content verified |
| Canvas intent | Snapshot, synthetic click and drag verified |
| Trusted input intent | Pointer down, pointer up and click verified as trusted; navigation and continued use of the same handle passed |

The native click failure was reproduced in an isolated test window before
replacing System Events' accessibility click with mouse-event delivery. The
regression distinguishes synthetic input from trusted input and verifies the
page result, rather than accepting a successful dispatch response alone.

Concurrent user browsing changed tab indexes during the first public-site run.
The shopping task was inspected again before continuing. The complete background
suite subsequently passed, including deliberate closure by a second MCP client.
Fullscreen video or a Safari dialog can cover a script-selected window; the
native path now stops with `native_click_target_not_frontmost` in that situation.

## Limits of this validation

- This Safari installation does not expose the native WebMCP discovery/execution
  interface. Positive live execution is explicitly skipped; native API test
  doubles cover discovery, confirmation, cancellation, timeouts and late results.
- Wikipedia's language menu did not finish the tested task while foreground
  browsing was concurrent. It is not counted as a passed scenario. Background
  widget initialization and actual foreground visibility need to be checked
  before attributing this to the locator or to Safari compatibility.
- Safari 26 and future-version decisions have regression coverage; this machine
  was not a Safari 26 test environment.

## Small performance comparison

Five samples per operation on the same Safari 27 installation. The baseline
locally bypassed the former version gate and preceded document-identity
verification. Values are medians in milliseconds, including MCP round trips.

| Operation | Baseline | Document verification |
| --- | ---: | ---: |
| Snapshot | 974 | 1042 |
| Fill and read | 1949 | 2083 |
| Click and read | 4900 | 5017 |

Document verification added approximately 2–7% in this small sample. These
measurements compare revisions of this plugin and do not establish performance
against Apple's MCP server.
