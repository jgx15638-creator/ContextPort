export const SESSION_SCHEMA = 'context-port.session.v1';
export const BUNDLE_SCHEMA = 'context-port.bundle.v1';
export const QUEUE_SCHEMA = 'context-port.import-queue.v1';

export const HOOK_EVENT_NAMES = {
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'post-tool-use': 'PostToolUse',
  stop: 'Stop',
};

export function normalizeHookName(name) {
  if (HOOK_EVENT_NAMES[name]) return name;
  const found = Object.entries(HOOK_EVENT_NAMES).find(([, eventName]) => eventName === name);
  return found?.[0] ?? '';
}

export function emptySession(input, now) {
  return {
    schema: SESSION_SCHEMA,
    session: {
      id: input.session_id,
      agent: 'codex',
      cwd: input.cwd ?? null,
      model: input.model ?? null,
      permissionMode: input.permission_mode ?? null,
      transcriptPath: input.transcript_path ?? null,
      startedAt: now,
      updatedAt: now,
    },
    events: [],
    messages: [],
    toolUses: [],
    summaries: [],
  };
}

export function validateBundle(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('bundle must be an object');
  }
  if (value.schema !== BUNDLE_SCHEMA) {
    throw new Error(`unsupported bundle schema: ${value.schema ?? 'missing'}`);
  }
  if (!value.session || typeof value.session.id !== 'string') {
    throw new Error('bundle is missing session.id');
  }
  return value;
}
