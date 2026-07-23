# ContextPort

Export context from one AI agent session and import it into another.

ContextPort supports one small workflow:

```text
agent session A
  -> contextport export
  -> portable .contextport.json bundle
  -> contextport import
  -> agent session B continues the work
```

The first version intentionally exposes only two commands: `export` and
`import`.

> Status: early prototype. OpenClaw and Codex adapters are experimental. Claude
> Code is planned.

## Install From This Repository

Requirements: Node.js 20+ and at least one supported agent host.

```bash
git clone https://github.com/Xubqpanda/ContextPort.git
cd ContextPort
npm install
npm link
```

For OpenClaw imports, also enable the local plugin:

```bash
openclaw plugins install -l .
openclaw plugins enable context-port
```

Restart OpenClaw after enabling the adapter. Historical export does not depend
on the plugin; the plugin is only required to consume imports.

## Export

Export the latest session from either supported host:

```bash
contextport export --from openclaw
contextport export --from codex
```

By default, ContextPort exports the most recently active native session and
writes a bundle under:

```text
~/.contextport/exports/
```

Choose a specific native session or output path when needed:

```bash
contextport export \
  --from codex \
  --session SESSION_ID \
  -o task.contextport.json
```

## Import

Queue the exported bundle for either supported host:

```bash
contextport import task.contextport.json --to openclaw
contextport import task.contextport.json --to codex
```

Then open or use a different target session and send a normal user message. The
adapter injects the imported context once before the model receives that
message. The first Codex import registers a managed hook in
`~/.codex/hooks.json`; Codex may ask you to trust it once. OpenClaw import uses
the enabled ContextPort plugin's `before_prompt_build` hook.

Target a known session explicitly when required:

```bash
contextport import task.contextport.json \
  --to codex \
  --session TARGET_SESSION_ID
```

## What Is Transferred

The current bundle contains sanitized events normalized by the adapter,
including:

- user inputs
- assistant outputs
- tool calls, results, and errors
- source session and run metadata

Imported content is marked as untrusted history. ContextPort does not
automatically replay tool calls or external side effects.

## Current Limitations

- OpenClaw native reading is currently tested against OpenClaw `2026.3.13`.
- Codex transcript reading and import are currently tested against Codex CLI
  `0.144.5`.
- Secret redaction is best effort; inspect bundles before sharing them.
- Claude Code transfer is not implemented yet.
- Untargeted imports are consumed by the next eligible session other than the
  source session.

## Development

```bash
npm test
```

Adapter contributors should read:

- [Adapter overview](./adapters/README.md)
- [Adapter development guide](./docs/adapter-development.md)
- [Architecture](./docs/architecture.md)
