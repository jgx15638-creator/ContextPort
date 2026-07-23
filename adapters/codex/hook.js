#!/usr/bin/env node
"use strict";

const {
  buildImportedContext,
  takePendingImport,
  validateBundle
} = require("../../packages/core/src");

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      if (!input.trim()) return resolve({});
      try {
        resolve(JSON.parse(input));
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

function handleHookEvent(event) {
  if (event?.hook_event_name !== "UserPromptSubmit") return null;
  const sessionId = String(event.session_id || "unknown-session");
  const pending = takePendingImport("codex", sessionId, true);
  if (!pending) return null;
  const validation = validateBundle(pending.request?.bundle);
  if (!validation.valid) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: buildImportedContext(validation.bundle)
    }
  };
}

async function main() {
  const output = handleHookEvent(await readStdinJson());
  process.stdout.write(`${JSON.stringify(output || {})}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`ContextPort Codex hook: ${error.message || error}\n`);
    process.stdout.write("{}\n");
  });
}

module.exports = { handleHookEvent, readStdinJson };
