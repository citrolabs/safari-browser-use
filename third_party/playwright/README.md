# Playwright ARIA snapshot sources

This directory contains the readable subset of Microsoft Playwright 1.62.1
used by `playwright.domSnapshot`. The files remain subject to the Apache
License 2.0 in this directory.

## Layout

- `packages/` contains the copied Playwright source files.
- `safari-browser-use-entry.ts` exposes the browser-side `snapshot` function
  and the same role, accessible-name, and hidden-state helpers used by locators.
- `tsconfig.json` resolves Playwright's internal imports during bundling.
- `../../scripts/build-playwright-aria-snapshot.mjs` creates the in-memory
  browser bundle consumed by the main plugin build and tests.

No generated snapshot bundle is committed. This keeps review focused on the
source that actually defines the behavior.

## Safari Browser Use changes

Changes are marked with `Safari Browser Use:` comments in
`packages/injected/src/ariaSnapshot.ts`:

- retain `data-testid` values as YAML node properties;
- recursively include same-origin iframe documents available to Safari page
  JavaScript.

When updating Playwright, replace the copied files from the exact release,
reapply the marked changes, and run `npm test`.
