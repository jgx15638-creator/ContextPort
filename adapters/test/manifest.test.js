"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const adaptersDirectory = path.resolve(__dirname, "..");
const allowedStatuses = new Set(["planned", "experimental", "stable"]);
const capabilityKeys = [
  "live_capture",
  "historical_read",
  "external_export",
  "external_import",
  "targeted_import",
  "in_agent_commands"
];

test("adapter manifests are complete and use unique host ids", () => {
  const ids = new Set();
  const directories = fs
    .readdirSync(adaptersDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== "test")
    .map((entry) => entry.name);

  for (const required of ["openclaw", "codex", "claude-code"]) {
    assert.ok(directories.includes(required), `missing reserved adapter ${required}`);
  }

  for (const directory of directories) {
    const manifestFile = path.join(
      adaptersDirectory,
      directory,
      "contextport.adapter.json"
    );
    assert.ok(fs.existsSync(manifestFile), `${directory} is missing its manifest`);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    assert.equal(manifest.schema, "contextport.adapter/v1");
    assert.equal(manifest.id, directory);
    assert.ok(manifest.display_name);
    assert.ok(allowedStatuses.has(manifest.status));
    assert.equal(ids.has(manifest.id), false, `duplicate adapter id ${manifest.id}`);
    ids.add(manifest.id);

    for (const key of capabilityKeys) {
      assert.equal(
        typeof manifest.capabilities?.[key],
        "boolean",
        `${manifest.id}.${key} must be boolean`
      );
    }
    if (manifest.status === "planned") assert.equal(manifest.entrypoint, null);
    else assert.equal(typeof manifest.entrypoint, "string");
  }
});
