# pi-agent-bridge

Pi extension that connects the `agy` (Google Antigravity) CLI as a model provider.

`agy models`로 모델 목록을 읽고, 프롬프트를 `agy` CLI로 라우팅한다.

## Prerequisites

- Pi (`@earendil-works/pi-coding-agent`)
- `agy` CLI installed and authenticated (`agy` 한 번 실행해서 로그인)

## Install

```bash
# local checkout
pi install /absolute/path/to/pi-agent-bridge

# one-off
pi -e /absolute/path/to/pi-agent-bridge
```

Install 후 Pi 재시작 → `/model` 에서 `agy/...` 선택.

모델 목록 강제 갱신:

```
/agy-refresh-models
```

## Config (env)

| Env | Default | Meaning |
|---|---|---|
| `AGY_BINARY` | `agy` | CLI binary |
| `AGY_TIMEOUT_MS` | `300000` | per-turn timeout |
| `AGY_EXTRA_ARGS` | _(empty)_ | extra args, space-separated |
| `AGY_CONVERSATIONS_DIR` | `~/.gemini/antigravity-cli/conversations` | conversation bind discovery |

State:

- sessions: `~/.pi/agent/agy/sessions.json`
- model cache (24h): `~/.cache/pi-agent-bridge/models.json`

## Models / thinking

`agy models` 결과에서 같은 base + suffix 쌍이 2개 이상이면 base 모델로 묶고, suffix를 Pi thinking level에 매핑한다.

예:

- `gemini-3.7-flash-high|medium|low` → `agy/gemini-3.7-flash` + thinking `low|medium|high`
- 단독 ID (`claude-sonnet-4-6`) → 그대로 등록

## Behavior

- agy에 넘기는 텍스트 = 최신 user 입력만 (history/tool/system harness 제외)
- 멀티턴 문맥은 agy conversation 바인딩으로 유지
- Pi system prompt / tools는 agy로 전달하지 않음
- agy가 자체 에이전트로 도구를 실행하고 최종 텍스트만 Pi에 반환
- Pi session id ↔ agy conversation id 바인딩
- 첫 바인딩 시 conversation 디렉터리 snapshot으로 conversation id 추론

## Permissions / Security

모든 `agy` 호출에 `--dangerously-skip-permissions`를 붙인다.  
agy가 수행하는 파일/명령 변경은 Pi permission UI를 거치지 않는다.  
신뢰하는 워크스페이스에서만 사용할 것.

## Develop

```bash
npm install
npm test
```

## Based on

[opencode-agy-plugin](https://github.com/river-gold/opencode-agy-plugin) 로직을 Pi custom provider extension으로 이식.
