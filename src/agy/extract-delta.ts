export function extractDelta(
	prevOutput: string,
	fullText: string,
	conversationBound: boolean,
): string {
	if (!conversationBound || !prevOutput) {
		return fullText;
	}

	const normalize = (str: string) => str.replace(/\r\n/g, "\n");
	const normPrev = normalize(prevOutput);
	const normFull = normalize(fullText);

	const output = normFull.replace(
		/^(?:(?:[ \t]*\n+)|(?:WARNING:|Update available:|\.\.\.TRUNCATED\.\.\.)[^\n]*(?:\n|$))+/,
		"",
	);

	const hasBoundary = (text: string, start: number) =>
		text.endsWith("\n") ||
		start + text.length === output.length ||
		/\s/.test(output[start + text.length] ?? "");

	if (output.startsWith(normPrev) && hasBoundary(normPrev, 0)) {
		return output.slice(normPrev.length).replace(/^\n+/, "");
	}

	const normPrevTrimmed = normPrev.trimEnd();
	if (output.startsWith(normPrevTrimmed) && hasBoundary(normPrevTrimmed, 0)) {
		return output.slice(normPrevTrimmed.length).replace(/^\s+/, "");
	}

	const lines = normPrevTrimmed.split("\n").filter((l) => l.trim());
	if (lines.length > 1) {
		const lastLine = lines[lines.length - 1]!.trimEnd();
		if (
			lastLine.length >= 10 &&
			output.startsWith(lastLine) &&
			hasBoundary(lastLine, 0)
		) {
			return output.slice(lastLine.length).replace(/^\s+/, "");
		}
	}

	const tail =
		normPrevTrimmed.length > 150
			? normPrevTrimmed.slice(-150)
			: normPrevTrimmed;
	const firstTokenMatch = output.match(/\S+/);
	if (tail.length >= 20) {
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
		if (tailStart !== undefined && hasBoundary(tail, tailStart)) {
			return output.slice(tailStart + tail.length).replace(/^\s+/, "");
		}
	}

	return fullText;
}
