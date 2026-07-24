"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const adapter = require("../index");
const { BUNDLE_SCHEMA, EVENT_SCHEMA, SESSION_SCHEMA, createBundle } = require("../../../packages/core/src");

const ADAPTER_DIRECTORY = path.join(__dirname, "..");
const FIXTURE = path.join(__dirname, "fixtures", "session.jsonl");
const EDGE_CASE_FIXTURE = path.join(__dirname, "fixtures", "edge-cases.jsonl");

function fixtureDescriptor(file = FIXTURE) {
  return {
    file,
    id: "fallback-id",
    projectSlug: "demo",
    cwd: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function withTemporaryHome(run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "contextport-claude-code-"));
  const projectDirectory = path.join(home, "projects", "-tmp-demo");
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.copyFileSync(
    FIXTURE,
    path.join(projectDirectory, "11111111-2222-3333-4444-555555555555.jsonl")
  );
  const subagentDirectory = path.join(
    projectDirectory,
    "99999999-8888-7777-6666-555555555555",
    "subagents"
  );
  fs.mkdirSync(subagentDirectory, { recursive: true });
  const subagentFile = path.join(subagentDirectory, "agent-newest.jsonl");
  fs.copyFileSync(EDGE_CASE_FIXTURE, subagentFile);
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(subagentFile, future, future);

  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = home;
  try {
    return run(home);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("manifest declares a valid adapter contract", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ADAPTER_DIRECTORY, "contextport.adapter.json"), "utf8")
  );

  assert.equal(manifest.schema, "contextport.adapter/v1");
  assert.equal(manifest.id, "claude-code");
  assert.equal(manifest.entrypoint, "index.js");
  assert.ok(fs.existsSync(path.join(ADAPTER_DIRECTORY, manifest.entrypoint)));
  assert.equal(manifest.capabilities.historical_read, true);
  assert.equal(manifest.capabilities.external_export, true);
  assert.equal(manifest.capabilities.live_capture, false);
  assert.equal(manifest.capabilities.external_import, false);
});

test("parses the native fixture into ordered core events", () => {
  const record = adapter.parseSession(fixtureDescriptor());

  assert.equal(record.schema, SESSION_SCHEMA);
  assert.equal(record.host, "claude-code");
  assert.equal(record.session.id, "11111111-2222-3333-4444-555555555555");
  assert.equal(record.session.cwd, "/tmp/demo");
  assert.equal(record.native.transcript_version, "2.1.215");
  assert.equal(record.native.model, "test-model-v1");

  assert.deepEqual(
    record.events.map((event) => event.type),
    ["llm.input", "llm.output", "tool.result", "tool.result", "llm.output"]
  );
  for (const event of record.events) {
    assert.equal(event.schema, EVENT_SCHEMA);
    assert.ok(event.event_id);
  }
});

test("pairs tool calls with their results and preserves errors", () => {
  const record = adapter.parseSession(fixtureDescriptor());
  const [firstTool, secondTool] = record.events.filter(
    (event) => event.type === "tool.result"
  );

  assert.equal(firstTool.payload.tool_name, "Write");
  assert.equal(firstTool.payload.tool_call_id, "call-0001");
  assert.equal(firstTool.payload.params.file_path, "/tmp/demo/fib.py");
  assert.equal(firstTool.payload.error, null);

  assert.equal(secondTool.payload.tool_name, "Bash");
  assert.equal(secondTool.payload.result, null);
  assert.match(secondTool.payload.error, /command not found/);
});

test("never exports system prompts or internal reasoning", () => {
  const record = adapter.parseSession(fixtureDescriptor());
  const serialized = JSON.stringify(record);

  assert.equal(serialized.includes("System reminder text"), false);
  assert.equal(serialized.includes("Internal reasoning"), false);
  assert.equal(serialized.includes("agent_listing_delta"), false);
});

test("exports array-form user text and keeps every event id unique", () => {
  const record = adapter.parseSession(fixtureDescriptor(EDGE_CASE_FIXTURE));

  assert.deepEqual(
    record.events.map((event) => event.type),
    ["llm.input", "llm.input", "tool.result", "tool.result"]
  );
  assert.deepEqual(
    record.events
      .filter((event) => event.type === "llm.input")
      .map((event) => event.payload.prompt),
    ["First array prompt", "Second array prompt"]
  );
  assert.equal(new Set(record.events.map((event) => event.event_id)).size, 4);
});

test("skips metadata wrappers and sidechain rows", () => {
  const serialized = JSON.stringify(
    adapter.parseSession(fixtureDescriptor(EDGE_CASE_FIXTURE))
  );

  for (const hiddenText of [
    "Hidden metadata prompt",
    "<local-command-caveat>",
    "<command-name>",
    "<local-command-stdout>",
    "<system-reminder>",
    "Hidden sidechain prompt"
  ]) {
    assert.equal(serialized.includes(hiddenText), false);
  }
});

test("skips malformed and blank transcript lines", () => {
  const raw = fs.readFileSync(FIXTURE, "utf8").split(/\r?\n/);
  const unparsable = raw.filter((line) => {
    if (!line.trim()) return false;
    try {
      JSON.parse(line);
      return false;
    } catch {
      return true;
    }
  });

  assert.ok(unparsable.length > 0, "fixture must contain a malformed line");
  assert.equal(adapter.parseSession(fixtureDescriptor()).events.length, 5);
});

test("rejects transcripts above the size guard", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "contextport-oversized-"));
  const file = path.join(home, "oversized.jsonl");
  fs.writeFileSync(file, "{}\n");

  const realStatSync = fs.statSync;
  fs.statSync = (target, ...rest) => {
    const stat = realStatSync(target, ...rest);
    if (target === file) stat.size = 200 * 1024 * 1024;
    return stat;
  };

  try {
    assert.throws(
      () => adapter.parseSession({ ...fixtureDescriptor(), file }),
      /larger than/
    );
  } finally {
    fs.statSync = realStatSync;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("discovers top-level sessions but never subagent transcripts", () => {
  withTemporaryHome(() => {
    const sessions = adapter.discoverSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, "11111111-2222-3333-4444-555555555555");
    assert.equal(sessions[0].projectSlug, "-tmp-demo");

    const latest = adapter.resolveSession("latest");
    assert.ok(latest);
    assert.equal(latest.record.session.id, "11111111-2222-3333-4444-555555555555");
    assert.equal(latest.file.includes(`${path.sep}subagents${path.sep}`), false);

    const targeted = adapter.resolveSession("11111111-2222-3333-4444-555555555555");
    assert.ok(targeted);
    assert.equal(targeted.record.events.length, 5);

    assert.equal(adapter.resolveSession("missing-session"), null);
  });
});

test("exports a valid ContextPort bundle", () => {
  const record = adapter.parseSession(fixtureDescriptor());
  const bundle = createBundle("claude-code", adapter.ADAPTER_VERSION, record);

  assert.equal(bundle.schema, BUNDLE_SCHEMA);
  assert.equal(bundle.source.host, "claude-code");
  assert.equal(bundle.events.length, 5);
});
