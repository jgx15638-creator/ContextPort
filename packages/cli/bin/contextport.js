#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  BUNDLE_SCHEMA,
  createBundle,
  listSessions,
  queueImport,
  readBundle,
  resolveSession,
  writeBundle
} = require("../../core/src");

const VERSION = "0.2.0";
const SUPPORTED_HOSTS = new Set(["openclaw"]);

function usage() {
  return `ContextPort ${VERSION} - portable context for AI agents

Usage:
  contextport sessions [--host openclaw]
  contextport export [--from openclaw] [--session latest] [-o FILE]
  contextport import FILE [--to openclaw] [--session SESSION_ID]
  contextport inspect FILE
  contextport handoff [--from openclaw] [--to openclaw] [--session latest]

Import without --session is consumed by the next user-triggered target session.`;
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("-")) {
      positional.push(value);
      continue;
    }
    const key = value.replace(/^-+/, "");
    const next = argv[index + 1];
    if (!next || next.startsWith("-")) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return { positional, options };
}

function option(options, longName, shortName, fallback) {
  return options[longName] || options[shortName] || fallback;
}

function requireHost(host) {
  if (!SUPPORTED_HOSTS.has(host)) {
    throw new Error(`Unsupported host: ${host}. Currently supported: openclaw.`);
  }
}

function exportSession(host, selector, output) {
  requireHost(host);
  const selected = resolveSession(host, selector);
  if (!selected) {
    throw new Error(
      `No captured ${host} session matched ${selector}. Run the host adapter first.`
    );
  }
  const bundle = createBundle(host, VERSION, selected.record);
  const file = writeBundle(bundle, output);
  return { bundle, file };
}

function printSessions(host) {
  requireHost(host);
  const sessions = listSessions(host);
  if (sessions.length === 0) {
    console.log(`No captured sessions for ${host}.`);
    return;
  }
  console.log("SESSION ID\tEVENTS\tUPDATED");
  for (const { record } of sessions) {
    console.log(
      `${record.session?.id || "unknown"}\t${record.events?.length || 0}\t${record.updated_at || "unknown"}`
    );
  }
}

function queue(bundle, host, sessionId) {
  requireHost(host);
  return queueImport(host, bundle, sessionId || null);
}

function run(argv = process.argv.slice(2)) {
  const command = argv[0];
  const { positional, options } = parseArgs(argv.slice(1));
  if (!command || command === "help" || options.help || options.h) {
    console.log(usage());
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    return;
  }

  if (command === "sessions") {
    printSessions(option(options, "host", null, "openclaw"));
    return;
  }

  if (command === "export") {
    const host = option(options, "from", null, "openclaw");
    const selector = option(options, "session", null, "latest");
    const output = option(options, "output", "o", null);
    const result = exportSession(host, selector, output);
    console.log(`Exported ${result.bundle.events.length} events from ${host}.`);
    console.log(`Bundle: ${result.file}`);
    return;
  }

  if (command === "import") {
    if (!positional[0]) throw new Error("import requires a bundle file.");
    const host = option(options, "to", null, "openclaw");
    const bundle = readBundle(path.resolve(positional[0]));
    const queued = queue(bundle, host, option(options, "session", null, null));
    console.log(`Queued bundle ${bundle.bundle_id} for ${host}.`);
    console.log(
      queued.request.target.session_id
        ? `Target session: ${queued.request.target.session_id}`
        : "Target: next user-triggered session"
    );
    return;
  }

  if (command === "inspect") {
    if (!positional[0]) throw new Error("inspect requires a bundle file.");
    const bundle = readBundle(path.resolve(positional[0]));
    console.log(JSON.stringify({
      schema: bundle.schema,
      bundle_id: bundle.bundle_id,
      exported_at: bundle.exported_at,
      source: bundle.source,
      event_count: bundle.events.length,
      safety: bundle.safety
    }, null, 2));
    return;
  }

  if (command === "handoff") {
    const source = option(options, "from", null, "openclaw");
    const target = option(options, "to", null, "openclaw");
    const selector = option(options, "session", null, "latest");
    const result = exportSession(source, selector, null);
    const queued = queue(result.bundle, target, null);
    console.log(`Exported ${result.bundle.events.length} events to ${result.file}`);
    console.log(`Queued handoff ${queued.request.request_id} for the next ${target} session.`);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`ContextPort: ${error.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, run, usage };
