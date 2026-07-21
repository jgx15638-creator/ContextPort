import { HOOK_EVENT_NAMES } from './schema.js';

export function renderHookOutput(hookName, additionalContext) {
  const text = additionalContext?.trim();
  if (!text) return '';
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT_NAMES[hookName] ?? hookName,
      additionalContext: text,
    },
  })}\n`;
}

export function renderImportedContext(bundle) {
  const summaries = lastItems(bundle.summaries ?? [], 5).map((s) => s.content).filter(Boolean);
  const userGoals = lastItems(bundle.messages ?? [], 8)
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .filter(Boolean);
  const toolUses = lastItems(bundle.toolUses ?? [], 8)
    .map((tool) => {
      const target = extractToolTarget(tool.input);
      return `${tool.toolName || 'tool'}${target ? `: ${target}` : ''}`;
    })
    .filter(Boolean);

  const parts = [
    '## Imported Codex session context',
    '',
    `Source session: ${bundle.session.id}`,
    `Source cwd: ${bundle.session.cwd ?? 'unknown'}`,
    `Exported at: ${bundle.exportedAt ?? 'unknown'}`,
  ];

  if (summaries.length > 0) {
    parts.push('', '### Recent assistant summaries');
    for (const item of summaries) parts.push(`- ${oneLine(item)}`);
  }

  if (userGoals.length > 0) {
    parts.push('', '### Recent user goals');
    for (const item of userGoals) parts.push(`- ${oneLine(item)}`);
  }

  if (toolUses.length > 0) {
    parts.push('', '### Recent tool work');
    for (const item of toolUses) parts.push(`- ${oneLine(item)}`);
  }

  parts.push(
    '',
    'Use this imported context as prior-session memory. First restate the inherited project goal, technical stack, completed work, and next step before making changes.',
  );

  return parts.join('\n');
}

export function renderImportQueuedMessage(result) {
  return [
    'Context import queued for the next Codex turn.',
    `Imported session: ${result.bundle.session.id}`,
    `Stored bundle: ${result.target}`,
    '',
    'Now send a normal prompt, for example:',
    '"Please restate the project goal, technical stack, completed work, and next step from the imported context."',
  ].join('\n');
}

export function renderTerminalPreview(bundle, sourcePath, command = '/context-import latest') {
  const sessionId = bundle.session.id;
  const projectName = inferProjectName(bundle);
  const projectGoal = inferProjectGoal(bundle);
  const techStack = inferTechStack(bundle);
  const nextStep = inferNextStep(bundle);
  const completed = lastItems(bundle.summaries ?? [], 3).map((s) => oneLine(s.content, 160));

  const lines = [
    `context-port tui - agent codex - session ${sessionId}`,
    '',
    `session agent:codex:${sessionId}`,
    '',
    `new session: agent:codex:target-session`,
    '',
    command,
    '',
    'Context has been queued for the next turn in the current session.',
    `Source file: ${sourcePath}`,
    '',
    'Now send a normal message, for example:',
    '"Please restate the project goal, technical stack, completed work, and next step inherited from the previous session."',
    '',
    'Please restate the project goal, technical stack, completed work, and next step from the previous session.',
    '',
    'Based on the imported workspace context, the prior-session recap is:',
    '',
    `Project name: ${projectName}`,
    `Project goal: ${projectGoal}`,
    `Technical stack: ${techStack}`,
    'Completed work:',
    ...completed.map((item) => `- ${item}`),
    `Next step: ${nextStep}`,
    '',
    'The imported context is ready. Continue from this recap before making new changes.',
  ];

  return lines.join('\n');
}

function lastItems(items, limit) {
  return items.slice(Math.max(0, items.length - limit));
}

function oneLine(value, max = 360) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function extractToolTarget(input) {
  if (!input || typeof input !== 'object') return '';
  for (const key of ['file_path', 'path', 'command']) {
    if (typeof input[key] === 'string') return input[key];
  }
  return '';
}

function inferProjectName(bundle) {
  const cwd = bundle.session.cwd;
  if (!cwd) return 'unknown';
  return String(cwd).split(/[\\/]/).filter(Boolean).pop() || 'unknown';
}

function inferProjectGoal(bundle) {
  const firstUser = (bundle.messages ?? []).find((m) => m.role === 'user' && m.content);
  return firstUser ? oneLine(firstUser.content, 160) : 'not captured';
}

function inferTechStack(bundle) {
  const text = JSON.stringify({
    messages: bundle.messages ?? [],
    toolUses: bundle.toolUses ?? [],
  }).toLowerCase();
  const hits = [];
  for (const item of ['react', 'typescript', 'javascript', 'node', 'vite', 'next', 'pnpm']) {
    if (text.includes(item)) hits.push(item);
  }
  return hits.length > 0 ? hits.join(', ') : 'not captured';
}

function inferNextStep(bundle) {
  const summaries = bundle.summaries ?? [];
  const last = summaries[summaries.length - 1]?.content;
  return last ? `continue after: ${oneLine(last, 120)}` : 'ask the user what to do next';
}
