import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import {
  runPageOperation
} from "../plugins/safari-browser-use/server/src/page-runtime.mjs";
import {
  buildPlaywrightAriaSnapshot
} from "../scripts/build-playwright-aria-snapshot.mjs";

const snapshotBundle = await buildPlaywrightAriaSnapshot();

test("builds a compact browser injection payload", () => {
  assert.ok(
    snapshotBundle.length < 70_000,
    `expected less than 70000 bytes, got ${snapshotBundle.length}`
  );
});

function createSnapshotPage(html) {
  const window = new Window({ url: "https://example.com/form" });
  window.document.documentElement.style.visibility = "visible";
  window.document.body.innerHTML = html;
  window.eval(
    snapshotBundle +
      "\nwindow.__sbuAriaSnapshot = " +
      "SBUPlaywrightAriaSnapshot;"
  );
  const dependencies = {
    ...window.__sbuAriaSnapshot,
    ariaSnapshot: window.__sbuAriaSnapshot.snapshot
  };
  delete window.__sbuAriaSnapshot;

  return {
    window,
    execute(method, params = {}) {
      return runPageOperation(window.document, window, method, params, dependencies);
    },
    snapshot(params = {}) {
      return runPageOperation(
        window.document,
        window,
        "playwright.domSnapshot",
        params,
        dependencies
      );
    }
  };
}

test("returns a Playwright-style YAML snapshot", () => {
  const page = createSnapshotPage(`
    <label for="email">Email address</label>
    <input id="email">
    <button>Continue</button>
  `);

  assert.equal(
    page.snapshot(),
    [
      "- text: Email address",
      '- textbox "Email address"',
      '- button "Continue"'
    ].join("\n")
  );
});

test("renders stable locator metadata as YAML properties", () => {
  const page = createSnapshotPage(`
    <section data-testid="product-card">
      <a href="/buy" data-testid="buy-link">Buy now</a>
    </section>
  `);

  assert.equal(
    page.snapshot(),
    [
      "- generic:",
      "  - /data-testid: product-card",
      '  - link "Buy now":',
      "    - /url: /buy",
      "    - /data-testid: buy-link"
    ].join("\n")
  );
});

test("scopes a DOM snapshot to one strict locator", () => {
  const page = createSnapshotPage(`
    <nav><a href="/home">Home</a></nav>
    <main data-testid="results">
      <h1>Products</h1>
      <button>Buy</button>
    </main>
  `);

  assert.equal(
    page.snapshot({
      locator: [{ type: "testId", testId: "results" }]
    }),
    [
      "- main:",
      "  - /data-testid: results",
      '  - heading "Products" [level=1]',
      '  - button "Buy"'
    ].join("\n")
  );
});

test("renders semantic hierarchy, values, and states", () => {
  const page = createSnapshotPage(`
    <main>
      <h1>Checkout</h1>
      <ul aria-label="Steps">
        <li>Address</li>
        <li>Payment</li>
      </ul>
      <input aria-label="Email" value="ada@example.com">
      <label><input type="checkbox" checked>Remember me</label>
      <button disabled>Pay</button>
    </main>
  `);

  assert.equal(
    page.snapshot(),
    [
      "- main:",
      '  - heading "Checkout" [level=1]',
      '  - list "Steps":',
      "    - listitem: Address",
      "    - listitem: Payment",
      '  - textbox "Email": ada@example.com',
      '  - checkbox "Remember me" [checked]',
      "  - text: Remember me",
      '  - button "Pay" [disabled]'
    ].join("\n")
  );
});

test("excludes hidden and collapsed content", () => {
  const page = createSnapshotPage(`
    <div style="display: none"><button>CSS hidden</button></div>
    <div aria-hidden="true"><button>ARIA hidden</button></div>
    <details>
      <summary>Summary</summary>
      <button>Collapsed action</button>
    </details>
    <button>Visible</button>
  `);

  assert.equal(
    page.snapshot(),
    ["- group: Summary", '- button "Visible"'].join("\n")
  );
});

test("walks open shadow roots and slots", () => {
  const page = createSnapshotPage(`
    <div id="host">Projected action</div>
  `);
  const host = page.window.document.querySelector("#host");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <nav aria-label="Primary">
      <button><slot></slot></button>
    </nav>
  `;
  Object.defineProperty(host.firstChild, "assignedSlot", {
    value: shadow.querySelector("slot")
  });

  assert.equal(
    page.snapshot(),
    [
      '- navigation "Primary":',
      '  - button "Projected action"'
    ].join("\n")
  );
});

test("includes same-origin iframe content", () => {
  const page = createSnapshotPage(`
    <iframe srcdoc="<h2>Frame title</h2><button>Frame action</button>">
    </iframe>
  `);
  page.window.document.querySelector("iframe")
    .contentDocument.documentElement.style.visibility = "visible";

  assert.equal(
    page.snapshot(),
    [
      "- iframe:",
      '  - heading "Frame title" [level=2]',
      '  - button "Frame action"'
    ].join("\n")
  );
});

for (const kind of ["shadow", "iframe"]) {
  test(`locates and clicks a ${kind} button shown in the snapshot`, async t => {
    const page = createSnapshotPage('<div id="host"></div><iframe></iframe>');
    t.after(() => page.window.happyDOM.abort());
    const root = kind === "shadow"
      ? page.window.document.querySelector("#host").attachShadow({ mode: "open" })
      : page.window.document.querySelector("iframe").contentDocument.body;
    root.innerHTML = '<button>Nested action</button>';
    root.ownerDocument.documentElement.style.visibility = "visible";
    let clicks = 0;
    root.querySelector("button").addEventListener("click", () => clicks++);
    const scope = kind === "shadow" ? "#host" : "iframe";
    const locator = [
      { type: "css", selector: scope },
      { type: "role", role: "button", name: "Nested action", exact: true }
    ];

    assert.match(page.snapshot(), /button "Nested action"/);
    assert.equal(page.execute("playwright.locator.count", { locator }), 1);
    page.execute("playwright.locator.click", { locator });
    assert.equal(clicks, 1);
    assert.equal(page.execute("playwright.locator.count", {
      locator: [{ type: "css", selector: scope }, { type: "css", selector: "button" }]
    }), 1);
  });
}

for (const [type, role] of [["number", "spinbutton"], ["search", "searchbox"]]) {
  test(`fills a native ${type} input using the role shown in its snapshot`, async t => {
    const page = createSnapshotPage(`<input type="${type}" aria-label="Value">`);
    t.after(() => page.window.happyDOM.abort());
    const locator = [{ type: "role", role, name: "Value", exact: true }];

    assert.match(page.snapshot(), new RegExp(`${role} "Value"`));
    page.execute("playwright.locator.fill", { locator, value: "42" });
    assert.equal(page.window.document.querySelector("input").value, "42");
    assert.match(page.snapshot(), /42/);
  });
}

for (const hidden of ['style="display:none"', 'aria-hidden="true"']) {
  test(`ignores a duplicate action inside a ${hidden} ancestor`, async t => {
    const page = createSnapshotPage(`
      <section ${hidden}><button>Continue</button></section>
      <button>Continue</button>
    `);
    t.after(() => page.window.happyDOM.abort());
    const clicked = [];
    page.window.document.querySelectorAll("button").forEach((button, index) => {
      button.addEventListener("click", () => clicked.push(index));
    });
    const locator = [{ type: "role", role: "button", name: "Continue", exact: true }];

    assert.equal((page.snapshot().match(/button "Continue"/g) || []).length, 1);
    page.execute("playwright.locator.click", { locator });
    assert.deepEqual(clicked, [1]);
  });
}

test("uses the same accessible name precedence as the snapshot", async t => {
  const page = createSnapshotPage(`
    <span id="label">Visible name</span>
    <button aria-label="Other name" aria-labelledby="label">Action</button>
  `);
  t.after(() => page.window.happyDOM.abort());
  assert.match(page.snapshot(), /button "Visible name"/);
  assert.equal(page.execute("playwright.locator.count", {
    locator: [{ type: "role", role: "button", name: "Visible name", exact: true }]
  }), 1);
});
