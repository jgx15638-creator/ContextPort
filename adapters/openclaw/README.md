# OpenClaw Adapter

The OpenClaw adapter is the first ContextPort integration and currently has
experimental status.

## Implemented

- captures session, LLM, tool, and agent lifecycle events through hooks
- stores sanitized session state under `~/.contextport/hosts/openclaw/sessions`
- exports `contextport.bundle/v1` through the external CLI or `/context-export`
- consumes external inbox requests during `before_prompt_build`
- supports explicit in-agent import through `/context-import`

## Missing Before Stable

- read OpenClaw sessions created before ContextPort was installed
- test real installation and rollback across supported OpenClaw versions
- add pending-import listing, cancellation, expiry, and confirmation
- add fixtures for multiple native transcript versions

Host-specific implementation belongs in this directory. Portable storage,
validation, redaction, and bundle rendering must remain in `packages/core`.
