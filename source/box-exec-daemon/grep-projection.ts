// Pure projection of ripgrep --json output into retained match/context lines.
// Extracted from the daemon route so the boundary rules are testable against
// real event sequences instead of source strings (external review r3 #4).
//
// Attribution rules (line-number based — the stream order alone is ambiguous,
// because the context lines between two matches serve as the previous match's
// -A lines AND the next match's -B lines):
// - a context line is emitted as the previous RETAINED match's trailing context
//   only when it is within that match's after-window (same file, distance <= A);
// - otherwise it is buffered (capped at B) as the NEXT match's leading context
//   and flushed only if that match is retained — so context belonging to
//   offset-skipped or over-head-limit matches never rides along.

export interface GrepProjectedLine {
  file: string;
  lineNumber: number;
  content: string;
  isContext: boolean;
}

export interface GrepProjection {
  lines: GrepProjectedLine[];
  /** Match events seen after the offset (retained or not). */
  totalSeen: number;
  /** Match lines kept within the head limit. */
  retained: number;
}

export function projectGrepEvents(
  stdout: string,
  options: { offset: number; headLimit: number; contextBefore: number; contextAfter: number },
): GrepProjection {
  const { offset, headLimit, contextBefore, contextAfter } = options;
  const lines: GrepProjectedLine[] = [];
  let totalSeen = 0;
  let retained = 0;
  let matchIndex = 0;
  let lastRetained: { file: string; lineNumber: number } | null = null;
  let pendingContext: GrepProjectedLine[] = [];
  for (const raw of stdout.split("\n")) {
    if (raw.length === 0) continue;
    let event: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
    try { event = JSON.parse(raw); } catch { continue; }
    const isMatch = event.type === "match";
    const isContext = event.type === "context";
    if (!isMatch && !isContext) continue;
    const file = event.data?.path?.text ?? "";
    const lineNumber = event.data?.line_number ?? 0;
    const content = (event.data?.lines?.text ?? "").replace(/\n$/, "");
    if (isContext) {
      const withinTrailingWindow =
        lastRetained != null &&
        lastRetained.file === file &&
        lineNumber > lastRetained.lineNumber &&
        lineNumber - lastRetained.lineNumber <= contextAfter;
      if (withinTrailingWindow) {
        lines.push({ file, lineNumber, content, isContext: true });
      } else if (contextBefore > 0) {
        pendingContext.push({ file, lineNumber, content, isContext: true });
        if (pendingContext.length > contextBefore) pendingContext.shift();
      }
      continue;
    }
    if (matchIndex++ < offset) { pendingContext = []; lastRetained = null; continue; }
    totalSeen += 1;
    if (retained >= headLimit) { pendingContext = []; lastRetained = null; continue; }
    for (const buffered of pendingContext) if (buffered.file === file) lines.push(buffered);
    pendingContext = [];
    lines.push({ file, lineNumber, content, isContext: false });
    retained += 1;
    lastRetained = { file, lineNumber };
  }
  return { lines, totalSeen, retained };
}
