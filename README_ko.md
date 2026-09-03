# pi-agent-bridge

Pi extension으로 `agy` (Google Antigravity CLI) 에이전트에 프롬프트를 라우팅한다.

영문 문서: [README.md](./README.md)

## 사전 요구사항

- Pi (`@earendil-works/pi-coding-agent`)
- **agy:** `agy` CLI 설치 및 인증

## 설치

```bash
# 로컬 checkout
pi install /absolute/path/to/pi-agent-bridge

# 일회성
pi -e /absolute/path/to/pi-agent-bridge
```

Pi 재시작 후 `/model`에서 선택:

- `agy/...`
- `antigravity/...` (alias)

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
  "agy": {
    "models": {
      "gemini-3.7-flash": {
        "name": "Gemini 3.7 Flash",
        "defaultVariant": "high",
        "variants": ["high", "medium", "low"]
      }
    }
  }
}
```

모델 필드:

| Field                         | Meaning                      |
| ----------------------------- | ---------------------------- |
| `name`                        | 표시 이름                    |
| `variants` / `defaultVariant` | 모델 id suffix → Pi thinking |
| `contextWindow` / `maxTokens` | Pi 모델 한도 (선택)          |

---

## agy

### Config (env)

| Env                           | Default                                   | Meaning                            |
| ----------------------------- | ----------------------------------------- | ---------------------------------- |
| `AGY_BINARY`                  | `agy`                                     | CLI binary                         |
| `AGY_TIMEOUT_MS`              | `300000`                                  | 턴 타임아웃                        |
| `AGY_EXTRA_ARGS`              | _(empty)_                                 | 추가 args (공백 구분)              |
| `AGY_CONVERSATIONS_DIR`       | `~/.gemini/antigravity-cli/conversations` | conversation 바인딩 탐색           |
| `AGY_INPUT_HISTORY_THRESHOLD` | `51200`                                   | 전체 히스토리 인라인 한도 (바이트) |
| `AGY_INPUT_HISTORY_PREVIEW`   | `2000`                                    | 파일 전달 지시문 preview 글자수    |

State: `~/.pi/agent/agy/sessions.json`

### Models / thinking

`.pi/agent/pi-agent-bridge.jsonc` → `agy.models`

예:

- `agy/gemini-3.7-flash`
- thinking: `high` | `medium` | `low` (기본 `high`)
- agy `--model`: `gemini-3.7-flash-{high|medium|low}`

### Behavior / security

- conversation 없음(첫 agy 턴, 모델/effort 변경, 마지막 agy 턴 이후 타 provider 사용): pi 전체 히스토리 주입(최신 요청은 `[Current request]`로 appended)
- 임계값 초과 히스토리는 `<cwd>/.temp/pi-agy-history-*.md` 파일로 전달(읽기 지시 + preview), 턴 종료 후 삭제(`.temp/`는 `.gitignore` 권장)
- 동일 모델/effort 연속 사용: 최신 user 입력만 전달, 문맥은 agy conversation 바인딩
- 모든 호출에 `--dangerously-skip-permissions`

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
