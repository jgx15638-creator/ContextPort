"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const core = require("../../../packages/core/src");
const history = require("../history");

function withTemporaryState(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "contextport-openclaw-history-")
  );
  const previous = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function writeJsonl(file, items) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${items.map(JSON.stringify).join("\n")}\n`, "utf8");
}

test("reads indexed OpenClaw history and normalizes messages and tools", (t) => {
  const state = withTemporaryState(t);
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const sessionsDirectory = path.join(state, "agents", "main", "sessions");
  const transcript = path.join(sessionsDirectory, `${sessionId}.jsonl`);
  writeJsonl(transcript, [
    {
      type: "session",
      id: sessionId,
      version: 3,
      timestamp: "2026-07-23T10:00:00.000Z",
      cwd: "/tmp/openclaw-project"
    },
    {
      type: "message",
      timestamp: "2026-07-23T10:00:01.000Z",
      message: {
        role: "system",
        content: [{ type: "text", text: "private system prompt" }]
      }
    },
    {
      type: "message",
      timestamp: "2026-07-23T10:00:02.000Z",
      message: {
        role: "user",
        content: [
          { type: "text", text: "Fix login with sk-1234567890abcdefghij" }
        ]
      }
    },
    {
      type: "message",
      timestamp: "2026-07-23T10:00:03.000Z",
      message: {
        role: "assistant",
        provider: "test-provider",
        model: "test-model",
        content: [
          { type: "text", text: "I will inspect the tests." },
          {
            type: "toolCall",
            id: "call-1",
            name: "exec",
            arguments: { command: "npm test", password: "secret" }
          }
        ]
      }
    },
    {
      type: "message",
      timestamp: "2026-07-23T10:00:04.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "exec",
        isError: false,
        content: [{ type: "text", text: "tests passed" }]
      }
    }
  ]);
  fs.writeFileSync(
    path.join(sessionsDirectory, "sessions.json"),
    JSON.stringify({
      "agent:main:main": {
        sessionId,
        sessionFile: transcript,
        updatedAt: Date.parse("2026-07-23T10:00:04.000Z"),
        model: "test-model",
        modelProvider: "test-provider"
      }
    }),
    "utf8"
  );

  const selected = history.resolveSession("agent:main:main");
  assert.equal(selected.record.session.id, sessionId);
  assert.equal(selected.record.session.agent_id, "main");
  assert.equal(selected.record.session.cwd, "/tmp/openclaw-project");
  assert.deepEqual(
    selected.record.events.map((event) => event.type),
    ["llm.input", "llm.output", "tool.result"]
  );
  assert.doesNotMatch(JSON.stringify(selected.record), /private system prompt/);

  const bundle = core.createBundle(
    "openclaw",
    history.ADAPTER_VERSION,
    selected.record
  );
  assert.equal(bundle.schema, core.BUNDLE_SCHEMA);
  assert.equal(bundle.source.session.cwd, "/tmp/openclaw-project");
  assert.match(bundle.events[0].payload.prompt, /REDACTED_API_KEY/);
  assert.equal(bundle.events[2].payload.params.password, "[REDACTED]");
  assert.equal(bundle.transcript, undefined);
});

test("discovers orphan OpenClaw transcripts that are not in sessions.json", (t) => {
  const state = withTemporaryState(t);
  const sessionsDirectory = path.join(state, "agents", "worker", "sessions");
  const transcript = path.join(sessionsDirectory, "orphan-session.jsonl");
  writeJsonl(transcript, [
    {
      type: "session",
      id: "orphan-session",
      timestamp: "2026-07-23T11:00:00.000Z",
      cwd: "/tmp/orphan"
    },
    {
      type: "message",
      timestamp: "2026-07-23T11:00:01.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Recover this task" }]
      }
    }
  ]);

  const selected = history.resolveSession("worker/orphan-session");
  assert.equal(selected.record.session.id, "orphan-session");
  assert.equal(selected.record.session.agent_id, "worker");
  assert.match(selected.record.events[0].payload.prompt, /Recover this task/);
});

test("normalizes legacy toolUse blocks and tool messages", (t) => {
  const state = withTemporaryState(t);
  const sessionId = "legacy-tool-session";
  const sessionsDirectory = path.join(state, "agents", "legacy", "sessions");
  const transcript = path.join(sessionsDirectory, `${sessionId}.jsonl`);
  writeJsonl(transcript, [
    {
      type: "session",
      id: sessionId,
      version: 2,
      timestamp: "2026-07-23T12:00:00.000Z",
      cwd: "/tmp/legacy-project"
    },
    {
      type: "message",
      timestamp: "2026-07-23T12:00:01.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Run the compatibility test" }]
      }
    },
    {
      type: "message",
      timestamp: "2026-07-23T12:00:02.000Z",
      message: {
        role: "assistant",
        provider: "legacy-provider",
        model: "legacy-model",
        content: [
          { type: "text", text: "I will run the test." },
          {
            type: "toolUse",
            id: "legacy-call-1",
            name: "exec",
            input: { command: "npm test", password: "legacy-secret" }
          }
        ]
      }
    },
    {
      type: "message",
      timestamp: "2026-07-23T12:00:03.000Z",
      message: {
        role: "tool",
        toolUseId: "legacy-call-1",
        toolName: "exec",
        content: [{ type: "text", text: "compatibility tests passed" }]
      }
    }
  ]);

  const selected = history.resolveSession(`legacy/${sessionId}`);
  assert.deepEqual(
    selected.record.events.map((event) => event.type),
    ["llm.input", "llm.output", "tool.result"]
  );
  assert.equal(selected.record.events[2].payload.tool_name, "exec");
  assert.equal(selected.record.events[2].payload.tool_call_id, "legacy-call-1");
  assert.equal(selected.record.events[2].payload.params.command, "npm test");
  assert.equal(
    selected.record.events[2].payload.result,
    "compatibility tests passed"
  );

  const bundle = core.createBundle(
    "openclaw",
    history.ADAPTER_VERSION,
    selected.record
  );
  assert.equal(bundle.events[2].payload.params.password, "[REDACTED]");
});

test("skips malformed transcript lines and preserves orphan tool results", (t) => {
  const state = withTemporaryState(t);
  const sessionId = "malformed-session";
  const sessionsDirectory = path.join(state, "agents", "worker", "sessions");
  const transcript = path.join(sessionsDirectory, `${sessionId}.jsonl`);
  fs.mkdirSync(sessionsDirectory, { recursive: true });
  fs.writeFileSync(
    transcript,
    [
      JSON.stringify({
        type: "session",
        id: sessionId,
        version: 3,
        timestamp: "2026-07-23T13:00:00.000Z",
        cwd: "/tmp/malformed-project"
      }),
      '{"type":"message","message":',
      JSON.stringify({
        type: "message",
        timestamp: "2026-07-23T13:00:01.000Z",
        message: {
          role: "toolResult",
          toolName: "read_file",
          content: [{ type: "text", text: "orphan result" }]
        }
      }),
      ""
    ].join("\n"),
    "utf8"
  );

  const selected = history.resolveSession(`worker/${sessionId}`);
  assert.equal(selected.record.events.length, 1);
  assert.equal(selected.record.events[0].type, "tool.result");
  assert.equal(selected.record.events[0].payload.tool_name, "read_file");
  assert.equal(selected.record.events[0].payload.tool_call_id, null);
  assert.equal(selected.record.events[0].payload.params, null);
  assert.equal(selected.record.events[0].payload.result, "orphan result");
});
