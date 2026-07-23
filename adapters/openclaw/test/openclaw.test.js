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

test("consumes an externally queued import without live capture hooks", async (t) => {
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
  const bundle = {
    schema: core.BUNDLE_SCHEMA,
    bundle_id: "openclaw-import-test",
    exported_at: "2026-07-23T00:00:00.000Z",
    source: { host: "codex", session: { id: "source-session" } },
    events: [
      { type: "llm.input", payload: { prompt: "Finish the task" } }
    ]
  };
  core.queueImport("openclaw", bundle, "target-session");

  const result = api.hooks.get("before_prompt_build")(
    { prompt: "Continue", messages: [] },
    { sessionId: "target-session", trigger: "user" }
  );
  assert.match(result.prependContext, /Imported ContextPort Handoff/);
  assert.match(result.prependContext, /Finish the task/);
  assert.deepEqual([...api.hooks.keys()], ["before_prompt_build"]);
  assert.ok(api.commands.has("context-export"));
  assert.ok(api.commands.has("context-import"));
});
