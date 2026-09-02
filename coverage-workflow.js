// coverage parallel workflow - avoids inline backtick parsing issues
await runs.all([
  {
    key: 'config-and-small',
    agent: 'worker',
    task: [
      '목표: config.ts, extract-delta.ts, prompt-mapper.ts, conversation-tracker.ts, process.ts 커버리지 100%',
      '경로: /Users/younwoo/repo/aiai/pi/agent/extensions/pi-agent-bridge',
      '파일별 uncovered:',
      '- src/agy/config.ts: envInt(AGY_TIMEOUT_MS), envList(AGY_EXTRA_ARGS), loadConfig overrides/stateDir/cacheDir',
      '- src/agy/extract-delta.ts: conversationBound false/empty, normalize, hasBoundary, exact prefix, trimEnd prefix, lastLine >=10, tail 150 fallback, firstToken endsWith tail',
      '- src/shared/prompt-mapper.ts: extractTask Task: prefix, 5 cutMarkers, extractText non-user / string vs array filter',
      '- src/agy/conversation-tracker.ts: snapshot .pb filter, findNewConversation 0/1/2 new',
      '- src/shared/process.ts: disposeChild null, stdin/stdout/stderr destroy, exitCode check, SIGKILL',
      '작업: tests/config.test.ts, tests/conversation-tracker.test.ts, tests/process.test.ts, tests/extract-delta-extra.test.ts, tests/prompt-mapper-extra.test.ts 생성 (기존 수정 금지)',
      '검증: npx vitest run --coverage 로 해당 파일 100% 확인',
      '제약: while 금지, flag 최소화, vitest 사용',
    ].join('\n'),
  },
  {
    key: 'models-config-agy-models',
    agent: 'worker',
    task: [
      '목표: src/shared/models-config.ts 와 src/agy/agy-models.ts 100%',
      '경로: /Users/younwoo/repo/aiai/pi/agent/extensions/pi-agent-bridge',
      'models-config uncovered: isPlainObject, asStringArray (non-array, empty, 공백), parseModelEntry (non-plain, name fallback, variants, defaultVariant, contextWindow>0, maxTokens>0), parseAgentSection (non-plain, missing models, modelsRaw non-plain, id trim empty, entry null), parseModelsConfig (non-plain, ignored agent), readModelsConfigFile (ENOENT vs EISDIR, Invalid JSONC), loadModelsConfigFile (override/env/project/home, project===home, exists true/false), resolveAgentCatalog (missing section, mapping)',
      'agy-models uncovered: buildThinkingLevelMap lowercasing, mapConfigEntry variants/name/defaultVariant/contextWindow/maxTokens, toPiModels sorting/reasoning/contextWindow default, loadAgyCatalog antigravity 우선 vs agy fallback, discoverModels, resolveAgyModelId (meta null, variants<2, reasoning off, map miss fallback, variant empty string -> line125)',
      '작업: tests/models-config-extra.test.ts, tests/agy-models-extra.test.ts 생성 (기존 수정 금지)',
      'resolveAgyModelId empty variant 테스트: variants ["",""] 로 125 라인 커버',
      '검증: npx vitest run --coverage',
    ].join('\n'),
  },
  {
    key: 'session-store',
    agent: 'worker',
    task: [
      '목표: src/shared/session-store.ts 100%',
      '경로: /Users/younwoo/repo/aiai/pi/agent/extensions/pi-agent-bridge',
      'uncovered: abortError (reason Error vs string stack), timeoutError, throwIfCancelled (signal aborted, deadline), sleep (delay calc, abort, deadline resolve/reject, cleanup), errCode, defaultIsAlive (process.kill mock EPERM), parseLock (invalid JSON, invalid shape), createLockFile (success, EEXIST, writeError), maybeStealStaleLock (alive false/true, stale true/false), releaseLock (dev mismatch, token mismatch), tryAcquireLock, acquireLock (backoff, deadline, abort, timeout), SessionStore (getEntry, set, loadStore, loadStoreUnlocked ENOENT, Invalid format)',
      '작업: tests/session-store-extra.test.ts 생성',
      '방법: mkdtemp, random lockPath, isAlive 가짜 함수, vi.spyOn(process,kill), abortSignal, timeoutMs 짧게',
      '검증: npx vitest run --coverage',
    ].join('\n'),
  },
  {
    key: 'agy-pool',
    agent: 'worker',
    task: [
      '목표: src/agy/agy-pool.ts 100%',
      '경로: /Users/younwoo/repo/aiai/pi/agent/extensions/pi-agent-bridge',
      'uncovered: createAbortError (AbortError 그대로, 일반Error wrapping, string, DOMException), isCompositeKey, ensureEntry closed/mismatch, spawnEntry args (model/effort trim/conversationId/extraArgs), onStdout, handleLine (non {, JSON fail, event not string, topConv, init, step_update ACTIVE/DONE/status DONE prefix mismatch streamError/fallback, tool start/done, result conversation_id 두곳 usage), settlePending (streamError, finalText, hasAnswer false status !=SUCCESS stderr), onCrash, resetIdleTimer idle<=0, enforceMaxEntries LRU, disposeEntry pending/graceful, _exec queue, doExec (closed, signal aborted, process exited, stdin not writable, pending wrap, timeout, abort, write error, backpressure drain), PooledHandle getters',
      '작업: tests/agy-pool-extra.test.ts 생성 (기존 수정 금지) - mock script 패턴 재사용 (tests/agy-pool.test.ts 참고) handlerBody 다양화, AgyPool maxEntries 1, idleTimeoutMs 0, 존재하지 않는 binary, AbortController, 큰 프롬프트 등',
      '검증: npx vitest run --coverage',
    ].join('\n'),
  },
]);
