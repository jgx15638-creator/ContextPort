# Codex Adapter

Status: **experimental**. Tested against Codex CLI `0.144.5`.

The adapter reads existing Codex JSONL transcripts without modifying them. It
normalizes user messages, assistant messages, and completed tool calls into the
shared `contextport.bundle/v1` format. Developer messages, system instructions,
reasoning payloads, and raw transcript files are not exported.

## Export

```bash
contextport export --from codex
contextport export --from codex --session SESSION_ID -o task.contextport.json
```

Both active sessions under `~/.codex/sessions` and archived sessions under
`~/.codex/archived_sessions` are discoverable. Set `CODEX_HOME` to override the
Codex data directory.

## Import

```bash
contextport import task.contextport.json --to codex
```

The first Codex import adds one managed `UserPromptSubmit` command hook to
`~/.codex/hooks.json`. Existing hooks are preserved. Codex may ask the user to
trust this hook the first time it runs. On the next normal user prompt, the hook
injects the imported bundle as untrusted historical context and consumes it
exactly once.

Target a known Codex session when needed:

```bash
contextport import task.contextport.json --to codex --session SESSION_ID
```

ContextPort does not edit Codex transcript files or write hook trust hashes.

To roll back the integration, remove only the `UserPromptSubmit` hook group
whose command ends in `adapters/codex/hook.js` from `~/.codex/hooks.json`.
