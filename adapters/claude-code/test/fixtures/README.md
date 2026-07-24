# Fixtures

`session.jsonl` is synthetic. It mimics the transcript layout produced by
Claude Code 2.1.215 under `~/.claude/projects/<slug>/<session-id>.jsonl`.
No real user data, paths, or credentials are included.

Coverage:

- session-level noise rows: `mode`, `permission-mode`, `file-history-snapshot`, `ai-title`
- a user prompt with string content
- an `attachment` row (host-injected context, must be skipped)
- an assistant `thinking` block (must be skipped)
- assistant `text` blocks
- `tool_use` blocks paired with `tool_result` rows that arrive under the user role
- a failed tool result carrying `is_error`
- a `system` row (must never be exported)
- one malformed line and one blank line
