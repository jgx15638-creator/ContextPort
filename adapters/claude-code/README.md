# Claude Code Adapter

Reads Claude Code transcripts from disk and exports them as portable
ContextPort bundles. Import is not implemented yet.

## Storage Layout

Claude Code writes one JSONL transcript per session:

    ~/.claude/projects/<project-slug>/<session-id>.jsonl

The project slug is derived from the directory the session was started in.
Set CLAUDE_CONFIG_DIR to point the adapter at a different home.

## Transcript Notes

The format has three traits that shape this adapter:

- There is no session header row. Session metadata (sessionId, cwd, version,
  gitBranch) is repeated on most rows, so the first occurrence of each field
  wins.
- User and assistant content may be block arrays. Their text blocks become
  llm.input and llm.output events; tool_use blocks are held until their result
  arrives.
- Tool results are recorded under the user role, because the host treats them
  as model input. They are matched back to their call through tool_use_id.

## Event Mapping

| Native row | Core event |
| --- | --- |
| user row with string or text-block content | llm.input |
| assistant row, text block | llm.output |
| assistant row, tool_use block | held, then merged into tool.result |
| user row with a tool_result block | tool.result |

Rows that are never exported: subagent sidechains, user metadata and internal
command wrappers, system, attachment, assistant thinking blocks, mode,
permission-mode, file-history-snapshot, file-history-delta, ai-title,
last-prompt, and any line that fails to parse.

## Limits

- Transcripts above 100 MB are rejected.
- Only the most recent 500 events are kept.

## Usage

    contextport export --from claude-code --session latest
    contextport export --from claude-code --session SESSION_ID

## Testing

    node --test adapters/claude-code/test/*.test.js

Fixtures are synthetic and modelled on Claude Code 2.1.215.
