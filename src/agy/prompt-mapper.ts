import type { Message } from "@earendil-works/pi-ai";
import {
  extractTask as sharedExtractTask,
  extractText,
} from "../shared/prompt-mapper.ts";

// Re-export shared helpers for external consumers
export { extractText } from "../shared/prompt-mapper.ts";

/**
 * agy 전용 mapPrompt: shared 로직을 확장하여
 * pi가 주입하는 `[Read from: ...]` prefix를 제거.
 * 패턴: [Read from:$message] → 선두의 [Read from: ...] 블록 1개 이상 제거.
 * 최신 user 메시지가 prefix만으로 비게 되면 이전 user 메시지로 fallback.
 */
export function mapPrompt(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "user") {
      const task = extractTask(extractText(msg));
      if (task) return task;
    }
  }
  return "";
}

function stripReadFromPrefix(raw: string): string {
  let t = raw.trimStart();
  const re = /^\[Read from:[^\]]*\]\s*/;
  while (re.test(t)) {
    t = t.replace(re, "");
  }
  return t;
}

function extractTask(raw: string): string {
  // shared 로직 재사용 + 앞뒤로 Read from 제거
  const stripped = stripReadFromPrefix(raw.trim());
  const task = sharedExtractTask(stripped);
  return stripReadFromPrefix(task).trim();
}

export { sharedExtractTask as extractTask };
