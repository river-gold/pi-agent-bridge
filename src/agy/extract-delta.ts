export function normalizeInput(str: string): string {
  return str.replace(/\r\n/g, "\n");
}

export function stripWarnings(text: string): string {
  return text.replace(
    /^(?:(?:[ \t]*\n+)|(?:WARNING:|Update available:|\.\.\.TRUNCATED\.\.\.)[^\n]*(?:\n|$))+/,
    "",
  );
}

export function hasBoundary(output: string, text: string, start: number): boolean {
  if (text.endsWith("\n")) return true;
  if (start + text.length === output.length) return true;
  return /\s/.test(output[start + text.length] ?? "");
}

export function extractTailDelta(output: string, normPrevTrimmed: string): string | null {
  const tail = normPrevTrimmed.length > 150 ? normPrevTrimmed.slice(-150) : normPrevTrimmed;
  const firstTokenMatch = output.match(/\S+/);
  if (tail.length < 20) return null;
  let tailStart: number | undefined;
  if (output.startsWith(tail)) {
    tailStart = 0;
  } else if (firstTokenMatch) {
    const firstTokenStart = firstTokenMatch.index ?? 0;
    const firstToken = firstTokenMatch[0]!;
    if (firstToken.endsWith(tail)) {
      tailStart = firstTokenStart + firstToken.length - tail.length;
    }
  }
  if (tailStart !== undefined && hasBoundary(output, tail, tailStart)) {
    return output.slice(tailStart + tail.length).replace(/^\s+/, "");
  }
  return null;
}

export function isConversationBound(conversationBound: boolean, prevOutput: string): boolean {
  return Boolean(conversationBound && prevOutput);
}

export function extractDelta(
  prevOutput: string,
  fullText: string,
  conversationBound: boolean,
): string {
  if (!isConversationBound(conversationBound, prevOutput)) {
    return fullText;
  }

  const normPrev = normalizeInput(prevOutput);
  const normFull = normalizeInput(fullText);

  const output = stripWarnings(normFull);

  if (output.startsWith(normPrev) && hasBoundary(output, normPrev, 0)) {
    return output.slice(normPrev.length).replace(/^\n+/, "");
  }

  const normPrevTrimmed = normPrev.trimEnd();
  if (output.startsWith(normPrevTrimmed) && hasBoundary(output, normPrevTrimmed, 0)) {
    return output.slice(normPrevTrimmed.length).replace(/^\s+/, "");
  }

  const lines = normPrevTrimmed.split("\n").filter((l) => l.trim());
  if (lines.length > 1) {
    const lastLine = lines[lines.length - 1]!.trimEnd();
    if (lastLine.length >= 10 && output.startsWith(lastLine) && hasBoundary(output, lastLine, 0)) {
      return output.slice(lastLine.length).replace(/^\s+/, "");
    }
  }

  const tailDelta = extractTailDelta(output, normPrevTrimmed);
  if (tailDelta !== null) return tailDelta;

  return fullText;
}
