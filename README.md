# pi-agent-bridge

Pi extension that routes prompts to external coding agents:

- `agy` — Google Antigravity CLI
- `codex` — Codex via Agent Client Protocol (`@agentclientprotocol/codex-acp`)
- `grok` — Grok via `grok agent stdio` (ACP)

## Prerequisites

- Pi (`@earendil-works/pi-coding-agent`)
- For agy: `agy` CLI installed and authenticated
- For codex: network for `npx @agentclientprotocol/codex-acp@1.6.0`, plus Codex auth (`codex` login / API key)
- For grok: `grok` CLI installed and authenticated (`grok` login)

## Install

```bash
# local checkout
pi install /absolute/path/to/pi-agent-bridge

# one-off
pi -e /absolute/path/to/pi-agent-bridge
```

Install 후 Pi 재시작 → `/model` 에서 `agy/...` / `codex/...` / `grok/...` 선택.

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

`src/agy/agy-models.ts` → `HARDCODED_AGY_MODELS`

- `agy/gemini-3.7-flash`
- thinking: `high` | `medium` | `low` (기본 `high`)
- agy `--model`: `gemini-3.7-flash-{high|medium|low}`

### Behavior / security

- 최신 user 입력만 전달 (history/tool/system harness 제외)
- 멀티턴은 agy conversation 바인딩
- 모든 호출에 `--dangerously-skip-permissions`

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

> npm 최신 태그는 `1.6.0` (요청한 `1.6.1`은 registry에 없음). 다른 버전은 `CODEX_ACP_ARGS`로 지정.

### Models / thinking

`src/codex/models.ts` → `HARDCODED_CODEX_MODELS`

- `codex/gpt-5.6-sol`
- `codex/gpt-5.6-terra`
- `codex/gpt-5.6-luna`
- thinking / `reasoning_effort`: `low` | `medium` | `high` | `xhigh` | `max` (기본 `high`)

### Behavior / security

- 최신 user 입력만 `session/prompt`로 전달
- 멀티턴은 ACP session id 바인딩 (프로세스 생존 시 resume)
- permission 요청은 `allow_always` / `allow_once` 자동 승인
- 기본 mode: `agent-full-access`
- Pi system prompt / tools 미전달

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

`src/grok/models.ts` → `HARDCODED_GROK_MODELS`

- `grok/grok-4.6`
- thinking / effort: `low` | `medium` | `high` | `xhigh` (기본 `high`)

Grok ACP 매핑:

- model → `session/set_model` `{ modelId }`
- effort → `session/set_mode` `{ modeId }`

> 현재 로컬 `grok models`에 없는 ID면 `session/set_model`이 `unknown model id`로 거부될 수 있음.

### Behavior / security

- 최신 user 입력만 `session/prompt`로 전달
- 멀티턴은 ACP session id 바인딩
- spawn에 `--always-approve`, permission 요청 자동 승인
- Pi system prompt / tools 미전달

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
src/agy/
src/codex/
src/grok/
src/shared/
```
