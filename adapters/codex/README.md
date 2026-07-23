# Codex Adapter

Status: **planned**. This directory is reserved for the Codex integration.

## Expected Work

1. Document the supported Codex versions and local session locations or APIs.
2. Implement a read-only historical session reader.
3. Add optional live capture only when Codex exposes a stable hook or event API.
4. Normalize messages, tool calls, tool results, and task metadata into Core.
5. Implement import through supported instructions, hooks, or MCP surfaces.
6. Add clean-environment install, export, import, and rollback tests.

## Acceptance Scenario

```text
Create a Codex session with user messages, file reads, edits, and tests
  -> contextport export --from codex --session latest creates a valid bundle
  -> contextport import FILE --to codex queues or injects it safely
  -> a new Codex session recovers the goal, completed work, files, and next step
```

Do not implement import by rewriting undocumented Codex transcript files. Record
all format assumptions as fixtures and keep host-specific parsing in this folder.
