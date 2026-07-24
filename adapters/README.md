# ContextPort Adapters

Adapters connect one agent host to the host-independent ContextPort core. Each
adapter owns host-specific discovery, capture, normalization, and injection. It
must not introduce a separate portable bundle format.

## Adapter Status

| Adapter | Status | Live capture | Historical reader | Import injection |
| --- | --- | ---: | ---: | ---: |
| [OpenClaw](./openclaw/) | Experimental | No | Yes | Yes |
| [Codex](./codex/) | Experimental | No | Yes | Yes |
| [Claude Code](./claude-code/) | Experimental | No | Yes | No |

Status meanings:

- `planned`: directory and contract are reserved; no usable implementation
- `experimental`: implementation exists but still needs host compatibility work
- `stable`: installation, export, import, rollback, and compatibility are tested

## Required Layout

```text
adapters/<host>/
├── contextport.adapter.json    # capability and status manifest
├── README.md                   # host-specific setup and design notes
├── package.json                # add when implementation starts
├── index.js                    # host integration entry point
├── src/                        # optional implementation modules
└── test/                       # fixtures and adapter tests
```

Use [`_template`](./_template/) when adding another host. Detailed requirements
are documented in [Adapter Development](../docs/adapter-development.md).

## Ownership Boundary

An adapter may:

- read documented host APIs and transcript files
- observe lifecycle hooks
- convert native records into `contextport.event/v1`
- persist through `@contextport/core`
- consume a ContextPort import and inject it through a supported host API

An adapter must not:

- modify undocumented transcript files during import
- export credentials, auth profiles, or system prompts
- define `codex-context-bundle/*` or another host-only portable schema
- duplicate redaction, bundle validation, inbox, or rendering logic from Core
