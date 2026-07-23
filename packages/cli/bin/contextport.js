#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  createBundle,
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
  contextport export [--from openclaw] [--session latest] [-o FILE]
  contextport import FILE [--to openclaw] [--session SESSION_ID]

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
