# pi-agent-bridge

Pi extension that routes prompts to the `agy` (Google Antigravity CLI) agent.

Korean docs: [README_ko.md](./README_ko.md)

## Prerequisites

- Pi (`@earendil-works/pi-coding-agent`)
- **agy:** `agy` CLI installed and authenticated

## Install

```bash
# local checkout
pi install /absolute/path/to/pi-agent-bridge

# one-off
pi -e /absolute/path/to/pi-agent-bridge
```

Restart Pi, then pick a model under `/model`:

- `agy/...`
- `antigravity/...` (alias)

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
  "agy": {
    "models": {
      "gemini-3.7-flash": {
        "name": "Gemini 3.7 Flash",
        "defaultVariant": "high",
        "variants": ["high", "medium", "low"],
      },
    },
  },
}
```

Per-model fields:

| Field | Meaning |
|---|---|
| `name` | display name |
| `variants` / `defaultVariant` | model id suffixes mapped to Pi thinking |
| `contextWindow` / `maxTokens` | Pi model limits (optional) |

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

## Develop

```bash
npm install
npm test
```

## Layout

```
extensions/antigravity.ts
src/agy/
src/shared/
```
