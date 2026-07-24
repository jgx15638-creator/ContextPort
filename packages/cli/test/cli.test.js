"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseArgs, run, usage } = require("../bin/contextport");

test("parses positional values and long and short options", () => {
  const parsed = parseArgs([
    "bundle.json",
    "--to",
    "openclaw",
    "-o",
    "result.json"
  ]);
  assert.deepEqual(parsed.positional, ["bundle.json"]);
  assert.equal(parsed.options.to, "openclaw");
  assert.equal(parsed.options.o, "result.json");
});

test("exposes only export and import as product commands", () => {
  const text = usage();
  const exportLine = text
    .split("\n")
    .find((line) => line.includes("contextport export"));
  const importLine = text
    .split("\n")
    .find((line) => line.includes("contextport import"));

  assert.match(exportLine, /openclaw\|codex\|claude-code/);
  assert.match(importLine, /openclaw\|codex/);
  assert.doesNotMatch(importLine, /claude-code/);
  assert.doesNotMatch(text, /contextport sessions/);
  assert.doesNotMatch(text, /contextport inspect/);
  assert.doesNotMatch(text, /contextport handoff/);
});

test("rejects Claude Code as an import target", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contextport-cli-"));
  const bundleFile = path.join(directory, "bundle.json");
  fs.writeFileSync(
    bundleFile,
    JSON.stringify({
      schema: "contextport.bundle/v1",
      source: { host: "openclaw" },
      events: []
    })
  );

  try {
    assert.throws(
      () => run(["import", bundleFile, "--to", "claude-code"]),
      /Host claude-code does not support import yet/
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
