# OpenClaw Adapter

The OpenClaw adapter is the first ContextPort integration and currently has
experimental status.

## Implemented

- reads indexed and orphaned native transcripts from the OpenClaw state directory
- exports sessions created before ContextPort was installed
- exports `contextport.bundle/v1` through the external CLI or `/context-export`
- consumes external inbox requests during `before_prompt_build`
- supports explicit in-agent import through `/context-import`

Native sessions are discovered under:

```text
$OPENCLAW_STATE_DIR/agents/<agent-id>/sessions/
```

When `OPENCLAW_STATE_DIR` is unset, the normal `~/.openclaw` state directory
and supported legacy state directories are checked.

## Missing Before Stable

- test real installation and rollback across supported OpenClaw versions
- add pending-import listing, cancellation, expiry, and confirmation
- add fixtures for multiple native transcript versions

Host-specific implementation belongs in this directory. Portable storage,
validation, redaction, and bundle rendering must remain in `packages/core`.
