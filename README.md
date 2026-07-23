# ContextPort

Portable context for AI agents.

ContextPort moves active work between agent hosts without editing their private
session files. The external CLI is the control plane; small host adapters capture
native events and inject validated handoffs at supported lifecycle hooks.

OpenClaw is the first adapter. Codex and Claude Code adapters can be added behind
the same host-independent bundle format.

## Architecture

```text
                         portable bundle
  source agent adapter  ----------------->  target agent adapter
          |                                      ^
          v                                      |
   persistent session store <---- CLI ----> import inbox
                               export/import
```

- `packages/core`: schemas, redaction, validation, storage, and rendering
- `packages/cli`: external `contextport` command
- `adapters`: one isolated integration directory per agent host
- `docs`: design decisions and adapter contracts

The CLI intentionally does not modify OpenClaw transcripts. An external import
is queued, then the adapter consumes it during `before_prompt_build`. In-agent
commands remain available as convenience and recovery surfaces.

## Adapter Roadmap

| Adapter | Status | Current scope |
| --- | --- | --- |
| [OpenClaw](./adapters/openclaw/) | Experimental | Hook capture and safe import injection |
| [Codex](./adapters/codex/) | Planned | Directory and contribution contract reserved |
| [Claude Code](./adapters/claude-code/) | Planned | Directory and contribution contract reserved |

Each adapter has a machine-readable `contextport.adapter.json` manifest. New
implementations should follow [Adapter Development](./docs/adapter-development.md)
and start from [`adapters/_template`](./adapters/_template/).

## Current Commands

The first public CLI version intentionally has only two product commands:

```text
export
import
```

Run from the repository while the package is not yet published:

```bash
npm install
npm run contextport -- help
```

Export the most recently active session:

```bash
npm run contextport -- export --from openclaw --session latest
```

Queue a bundle for the next user-triggered OpenClaw session:

```bash
npm run contextport -- import ./FILE.contextport.json --to openclaw
```

Target a known session explicitly:

```bash
npm run contextport -- import ./FILE.contextport.json \
  --to openclaw --session SESSION_ID
```

After an untargeted import, start or use a different OpenClaw session and send a
normal user message. The adapter consumes the oldest pending handoff once; a
same-host handoff is not consumed by its source session.

## OpenClaw Adapter

The adapter records sanitized lifecycle events under:

```text
~/.contextport/hosts/openclaw/sessions/
```

It also retains two authenticated in-agent commands:

```text
/context-export
/context-import latest
```

The original `openclaw-context-bundle/v1` format from the first implementation
is accepted and normalized to `contextport.bundle/v1` during import.

## Data and Safety

- ContextPort is local-first and writes files with user-only permissions.
- Common API key, bearer token, password, cookie, and secret fields are redacted.
- Imported text is explicitly marked as untrusted historical context.
- System prompts are not intentionally included in portable bundles.
- Redaction is defense in depth, not a guarantee. Inspect bundles before sharing.

Override the local data directory for testing or isolation:

```bash
export CONTEXTPORT_HOME=/path/to/contextport-data
```

## Development

```bash
npm test
node packages/cli/bin/contextport.js help
```

See [Architecture](./docs/architecture.md) for the host boundary and
[Adapter Development](./docs/adapter-development.md) before opening an adapter PR.
