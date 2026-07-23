"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const core = require("../../../packages/core/src");
const adapter = require("../index");
const { handleHookEvent } = require("../hook");

function withTemporaryHomes(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextport-codex-"));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousContextPortHome = process.env.CONTEXTPORT_HOME;
  process.env.CODEX_HOME = path.join(root, "codex");
  process.env.CONTEXTPORT_HOME = path.join(root, "contextport");
  t.after(() => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousContextPortHome === undefined) delete process.env.CONTEXTPORT_HOME;
    else process.env.CONTEXTPORT_HOME = previousContextPortHome;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function writeSyntheticSession(id) {
  const directory = path.join(process.env.CODEX_HOME, "sessions", "2026", "07", "23");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `rollout-2026-07-23T10-00-00-${id}.jsonl`);
  const items = [
    {
      timestamp: "2026-07-23T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id,
        timestamp: "2026-07-23T10:00:00.000Z",
        cwd: "/tmp/project",
        cli_version: "0.144.5",
        base_instructions: "private system prompt"
      }
    },
    {
      timestamp: "2026-07-23T10:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "do not export this" }]
      }
    },
    {
      timestamp: "2026-07-23T10:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Fix login with sk-1234567890abcdefghij" }]
      }
    },
    {
      timestamp: "2026-07-23T10:00:03.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell_command",
        call_id: "call-1",
        arguments: JSON.stringify({ command: "npm test", password: "secret" })
      }
    },
    {
      timestamp: "2026-07-23T10:00:04.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: "tests passed"
      }
    },
    {
      timestamp: "2026-07-23T10:00:05.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Login fixed" }]
      }
    }
  ];
  fs.writeFileSync(file, `${items.map(JSON.stringify).join("\n")}\n`, "utf8");
  return file;
}

test("reads historical Codex JSONL and normalizes only portable events", (t) => {
  withTemporaryHomes(t);
  const id = "11111111-2222-3333-4444-555555555555";
  writeSyntheticSession(id);

  const selected = adapter.resolveSession("latest");
  assert.equal(selected.record.session.id, id);
  assert.deepEqual(
    selected.record.events.map((event) => event.type),
    ["llm.input", "tool.result", "llm.output"]
  );
  assert.doesNotMatch(JSON.stringify(selected.record), /private system prompt/);
  assert.doesNotMatch(JSON.stringify(selected.record), /do not export this/);

  const bundle = core.createBundle("codex", adapter.ADAPTER_VERSION, selected.record);
  assert.equal(bundle.schema, core.BUNDLE_SCHEMA);
  assert.equal(bundle.source.session.cwd, "/tmp/project");
  assert.match(bundle.events[0].payload.prompt, /REDACTED_API_KEY/);
  assert.equal(bundle.events[1].payload.params.password, "[REDACTED]");
  assert.equal(bundle.transcript, undefined);
});

test("installs one managed UserPromptSubmit hook without replacing other hooks", (t) => {
  withTemporaryHomes(t);
  const hooksPath = path.join(process.env.CODEX_HOME, "hooks.json");
  fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
  fs.writeFileSync(
    hooksPath,
    JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "existing-start" }] },
          {
            hooks: [
              {
                type: "command",
                command: "node /old/ContextPort/src/cli.js hook run session-start"
              }
            ]
          }
        ],
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "existing-prompt" }] }
        ]
      }
    })
  );

  adapter.ensureImportHook();
  adapter.ensureImportHook();
  const config = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  assert.equal(config.hooks.SessionStart.length, 1);
  assert.equal(config.hooks.SessionStart[0].hooks[0].command, "existing-start");
  assert.equal(config.hooks.UserPromptSubmit.length, 2);
  assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].command, "existing-prompt");
  assert.match(config.hooks.UserPromptSubmit[1].hooks[0].command, /adapters[\\/]codex[\\/]hook\.js/);
  assert.equal(fs.existsSync(path.join(process.env.CODEX_HOME, "config.toml")), false);
});

test("injects a queued import once and skips its source Codex session", (t) => {
  withTemporaryHomes(t);
  const bundle = {
    schema: core.BUNDLE_SCHEMA,
    bundle_id: "bundle-codex-1",
    exported_at: "2026-07-23T10:00:00.000Z",
    source: { host: "codex", session: { id: "source-session" } },
    events: [
      { type: "llm.input", payload: { prompt: "Continue the migration" } }
    ]
  };
  core.queueImport("codex", bundle);

  assert.equal(
    handleHookEvent({
      hook_event_name: "UserPromptSubmit",
      session_id: "source-session"
    }),
    null
  );
  const output = handleHookEvent({
    hook_event_name: "UserPromptSubmit",
    session_id: "target-session"
  });
  assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(output.hookSpecificOutput.additionalContext, /untrusted historical context/);
  assert.match(output.hookSpecificOutput.additionalContext, /Continue the migration/);
  assert.match(output.hookSpecificOutput.additionalContext, /Source cwd: unknown/);
  assert.equal(
    handleHookEvent({
      hook_event_name: "UserPromptSubmit",
      session_id: "target-session"
    }),
    null
  );
});
