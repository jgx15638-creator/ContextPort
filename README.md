# ContextPort

<p align="center">
  Move working context between AI agent sessions.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Hosts-OpenClaw%20%7C%20Codex-green" alt="hosts">
  <img src="https://img.shields.io/badge/Format-contextport.bundle%2Fv1-blue" alt="bundle format">
  <img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="license">
</p>

## 1. What Is ContextPort?

ContextPort exports context from one AI agent session and imports it into another session.

```text
OpenClaw session
  -> contextport export
  -> portable bundle
  -> contextport import
  -> Codex session continues the work
```

ContextPort reads existing native session history. It does not modify native transcript files or replay previous tool calls.

## 2. Installation

Requirements: Node.js 20+ and OpenClaw or Codex.

```bash
git clone https://github.com/Xubqpanda/ContextPort.git
cd ContextPort
npm install
npm link
```

Exports work immediately after the common installation. Open the adapter setup below only when you need to import context into that host.

<details>
<summary><strong>OpenClaw</strong></summary>

<br>

Enable the ContextPort plugin and restart OpenClaw:

```bash
openclaw plugins install -l ./adapters/openclaw
openclaw plugins enable context-port
```

The plugin injects an imported bundle during `before_prompt_build`.

</details>

<details>
<summary><strong>Codex CLI</strong></summary>

<br>

No additional setup is required. The first Codex import automatically adds a managed `UserPromptSubmit` hook.

Codex may ask you to trust the hook the first time it runs.

</details>

## 3. Export And Import

The shortest OpenClaw to Codex workflow is:

```bash
contextport export --from openclaw -o task.contextport.json
contextport import task.contextport.json --to codex
```

That is the complete workflow. OpenClaw and Codex can both be used as the source or target.

<details>
<summary><strong>OpenClaw commands</strong></summary>

<br>

Export the latest OpenClaw session:

```bash
contextport export --from openclaw
```

Import a bundle into OpenClaw:

```bash
contextport import task.contextport.json --to openclaw
```

Select a specific OpenClaw session when needed:

```bash
contextport export --from openclaw --session SESSION_ID
contextport import task.contextport.json --to openclaw --session SESSION_ID
```

</details>

<details>
<summary><strong>Codex CLI commands</strong></summary>

<br>

Export the latest Codex session:

```bash
contextport export --from codex
```

Import a bundle into Codex:

```bash
contextport import task.contextport.json --to codex
```

Select a specific Codex session when needed:

```bash
contextport export --from codex --session SESSION_ID
contextport import task.contextport.json --to codex --session SESSION_ID
```

</details>

Without `-o`, exported bundles are written under `~/.contextport/exports/` and the generated path is printed in the terminal.
