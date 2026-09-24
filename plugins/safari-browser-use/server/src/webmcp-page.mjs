// Bridge only the WebMCP interface already provided by the page's browser.
export function runWebmcpPageOperation(document, window, method, params = {}) {
  const callsKey = "__safari_browser_use_webmcp_calls__";
  const token = String(params.token || "");

  if (method === "webmcp.callStatus") {
    const calls = window[callsKey];
    const slot = calls?.[token];

    if (!slot) return { token, status: "unknown" };
    if (params.abort === true) {
      delete calls[token];
      window.clearTimeout(slot.timer);
      slot.controller.abort();
      return { token, status: "aborted" };
    }
    if (slot.status === "pending") return { token, status: "pending" };

    delete calls[token];
    window.clearTimeout(slot.timer);
    const { controller, timer, ...result } = slot;
    return { token, ...result };
  }

  if (method !== "webmcp.pageTools" && method !== "webmcp.execute") {
    throw new Error(`unsupported_webmcp_method: ${method}`);
  }

  const context = document.modelContext;
  const available = Boolean(context) &&
    typeof context.getTools === "function" &&
    typeof context.executeTool === "function";

  if (method === "webmcp.pageTools" && (!available || !token)) {
    return { status: "done", available, tools: [] };
  }
  if (!available) throw new Error("webmcp_unavailable");
  if (!token) throw new Error("webmcp_call_token_required");

  const calls = window[callsKey] || (window[callsKey] = Object.create(null));
  const controller = new window.AbortController();
  const timeoutMs = params.timeoutMs === undefined ? 10000 : params.timeoutMs;
  const deadline = params.deadline === undefined ? Date.now() + timeoutMs : params.deadline;
  const slot = { status: "pending", available: true, controller };
  calls[token] = slot;
  slot.timer = window.setTimeout(() => {
    if (calls[token] !== slot) return;
    delete calls[token];
    controller.abort();
  }, Math.max(0, deadline - Date.now()));

  function checkDeadline() {
    if (Date.now() >= deadline) {
      controller.abort();
      throw new Error(`webmcp_call_timeout: ${timeoutMs}ms`);
    }
  }

  Promise.resolve()
    .then(() => {
      if (controller.signal.aborted) return;
      checkDeadline();
      return context.getTools();
    })
    .then(tools => {
      if (controller.signal.aborted) return;
      checkDeadline();
      if (!Array.isArray(tools)) throw new Error("webmcp_invalid_tools");

      if (method === "webmcp.pageTools") {
        return { tools: tools.map(tool => {
          const descriptor = { name: tool.name, description: String(tool.description || "") };
          for (const key of ["title", "inputSchema", "annotations", "origin"]) {
            if (tool[key] !== undefined) descriptor[key] = tool[key];
          }
          return descriptor;
        }) };
      }

      const name = String(params.name || "");
      const matches = tools.filter(tool => tool.name === name);
      if (matches.length === 0) throw new Error(`webmcp_unknown_tool: ${name}`);
      if (matches.length !== 1) throw new Error(`webmcp_ambiguous_tool: ${name}`);

      const tool = matches[0];
      const readOnly = tool.annotations?.readOnlyHint === true &&
        tool.annotations?.consequentialHint !== true;
      if (!readOnly && params.options?.confirmed !== true) {
        throw new Error(`webmcp_confirmation_required: ${name}; confirm the action and arguments, then pass { confirmed: true }`);
      }

      // Keep the original RegisteredTool, including its owner window, in-page.
      return Promise.resolve(context.executeTool(tool, params.args || {}, {
        signal: controller.signal
      })).then(result => ({ result }));
    })
    .then(result => {
      if (calls[token] !== slot || controller.signal.aborted) return;
      checkDeadline();
      Object.assign(slot, { status: "done" }, result);
    })
    .catch(error => {
      if (calls[token] === slot) {
        Object.assign(slot, {
          status: "error", error: error?.message || String(error)
        });
      }
    });

  return { token, status: "pending", available: true };
}
