#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import {
  createHash,
  randomBytes
} from "node:crypto";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  resolve
} from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = dirname(scriptPath);
const runtimePath = resolve(
  scriptDirectory,
  "runtime/safari-repl.jxa.js"
);
const sessionPattern = /^[a-f0-9]{16}$/;
const requestTimeoutMs = 120_000;
const idleTimeoutMs = 15 * 60_000;

function sessionRoot() {
  return resolve(
    process.env.SBU_SESSION_DIR ||
      join(tmpdir(), `safari-browser-use-${process.getuid?.() ?? "user"}`)
  );
}

function sessionPaths(sessionId) {
  if (!sessionPattern.test(String(sessionId))) {
    throw new Error("invalid_session_id");
  }

  const root = sessionRoot();
  const rootHash = createHash("sha256")
    .update(root)
    .digest("hex")
    .slice(0, 8);
  const socket = join(
    tmpdir(),
    `sbu-${process.getuid?.() ?? "user"}-${rootHash}-${sessionId}.sock`
  );

  return {
    root,
    socket,
    state: join(root, `${sessionId}.json`),
    error: join(root, `${sessionId}.error`)
  };
}

async function prepareSessionRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function parseOptions(args) {
  const options = {};
  const positional = [];

  for (let index = 0; index < args.length; index++) {
    const value = args[index];

    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const name = value.slice(2);
    const next = args[index + 1];

    if (!next) {
      throw new Error(`missing_value_for_${name}`);
    }

    options[name] = next;
    index++;
  }

  return { options, positional };
}

function requireOption(options, name) {
  const value = options[name];

  if (!value) {
    throw new Error(`missing_${name.replaceAll("-", "_")}`);
  }

  return value;
}

class McpRuntime {
  constructor() {
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = [];
    this.closing = false;
  }

  async start() {
    this.child = spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", runtimePath],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    const lines = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity
    });
    lines.on("line", line => this.handleLine(line));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", chunk => {
      this.stderr.push(String(chunk));
      if (this.stderr.length > 20) {
        this.stderr.shift();
      }
    });
    this.child.on("error", error => this.rejectAll(error));
    this.child.on("exit", code => {
      if (!this.closing) {
        const detail = this.stderr.join("").trim();
        this.rejectAll(new Error(
          detail || `safari_runtime_exited_${code}`
        ));
      }
    });

    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "safari-browser-use-skill",
        version: "0.2.0"
      }
    });
  }

  handleLine(line) {
    let message;

    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    const pending = this.pending.get(message.id);

    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pending.timeout);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  request(method, params) {
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(new Error("safari_runtime_unavailable"));
    }

    const id = this.nextId++;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    return new Promise((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error("safari_runtime_timeout"));
      }, requestTimeoutMs);
      this.pending.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timeout
      });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async callTool(name, args) {
    const result = await this.request("tools/call", {
      name,
      arguments: args
    });

    if (result.isError) {
      const text = (result.content || [])
        .map(part => part.text || "")
        .filter(Boolean)
        .join("\n");
      throw new Error(text || "safari_tool_failed");
    }

    return result;
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async close() {
    if (!this.child) {
      return;
    }

    this.closing = true;
    this.child.stdin.end();

    if (this.child.exitCode === null) {
      await Promise.race([
        new Promise(resolveExit => this.child.once("exit", resolveExit)),
        delay(2_000)
      ]);
    }

    if (this.child.exitCode === null) {
      this.child.kill("SIGTERM");
    }
  }
}

async function normalizeToolResult(result, sessionId) {
  const paths = sessionPaths(sessionId);
  const images = [];
  const imageParts = (result.content || []).filter(
    part => part.type === "image" && typeof part.data === "string"
  );

  for (let index = 0; index < imageParts.length; index++) {
    const part = imageParts[index];
    const extension = part.mimeType === "image/jpeg" ? ".jpg" : ".png";
    const path = join(
      paths.root,
      `${sessionId}-${Date.now()}-${index}${extension}`
    );
    await writeFile(path, Buffer.from(part.data, "base64"), {
      mode: 0o600
    });
    images.push(path);
  }

  const structured = result.structuredContent || {};

  return {
    ok: true,
    value: structured.value ?? null,
    output: structured.output || [],
    images
  };
}

async function sendSessionRequest(sessionId, request) {
  const paths = sessionPaths(sessionId);
  const state = JSON.parse(await readFile(paths.state, "utf8"));

  return new Promise((resolveRequest, rejectRequest) => {
    const socket = createConnection(state.socket);
    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectRequest(new Error("skill_session_timeout"));
    }, requestTimeoutMs);

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", chunk => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");

      if (newline === -1) {
        return;
      }

      clearTimeout(timeout);
      socket.end();

      try {
        resolveRequest(JSON.parse(buffer.slice(0, newline)));
      } catch {
        rejectRequest(new Error("invalid_skill_session_response"));
      }
    });
    socket.on("error", error => {
      clearTimeout(timeout);
      rejectRequest(error);
    });
  });
}

async function waitForSession(sessionId) {
  const paths = sessionPaths(sessionId);
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const response = await sendSessionRequest(sessionId, {
        command: "ping"
      });

      if (response.ok) {
        return;
      }
    } catch {
      try {
        const detail = await readFile(paths.error, "utf8");
        throw new Error(detail.trim() || "skill_session_start_failed");
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }

    await delay(50);
  }

  throw new Error("skill_session_start_timeout");
}

async function startSession() {
  const sessionId = randomBytes(8).toString("hex");
  const paths = sessionPaths(sessionId);
  await prepareSessionRoot(paths.root);
  await rm(paths.error, { force: true });

  const child = spawn(
    process.execPath,
    [scriptPath, "__serve", "--session", sessionId],
    {
      detached: true,
      stdio: "ignore",
      env: process.env
    }
  );
  child.unref();
  await waitForSession(sessionId);

  return {
    ok: true,
    sessionId
  };
}

async function serveSession(sessionId) {
  const paths = sessionPaths(sessionId);
  await prepareSessionRoot(paths.root);
  await rm(paths.socket, { force: true });

  const runtime = new McpRuntime();
  await runtime.start();

  let stopping = false;
  let queue = Promise.resolve();
  let idleTimer;
  const server = createServer(socket => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", chunk => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");

      if (newline === -1) {
        return;
      }

      socket.pause();
      const line = buffer.slice(0, newline);
      queue = queue.then(async () => {
        let request;

        try {
          request = JSON.parse(line);
          const response = await handleSessionRequest(
            runtime,
            sessionId,
            request
          );
          socket.end(`${JSON.stringify(response)}\n`);

          if (request.command === "stop") {
            stopping = true;
            setTimeout(shutdown, 25);
          } else {
            refreshIdleTimer();
          }
        } catch (error) {
          socket.end(`${JSON.stringify({
            ok: false,
            error: error.message || String(error)
          })}\n`);
        }
      });
    });
  });

  async function shutdown() {
    if (!stopping) {
      stopping = true;
    }
    clearTimeout(idleTimer);
    await new Promise(resolveClose => server.close(resolveClose));
    await runtime.close();
    await rm(paths.socket, { force: true });
    await rm(paths.state, { force: true });
  }

  function refreshIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stopping = true;
      shutdown().finally(() => process.exit(0));
    }, idleTimeoutMs);
    idleTimer.unref();
  }

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(paths.socket, resolveListen);
  });
  await chmod(paths.socket, 0o600);
  await writeFile(paths.state, JSON.stringify({
    pid: process.pid,
    socket: paths.socket
  }), { mode: 0o600 });
  refreshIdleTimer();

  await new Promise(resolveStopped => {
    server.once("close", resolveStopped);
  });
}

async function handleSessionRequest(runtime, sessionId, request) {
  switch (request.command) {
    case "ping":
      return { ok: true };
    case "run":
      return normalizeToolResult(
        await runtime.callTool("js", {
          title: request.title,
          code: request.code
        }),
        sessionId
      );
    case "reset":
      return normalizeToolResult(
        await runtime.callTool("js_reset", {}),
        sessionId
      );
    case "doctor":
      return normalizeToolResult(
        await runtime.callTool("js", {
          title: "Check Safari connection",
          code: "browser.doctor()"
        }),
        sessionId
      );
    case "documentation": {
      const topic = request.topic === undefined
        ? ""
        : JSON.stringify(String(request.topic));
      return normalizeToolResult(
        await runtime.callTool("js", {
          title: "Read Safari operating guide",
          code: topic
            ? `browser.documentation(${topic})`
            : "browser.documentation()"
        }),
        sessionId
      );
    }
    case "release":
      return normalizeToolResult(
        await runtime.callTool("js", {
          title: "Release Safari control",
          code: "browser.release()"
        }),
        sessionId
      );
    case "stop": {
      const result = await runtime.callTool("js", {
        title: "Release Safari control",
        code: "browser.release()"
      });
      return normalizeToolResult(result, sessionId);
    }
    default:
      throw new Error(`unknown_command_${request.command}`);
  }
}

function printHelp() {
  process.stdout.write([
    "Usage:",
    "  safari-repl.mjs start",
    "  safari-repl.mjs doctor --session ID",
    "  safari-repl.mjs documentation --session ID [--topic NAME]",
    "  safari-repl.mjs run --session ID --title TITLE (--code CODE | --code-file PATH)",
    "  safari-repl.mjs reset --session ID",
    "  safari-repl.mjs release --session ID",
    "  safari-repl.mjs stop --session ID"
  ].join("\n") + "\n");
}

async function runCommand(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  const { options } = parseOptions(rest);

  if (command === "__serve") {
    const sessionId = requireOption(options, "session");
    const paths = sessionPaths(sessionId);

    try {
      await serveSession(sessionId);
    } catch (error) {
      await prepareSessionRoot(paths.root);
      await writeFile(
        paths.error,
        error.message || String(error),
        { mode: 0o600 }
      );
      throw error;
    }
    return;
  }

  let response;

  if (command === "start") {
    response = await startSession();
  } else {
    const sessionId = requireOption(options, "session");
    const request = { command };

    if (command === "run") {
      request.title = requireOption(options, "title");

      if (options["code-file"]) {
        request.code = await readFile(
          resolve(options["code-file"]),
          "utf8"
        );
      } else {
        request.code = requireOption(options, "code");
      }
    }

    if (command === "documentation" && options.topic) {
      request.topic = options.topic;
    }

    response = await sendSessionRequest(sessionId, request);
  }

  if (!response.ok) {
    throw new Error(response.error || "skill_command_failed");
  }

  process.stdout.write(`${JSON.stringify(response)}\n`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  runCommand(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: error.message || String(error)
    })}\n`);
    process.exitCode = 1;
  });
}
