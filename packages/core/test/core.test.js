"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const core = require("../src");

function withTemporaryHome(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contextport-test-"));
  const previous = process.env.CONTEXTPORT_HOME;
  process.env.CONTEXTPORT_HOME = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.CONTEXTPORT_HOME;
    else process.env.CONTEXTPORT_HOME = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test("persists a sanitized session and exports a portable bundle", (t) => {
  withTemporaryHome(t);
  core.persistEvent(
    "openclaw",
    "llm.input",
    { sessionId: "session-1", runId: "run-1" },
    { agentId: "main" },
    { prompt: "Use sk-1234567890abcdefghij", password: "secret" }
  );

  const selected = core.resolveSession("openclaw", "latest");
  assert.equal(selected.record.session.id, "session-1");
  assert.match(selected.record.events[0].payload.prompt, /REDACTED_API_KEY/);
  assert.equal(selected.record.events[0].payload.password, "[REDACTED]");

  const bundle = core.createBundle("openclaw", "0.2.0", selected.record);
  assert.equal(bundle.schema, core.BUNDLE_SCHEMA);
  assert.equal(bundle.source.host, "openclaw");
  assert.equal(bundle.events.length, 1);
});

test("queues and atomically consumes an import", (t) => {
  withTemporaryHome(t);
  const bundle = {
    schema: core.BUNDLE_SCHEMA,
    bundle_id: "bundle-1",
    exported_at: new Date().toISOString(),
    source: { host: "openclaw", session: { id: "source" } },
    events: []
  };
  core.queueImport("openclaw", bundle);

  const pending = core.takePendingImport("openclaw", "target", true);
  assert.equal(pending.request.bundle.bundle_id, "bundle-1");
  assert.match(pending.file, /processed/);
  assert.equal(core.takePendingImport("openclaw", "target", true), null);
});

test("an untargeted same-host handoff is not consumed by its source session", (t) => {
  withTemporaryHome(t);
  const bundle = {
    schema: core.BUNDLE_SCHEMA,
    bundle_id: "bundle-2",
    exported_at: new Date().toISOString(),
    source: { host: "openclaw", session: { id: "source" } },
    events: []
  };
  core.queueImport("openclaw", bundle);
  assert.equal(core.takePendingImport("openclaw", "source", true), null);
  assert.equal(
    core.takePendingImport("openclaw", "different-session", true).request.bundle.bundle_id,
    "bundle-2"
  );
});

test("normalizes the original OpenClaw-only bundle format", () => {
  const result = core.validateBundle({
    schema: core.LEGACY_BUNDLE_SCHEMA,
    source: {
      platform: "openclaw",
      plugin_version: "0.1.0",
      session: { id: "old-session" }
    },
    events: []
  });
  assert.equal(result.valid, true);
  assert.equal(result.bundle.schema, core.BUNDLE_SCHEMA);
  assert.equal(result.bundle.source.host, "openclaw");
});

test("renders transferred events as explicitly untrusted context", () => {
  const text = core.buildImportedContext({
    schema: core.BUNDLE_SCHEMA,
    exported_at: "2026-07-20T00:00:00.000Z",
    source: { host: "openclaw", session: { id: "source" } },
    events: [
      { type: "llm.input", payload: { prompt: "Continue the migration" } },
      { type: "llm.output", payload: { assistant_texts: ["Work completed"] } }
    ]
  });
  assert.match(text, /untrusted historical context/);
  assert.match(text, /Continue the migration/);
  assert.match(text, /Work completed/);
});
