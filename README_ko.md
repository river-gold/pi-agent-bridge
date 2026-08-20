# pi-agent-bridge

Pi extension으로 외부 코딩 에이전트에 프롬프트를 라우팅한다.

- `agy` — Google Antigravity CLI
- `codex` — Codex via Agent Client Protocol (`@agentclientprotocol/codex-acp`)
- `grok` — Grok via `grok agent stdio` (ACP)
- `cursor` — Cursor via `cursor-agent acp`

영문 문서: [README.md](./README.md)

## 사전 요구사항

- Pi (`@earendil-works/pi-coding-agent`)
- **agy:** `agy` CLI 설치 및 인증
- **codex:** `npx @agentclientprotocol/codex-acp@1.6.0`용 네트워크, Codex 인증 (`codex` login / API key)
- **grok:** `grok` CLI 설치 및 인증 (`grok` login)
- **cursor:** `cursor-agent` CLI 설치 및 인증 (`cursor-agent login`)

## 설치

```bash
# 로컬 checkout
pi install /absolute/path/to/pi-agent-bridge

# 일회성
pi -e /absolute/path/to/pi-agent-bridge
```

Pi 재시작 후 `/model`에서 선택:

- `agy/...`
- `codex/...`
- `grok/...`
- `cursor/...`

---

## agy

### Config (env)

| Env | Default | Meaning |
|---|---|---|
| `AGY_BINARY` | `agy` | CLI binary |
| `AGY_TIMEOUT_MS` | `300000` | 턴 타임아웃 |
| `AGY_EXTRA_ARGS` | _(empty)_ | 추가 args (공백 구분) |
| `AGY_CONVERSATIONS_DIR` | `~/.gemini/antigravity-cli/conversations` | conversation 바인딩 탐색 |

State: `~/.pi/agent/agy/sessions.json`

### Models / thinking

`src/agy/agy-models.ts` → `HARDCODED_AGY_MODELS`

- `agy/gemini-3.7-flash`
- thinking: `high` | `medium` | `low` (기본 `high`)
- agy `--model`: `gemini-3.7-flash-{high|medium|low}`

### Behavior / security

- 최신 user 입력만 전달 (history / tool / system harness 제외)
- 멀티턴은 agy conversation 바인딩
- 모든 호출에 `--dangerously-skip-permissions`

---

## codex (ACP)

### Config (env)

| Env | Default | Meaning |
|---|---|---|
| `CODEX_ACP_COMMAND` | `npx` | launcher |
| `CODEX_ACP_ARGS` | `-y @agentclientprotocol/codex-acp@1.6.0` | agent args |
| `CODEX_ACP_TIMEOUT_MS` | `300000` | 턴 타임아웃 |
| `CODEX_ACP_MODE` | `agent-full-access` | ACP session mode |

State: `~/.pi/agent/codex/sessions.json`

> npm 최신 태그는 `1.6.0`. 다른 버전은 `CODEX_ACP_ARGS`로 지정.

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
| `GROK_ACP_TIMEOUT_MS` | `300000` | 턴 타임아웃 |

State: `~/.pi/agent/grok/sessions.json`

### Models / thinking

`src/grok/models.ts` → `HARDCODED_GROK_MODELS`

- `grok/grok-4.6`
- thinking / effort: `low` | `medium` | `high` | `xhigh` (기본 `high`)

Grok ACP 매핑:

- model → `session/set_model` `{ modelId }`
- effort → `session/set_mode` `{ modeId }`

> 로컬 `grok models`에 없는 ID면 `session/set_model`이 `unknown model id`로 거부될 수 있음.

### Behavior / security

- 최신 user 입력만 `session/prompt`로 전달
- 멀티턴은 ACP session id 바인딩
- spawn에 `--always-approve`, permission 요청 자동 승인
- Pi system prompt / tools 미전달

---

## cursor (ACP)

### Config (env)

| Env | Default | Meaning |
|---|---|---|
| `CURSOR_ACP_COMMAND` | `cursor-agent` | launcher |
| `CURSOR_ACP_ARGS` | `acp` | agent args |
| `CURSOR_ACP_TIMEOUT_MS` | `300000` | 턴 타임아웃 |
| `CURSOR_ACP_MODE` | `agent` | session mode (`agent` \| `plan` \| `ask`) |

State: `~/.pi/agent/cursor/sessions.json`

Auth: `cursor-agent login` (ACP `cursor_login`)

### Models

`src/cursor/models.ts` → `HARDCODED_CURSOR_MODELS`

- `cursor/auto` → ACP model value `default[]`

### Behavior / security

- 최신 user 입력만 `session/prompt`로 전달
- permission 자동 승인 (`allow-always` 우선)
- `cursor/ask_question`, `cursor/create_plan` 등 extension method 자동 응답
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
extensions/cursor.ts
src/agy/
src/codex/
src/grok/
src/cursor/
src/shared/
```
