"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const core = require("../../../packages/core/src");
const adapter = require("../index");

function createApi() {
  const hooks = new Map();
  const commands = new Map();
  return {
    hooks,
    commands,
    on(name, handler) {
      hooks.set(name, handler);
    },
    registerCommand(command) {
      commands.set(command.name, command);
    },
    logger: { info() {}, warn() {} },
    session: {
      workflow: {
        async enqueueNextTurnInjection() {}
      }
    }
  };
}

test("captures OpenClaw events and consumes an externally queued import", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contextport-openclaw-"));
  const previous = process.env.CONTEXTPORT_HOME;
  process.env.CONTEXTPORT_HOME = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.CONTEXTPORT_HOME;
    else process.env.CONTEXTPORT_HOME = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const api = createApi();
  adapter.register(api);
  api.hooks.get("session_start")(
    { sessionId: "source-session" },
    { sessionId: "source-session", agentId: "main" }
  );
  api.hooks.get("llm_input")(
    {
      sessionId: "source-session",
      runId: "run-1",
      provider: "test",
      model: "test-model",
      prompt: "Finish the task",
      historyMessages: [],
      imagesCount: 0
    },
    { sessionId: "source-session", agentId: "main" }
  );

  const selected = core.resolveSession("openclaw", "source-session");
  const bundle = core.createBundle("openclaw", "0.2.0", selected.record);
  core.queueImport("openclaw", bundle, "target-session");

  const result = api.hooks.get("before_prompt_build")(
    { prompt: "Continue", messages: [] },
    { sessionId: "target-session", trigger: "user" }
  );
  assert.match(result.prependContext, /Imported ContextPort Handoff/);
  assert.match(result.prependContext, /Finish the task/);
  assert.ok(api.commands.has("context-export"));
  assert.ok(api.commands.has("context-import"));
});
