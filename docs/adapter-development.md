# Adapter Development

This guide defines the minimum contract for adding an agent host to ContextPort.
Start from `adapters/_template` and keep every host-specific assumption inside
the new adapter directory.

## Capability Stages

Implement adapters in this order:

1. **Discovery**: list native sessions with stable IDs and update timestamps.
2. **Historical read**: read existing transcripts without modifying them.
3. **Normalization**: map native messages and tool activity to Core events.
4. **External export**: make sessions visible to `contextport export`.
5. **Safe import**: inject bundles through supported host lifecycle APIs.
6. **Live capture**: add hooks only when they provide data absent from history.
7. **Operations**: installation, diagnostics, rollback, and compatibility tests.

Historical reading comes before live capture because users expect ContextPort to
export sessions that existed before the adapter was installed. If a host has no
stable history API or file format, document that limitation in the manifest and
use hook capture as a fallback.

## Adapter Manifest

Every adapter has `contextport.adapter.json`:

```json
{
  "schema": "contextport.adapter/v1",
  "id": "host-id",
  "display_name": "Host Name",
  "status": "experimental",
  "entrypoint": "index.js",
  "capabilities": {
    "live_capture": true,
    "historical_read": true,
    "external_export": true,
    "external_import": true,
    "targeted_import": false,
    "in_agent_commands": false
  }
}
```

Do not mark a capability `true` until a test covers it.

## Source-Side Contract

The adapter must produce enough normalized state for Core to create
`contextport.bundle/v1`. At minimum preserve:

- source session ID and update time
- user messages and assistant results
- tool name, arguments, result or error
- relevant agent or run ID when available
- file and artifact references when safe

Never include provider credentials, account cookies, auth profiles, or system
prompts. Use Core sanitization even when the host claims its transcript is safe.

## Target-Side Contract

Import must use a documented host API, hook, MCP surface, or supported startup
context mechanism. Never mutate an undocumented transcript file.

The target must receive imported text as untrusted historical context. It must
not automatically replay tool calls, commits, messages, payments, deployments,
or other side effects recorded by the source agent.

## Tests Required for a PR

- manifest validation
- native fixture parsing
- secret removal
- session discovery and selection
- export to a valid ContextPort bundle
- malformed and oversized input rejection
- target import consumption exactly once
- install and rollback documentation

Fixtures must be synthetic or thoroughly anonymized. Include the host version
that produced each fixture.

## Pull Request Scope

An adapter PR should normally modify only:

```text
adapters/<host>/
packages/core/             # only for a genuinely host-independent capability
packages/cli/              # only when exposing a generic command
docs/                      # shared contract updates
```

Changes to a different host adapter need a separate justification and review.
