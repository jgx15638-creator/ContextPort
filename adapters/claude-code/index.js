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
const HOST = "claude-code";
const MAX_TRANSCRIPT_BYTES = 100 * 1024 * 1024;
const MAX_EVENTS = 500;

function getClaudeHome() {
  return path.resolve(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")
  );
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

// Claude Code stores one transcript per session under
// <home>/projects/<project-slug>/<session-id>.jsonl. Unlike Codex there is no
// session_meta line, so discovery relies on the file name and stat times only.
function discoverSessions() {
  const projectsDirectory = path.join(getClaudeHome(), "projects");

  return listJsonlFiles(projectsDirectory)
    .map((file) => {
      const stat = fs.statSync(file);
      return {
        file,
        id: path.basename(file, ".jsonl"),
        projectSlug: path.basename(path.dirname(file)),
        cwd: null,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString()
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

// Assistant content is a block array. Only plain text blocks may be exported;
// thinking blocks are internal reasoning and stay out of the bundle.
function textFromBlocks(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      return block?.type === "text" && typeof block.text === "string"
        ? block.text
        : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
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
      `Claude Code transcript is larger than ${MAX_TRANSCRIPT_BYTES / 1024 / 1024} MB: ${descriptor.file}`
    );
  }

  const lines = fs.readFileSync(descriptor.file, "utf8").split(/\r?\n/);
  const events = [];
  const pendingTools = new Map();
  const metadata = { sessionId: null, cwd: null, version: null, gitBranch: null };
  let model = null;
  let firstTimestamp = null;
  let lastTimestamp = null;

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    let item;
    try {
      item = JSON.parse(lines[index]);
    } catch {
      continue;
    }

    // Session metadata is repeated on most rows instead of a dedicated header.
    if (!metadata.sessionId && item.sessionId) metadata.sessionId = item.sessionId;
    if (!metadata.cwd && item.cwd) metadata.cwd = item.cwd;
    if (!metadata.version && item.version) metadata.version = item.version;
    if (!metadata.gitBranch && item.gitBranch) metadata.gitBranch = item.gitBranch;
    if (item.timestamp) {
      if (!firstTimestamp) firstTimestamp = item.timestamp;
      lastTimestamp = item.timestamp;
    }

    const sessionId = String(metadata.sessionId || descriptor.id);

    if (item.type === "user" && item.message) {
      const content = item.message.content;

      if (typeof content === "string") {
        const text = content.trim();
        if (text) {
          events.push(
            normalizedEvent(sessionId, index, item.timestamp, "llm.input", {
              prompt: text
            })
          );
        }
        continue;
      }

      // Tool results are delivered under the user role because the host treats
      // them as input to the model.
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== "tool_result") continue;
          const callId = block.tool_use_id || null;
          const pending = pendingTools.get(callId) || { name: "unknown", input: null };
          const output = textFromBlocks(block.content);
          events.push(
            normalizedEvent(sessionId, index, item.timestamp, "tool.result", {
              tool_name: pending.name,
              tool_call_id: callId,
              params: pending.input,
              result: block.is_error ? null : output || null,
              error: block.is_error ? output || "Tool call failed" : null
            })
          );
          if (callId) pendingTools.delete(callId);
        }
      }
      continue;
    }

    if (item.type === "assistant" && item.message) {
      if (item.message.model) model = item.message.model;
      const content = item.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block?.type === "text" && typeof block.text === "string") {
          const text = block.text.trim();
          if (!text) continue;
          events.push(
            normalizedEvent(sessionId, index, item.timestamp, "llm.output", {
              provider: null,
              model: item.message.model || model,
              assistant_texts: [text]
            })
          );
          continue;
        }
        if (block?.type === "tool_use" && block.id) {
          pendingTools.set(block.id, {
            name: block.name || "unknown",
            input: block.input ?? null
          });
        }
      }
      continue;
    }

    // Every other row type is host bookkeeping or injected system context and
    // must never leave the machine.
  }

  const sessionId = String(metadata.sessionId || descriptor.id);
  return {
    schema: SESSION_SCHEMA,
    host: HOST,
    memory_id: sessionId,
    session: {
      id: sessionId,
      agent_id: HOST,
      cwd: metadata.cwd || descriptor.cwd || null
    },
    created_at: firstTimestamp || descriptor.createdAt,
    updated_at: lastTimestamp || descriptor.updatedAt,
    native: {
      project_slug: descriptor.projectSlug || null,
      transcript_path: descriptor.file,
      transcript_version: metadata.version,
      git_branch: metadata.gitBranch,
      model
    },
    events: events.slice(Math.max(0, events.length - MAX_EVENTS))
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

module.exports = {
  ADAPTER_VERSION,
  discoverSessions,
  getClaudeHome,
  parseSession,
  resolveSession
};
