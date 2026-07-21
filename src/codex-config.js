import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANAGED_MARKERS = [
  'context-port hook run',
  'context-port\\src\\cli.js',
  'context-port/src/cli.js',
  'context-port\\bin\\context-port-hook.cmd',
  'context-port/bin/context-port-hook.cmd',
];
const HOOKS = [
  ['SessionStart', 'session-start', 'Loading imported context'],
  ['UserPromptSubmit', 'user-prompt-submit'],
  ['PostToolUse', 'post-tool-use'],
  ['Stop', 'stop'],
];

export async function installCodexHooks({ global = false, root = process.cwd() } = {}) {
  const base = global ? resolve(process.env.CODEX_HOME || join(homedir(), '.codex')) : join(resolve(root), '.codex');
  const hooksPath = join(base, 'hooks.json');
  const configPath = join(base, 'config.toml');
  const commandPrefix = hookCommandPrefix();

  const hooksFile = await readJson(hooksPath, {});
  const hooks = { ...(hooksFile.hooks ?? {}) };
  let changed = false;

  for (const [eventName, hookName, statusMessage] of HOOKS) {
    const existing = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
    const filtered = existing
      .map((group) => ({
        ...group,
        hooks: Array.isArray(group.hooks)
          ? group.hooks.filter((hook) => !isManagedHookCommand(String(hook.command ?? '')))
          : [],
      }))
      .filter((group) => group.hooks.length > 0);

    filtered.push({
      matcher: null,
      hooks: [
        {
          type: 'command',
          command: `${commandPrefix} ${hookName}`,
          timeout: 30,
          ...(statusMessage ? { statusMessage } : {}),
        },
      ],
    });
    hooks[eventName] = filtered;
    changed = true;
  }

  await mkdir(dirname(hooksPath), { recursive: true });
  await writeFile(hooksPath, `${JSON.stringify({ ...hooksFile, hooks }, null, 2)}\n`, 'utf8');
  await ensureHooksFeature(configPath);

  return { hooksPath, configPath, changed };
}

function hookCommandPrefix() {
  const nodeCommand = process.env.CONTEXT_PORT_NODE || 'node';
  return `${quoteCommand(nodeCommand)} ${quote(fileURLToPath(new URL('./cli.js', import.meta.url)))} hook run`;
}

async function ensureHooksFeature(configPath) {
  let content = '';
  if (existsSync(configPath)) content = await readFile(configPath, 'utf8');

  const hasHooks = hasExactLine(content, 'hooks = true');
  const hasLegacy = hasExactLine(content, 'codex_hooks = true');

  if (hasHooks && !hasLegacy) return;
  if (hasLegacy) content = removeExactLine(content, 'codex_hooks = true');
  if (!hasHooks) {
    if (content.includes('[features]')) {
      content = content.replace('[features]', '[features]\nhooks = true');
    } else {
      if (content && !content.endsWith('\n')) content += '\n';
      content += '\n[features]\nhooks = true\n';
    }
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, content, 'utf8');
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function quoteCommand(value) {
  const text = String(value);
  if (process.platform === 'win32' && text === 'node') return text;
  return quote(text);
}

function isManagedHookCommand(command) {
  return MANAGED_MARKERS.some((marker) => command.includes(marker));
}

function hasExactLine(content, line) {
  return content.split(/\r?\n/).some((raw) => raw.trim() === line);
}

function removeExactLine(content, line) {
  return content
    .split(/\r?\n/)
    .filter((raw) => raw.trim() !== line)
    .join('\n');
}
