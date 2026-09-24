export function runPageOperation(
  document,
  window,
  method,
  params = {},
  dependencies = {}
) {
  const controlIndicatorAttribute =
    "data-safari-browser-use-control";
  const controlCursorAttribute =
    "data-safari-browser-use-control-cursor";
  const controlStyleId =
    "__safari_browser_use_control_style__";
  const controlTimerKey =
    "__safari_browser_use_control_timer__";
  const documentIdKey =
    "__safari_browser_use_document_id__";
  const navigationPendingKey =
    "__safari_browser_use_navigation_pending__";
  const navigationObserverKey =
    "__safari_browser_use_navigation_observer__";
  const highlightAttribute =
    "data-safari-browser-use-highlight";
  const highlightStyleId =
    "__safari_browser_use_highlight_style__";
  const gestureHighlightAttribute =
    "data-safari-browser-use-gesture-highlight";
  const gestureHighlightStyleId =
    "__safari_browser_use_gesture_highlight_style__";
  const gesturePathAttribute =
    "data-safari-browser-use-gesture-path";
  const gesturePointAttribute =
    "data-safari-browser-use-gesture-point";
  const fileUploadSessionKey =
    "__safari_browser_use_file_upload_session__";

  function hideControlIndicator() {
    window.clearTimeout(window[controlTimerKey]);
    delete window[controlTimerKey];

    document.querySelector(
      `[${controlIndicatorAttribute}]`
    )?.remove();
    document.getElementById(controlStyleId)?.remove();

    return { visible: false };
  }

  function showControlIndicator(options) {
    const existingIndicator = document.querySelector(
      `[${controlIndicatorAttribute}]`
    );
    const existingStyle = document.getElementById(controlStyleId);

    if (existingIndicator && existingStyle) {
      existingIndicator.style.pointerEvents = "auto";
      window.clearTimeout(window[controlTimerKey]);
      window[controlTimerKey] = window.setTimeout(
        hideControlIndicator,
        controlLeaseMs(options)
      );
      return { visible: true };
    }

    hideControlIndicator();

    const style = document.createElement("style");
    style.id = controlStyleId;
    style.textContent = `
      @keyframes __safari_browser_use_control_breathe__ {
        0%, 100% { opacity: 0.64; }
        50% { opacity: 1; }
      }

      [${controlIndicatorAttribute}] {
        animation:
          __safari_browser_use_control_breathe__
          1300ms cubic-bezier(0.25, 1, 0.5, 1) infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        [${controlIndicatorAttribute}] {
          animation: none !important;
          opacity: 0.98 !important;
        }
      }
    `;
    (document.head || document.documentElement).append(style);

    const indicator = document.createElement("div");
    indicator.setAttribute(controlIndicatorAttribute, "");
    indicator.setAttribute("aria-hidden", "true");
    Object.assign(indicator.style, {
      position: "fixed",
      inset: "0",
      boxSizing: "border-box",
      pointerEvents: "auto",
      zIndex: "2147483647",
      border: "3px solid rgba(194, 184, 38, 0.98)",
      outline: "1px solid rgba(255, 252, 210, 0.92)",
      outlineOffset: "-6px",
      borderRadius: "10px",
      boxShadow: [
        "inset 0 0 18px 4px rgba(255, 253, 220, 0.95)",
        "inset 0 0 56px 14px rgba(230, 222, 82, 0.78)",
        "inset 0 0 140px 28px rgba(183, 191, 42, 0.52)",
        "inset 0 0 200px 42px rgba(151, 162, 34, 0.28)"
      ].join(", "),
      contain: "strict",
      willChange: "opacity"
    });

    const cursor = document.createElement("div");
    const cursorSvg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36">',
      '<path d="M3 2v27l7-7 6 12 6-3-6-11h10z"',
      ' fill="#111" stroke="#fff" stroke-width="2"',
      ' stroke-linejoin="round"/>',
      "</svg>"
    ].join("");
    cursor.setAttribute(controlCursorAttribute, "");
    Object.assign(cursor.style, {
      position: "absolute",
      right: "96px",
      bottom: "80px",
      width: "28px",
      height: "36px",
      pointerEvents: "none",
      backgroundImage:
        `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}")`,
      backgroundRepeat: "no-repeat",
      backgroundSize: "contain",
      filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55))"
    });
    indicator.append(cursor);
    document.documentElement.append(indicator);

    window[controlTimerKey] = window.setTimeout(
      hideControlIndicator,
      controlLeaseMs(options)
    );

    return { visible: true };
  }

  function setControlPassthrough(options) {
    const indicator = document.querySelector(
      `[${controlIndicatorAttribute}]`
    );
    const passthrough = options.enabled === true;

    if (!indicator) {
      return { passthrough, visible: false };
    }

    indicator.style.pointerEvents = passthrough ? "none" : "auto";

    return { passthrough, visible: true };
  }

  function controlLeaseMs(options) {
    const requestedLeaseMs = Number(options.leaseMs);

    return Number.isFinite(requestedLeaseMs) &&
      requestedLeaseMs > 0
      ? Math.min(requestedLeaseMs, 300_000)
      : 60_000;
  }

  function pageDocumentId() {
    if (!window[documentIdKey]) {
      window[documentIdKey] =
        `document-${Date.now().toString(36)}-` +
        Math.random().toString(36).slice(2);
    }

    return window[documentIdKey];
  }

  function pageNavigationPending() {
    if (!window[navigationObserverKey]) {
      const markPending = () => {
        window[navigationPendingKey] = true;
      };

      window.addEventListener("beforeunload", markPending);
      window.addEventListener("pagehide", markPending);
      window.addEventListener("pageshow", () => {
        window[navigationPendingKey] = false;
      });
      window[navigationObserverKey] = true;
    }

    return window[navigationPendingKey] === true;
  }

  function navigationTransition(element) {
    const anchor = element.closest?.("a[href]");

    if (anchor) {
      const target =
        (anchor.getAttribute("target") || "_self").toLowerCase();
      let destination;

      try {
        destination = new URL(anchor.href, window.location.href);
      } catch (error) {
        return null;
      }

      if (anchor.hasAttribute("download")) {
        const transition = {
          kind: "download",
          url: destination.href
        };
        const suggestedFilename = anchor.getAttribute("download");

        if (suggestedFilename) {
          transition.suggestedFilename = suggestedFilename;
        }

        return transition;
      }

      if (target !== "_self" && target !== "") {
        return {
          kind: "new-tab",
          url: destination.href
        };
      }

      const current = new URL(window.location.href);
      const withoutHash = value =>
        `${value.origin}${value.pathname}${value.search}`;

      return (
        (destination.protocol === "http:" ||
          destination.protocol === "https:") &&
        (
          destination.href === current.href ||
          withoutHash(destination) !== withoutHash(current)
        )
      )
        ? { kind: "same-tab", url: destination.href }
        : null;
    }

    const form = element.form;

    if (!form) {
      return null;
    }

    const target =
      (
        element.getAttribute("formtarget") ||
        form.getAttribute("target") ||
        "_self"
      ).toLowerCase();
    const tagName = element.tagName.toLowerCase();
    const type = (
      element.getAttribute("type") ||
      (tagName === "button" ? "submit" : "")
    ).toLowerCase();
    const submitsForm =
      tagName === "button" && type === "submit" ||
      tagName === "input" &&
        (type === "submit" || type === "image");

    if (!submitsForm) {
      return null;
    }

    const action =
      element.getAttribute("formaction") ||
      form.getAttribute("action") ||
      window.location.href;
    let destination;

    try {
      destination = new URL(action, window.location.href).href;
    } catch (error) {
      return null;
    }

    return {
      kind: target === "_self" || target === ""
        ? "same-tab"
        : "new-tab",
      url: destination
    };
  }

  function captureDownloadDuring(action) {
    const anchorPrototype = window.HTMLAnchorElement?.prototype;
    const originalClick = anchorPrototype?.click;
    let captured = null;

    function capture(anchor) {
      if (
        captured ||
        !anchor ||
        !anchor.hasAttribute?.("download")
      ) {
        return;
      }

      const transition = {
        kind: "download",
        programmatic: true,
        url: String(anchor.href || anchor.getAttribute("href") || "")
      };
      const suggestedFilename = anchor.getAttribute("download");

      if (suggestedFilename) {
        transition.suggestedFilename = suggestedFilename;
      }

      captured = transition;
    }

    function captureClick(event) {
      capture(event.target?.closest?.("a[download]"));
    }

    document.addEventListener("click", captureClick, true);

    if (anchorPrototype && typeof originalClick === "function") {
      anchorPrototype.click = function () {
        capture(this);
        return originalClick.call(this);
      };
    }

    try {
      action();
      return captured;
    } finally {
      document.removeEventListener("click", captureClick, true);

      if (anchorPrototype && typeof originalClick === "function") {
        anchorPrototype.click = originalClick;
      }
    }
  }

  function controlCursorElement() {
    return document.querySelector(`[${controlCursorAttribute}]`);
  }

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function moveControlCursorTo(point, options = {}) {
    if (
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    ) {
      return { moved: false };
    }

    showControlIndicator(options);

    const cursor = controlCursorElement();

    if (!cursor) {
      return { moved: false };
    }

    const glideMs = Number.isFinite(Number(options.glideMs))
      ? Number(options.glideMs)
      : 320;

    cursor.style.right = "auto";
    cursor.style.bottom = "auto";
    cursor.style.left = "0";
    cursor.style.top = "0";
    cursor.style.transition = prefersReducedMotion()
      ? "none"
      : `transform ${glideMs}ms ` +
        "cubic-bezier(0.22, 1, 0.36, 1)";
    cursor.style.transform =
      `translate3d(${point.x - 3}px, ${point.y - 2}px, 0px)`;
    cursor.style.willChange = "transform";

    return { moved: true, x: point.x, y: point.y };
  }

  function pointerablePoint(element) {
    if (
      !element ||
      typeof element.getBoundingClientRect !== "function"
    ) {
      return null;
    }

    const rect = element.getBoundingClientRect();

    if (!rect || (!rect.width && !rect.height)) {
      return null;
    }

    // Aim near the centre with a small imprecise offset so the
    // cursor lands naturally rather than pixel-perfectly.
    const jitterX = (Math.random() - 0.5) * Math.min(rect.width, 24);
    const jitterY = (Math.random() - 0.5) * Math.min(rect.height, 16);
    const viewportWidth = window.innerWidth || rect.right;
    const viewportHeight = window.innerHeight || rect.bottom;
    const x = Math.max(
      2,
      Math.min(rect.left + rect.width / 2 + jitterX, viewportWidth - 2)
    );
    const y = Math.max(
      2,
      Math.min(rect.top + rect.height / 2 + jitterY, viewportHeight - 2)
    );

    return { x, y };
  }

  function moveControlCursorToElement(element, options) {
    try {
      return moveControlCursorTo(pointerablePoint(element), options);
    } catch (error) {
      // The cursor illusion must never break a real operation.
      return { moved: false };
    }
  }

  function ensureHighlightStyle() {
    if (document.getElementById(highlightStyleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = highlightStyleId;
    style.textContent = `
      @keyframes __safari_browser_use_highlight_fade__ {
        0% { opacity: 1; transform: scale(1.03); }
        5% { opacity: 1; transform: scale(1); }
        25% { opacity: 1; transform: scale(1); }
        100% { opacity: 0; transform: scale(1); }
      }

      [${highlightAttribute}] {
        animation:
          __safari_browser_use_highlight_fade__
          4000ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }

      @media (prefers-reduced-motion: reduce) {
        [${highlightAttribute}] {
          animation: none !important;
          opacity: 1 !important;
          transform: none !important;
        }
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function highlightElement(element) {
    try {
      const rect =
        element && typeof element.getBoundingClientRect === "function"
          ? element.getBoundingClientRect()
          : null;

      if (!rect || (!rect.width && !rect.height)) {
        return { highlighted: false };
      }

      ensureHighlightStyle();

      const pad = 4;
      const glow = document.createElement("div");
      glow.setAttribute(highlightAttribute, "");
      glow.setAttribute("aria-hidden", "true");
      Object.assign(glow.style, {
        position: "fixed",
        left: `${rect.left - pad}px`,
        top: `${rect.top - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
        boxSizing: "border-box",
        pointerEvents: "none",
        zIndex: "2147483646",
        borderRadius: "10px",
        border: "2px solid rgba(255, 148, 0, 0.95)",
        backgroundColor: "rgba(255, 152, 32, 0.12)",
        boxShadow: [
          "0 0 0 3px rgba(255, 165, 40, 0.55)",
          "0 0 16px 4px rgba(255, 140, 0, 0.80)",
          "0 0 38px 12px rgba(255, 120, 0, 0.45)"
        ].join(", "),
        willChange: "opacity, transform"
      });

      const remove = () => glow.remove();
      glow.addEventListener("animationend", remove);
      // Fallback removal in case the animation event never fires.
      window.setTimeout(remove, 4200);

      document.documentElement.append(glow);

      return { highlighted: true };
    } catch (error) {
      // The highlight is decorative and must never break an operation.
      return { highlighted: false };
    }
  }

  function ensureGestureHighlightStyle() {
    if (document.getElementById(gestureHighlightStyleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = gestureHighlightStyleId;
    style.textContent = `
      @keyframes __safari_browser_use_gesture_highlight_fade__ {
        0%, 25% { opacity: 1; }
        100% { opacity: 0; }
      }

      [${gestureHighlightAttribute}] {
        animation:
          __safari_browser_use_gesture_highlight_fade__
          4000ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }

      @media (prefers-reduced-motion: reduce) {
        [${gestureHighlightAttribute}] {
          animation: none !important;
          opacity: 1 !important;
        }
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function highlightGesture(params) {
    try {
      const kind = String(params.kind);
      const glow = document.createElement("div");
      glow.setAttribute(gestureHighlightAttribute, kind);
      glow.setAttribute("aria-hidden", "true");
      Object.assign(glow.style, {
        position: "fixed",
        pointerEvents: "none",
        zIndex: "2147483646",
        boxSizing: "border-box"
      });

      ensureGestureHighlightStyle();

      if (kind === "click") {
        const x = Number(params.x);
        const y = Number(params.y);
        const diameter = 36;

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return { highlighted: false };
        }

        Object.assign(glow.style, {
          left: `${x - diameter / 2}px`,
          top: `${y - diameter / 2}px`,
          width: `${diameter}px`,
          height: `${diameter}px`,
          borderRadius: "50%",
          border: "3px solid rgba(255, 148, 0, 0.98)",
          backgroundColor: "rgba(255, 152, 32, 0.18)",
          boxShadow: [
            "0 0 0 5px rgba(255, 165, 40, 0.42)",
            "0 0 22px 8px rgba(255, 120, 0, 0.72)"
          ].join(", ")
        });
      } else if (kind === "drag") {
        const fromX = Number(params.fromX);
        const fromY = Number(params.fromY);
        const toX = Number(params.toX);
        const toY = Number(params.toY);

        if (
          !Number.isFinite(fromX) ||
          !Number.isFinite(fromY) ||
          !Number.isFinite(toX) ||
          !Number.isFinite(toY)
        ) {
          return { highlighted: false };
        }

        const deltaX = toX - fromX;
        const deltaY = toY - fromY;
        const path = document.createElement("div");
        path.setAttribute(gesturePathAttribute, "");
        Object.assign(path.style, {
          position: "absolute",
          left: `${fromX}px`,
          top: `${fromY}px`,
          width: `${Math.hypot(deltaX, deltaY)}px`,
          height: "0",
          borderTop: "3px solid rgba(255, 148, 0, 0.95)",
          boxShadow: "0 0 14px 4px rgba(255, 120, 0, 0.68)",
          transformOrigin: "0 50%",
          transform:
            `rotate(${Math.atan2(deltaY, deltaX) * 180 / Math.PI}deg)`
        });
        glow.append(path);

        [
          ["start", fromX, fromY],
          ["end", toX, toY]
        ].forEach(([name, x, y]) => {
          const point = document.createElement("div");
          point.setAttribute(gesturePointAttribute, name);
          Object.assign(point.style, {
            position: "absolute",
            left: `${x - 9}px`,
            top: `${y - 9}px`,
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            border: "3px solid rgba(255, 148, 0, 0.98)",
            backgroundColor: name === "end"
              ? "rgba(255, 132, 0, 0.82)"
              : "rgba(255, 245, 210, 0.94)",
            boxShadow: "0 0 16px 5px rgba(255, 120, 0, 0.68)"
          });
          glow.append(point);
        });

        Object.assign(glow.style, {
          inset: "0"
        });
      } else {
        return { highlighted: false };
      }

      const remove = () => glow.remove();
      glow.addEventListener("animationend", remove);
      window.setTimeout(remove, 4200);
      document.documentElement.append(glow);

      return { highlighted: true };
    } catch (error) {
      // Gesture highlighting must never break a real operation.
      return { highlighted: false };
    }
  }

  function normalizeText(value) {
    return value?.replace(/\s+/g, " ").trim() ?? "";
  }

  function accessibleName(element) {
    return dependencies.getElementAccessibleNameText(element, false);
  }

  function isVisible(element) {
    if (element.hidden) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden";
  }

  function matchesText(actual, expected, exact) {
    const normalizedActual = normalizeText(actual);
    const normalizedExpected = normalizeText(String(expected));

    return exact
      ? normalizedActual === normalizedExpected
      : normalizedActual.includes(normalizedExpected);
  }

  function descendants(roots, selector = "*") {
    return roots.flatMap(root => {
      const matches = [...root.querySelectorAll(selector)];
      for (const element of [root, ...root.querySelectorAll("*")]) {
        if (element.shadowRoot) {
          matches.push(...descendants([element.shadowRoot], selector));
        }
        if (element.tagName === "IFRAME") {
          try {
            if (element.contentDocument) {
              matches.push(...descendants([element.contentDocument], selector));
            }
          } catch (error) {
            // Cross-origin frames are unavailable to page JavaScript.
          }
        }
      }
      return matches;
    });
  }

  function isHiddenForAria(element) {
    for (let current = element; current; current = current.ownerDocument.defaultView?.frameElement) {
      if (dependencies.isElementHiddenForAria(current)) {
        return true;
      }
    }
    return false;
  }

  function resolveLocator(steps) {
    let roots = [document];

    for (const step of steps) {
      if (step.type === "index") {
        const index = step.index < 0
          ? roots.length + step.index
          : step.index;
        roots = roots[index] ? [roots[index]] : [];
        continue;
      }

      const candidates = descendants(roots);

      switch (step.type) {
        case "css":
          roots = descendants(roots, step.selector);
          break;
        case "role":
          roots = candidates.filter(element =>
            !isHiddenForAria(element) &&
            dependencies.getAriaRole(element) === step.role &&
            (
              step.name === undefined ||
              matchesText(
                accessibleName(element),
                step.name,
                step.exact
              )
            )
          );
          break;
        case "text": {
          const matches = candidates.filter(element =>
            matchesText(element.textContent, step.text, step.exact)
          );
          roots = matches.filter(element =>
            ![...element.children].some(child =>
              matchesText(child.textContent, step.text, step.exact)
            )
          );
          break;
        }
        case "label":
          roots = candidates.filter(element =>
            "labels" in element &&
            matchesText(
              accessibleName(element),
              step.text,
              step.exact
            )
          );
          break;
        case "placeholder":
          roots = candidates.filter(element =>
            matchesText(
              element.getAttribute("placeholder"),
              step.text,
              step.exact
            )
          );
          break;
        case "testId":
          roots = candidates.filter(element =>
            element.getAttribute("data-testid") === step.testId
          );
          break;
        default:
          throw new Error(
            `unsupported_locator_step: ${step.type}`
          );
      }
    }

    return [...new Set(roots)];
  }

  function oneLocatorElement(locator) {
    const matches = resolveLocator(locator);

    if (matches.length !== 1) {
      throw new Error(
        `strict mode violation: locator resolved to ` +
        `${matches.length} elements`
      );
    }

    return matches[0];
  }

  function isContentEditable(element) {
    return element.getAttribute("contenteditable") === "true" ||
      element.isContentEditable === true;
  }

  function fillContentEditable(element, value) {
    const text = String(value);

    element.focus?.();
    element.dispatchEvent(
      new window.Event("beforeinput", { bubbles: true })
    );
    element.textContent = text;
    element.dispatchEvent(
      new window.Event("input", { bubbles: true })
    );
  }

  function setNativeControlValue(element, value) {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value"
    );

    if (typeof descriptor?.set === "function") {
      descriptor.set.call(element, String(value));
      return;
    }

    element.value = String(value);
  }

  function fillElement(element, value) {
    if (element.readOnly) {
      throw new Error("element_readonly");
    }

    if (isContentEditable(element)) {
      fillContentEditable(element, value);
      return;
    }

    if (!("value" in element)) {
      throw new Error("element_not_fillable");
    }

    setNativeControlValue(element, value);
    element.dispatchEvent(
      new window.Event("input", { bubbles: true })
    );
    element.dispatchEvent(
      new window.Event("change", { bubbles: true })
    );
  }

  function appendToElement(element, value) {
    if (isContentEditable(element)) {
      fillContentEditable(
        element,
        `${element.textContent ?? ""}${value}`
      );
      return;
    }

    fillElement(element, `${element.value ?? ""}${value}`);
  }

  function decodeBase64(base64) {
    const decode = window.atob || (typeof atob === "function" ? atob : null);

    if (!decode) {
      throw new Error("base64_decode_unavailable");
    }

    const binary = decode(String(base64));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  function buildFileTransfer(files) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("no_files_provided");
    }

    const dataTransfer = new window.DataTransfer();
    const meta = [];

    for (const spec of files) {
      if (
        !spec ||
        typeof spec.name !== "string" ||
        typeof spec.base64 !== "string"
      ) {
        throw new Error("invalid_file_spec");
      }

      const file = new window.File(
        [decodeBase64(spec.base64)],
        spec.name,
        { type: spec.mimeType || "application/octet-stream" }
      );
      dataTransfer.items.add(file);
      meta.push({ name: file.name, size: file.size, type: file.type });
    }

    return { dataTransfer, meta };
  }

  function isFileInput(element) {
    return Boolean(
      element &&
      element.tagName &&
      element.tagName.toLowerCase() === "input" &&
      (element.getAttribute("type") ?? "").toLowerCase() === "file"
    );
  }

  function assignFilesToInput(input, transfer, via) {
    if (!isFileInput(input)) {
      throw new Error("element_not_file_input");
    }

    input.files = transfer.dataTransfer.files;
    input.dispatchEvent(
      new window.Event("input", { bubbles: true })
    );
    input.dispatchEvent(
      new window.Event("change", { bubbles: true })
    );

    return {
      status: "uploaded",
      files: transfer.meta,
      via
    };
  }

  function uploadSessionResult(session) {
    return {
      status: session.status,
      token: session.token,
      files: session.transfer.meta,
      via: session.via ?? null,
      error: session.error ?? null
    };
  }

  function restoreUploadHooks(session) {
    if (session.cleaned) {
      return;
    }

    session.cleaned = true;
    window.clearTimeout(session.timer);
    window.removeEventListener(
      "click",
      session.captureClick,
      true
    );

    const prototype = window.HTMLInputElement?.prototype;

    if (prototype?.click === session.clickWrapper) {
      prototype.click = session.originalClick;
    }

    if (
      prototype &&
      session.showPickerWrapper &&
      prototype.showPicker === session.showPickerWrapper
    ) {
      prototype.showPicker = session.originalShowPicker;
    }

    if (
      session.openPickerWrapper &&
      window.showOpenFilePicker === session.openPickerWrapper
    ) {
      window.showOpenFilePicker = session.originalOpenPicker;
    }
  }

  function finishUploadSession(session, input, via) {
    if (session.status !== "pending") {
      return uploadSessionResult(session);
    }

    try {
      const result = assignFilesToInput(
        input,
        session.transfer,
        via
      );
      session.status = result.status;
      session.via = result.via;
    } catch (error) {
      session.status = "error";
      session.error = error?.message ?? String(error);
    } finally {
      restoreUploadHooks(session);
    }

    return uploadSessionResult(session);
  }

  function armFileUpload(trigger, files, options) {
    const transfer = buildFileTransfer(files);

    if (isFileInput(trigger)) {
      return assignFilesToInput(trigger, transfer, "input");
    }

    const existing = window[fileUploadSessionKey];

    if (existing?.status === "pending") {
      throw new Error("file_upload_already_armed");
    }

    const session = {
      cleaned: false,
      error: null,
      status: "pending",
      token:
        `upload-${Date.now().toString(36)}-` +
        Math.random().toString(36).slice(2),
      transfer,
      via: null
    };
    const prototype = window.HTMLInputElement?.prototype;

    if (!prototype || typeof prototype.click !== "function") {
      throw new Error("file_upload_interception_unavailable");
    }

    session.originalClick = prototype.click;
    session.originalShowPicker = prototype.showPicker;
    session.originalOpenPicker = window.showOpenFilePicker;
    session.captureClick = event => {
      const path = typeof event.composedPath === "function"
        ? event.composedPath()
        : [event.target];
      const input = path.find(isFileInput);

      if (!input || session.status !== "pending") {
        return;
      }

      event.preventDefault();
      finishUploadSession(session, input, "dynamic-input");
    };
    session.clickWrapper = function () {
      if (!isFileInput(this) || session.status !== "pending") {
        return session.originalClick.apply(this, arguments);
      }

      const click = new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true
      });
      this.dispatchEvent(click);

      if (session.status === "pending") {
        finishUploadSession(session, this, "dynamic-input");
      }
    };

    window.addEventListener("click", session.captureClick, true);
    prototype.click = session.clickWrapper;

    if (typeof prototype.showPicker === "function") {
      session.showPickerWrapper = function () {
        if (!isFileInput(this) || session.status !== "pending") {
          return session.originalShowPicker.apply(this, arguments);
        }

        finishUploadSession(session, this, "dynamic-input");
      };
      prototype.showPicker = session.showPickerWrapper;
    }

    if (typeof window.showOpenFilePicker === "function") {
      session.openPickerWrapper = function () {
        session.status = "unsupported";
        session.error = "native_file_picker_not_supported";
        restoreUploadHooks(session);

        return Promise.reject(
          new window.DOMException(
            "Native file picker interception is unavailable.",
            "NotAllowedError"
          )
        );
      };
      window.showOpenFilePicker = session.openPickerWrapper;
    }

    const timeoutMs = Math.min(
      Math.max(
        Number(options?.timeoutMs) || (trigger ? 3000 : 30000),
        100
      ),
      60000
    );
    session.timer = window.setTimeout(() => {
      if (session.status === "pending") {
        session.status = "expired";
        session.error = "file_upload_input_not_captured";
      }
      restoreUploadHooks(session);
    }, timeoutMs);
    window[fileUploadSessionKey] = session;

    if (trigger) {
      try {
        trigger.scrollIntoView?.({
          block: "center",
          inline: "center"
        });
        trigger.click();
      } catch (error) {
        session.status = "error";
        session.error = error?.message ?? String(error);
        restoreUploadHooks(session);
      }
    }

    return uploadSessionResult(session);
  }

  function fileUploadStatus(token) {
    const session = window[fileUploadSessionKey];

    if (!session || session.token !== token) {
      return {
        status: "missing",
        token,
        files: [],
        via: null,
        error: "file_upload_session_not_found"
      };
    }

    return uploadSessionResult(session);
  }

  function cleanupFileUpload(token) {
    const session = window[fileUploadSessionKey];

    if (!session || session.token !== token) {
      return { cleaned: false };
    }

    if (session.status === "pending") {
      session.status = "cancelled";
    }
    restoreUploadHooks(session);
    delete window[fileUploadSessionKey];

    return { cleaned: true };
  }

  function canvasSnapshot(element, options) {
    if (!element || element.tagName.toLowerCase() !== "canvas") {
      throw new Error("not_a_canvas");
    }

    const sourceWidth = Number(element.width) || 0;
    const sourceHeight = Number(element.height) || 0;
    const maxSize = Number(options.maxSize) > 0
      ? Number(options.maxSize)
      : 1280;
    const longestEdge = Math.max(sourceWidth, sourceHeight) || 1;

    let outputWidth = sourceWidth;
    let outputHeight = sourceHeight;
    let exportCanvas = element;

    if (longestEdge > maxSize) {
      const scale = maxSize / longestEdge;
      outputWidth = Math.max(1, Math.round(sourceWidth * scale));
      outputHeight = Math.max(1, Math.round(sourceHeight * scale));

      const scaled = document.createElement("canvas");
      scaled.width = outputWidth;
      scaled.height = outputHeight;

      const scaledContext = scaled.getContext("2d");

      if (scaledContext) {
        scaledContext.drawImage(element, 0, 0, outputWidth, outputHeight);
      }

      exportCanvas = scaled;
    }

    let dataUrl;

    try {
      dataUrl = exportCanvas.toDataURL("image/png");
    } catch (error) {
      throw new Error("canvas_tainted_cross_origin");
    }

    const separator = dataUrl.indexOf(",");
    const base64 = separator === -1 ? "" : dataUrl.slice(separator + 1);

    let blank = false;

    try {
      const sampleMax = 96;
      const sampleLongest = Math.max(outputWidth, outputHeight) || 1;
      const sampleScale = sampleLongest > sampleMax
        ? sampleMax / sampleLongest
        : 1;
      const sampleWidth = Math.max(1, Math.round(outputWidth * sampleScale));
      const sampleHeight = Math.max(1, Math.round(outputHeight * sampleScale));

      const sampler = document.createElement("canvas");
      sampler.width = sampleWidth;
      sampler.height = sampleHeight;

      const context = sampler.getContext("2d");

      if (!context) {
        throw new Error("no_2d_context");
      }

      context.drawImage(exportCanvas, 0, 0, sampleWidth, sampleHeight);

      const pixels = context.getImageData(
        0,
        0,
        sampleWidth,
        sampleHeight
      ).data;

      blank = true;

      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 0) {
          blank = false;
          break;
        }
      }
    } catch (error) {
      blank = false;
    }

    const rect = element.getBoundingClientRect
      ? element.getBoundingClientRect()
      : { left: 0, top: 0, width: sourceWidth, height: sourceHeight };

    return {
      __sbuImage: {
        mimeType: "image/png",
        base64,
        width: outputWidth,
        height: outputHeight
      },
      source: {
        width: sourceWidth,
        height: sourceHeight,
        viewport: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        }
      },
      blank
    };
  }

  function insideControlIndicator(element) {
    return Boolean(
      element &&
      element.closest &&
      element.closest(`[${controlIndicatorAttribute}]`)
    );
  }

  function hitTestTarget(x, y) {
    const direct = document.elementFromPoint
      ? document.elementFromPoint(x, y)
      : null;

    if (direct && !insideControlIndicator(direct)) {
      return direct;
    }

    const stack = document.elementsFromPoint
      ? document.elementsFromPoint(x, y)
      : [];

    for (const element of stack) {
      if (!insideControlIndicator(element)) {
        return element;
      }
    }

    return document.documentElement || document.body;
  }

  function dispatchMouseEvent(params) {
    const x = Number(params.x);
    const y = Number(params.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("invalid_coordinates");
    }

    const type = String(params.type);
    const button = Number(params.button ?? 0);
    const buttons = Number(params.buttons ?? 0);
    const pointerId = Number(params.pointerId ?? 1);
    const target = hitTestTarget(x, y);

    // Glide the fake cursor along the coordinate path so a person
    // watching sees the pointer travel to where the AI is acting.
    try {
      moveControlCursorTo({ x, y }, { glideMs: 90 });
    } catch (error) {
      // never let the illusion break a real gesture
    }

    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      button,
      buttons
    };

    if (type.indexOf("pointer") === 0 && window.PointerEvent) {
      target.dispatchEvent(
        new window.PointerEvent(
          type,
          Object.assign({}, base, {
            pointerId,
            pointerType: "mouse",
            isPrimary: true,
            pressure: buttons ? 0.5 : 0
          })
        )
      );
    }

    const mouseType = {
      pointerdown: "mousedown",
      pointermove: "mousemove",
      pointerup: "mouseup",
      click: "click"
    }[type];

    if (mouseType && window.MouseEvent) {
      target.dispatchEvent(new window.MouseEvent(mouseType, base));
    }

    return {
      type,
      target: target && target.tagName
        ? target.tagName.toLowerCase()
        : null,
      x,
      y
    };
  }

  function domSnapshot() {
    let root = document.body || document.documentElement;

    if (params.locator) {
      root = oneLocatorElement(params.locator);
    } else if (params.root !== undefined) {
      root = oneLocatorElement([{
        type: "css",
        selector: String(params.root)
      }]);
    }

    return dependencies.ariaSnapshot(
      root
    );
  }

  function matchesState(locator, state) {
    const matches = resolveLocator(locator);

    switch (state) {
      case "attached":
        return matches.length > 0;
      case "detached":
        return matches.length === 0;
      case "hidden":
        return matches.length === 0 ||
          matches.every(element => !isVisible(element));
      case "visible":
        return matches.some(element => isVisible(element));
      default:
        throw new Error(`unsupported_locator_state: ${state}`);
    }
  }

  function firstElement(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);

      if (element) {
        return element;
      }
    }

    return null;
  }

  function centrePoint(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") {
      return null;
    }

    const rect = element.getBoundingClientRect();

    if (
      !rect ||
      !Number.isFinite(Number(rect.width)) ||
      !Number.isFinite(Number(rect.height)) ||
      Number(rect.width) <= 0 ||
      Number(rect.height) <= 0
    ) {
      return null;
    }

    return {
      x: Math.round(Number(rect.left) + Number(rect.width) / 2),
      y: Math.round(Number(rect.top) + Number(rect.height) / 2)
    };
  }

  function controlValue(element) {
    if (!element) {
      return "";
    }

    if ("value" in element) {
      return String(element.value ?? "");
    }

    const input = element.querySelector?.("input");

    return input && "value" in input
      ? String(input.value ?? "")
      : String(element.textContent ?? "").trim();
  }

  function googleDocsEditorState() {
    const title = firstElement([
      ".docs-title-input",
      "[aria-label='Document title']"
    ]);
    const editor = firstElement([
      ".kix-appview-editor",
      ".kix-page-paginated",
      ".kix-page"
    ]);

    return {
      title: controlValue(title),
      editorPoint: centrePoint(editor)
    };
  }

  function googleSheetsEditorState() {
    const title = firstElement([
      ".docs-title-input",
      "[aria-label='Spreadsheet title']"
    ]);
    const nameBox = firstElement([
      ".waffle-name-box",
      "#t-name-box",
      "[aria-label='Name box']"
    ]);
    const grid = firstElement([
      ".waffle-grid-container",
      "#waffle-grid-container",
      "canvas",
      ".grid-container"
    ]);
    const tabs = [
      ...document.querySelectorAll(
        ".docs-sheet-tab[data-sheet-id], " +
        ".docs-sheet-tab[data-id]"
      )
    ];

    return {
      title: controlValue(title),
      selectionRange: controlValue(nameBox),
      nameBoxPoint: centrePoint(nameBox),
      sheets: tabs.map(tab => {
        const gid =
          tab.getAttribute("data-sheet-id") ||
          tab.getAttribute("data-id") ||
          "";
        const name = tab.querySelector(".docs-sheet-tab-name");

        return {
          name: String(
            name ? name.textContent : tab.textContent
          ).trim(),
          gid: String(gid),
          gridId: String(gid)
        };
      }),
      editorPoint: centrePoint(grid)
    };
  }

  if (method === "googleDocs.editorState") {
    return googleDocsEditorState();
  }

  if (method === "googleSheets.editorState") {
    return googleSheetsEditorState();
  }

  if (method === "playwright.domSnapshot") {
    return domSnapshot();
  }

  if (method === "playwright.readyState") {
    return document.readyState;
  }

  if (method === "playwright.pageState") {
    return {
      controlVisible: Boolean(document.querySelector(
        `[${controlIndicatorAttribute}]`
      )),
      documentId: pageDocumentId(),
      navigationPending: pageNavigationPending(),
      readyState: document.readyState,
      url: window.location.href
    };
  }

  if (method === "playwright.viewportMetrics") {
    const visualViewport = window.visualViewport;

    return {
      innerHeight: Number(window.innerHeight),
      innerWidth: Number(window.innerWidth),
      outerHeight: Number(window.outerHeight),
      outerWidth: Number(window.outerWidth),
      visualOffsetLeft: visualViewport
        ? Number(visualViewport.offsetLeft)
        : 0,
      visualOffsetTop: visualViewport
        ? Number(visualViewport.offsetTop)
        : 0,
      visualScale: visualViewport
        ? Number(visualViewport.scale)
        : 1
    };
  }

  if (method === "playwright.scrollBy") {
    const deltaX = Number(params.deltaX ?? 0);
    const deltaY = Number(params.deltaY ?? 0);

    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      throw new Error("invalid_scroll_offset");
    }

    window.scrollBy(deltaX, deltaY);
    return { deltaX, deltaY };
  }

  if (method === "playwright.mouseEvent") {
    return dispatchMouseEvent(params);
  }

  if (method === "playwright.gestureHighlight") {
    return highlightGesture(params);
  }

  if (method === "playwright.fileUploadStatus") {
    return fileUploadStatus(params.token);
  }

  if (method === "playwright.fileUploadArm") {
    return armFileUpload(
      null,
      params.files,
      params.options || {}
    );
  }

  if (method === "playwright.fileUploadCleanup") {
    return cleanupFileUpload(params.token);
  }

  if (method === "control.show") {
    return showControlIndicator(params);
  }

  if (method === "control.passthrough") {
    return setControlPassthrough(params);
  }

  if (method === "control.hide") {
    return hideControlIndicator();
  }

  if (!method.startsWith("playwright.locator.")) {
    throw new Error(`unsupported_playwright_method: ${method}`);
  }

  const operation =
    method.slice("playwright.locator.".length);

  if (operation === "matchesState") {
    return matchesState(params.locator, params.state);
  }

  const matches = resolveLocator(params.locator);

  if (operation === "count") {
    return matches.length;
  }

  if (operation === "allTextContents") {
    return matches.map(element => element.textContent ?? "");
  }

  if (operation === "allAttributes") {
    if (typeof params.name !== "string" || !params.name) {
      throw new Error("attribute_name_required");
    }

    return matches.map(element =>
      element.getAttribute(params.name)
    );
  }

  if (operation === "allRecords") {
    const fields = params.fields || {};

    return matches.map(element => ({
      textContent: element.textContent ?? "",
      fields: Object.fromEntries(
        Object.entries(fields).map(([name, field]) => {
          if (
            !field ||
            typeof field.selector !== "string" ||
            typeof field.attribute !== "string"
          ) {
            throw new Error("invalid_record_field: " + name);
          }

          return [
            name,
            [...element.querySelectorAll(field.selector)].map(
              child => child.getAttribute(field.attribute)
            )
          ];
        })
      )
    }));
  }

  const element = oneLocatorElement(params.locator);

  const pointerOperations = new Set([
    "click",
    "fill",
    "type",
    "press",
    "check",
    "uncheck",
    "setChecked",
    "selectOption",
    "setInputFiles",
    "uploadFiles",
    "dropFiles"
  ]);

  if (pointerOperations.has(operation)) {
    if (element.matches(":disabled")) {
      throw new Error("element_disabled");
    }
    moveControlCursorToElement(element, params);
    if (operation !== "click") {
      highlightElement(element);
    }
  }

  switch (operation) {
    case "click":
      const transition = navigationTransition(element);
      const navigationExpected =
        transition?.kind === "same-tab";
      element.scrollIntoView?.({
        block: "center",
        inline: "center"
      });
      moveControlCursorToElement(element, params);
      highlightElement(element);
      const capturedDownload = captureDownloadDuring(() => {
        element.click();
      });
      const observedTransition = transition || capturedDownload;
      return {
        clicked: true,
        navigationExpected,
        ...(observedTransition
          ? { transition: observedTransition }
          : {})
      };
    case "canvasSnapshot":
      return canvasSnapshot(element, params);
    case "setInputFiles": {
      return assignFilesToInput(
        element,
        buildFileTransfer(params.files),
        "input"
      );
    }
    case "uploadFiles": {
      return armFileUpload(
        element,
        params.files,
        params.options || {}
      );
    }
    case "dropFiles": {
      const { dataTransfer, meta } = buildFileTransfer(params.files);
      const options = { bubbles: true, cancelable: true };

      for (const eventType of ["dragenter", "dragover", "drop"]) {
        let event;

        try {
          event = new window.DragEvent(
            eventType,
            Object.assign({}, options, { dataTransfer })
          );
        } catch (error) {
          event = new window.Event(eventType, options);
        }

        if (event.dataTransfer !== dataTransfer) {
          try {
            Object.defineProperty(event, "dataTransfer", {
              configurable: true,
              value: dataTransfer
            });
          } catch (defineError) {
            try {
              event.dataTransfer = dataTransfer;
            } catch (assignError) {
              // Some engines expose dataTransfer as read-only; the
              // constructor init above already carries it in Safari.
            }
          }
        }

        element.dispatchEvent(event);
      }

      return { files: meta, via: "drop" };
    }
    case "fill":
      fillElement(element, params.value);
      return { filled: true };
    case "type":
      appendToElement(element, params.value);
      return { typed: true };
    case "press": {
      const key = String(params.value);
      const unsupportedDefaultActionKeys = [
        "Tab",
        "PageDown",
        "PageUp",
        "Home",
        "End",
        "Space",
        " "
      ];

      if (unsupportedDefaultActionKeys.includes(key)) {
        throw new Error(
          "unsupported_press_default_action: " +
          `"${key}" cannot be synthesized; use ` +
          "tab.playwright.scrollBy() or locator.scrollIntoView()"
        );
      }

      element.focus?.();
      const form = element.form;
      const initialUrl = window.location.href;
      let submissionObserved = false;
      let navigationExpected = false;
      let transition = null;
      const observeSubmission = () => { submissionObserved = true; };
      const dispatchKey = type => element.dispatchEvent(
        new window.KeyboardEvent(type, {
          key,
          bubbles: true,
          cancelable: true,
          composed: true,
          ...(key === "Enter" ? {
            code: "Enter", keyCode: 13, which: 13,
            charCode: type === "keypress" ? 13 : 0
          } : {})
        })
      );
      form?.addEventListener("submit", observeSubmission, true);
      form?.addEventListener("invalid", observeSubmission, true);

      try {
        const allowed = dispatchKey("keydown");
        const enterAllowed = key === "Enter" && allowed && dispatchKey("keypress");
        const blockingTypes = new Set([
          "text", "search", "tel", "url", "email", "password",
          "date", "month", "week", "time", "datetime-local", "number"
        ]);

        if (
          enterAllowed && !submissionObserved && form &&
          element.isConnected && element.form === form &&
          element.tagName.toLowerCase() === "input" &&
          blockingTypes.has(element.type) &&
          window.location.href === initialUrl
        ) {
          const controls = [...element.getRootNode().querySelectorAll("input, button")]
            .filter(control => control.form === form);
          const submitter = controls.find(control =>
            control.type === "submit" || control.type === "image"
          );

          if (submitter) {
            if (!submitter.matches(":disabled")) {
              transition = navigationTransition(submitter);
              navigationExpected = transition?.kind === "same-tab";
              submitter.click();
            }
          } else if (controls.filter(control =>
            control.tagName.toLowerCase() === "input" && blockingTypes.has(control.type)
          ).length === 1) {
            navigationExpected = true;
            window.HTMLFormElement.prototype.requestSubmit.call(form);
          }
        }

        dispatchKey("keyup");
      } finally {
        form?.removeEventListener("submit", observeSubmission, true);
        form?.removeEventListener("invalid", observeSubmission, true);
      }

      return {
        pressed: true, trusted: false,
        ...(navigationExpected ? { navigationExpected } : {}),
        ...(transition ? { transition } : {})
      };
    }
    case "scrollIntoView": {
      const options = params.options || {};
      element.scrollIntoView?.({
        block: options.block || "center",
        inline: options.inline || "nearest"
      });
      return { scrolled: true };
    }
    case "innerText":
      return normalizeText(element.innerText);
    case "textContent":
      return element.textContent;
    case "getAttribute":
      return element.getAttribute(params.name);
    case "isVisible":
      return isVisible(element);
    case "isEnabled":
      return !element.matches(":disabled");
    case "setChecked":
      if (!("checked" in element)) {
        throw new Error("element_not_checkable");
      }
      if (element.checked !== Boolean(params.checked)) {
        element.click();
      }
      if (element.checked !== Boolean(params.checked)) {
        throw new Error("checked_state_not_changed");
      }
      return { checked: element.checked };
    case "selectOption": {
      if (element.tagName.toLowerCase() !== "select") {
        throw new Error("element_not_selectable");
      }
      const values = Array.isArray(params.value)
        ? params.value
        : [params.value];
      const expected = values.map(value =>
        typeof value === "object" ? value.value : value
      );

      for (const option of element.options) {
        option.selected = expected.includes(option.value);
      }

      element.dispatchEvent(
        new window.Event("input", { bubbles: true })
      );
      element.dispatchEvent(
        new window.Event("change", { bubbles: true })
      );
      return [...element.selectedOptions]
        .map(option => option.value);
    }
    default:
      throw new Error(
        `unsupported_locator_operation: ${operation}`
      );
  }
}
