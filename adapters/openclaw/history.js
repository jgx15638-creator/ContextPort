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
const HOST = "openclaw";
const MAX_TRANSCRIPT_BYTES = 100 * 1024 * 1024;
const MAX_EVENTS = 500;
const LEGACY_STATE_DIRECTORIES = [".clawdbot", ".moldbot", ".moltbot"];

function expandHome(value, home) {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(home, value.slice(2));
  }
  return value;
}

function getOpenClawStateDir() {
  const fallbackHome = path.resolve(
    process.env.HOME || process.env.USERPROFILE || os.homedir()
  );
  const configuredHome = process.env.OPENCLAW_HOME?.trim();
  const home = path.resolve(
    configuredHome ? expandHome(configuredHome, fallbackHome) : fallbackHome
  );
  const override =
    process.env.OPENCLAW_STATE_DIR || process.env.CLAWDBOT_STATE_DIR;
  if (override?.trim()) return path.resolve(expandHome(override.trim(), home));

  const current = path.join(home, ".openclaw");
  if (fs.existsSync(current)) return current;
  for (const directory of LEGACY_STATE_DIRECTORIES) {
    const candidate = path.join(home, directory);
    if (fs.existsSync(candidate)) return candidate;
  }
  return current;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function realPathOrResolved(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function pathWithin(directory, candidate) {
  const base = realPathOrResolved(directory);
  const target = realPathOrResolved(candidate);
  const relative = path.relative(base, target);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return target;
  }
  return null;
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function resolveTranscriptFile(sessionsDirectory, sessionId, entry = {}) {
  const configured = typeof entry.sessionFile === "string"
    ? entry.sessionFile.trim()
    : "";
  if (configured) {
    const candidate = path.isAbsolute(configured)
      ? configured
      : path.join(sessionsDirectory, configured);
    const contained = pathWithin(sessionsDirectory, candidate);
    if (contained && isFile(contained)) return contained;
  }
  const fallback = path.join(sessionsDirectory, `${sessionId}.jsonl`);
  return isFile(fallback) ? realPathOrResolved(fallback) : null;
}

function listAgentDirectories(agentsDirectory) {
  if (!fs.existsSync(agentsDirectory)) return [];
  return fs
    .readdirSync(agentsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      agentId: entry.name,
      sessionsDirectory: path.join(agentsDirectory, entry.name, "sessions")
    }));
}

function mergeDescriptor(descriptors, descriptor) {
  const key = realPathOrResolved(descriptor.file);
  const existing = descriptors.get(key);
  if (!existing) {
    descriptors.set(key, { ...descriptor, sessionKeys: descriptor.sessionKeys || [] });
    return;
  }
  existing.updatedAt = Math.max(existing.updatedAt, descriptor.updatedAt);
  existing.sessionKeys = [
    ...new Set([...(existing.sessionKeys || []), ...(descriptor.sessionKeys || [])])
  ];
}

function discoverSessions() {
  const agentsDirectory = path.join(getOpenClawStateDir(), "agents");
  const descriptors = new Map();

  for (const { agentId, sessionsDirectory } of listAgentDirectories(agentsDirectory)) {
    if (!fs.existsSync(sessionsDirectory)) continue;
    const store = readJson(path.join(sessionsDirectory, "sessions.json"), {});
    if (store && typeof store === "object" && !Array.isArray(store)) {
      for (const [sessionKey, entry] of Object.entries(store)) {
        const sessionId = String(entry?.sessionId || "").trim();
        if (!sessionId) continue;
        const file = resolveTranscriptFile(sessionsDirectory, sessionId, entry);
        if (!file) continue;
        const stat = fs.statSync(file);
        mergeDescriptor(descriptors, {
          agentId,
          file,
          id: sessionId,
          sessionKeys: [sessionKey],
          updatedAt: Math.max(Number(entry.updatedAt) || 0, stat.mtimeMs),
          model: entry.model || null,
          provider: entry.modelProvider || null
        });
      }
    }

    for (const name of fs.readdirSync(sessionsDirectory)) {
      if (!name.endsWith(".jsonl")) continue;
      const file = realPathOrResolved(path.join(sessionsDirectory, name));
      const stat = fs.statSync(file);
      mergeDescriptor(descriptors, {
        agentId,
        file,
        id: path.basename(name, ".jsonl"),
        sessionKeys: [],
        updatedAt: stat.mtimeMs,
        model: null,
        provider: null
      });
    }
  }

  return [...descriptors.values()].sort(
    (left, right) => right.updatedAt - left.updatedAt
  );
}

function extractText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      return item?.type === "text" && typeof item.text === "string"
        ? item.text
        : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeTimestamp(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  return new Date(fallback || 0).toISOString();
}

function eventId(sessionId, lineNumber, type) {
  return crypto
    .createHash("sha256")
    .update(`${sessionId}:${lineNumber}:${type}`)
    .digest("hex")
    .slice(0, 32);
}

function normalizedEvent(descriptor, sessionId, lineNumber, at, type, payload) {
  return {
    schema: EVENT_SCHEMA,
    event_id: eventId(sessionId, lineNumber, type),
    timestamp: at,
    type,
    session: {
      id: sessionId,
      agent_id: descriptor.agentId,
      run_id: null
    },
    payload
  };
}

function parseSession(descriptor) {
  const stat = fs.statSync(descriptor.file);
  if (stat.size > MAX_TRANSCRIPT_BYTES) {
    throw new Error(
      `OpenClaw transcript is larger than ${MAX_TRANSCRIPT_BYTES / 1024 / 1024} MB: ${descriptor.file}`
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

    if (item.type === "session") {
      metadata = item;
      continue;
    }
    if (item.type !== "message" || !item.message) continue;

    const message = item.message;
    const sessionId = String(metadata.id || descriptor.id);
    const at = normalizeTimestamp(
      item.timestamp || message.timestamp,
      stat.mtimeMs
    );

    if (message.role === "user") {
      const text = extractText(message.content);
      if (text) {
        events.push(
          normalizedEvent(descriptor, sessionId, index, at, "llm.input", {
            prompt: text
          })
        );
      }
      continue;
    }

    if (message.role === "assistant") {
      const text = extractText(message.content);
      if (text) {
        events.push(
          normalizedEvent(descriptor, sessionId, index, at, "llm.output", {
            provider: message.provider || descriptor.provider,
            model: message.model || descriptor.model,
            assistant_texts: [text]
          })
        );
      }
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block?.type !== "toolCall" && block?.type !== "toolUse") continue;
          const callId = block.id || block.toolCallId;
          if (!callId) continue;
          pendingTools.set(callId, {
            name: block.name || "unknown",
            input: block.arguments ?? block.input ?? null
          });
        }
      }
      continue;
    }

    if (message.role === "toolResult" || message.role === "tool") {
      const callId = message.toolCallId || message.toolUseId || null;
      const pending = pendingTools.get(callId) || {
        name: message.toolName || "unknown",
        input: null
      };
      const output = extractText(message.content);
      events.push(
        normalizedEvent(descriptor, sessionId, index, at, "tool.result", {
          tool_name: message.toolName || pending.name,
          tool_call_id: callId,
          params: pending.input,
          result: message.isError ? null : output || null,
          error: message.isError ? output || "Tool call failed" : null
        })
      );
      if (callId) pendingTools.delete(callId);
    }
  }

  const sessionId = String(metadata.id || descriptor.id);
  return {
    schema: SESSION_SCHEMA,
    host: HOST,
    memory_id: sessionId,
    session: {
      id: sessionId,
      agent_id: descriptor.agentId,
      cwd: metadata.cwd || null
    },
    created_at: normalizeTimestamp(metadata.timestamp, stat.birthtimeMs),
    updated_at: normalizeTimestamp(descriptor.updatedAt, stat.mtimeMs),
    native: {
      agent_id: descriptor.agentId,
      session_keys: descriptor.sessionKeys,
      transcript_path: descriptor.file,
      transcript_version: metadata.version || null
    },
    events: events.slice(Math.max(0, events.length - MAX_EVENTS))
  };
}

function matchesSelector(descriptor, selector) {
  return (
    descriptor.id === selector ||
    path.basename(descriptor.file, ".jsonl") === selector ||
    descriptor.sessionKeys.includes(selector) ||
    `${descriptor.agentId}/${descriptor.id}` === selector
  );
}

function resolveSession(selector = "latest") {
  const sessions = discoverSessions();
  const descriptor = selector === "latest"
    ? sessions[0]
    : sessions.find((session) => matchesSelector(session, selector));
  if (!descriptor) return null;
  return { file: descriptor.file, record: parseSession(descriptor) };
}

module.exports = {
  ADAPTER_VERSION,
  discoverSessions,
  getOpenClawStateDir,
  parseSession,
  resolveSession
};
