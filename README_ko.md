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

## 모델 설정 파일

모델 목록은 소스 하드코딩 대신 JSON 설정 파일을 쓴다.

- 프로젝트 경로: Pi 시작 작업 디렉터리(`process.cwd()`) 기준 `.pi/agent/pi-agent-bridge.jsonc`
- 홈 fallback: `~/.pi/agent/pi-agent-bridge.jsonc`
- 경로 오버라이드: env `PI_AGENT_BRIDGE_CONFIG`

프로젝트 설정 파일을 만든 뒤 Pi 재시작 또는 `/reload`:

```bash
mkdir -p .pi/agent
$EDITOR .pi/agent/pi-agent-bridge.jsonc
```

규칙:

- 우선순위는 명시적 `configPath` > `PI_AGENT_BRIDGE_CONFIG` > 프로젝트 설정 > 홈 설정
- 명시적 경로와 env 경로는 단독 사용하며, 파일이 없어도 프로젝트/홈 경로로 fallback하지 않는다.
- 프로젝트 파일이 있으면 전체 설정으로 사용하며 홈 설정과 파일/agent 단위로 병합하지 않는다.
- 프로젝트 파일이 없을 때만 홈으로 fallback하며 문법 오류나 읽기 오류는 그대로 실패한다.
- 파일 없음 / agent 섹션 없음 → 해당 agent 모델 **0개**
- agent 섹션 있음 → 그 목록만 등록
- JSONC 주석과 trailing comma를 지원한다.
- 그 외 JSON 문법 오류는 설정 경로를 포함한 오류로 실패한다.

현재 스키마 예제:

```json
{
  "agy": { "models": { "gemini-3.7-flash": { "name": "Gemini 3.7 Flash", "defaultVariant": "high", "variants": ["high", "medium", "low"] } } },
  "codex": { "models": { "gpt-5.6-sol": { "name": "GPT-5.6 Sol", "defaultEffort": "high", "efforts": ["low", "medium", "high", "xhigh", "max"] } } },
  "grok": { "models": { "grok-4.6": { "name": "Grok 4.6", "defaultEffort": "high", "efforts": ["low", "medium", "high", "xhigh"] } } },
  "cursor": { "models": { "auto": { "name": "Auto", "acpModelValue": "default[]" } } }
}
```

모델 필드:

| Field | Agents | Meaning |
|---|---|---|
| `name` | 전체 | 표시 이름 |
| `variants` / `defaultVariant` | agy | 모델 id suffix → Pi thinking |
| `efforts` / `defaultEffort` | codex, grok, cursor | reasoning effort (cursor → `model[effort=…]`) |
| `acpModelValue` | cursor (선택) | Pi model id와 Cursor base 값이 다를 때만 오버라이드 |
| `contextWindow` / `maxTokens` | 전체 (선택) | Pi 모델 한도 |

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

`.pi/agent/pi-agent-bridge.jsonc` → `agy.models`

예:

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

`.pi/agent/pi-agent-bridge.jsonc` → `codex.models`

예:

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

`.pi/agent/pi-agent-bridge.jsonc` → `grok.models`

예:

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

`.pi/agent/pi-agent-bridge.jsonc` → `cursor.models`

예:

- `cursor/default[]` — Auto, `efforts` 없으면 wire `default[]` 유지
- `cursor/composer-2.5` + `efforts` → wire `composer-2.5[effort=high]`
- Pi thinking → `effort=`; 미지원 레벨은 `defaultEffort`

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
