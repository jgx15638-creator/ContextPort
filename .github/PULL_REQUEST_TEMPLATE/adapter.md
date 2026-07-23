---
name: Adapter contribution
about: Add or extend an agent host adapter
---

## Host

- Host name:
- Tested host versions:
- Adapter status after this PR: planned / experimental / stable

## Capabilities

- [ ] Session discovery
- [ ] Historical transcript read
- [ ] Live capture
- [ ] External export
- [ ] External import
- [ ] Targeted import
- [ ] In-agent commands

## Safety

- [ ] Native transcripts are read-only
- [ ] Credentials and auth profiles are never exported
- [ ] Fixtures are synthetic or anonymized
- [ ] Imported content is marked as untrusted
- [ ] Tool calls and side effects are not replayed automatically

## Verification

- [ ] Manifest matches implemented capabilities
- [ ] Unit tests added
- [ ] Clean-environment manual test completed
- [ ] Install and rollback documented
- [ ] `npm test` passes

## Evidence

Describe the source session, exported bundle, target session, and what state was
successfully recovered. Do not include secrets or private conversation content.
