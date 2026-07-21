import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { BUNDLE_SCHEMA, QUEUE_SCHEMA, emptySession, validateBundle } from './schema.js';

export function dataDir() {
  return resolve(process.env.CONTEXT_PORT_HOME || join(process.cwd(), '.context-port'));
}

export function sessionPath(sessionId) {
  return join(dataDir(), 'sessions', `${safeId(sessionId)}.json`);
}

export function exportsDir() {
  return join(dataDir(), 'exports');
}

export function importsDir() {
  return join(dataDir(), 'imports');
}

export function queuePath() {
  return join(dataDir(), 'queue', 'next-import.json');
}

export function safeId(id) {
  const value = String(id || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
  return value || 'unknown';
}

export async function readJson(path, fallback = undefined) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export async function loadOrCreateSession(input) {
  const id = typeof input.session_id === 'string' && input.session_id ? input.session_id : 'unknown';
  const now = new Date().toISOString();
  const path = sessionPath(id);
  const existing = await readJson(path, null);
  if (existing) return existing;
  return emptySession({ ...input, session_id: id }, now);
}

export async function saveSession(session) {
  await writeJson(sessionPath(session.session.id), session);
}

export function updateSessionMetadata(session, input, now = new Date().toISOString()) {
  session.session.updatedAt = now;
  if (input.cwd) session.session.cwd = input.cwd;
  if (input.model) session.session.model = input.model;
  if (input.permission_mode) session.session.permissionMode = input.permission_mode;
  if (input.transcript_path) session.session.transcriptPath = input.transcript_path;
}

export async function appendHookEvent(hookName, input) {
  const now = new Date().toISOString();
  const session = await loadOrCreateSession(input);
  updateSessionMetadata(session, input, now);

  session.events.push({
    type: input.hook_event_name || hookName,
    hookName,
    at: now,
    turnId: input.turn_id ?? null,
    raw: input,
  });

  if (hookName === 'user-prompt-submit' && typeof input.prompt === 'string' && input.prompt.trim()) {
    session.messages.push({
      role: 'user',
      content: input.prompt,
      turnId: input.turn_id ?? null,
      at: now,
    });
  }

  if (hookName === 'post-tool-use') {
    session.toolUses.push({
      toolName: input.tool_name ?? input.tool ?? 'unknown',
      toolUseId: input.tool_use_id ?? null,
      input: input.tool_input ?? null,
      response: input.tool_response ?? input.tool_output ?? null,
      at: now,
    });
  }

  if (hookName === 'stop') {
    const content = input.last_assistant_message ?? input.turn_summary;
    if (typeof content === 'string' && content.trim()) {
      session.messages.push({
        role: 'assistant',
        content,
        turnId: input.turn_id ?? null,
        at: now,
      });
      session.summaries.push({
        scope: 'turn',
        content,
        at: now,
      });
    }
  }

  await saveSession(session);
  return session;
}

export async function listSessions() {
  const dir = join(dataDir(), 'sessions');
  let names = [];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const sessions = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const session = await readJson(join(dir, name), null);
    if (session?.schema) sessions.push(session);
  }
  return sessions.sort((a, b) => String(b.session.updatedAt).localeCompare(String(a.session.updatedAt)));
}

export async function findSession(ref = 'latest') {
  const sessions = await listSessions();
  if (ref === 'latest') return sessions[0] ?? null;
  return sessions.find((s) => s.session.id === ref || safeId(s.session.id) === safeId(ref)) ?? null;
}

export async function buildBundle(session) {
  const transcript = await readTranscript(session.session.transcriptPath);
  return {
    schema: BUNDLE_SCHEMA,
    exportedAt: new Date().toISOString(),
    source: {
      agent: 'codex',
      host: process.env.COMPUTERNAME || process.env.HOSTNAME || null,
    },
    session: session.session,
    messages: session.messages,
    toolUses: session.toolUses,
    summaries: session.summaries,
    events: session.events,
    transcript,
  };
}

export async function exportBundle(ref = 'latest', output) {
  const session = await findSession(ref);
  if (!session) throw new Error(`session not found: ${ref}`);
  const bundle = await buildBundle(session);
  const target = resolveExportPath(output, session.session.id);
  await writeJson(target, bundle);
  return { target, bundle };
}

export async function importBundle(pathOrLatest) {
  const inputPath = await resolveImportInput(pathOrLatest);
  const bundle = validateBundle(await readJson(inputPath));
  const importedAt = new Date().toISOString();
  const target = join(importsDir(), `${compactTimestamp(importedAt)}-${safeId(bundle.session.id)}.json`);
  await writeJson(target, { ...bundle, importedAt });
  await writeJson(queuePath(), {
    schema: QUEUE_SCHEMA,
    queuedAt: importedAt,
    bundlePath: target,
    sourcePath: inputPath,
    sessionId: bundle.session.id,
  });
  return { target, bundle };
}

export async function loadBundle(pathOrLatest = 'latest') {
  const inputPath = await resolveBundleInput(pathOrLatest);
  return {
    path: inputPath,
    bundle: validateBundle(await readJson(inputPath)),
  };
}

export async function consumeQueuedImport() {
  const queue = await readJson(queuePath(), null);
  if (queue?.consumed) return null;
  if (!queue?.bundlePath) return null;
  const bundle = validateBundle(await readJson(queue.bundlePath));
  await writeJson(queuePath(), {
    ...queue,
    consumedAt: new Date().toISOString(),
    consumed: true,
  });
  return bundle;
}

export async function latestExportPath() {
  return latestJsonFile(exportsDir());
}

export async function latestImportPath() {
  return latestJsonFile(importsDir());
}

async function latestJsonFile(dir) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
  const items = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const path = join(dir, name);
    items.push({ path, mtimeMs: (await stat(path)).mtimeMs });
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items[0]?.path ?? null;
}

async function resolveImportInput(pathOrLatest) {
  if (!pathOrLatest || pathOrLatest === 'latest') {
    const latest = await latestExportPath();
    if (!latest) throw new Error('no exported bundle found');
    return latest;
  }
  const path = resolve(pathOrLatest);
  if (!existsSync(path)) throw new Error(`bundle file not found: ${path}`);
  return path;
}

async function resolveBundleInput(pathOrLatest) {
  if (!pathOrLatest || pathOrLatest === 'latest') {
    const latest = (await latestImportPath()) || (await latestExportPath());
    if (!latest) throw new Error('no bundle found');
    return latest;
  }
  const path = resolve(pathOrLatest);
  if (!existsSync(path)) throw new Error(`bundle file not found: ${path}`);
  return path;
}

function resolveExportPath(output, sessionId) {
  const filename = `context-${safeId(sessionId)}-${Date.now()}.json`;
  if (!output) return join(exportsDir(), filename);
  const resolved = resolve(output);
  if (output.endsWith('.json')) return resolved;
  return join(resolved, filename);
}

async function readTranscript(path) {
  if (!path) return null;
  try {
    const data = await readFile(path);
    return {
      originalPath: path,
      encoding: 'base64',
      content: data.toString('base64'),
      byteLength: data.byteLength,
    };
  } catch {
    return {
      originalPath: path,
      missing: true,
    };
  }
}

function compactTimestamp(value) {
  return value.replace(/[-:.TZ]/g, '').slice(0, 14);
}

export function displayPath(path) {
  return path ? resolve(path) : '';
}
