# Development and validation

The [macOS 27 validation record](macos27-validation.md) documents the tested
environment, real browser scenarios, performance sample and remaining limits.

Install development dependencies with `npm ci`, then run `npm test` for the
unit, packaging, and MCP transport tests. To rebuild both distributions and
run the real Safari regression suite on macOS:

```sh
npm run test:safari
```

For an explicitly authorized foreground test, run `npm run test:safari:native`.
This requires Accessibility permission, opens its own Safari window, moves the
mouse, and verifies trusted pointer down/up/click delivery and navigation through
the same tab handle. It distinguishes synthetic input from trusted input and
closes its test window afterward. Avoid moving the mouse during this short test.

The runtime supports macOS 27 / Safari 27 through the same JXA REPL and Apple
Events path. `browser.doctor()` reports `runtimeVersion`, `macosVersion`,
`safariVersion`, `safariVersionStatus`, and `ready`. An unverified future version
does not disable automation; missing Automation or webpage JavaScript does.
Safari 26 compatibility remains covered by the existing version tests.

These commands validate the workspace builds; they do not update a previously
installed plugin cache.

For a public-site check, use SauceDemo's published demo account to log in, sort
by price, add one item, verify checkout validation, cancel, remove the item, and
log out. Check the resulting UI after every action. Wikipedia can also exercise
search and language menus, but Safari may pause animation-frame-based widget
initialization in background tabs. Treat an unresponsive menu as an incomplete
scenario. When foreground testing is authorized, compare the same action in a
foreground task tab before counting it as passed.

The Safari suite uses a temporary localhost server and its own background tabs.
It covers snapshot-to-action flows, tab-handle invalidation, removed learning
controls, and JSON loading through fetch and XMLHttpRequest without automatic
WebMCP conversion or extra HTTP requests. Native WebMCP
execution runs only when Safari provides the native interface; it is explicitly
skipped otherwise. Unit tests use native API test doubles for discovery,
execution, confirmation, and cancellation; they do not install a browser polyfill.
Server bridge tests also cover the JSON boundary, timeouts, and cancellation
after a failed result read, including prevention of delayed native execution.
They exercise lost dispatch replies, delayed background timers, an unreachable
cancellation path, and expiry of unread results using a controlled clock.
The Safari suite also covers
Chinese Enter submission, cancelled and invalid submissions, delegated language
menus, chained HTTP redirects, and a canonical URL update after a URL wait has
already returned. The canonicalization fixture holds a request until the test
releases it, so this timing regression does not depend on a fixed sleep.
An additional two-tab scenario verifies that a delayed URL change keeps the
original document even while a sibling retains its previous URL.
Another closes an earlier tab and verifies that two identical sibling pages
keep separate handles after Safari renumbers them. It repeats the closure from
a second independent MCP session, then verifies that externally closed handles
cannot adopt either a same-URL sibling or an unrelated URL-wait destination.
It closes its tabs and releases browser control afterward. Safari's Automation permissions must
already be enabled; no signed-in website or real credentials are needed.

For a targeted unit-test run:

```sh
node --test tests/webmcp-native.test.mjs tests/webmcp-server.test.mjs tests/playwright-aria-snapshot.test.mjs tests/background-tabs.test.mjs
```

The live suite is skipped by default. Its subtests use one shared Safari
session and run in order. To test another built entrypoint, set `MCP_ENTRYPOINT`
to its absolute path and run `SAFARI_LIVE_TEST=1 node --test tests/safari-live.test.mjs`.
Set `SAFARI_LIVE_TRACE` to a local JSONL path to record the individual REPL cells
and responses when investigating a real-browser failure.
