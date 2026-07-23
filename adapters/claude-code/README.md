# Claude Code Adapter

Status: **planned**. This directory is reserved for the Claude Code integration.

## Expected Work

1. Document supported Claude Code versions, hooks, and native session storage.
2. Implement a read-only historical transcript reader.
3. Use supported hooks to capture incremental state when they add useful data.
4. Normalize messages, tool activity, plans, file paths, and outcomes into Core.
5. Implement import through supported hooks or session-start context injection.
6. Add clean-environment install, export, import, and rollback tests.

## Acceptance Scenario

```text
Create a Claude Code session with user messages, tool calls, edits, and tests
  -> contextport export --from claude-code --session latest creates a valid bundle
  -> contextport import FILE --to claude-code queues or injects it safely
  -> a new Claude Code session recovers the goal, work, decisions, and next step
```

Do not export Claude authentication state or system instructions. Keep all
Claude-specific parsing, hook registration, and injection code in this folder.
