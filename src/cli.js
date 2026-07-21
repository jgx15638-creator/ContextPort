#!/usr/bin/env node
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { installCodexHooks } from './codex-config.js';
import {
  renderHookOutput,
  renderImportQueuedMessage,
  renderImportedContext,
  renderTerminalPreview,
} from './format.js';
import {
  appendHookEvent,
  consumeQueuedImport,
  dataDir,
  displayPath,
  exportBundle,
  importBundle,
  loadBundle,
  latestExportPath,
  latestImportPath,
  listSessions,
} from './store.js';
import { normalizeHookName } from './schema.js';

const args = process.argv.slice(2);

try {
  await main(args);
} catch (err) {
  await writeErrorLog(err).catch(() => {});
  if (args[0] === 'hook') {
    process.exitCode = 0;
  } else {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

async function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'install':
      return installCommand(rest);
    case 'hook':
      return hookCommand(rest);
    case 'export':
      return exportCommand(rest);
    case 'import':
      return importCommand(rest);
    case 'preview':
      return previewCommand(rest);
    case 'list':
      return listCommand();
    case 'paths':
      return pathsCommand();
    case 'help':
    case undefined:
      return helpCommand();
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

async function installCommand(argv) {
  const global = argv.includes('--global');
  const rootFlag = readFlag(argv, '--root');
  const result = await installCodexHooks({ global, root: rootFlag || process.cwd() });
  process.stdout.write(`wrote ${result.hooksPath}\n`);
  process.stdout.write(`wrote ${result.configPath}\n`);
}

async function hookCommand(argv) {
  if (argv[0] !== 'run') throw new Error('usage: context-port hook run <hook-name>');
  const hookName = normalizeHookName(argv[1]);
  if (!hookName) throw new Error(`unknown hook: ${argv[1] ?? ''}`);
  const input = await readStdinJson();
  await appendHookEvent(hookName, input);

  if (hookName === 'session-start' || hookName === 'user-prompt-submit') {
    const bundle = await consumeQueuedImport();
    if (bundle) process.stdout.write(renderHookOutput(hookName, renderImportedContext(bundle)));
  }
}

async function exportCommand(argv) {
  const ref = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'latest';
  const output = readFlag(argv, '-o') || readFlag(argv, '--output');
  const result = await exportBundle(ref, output);
  process.stdout.write(`exported ${result.bundle.session.id}\n`);
  process.stdout.write(`${displayPath(result.target)}\n`);
}

async function importCommand(argv) {
  const input = argv[0] || 'latest';
  const result = await importBundle(input);
  if (argv.includes('--preview')) {
    process.stdout.write(`${renderTerminalPreview(result.bundle, result.target)}\n`);
    return;
  }
  process.stdout.write(`${renderImportQueuedMessage(result)}\n`);
}

async function previewCommand(argv) {
  const input = argv[0] || 'latest';
  const result = await loadBundle(input);
  process.stdout.write(`${renderTerminalPreview(result.bundle, result.path)}\n`);
}

async function listCommand() {
  const sessions = await listSessions();
  process.stdout.write(`dataDir: ${dataDir()}\n`);
  process.stdout.write('sessions:\n');
  for (const session of sessions) {
    process.stdout.write(`- ${session.session.id} ${session.session.updatedAt} ${session.session.cwd ?? ''}\n`);
  }
  process.stdout.write(`latestExport: ${displayPath(await latestExportPath())}\n`);
  process.stdout.write(`latestImport: ${displayPath(await latestImportPath())}\n`);
}

async function pathsCommand() {
  process.stdout.write(`${dataDir()}\n`);
}

function helpCommand() {
  process.stdout.write(`Context Port

Usage:
  context-port install [--global] [--root <path>]
  context-port hook run <session-start|user-prompt-submit|post-tool-use|stop>
  context-port export [latest|session-id] [-o <path>]
  context-port import <bundle.json|latest>
  context-port import <bundle.json|latest> --preview
  context-port preview [bundle.json|latest]
  context-port list
  context-port paths

Environment:
  CONTEXT_PORT_HOME  Override the local data directory.
  CODEX_HOME         Used by install --global.
`);
}

async function readStdinJson() {
  if (process.stdin.isTTY) return {};
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object') return {};
  if (!value.session_id) value.session_id = 'unknown';
  return value;
}

function readFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return '';
  return argv[index + 1] || '';
}

async function writeErrorLog(err) {
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  await appendFile(
    join(dir, 'errors.log'),
    `${JSON.stringify({
      at: new Date().toISOString(),
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      node: process.execPath,
      error: {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : null,
      },
    })}\n`,
    'utf8',
  );
}
