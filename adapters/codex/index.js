"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  EVENT_SCHEMA,
  SESSION_SCHEMA
} = require("../../packages/core/src");

const ADAPTER_VERSION = "0.2.0";
const HOST = "codex";
const MAX_TRANSCRIPT_BYTES = 100 * 1024 * 1024;
const MAX_EVENTS = 500;

function getCodexHome() {
  return path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}

function listJsonlFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJsonlFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(target);
  }
  return files;
}

function readFirstJsonLine(file) {
  const descriptor = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, length).toString("utf8").split(/\r?\n/, 1)[0];
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  } finally {
    fs.closeSync(descriptor);
  }
}

function sessionIdFromFile(file) {
  const match = path.basename(file).match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match?.[1] || path.basename(file, ".jsonl");
}

function discoverSessions() {
  const home = getCodexHome();
  const files = [
    ...listJsonlFiles(path.join(home, "sessions")),
    ...listJsonlFiles(path.join(home, "archived_sessions"))
  ];

  return files
    .map((file) => {
      const stat = fs.statSync(file);
      const first = readFirstJsonLine(file);
      const metadata = first?.type === "session_meta" ? first.payload || {} : {};
      return {
        file,
        id: String(metadata.id || metadata.session_id || sessionIdFromFile(file)),
        cwd: metadata.cwd || null,
        createdAt: metadata.timestamp || first?.timestamp || stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
        cliVersion: metadata.cli_version || null
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function textFromMessage(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "input_text" || item?.type === "output_text")
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseToolInput(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function eventId(sessionId, lineNumber, type) {
  return crypto
    .createHash("sha256")
    .update(`${sessionId}:${lineNumber}:${type}`)
    .digest("hex")
    .slice(0, 32);
}

function normalizedEvent(sessionId, lineNumber, timestamp, type, payload) {
  return {
    schema: EVENT_SCHEMA,
    event_id: eventId(sessionId, lineNumber, type),
    timestamp: timestamp || new Date(0).toISOString(),
    type,
    session: { id: sessionId, agent_id: HOST, run_id: null },
    payload
  };
}

function parseSession(descriptor) {
  const stat = fs.statSync(descriptor.file);
  if (stat.size > MAX_TRANSCRIPT_BYTES) {
    throw new Error(
      `Codex transcript is larger than ${MAX_TRANSCRIPT_BYTES / 1024 / 1024} MB: ${descriptor.file}`
    );
  }

  const lines = fs.readFileSync(descriptor.file, "utf8").split(/\r?\n/);
  const events = [];
  const pendingTools = new Map();
  let metadata = {};

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    let item;
    try {
      item = JSON.parse(lines[index]);
    } catch {
      continue;
    }

    if (item.type === "session_meta") {
      metadata = item.payload || metadata;
      continue;
    }
    if (item.type !== "response_item" || !item.payload) continue;

    const payload = item.payload;
    if (payload.type === "message") {
      const text = textFromMessage(payload.content);
      if (!text || (payload.role !== "user" && payload.role !== "assistant")) {
        continue;
      }
      events.push(
        normalizedEvent(
          descriptor.id,
          index,
          item.timestamp,
          payload.role === "user" ? "llm.input" : "llm.output",
          payload.role === "user"
            ? { prompt: text }
            : { assistant_texts: [text] }
        )
      );
      continue;
    }

    if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      const callId = payload.call_id || payload.id;
      if (callId) {
        pendingTools.set(callId, {
          name: payload.name || "unknown",
          input: parseToolInput(payload.arguments ?? payload.input)
        });
      }
      continue;
    }

    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const callId = payload.call_id || payload.id;
      const pending = pendingTools.get(callId) || { name: "unknown", input: null };
      events.push(
        normalizedEvent(descriptor.id, index, item.timestamp, "tool.result", {
          tool_name: pending.name,
          tool_call_id: callId || null,
          params: pending.input,
          result: payload.output ?? null,
          error: null
        })
      );
      pendingTools.delete(callId);
    }
  }

  const selectedEvents = events.slice(Math.max(0, events.length - MAX_EVENTS));
  return {
    schema: SESSION_SCHEMA,
    host: HOST,
    memory_id: descriptor.id,
    session: {
      id: descriptor.id,
      agent_id: HOST,
      cwd: metadata.cwd || descriptor.cwd || null
    },
    created_at: metadata.timestamp || descriptor.createdAt,
    updated_at: descriptor.updatedAt,
    native: {
      cwd: metadata.cwd || descriptor.cwd,
      cli_version: metadata.cli_version || descriptor.cliVersion,
      transcript_path: descriptor.file
    },
    events: selectedEvents
  };
}

function resolveSession(selector = "latest") {
  const sessions = discoverSessions();
  const descriptor =
    selector === "latest"
      ? sessions[0]
      : sessions.find(
          (session) =>
            session.id === selector ||
            path.basename(session.file, ".jsonl") === selector
        );
  if (!descriptor) return null;
  return { file: descriptor.file, record: parseSession(descriptor) };
}

function quoteCommand(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function isManagedHook(command) {
  const normalized = String(command).replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("/adapters/codex/hook.js") ||
    normalized.includes("context-port hook run") ||
    normalized.includes("context-port/src/cli.js") ||
    normalized.includes("contextport/src/cli.js")
  );
}

function removeManagedHooks(groups) {
  if (!Array.isArray(groups)) return groups;
  return groups
    .map((group) => ({
      ...group,
      hooks: Array.isArray(group.hooks)
        ? group.hooks.filter((hook) => !isManagedHook(hook.command))
        : []
    }))
    .filter((group) => group.hooks.length > 0);
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(temporary, file);
}

function ensureImportHook() {
  const hooksPath = path.join(getCodexHome(), "hooks.json");
  let config = {};
  if (fs.existsSync(hooksPath)) config = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  const hooks = { ...(config.hooks || {}) };
  for (const [eventName, groups] of Object.entries(hooks)) {
    hooks[eventName] = removeManagedHooks(groups);
  }
  const filtered = Array.isArray(hooks.UserPromptSubmit)
    ? hooks.UserPromptSubmit
    : [];

  const hookFile = path.join(__dirname, "hook.js");
  filtered.push({
    hooks: [
      {
        type: "command",
        command: `${quoteCommand(process.execPath)} ${quoteCommand(hookFile)}`,
        statusMessage: "Loading imported ContextPort context",
        timeout: 30
      }
    ]
  });
  hooks.UserPromptSubmit = filtered;
  writeJsonAtomic(hooksPath, { ...config, hooks });
  return { hooksPath, hookFile };
}

function prepareImport() {
  return ensureImportHook();
}

module.exports = {
  ADAPTER_VERSION,
  discoverSessions,
  ensureImportHook,
  getCodexHome,
  parseSession,
  prepareImport,
  resolveSession
};
