# pi-agent-bridge

Pi extension that routes prompts to external coding agents:

- `agy` — Google Antigravity CLI
- `codex` — Codex via Agent Client Protocol (`@agentclientprotocol/codex-acp`)
- `grok` — Grok via `grok agent stdio` (ACP)
- `cursor` — Cursor via `cursor-agent acp`

Korean docs: [README_ko.md](./README_ko.md)

## Prerequisites

- Pi (`@earendil-works/pi-coding-agent`)
- **agy:** `agy` CLI installed and authenticated
- **codex:** network for `npx @agentclientprotocol/codex-acp@1.6.0`, plus Codex auth (`codex` login / API key)
- **grok:** `grok` CLI installed and authenticated (`grok` login)
- **cursor:** `cursor-agent` CLI installed and authenticated (`cursor-agent login`)

## Install

```bash
# local checkout
pi install /absolute/path/to/pi-agent-bridge

# one-off
pi -e /absolute/path/to/pi-agent-bridge
```

Restart Pi, then pick a model under `/model`:

- `agy/...`
- `codex/...`
- `grok/...`
- `cursor/...`

---

## Model config file

Models are no longer edit-only-in-source. Prefer a JSON config:

- project path: `.pi/agent/pi-agent-bridge.jsonc` under Pi's startup working directory (`process.cwd()`)
- home fallback: `~/.pi/agent/pi-agent-bridge.jsonc`
- override path: env `PI_AGENT_BRIDGE_CONFIG`

Create the project config, then restart Pi or `/reload`:

```bash
mkdir -p .pi/agent
$EDITOR .pi/agent/pi-agent-bridge.jsonc
```

Rules:

- priority is explicit `configPath` > `PI_AGENT_BRIDGE_CONFIG` > project config > home config
- explicit and env paths are used alone; a missing file does not fall back to project or home
- the project file is authoritative when present; files and agent sections are not merged with the home config
- only a missing project file falls back to home; malformed or unreadable files fail
- missing file / missing agent section → that agent exposes **0 models**
- agent section present → only those models are registered
- JSONC comments and trailing commas are supported.
- Other JSON syntax errors fail with the config path in the error.

Current schema example:

```jsonc
{
  // Model entries are grouped by agent.
  "agy": {
    "models": {
      "gemini-3.7-flash": {
        "name": "Gemini 3.7 Flash",
        "defaultVariant": "high",
        "variants": ["high", "medium", "low"],
      },
    },
  },
  "codex": {
    "models": {
      "gpt-5.6-sol": {
        "name": "GPT-5.6 Sol",
        "defaultEffort": "high",
        "efforts": ["low", "medium", "high", "xhigh", "max"],
      },
    },
  },
  "grok": {
    "models": {
      "grok-4.6": {
        "name": "Grok 4.6",
        "defaultEffort": "high",
        "efforts": ["low", "medium", "high", "xhigh"],
      },
    },
  },
  "cursor": {
    "models": {
      "auto": {
        "name": "Auto",
        "acpModelValue": "default[]",
      },
    },
  },
}
```

Per-model fields:

| Field | Agents | Meaning |
|---|---|---|
| `name` | all | display name |
| `variants` / `defaultVariant` | agy | model id suffixes mapped to Pi thinking |
| `efforts` / `defaultEffort` | codex, grok, cursor | reasoning effort (cursor → `model[effort=…]`) |
| `acpModelValue` | cursor (optional) | override ACP model base when it differs from the Pi model id |
| `contextWindow` / `maxTokens` | all (optional) | Pi model limits |

---

## agy

### Config (env)

| Env | Default | Meaning |
|---|---|---|
| `AGY_BINARY` | `agy` | CLI binary |
| `AGY_TIMEOUT_MS` | `300000` | per-turn timeout |
| `AGY_EXTRA_ARGS` | _(empty)_ | extra args, space-separated |
| `AGY_CONVERSATIONS_DIR` | `~/.gemini/antigravity-cli/conversations` | conversation bind discovery |

State: `~/.pi/agent/agy/sessions.json`

### Models / thinking

Configured via `.pi/agent/pi-agent-bridge.jsonc` → `agy.models`.

Example:

- `agy/gemini-3.7-flash`
- thinking: `high` | `medium` | `low` (default `high`)
- agy `--model`: `gemini-3.7-flash-{high|medium|low}`

### Behavior / security

- Only the latest user text is sent (no history / tools / system harness)
- Multi-turn context uses the agy conversation binding
- Every call uses `--dangerously-skip-permissions`

---

## codex (ACP)

### Config (env)

| Env | Default | Meaning |
|---|---|---|
| `CODEX_ACP_COMMAND` | `npx` | launcher |
| `CODEX_ACP_ARGS` | `-y @agentclientprotocol/codex-acp@1.6.0` | agent args |
| `CODEX_ACP_TIMEOUT_MS` | `300000` | per-turn timeout |
| `CODEX_ACP_MODE` | `agent-full-access` | ACP session mode |

State: `~/.pi/agent/codex/sessions.json`

> Latest npm tag observed: `1.6.0`. Override the version with `CODEX_ACP_ARGS` if needed.

### Models / thinking

Configured via `.pi/agent/pi-agent-bridge.jsonc` → `codex.models`.

Example:

- `codex/gpt-5.6-sol`
- `codex/gpt-5.6-terra`
- `codex/gpt-5.6-luna`
- thinking / `reasoning_effort`: `low` | `medium` | `high` | `xhigh` | `max` (default `high`)

### Behavior / security

- Only the latest user text is sent via `session/prompt`
- Multi-turn uses ACP session id binding (resume while the process stays alive)
- Permission requests are auto-approved (`allow_always` / `allow_once`)
- Default mode: `agent-full-access`
- Pi system prompt / tools are not forwarded

---

## grok (ACP)

### Config (env)

| Env | Default | Meaning |
|---|---|---|
| `GROK_ACP_COMMAND` | `grok` | launcher |
| `GROK_ACP_ARGS` | `agent --always-approve stdio` | agent args |
| `GROK_ACP_TIMEOUT_MS` | `300000` | per-turn timeout |

State: `~/.pi/agent/grok/sessions.json`

### Models / thinking

Configured via `.pi/agent/pi-agent-bridge.jsonc` → `grok.models`.

Example:

- `grok/grok-4.6`
- thinking / effort: `low` | `medium` | `high` | `xhigh` (default `high`)

Grok ACP mapping:

- model → `session/set_model` `{ modelId }`
- effort → `session/set_mode` `{ modeId }`

> If the model id is not in local `grok models`, `session/set_model` may reject it with `unknown model id`.

### Behavior / security

- Only the latest user text is sent via `session/prompt`
- Multi-turn uses ACP session id binding
- Spawn uses `--always-approve`; permission requests are auto-approved
- Pi system prompt / tools are not forwarded

---

## cursor (ACP)

### Config (env)

| Env | Default | Meaning |
|---|---|---|
| `CURSOR_ACP_COMMAND` | `cursor-agent` | launcher |
| `CURSOR_ACP_ARGS` | `acp` | agent args |
| `CURSOR_ACP_TIMEOUT_MS` | `300000` | per-turn timeout |
| `CURSOR_ACP_MODE` | `agent` | session mode (`agent` \| `plan` \| `ask`) |

State: `~/.pi/agent/cursor/sessions.json`

Auth: `cursor-agent login` (ACP `cursor_login`)

### Models

Configured via `.pi/agent/pi-agent-bridge.jsonc` → `cursor.models`.

Example:

- `cursor/default[]` — Auto; no `efforts` → wire value stays `default[]`
- `cursor/composer-2.5` with `efforts` → wire `composer-2.5[effort=high]`
- Pi thinking maps to `effort=`; unsupported levels fall back to `defaultEffort`

### Behavior / security

- Only the latest user text is sent via `session/prompt`
- Permission requests are auto-approved (`allow-always` preferred)
- Cursor extension methods (`cursor/ask_question`, `cursor/create_plan`, etc.) are auto-handled
- Pi system prompt / tools are not forwarded

---

## Develop

```bash
npm install
npm test
```

## Layout

```
extensions/agy.ts
extensions/codex.ts
extensions/grok.ts
extensions/cursor.ts
src/agy/
src/codex/
src/grok/
src/cursor/
src/shared/
```
