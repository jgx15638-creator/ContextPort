# Adapter Template

Copy this directory to `adapters/<host-id>` and rename
`contextport.adapter.example.json` to `contextport.adapter.json`.

An adapter PR should include:

- native session discovery or a documented reason it is unavailable
- read-only native transcript parsing where possible
- normalization into ContextPort events
- safe target injection without transcript mutation
- manifest capability updates that match implemented behavior
- fixtures with secrets removed
- tests for export, import, malformed input, and rollback
- a README with supported host versions and manual verification steps

Use the checklist in [Adapter Development](../../docs/adapter-development.md).
