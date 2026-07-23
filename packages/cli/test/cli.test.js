"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseArgs, usage } = require("../bin/contextport");

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
  assert.match(text, /contextport export/);
  assert.match(text, /contextport import/);
  assert.doesNotMatch(text, /contextport sessions/);
  assert.doesNotMatch(text, /contextport inspect/);
  assert.doesNotMatch(text, /contextport handoff/);
});
