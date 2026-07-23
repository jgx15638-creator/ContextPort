# ContextPort Architecture

## Decision

ContextPort uses an external-first hybrid architecture.

The external CLI owns user intent and portable data operations:

- select source and target hosts through export and import
- resolve the requested source session
- export, validate, and redact bundles
- queue imports and support rollback

Host adapters own host-specific access:

- observe native lifecycle events
- map native events to ContextPort events
- persist enough state for offline export
- consume queued imports at a safe host lifecycle hook
- inject context without modifying private transcript formats

In-agent commands are optional convenience surfaces. They must call the same
core APIs and must not define another bundle format.

## Why Not CLI-only

A CLI-only importer would need to rewrite undocumented host session files. That
is brittle, risks corrupting sessions, and couples ContextPort to every storage
change made by a host. Some hosts also require a live runtime API to inject
context correctly.

## Why Not Agent-only

Agent-only commands make automation, auditing, redaction previews, batch export,
and cross-host transfers harder. They also require a working source agent merely
to retrieve already persisted context.

## Repository Boundaries

```text
ContextPort/
├── packages/
│   ├── core/                 # no dependency on any agent host
│   └── cli/                  # external control plane
├── adapters/
│   ├── openclaw/             # current experimental implementation
│   ├── codex/                # reserved integration boundary
│   ├── claude-code/          # reserved integration boundary
│   ├── _template/            # starting point for another host
│   └── test/                 # shared adapter contract tests
├── docs/
├── index.js                  # backwards-compatible OpenClaw entry point
└── openclaw.plugin.json      # backwards-compatible root manifest
```

Every adapter exposes a `contextport.adapter.json` manifest. Planned adapters
keep `entrypoint` null and all capabilities false until their implementation is
covered by tests. Implemented adapters must consume and produce
`contextport.bundle/v1`, not introduce a host-specific portable bundle.

## External Import Flow

```text
contextport import bundle --to openclaw
  -> validate and normalize bundle
  -> write ~/.contextport/inbox/openclaw/<request>.json
  -> OpenClaw adapter reaches before_prompt_build
  -> claim the matching or next-session request atomically
  -> render it as untrusted historical context
  -> return prependContext to OpenClaw
```

An untargeted request is intentionally consumed only by a user-triggered run.
Production versions should add `pending`, `cancel`, expiry, and an interactive
confirmation before an untargeted import is claimed.

## Bundle Evolution

The current bundle transports a sanitized canonical event stream. It is a useful
bootstrap format, but raw history is not the final interoperability contract.
The next schema revision should add a structured handoff section:

- user goal and acceptance criteria
- completed work and verified outputs
- decisions and constraints
- relevant files and artifacts
- current plan and unresolved errors
- pending external side effects
- suggested next action

Adapters may retain raw events as evidence, while target agents should primarily
consume the structured handoff.

## Security Requirements

- Treat all imported text as untrusted data, never as system instructions.
- Never export credentials or host authentication profiles.
- Use restrictive local file permissions.
- Validate size and schema before rendering.
- Prefer explicit target sessions; untargeted imports are a convenience mode.
- Do not replay tool calls or external side effects automatically.
