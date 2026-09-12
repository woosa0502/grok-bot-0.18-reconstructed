import { normalize } from "../text.js";
import type { ExtractedAtom } from "./contracts.js";
/** Deliberately bounded bilingual direct-statement grammar; not a general NLU model. */
export const EXTRACTOR_VERSION = "extractive-ko-en-v1";
export function extractAtoms(text: string): ExtractedAtom[] {
  const atoms: ExtractedAtom[] = [];
  // Newline and sentence segmentation preserves decimal numbers and ISO dates.
  const segments = [...text.matchAll(/[^\n!?。]+(?:[!?。]|\n|$)/gu)];
  for (const match of segments) {
    const raw = match[0], quote = raw.trim();
    if (!quote || quote.length > 2000 || /[?？]$/.test(quote)) continue;
    const start = match.index! + raw.indexOf(quote), end = start + quote.length;
    const low = normalize(quote).toLowerCase();
    const context: Record<string, string> = {};
    if (/장거리|long[- ]haul|long flight/.test(low)) context.distance = "long-haul";
    if (/단거리|short[- ]haul/.test(low)) context.distance = "short-haul";
    if (/출장|business trip/.test(low)) context.purpose = "business";
    if (/휴가|휴양|leisure|vacation/.test(low)) context.purpose = "leisure";
    const emit = (type: ExtractedAtom["type"], subject: string, predicate: string, value: string, ctx = context) => {
      atoms.push({ type, subject, predicate, value, context: { ...ctx }, confidence: 0.9,
        content: quote, span: { start, end, quote } });
    };
    const ambiguousSeats = /통로석|aisle/.test(low) && /창가|window seat/.test(low);
    const negative = /선호하지|좋아하지|원하지|싫어|피하|피해|avoid|do not prefer|don't prefer|dislike/.test(low);
    if (!ambiguousSeats && /통로석|aisle/.test(low) && /선호|좋아|원해|prefer|want/.test(low) && !negative) emit("preference", "user", "flight.seat", "aisle");
    if (!ambiguousSeats && /창가|window seat/.test(low) && /선호|좋아|원해|prefer|want/.test(low) && !negative) emit("preference", "user", "flight.seat", "window");
    if (!ambiguousSeats && /통로석|aisle/.test(low) && negative) emit("preference", "user", "flight.avoid_seat", "aisle");
    if (!ambiguousSeats && /창가|window seat/.test(low) && negative) emit("preference", "user", "flight.avoid_seat", "window");
    if (!ambiguousSeats && !/않|아니|싫|do not|don.t|not willing/.test(low) && /비싸도|더 내|높아도|pay more|costs more|more expensive/.test(low) && /통로석|aisle|좌석|seat/.test(low)) emit("preference", "user", "flight.tradeoff", "seat_over_price", /통로석|aisle/.test(low) ? { ...context, seat: "aisle" } : /창가|window seat/.test(low) ? { ...context, seat: "window" } : context);
    if (/호텔|숙소|hotel|accommodation/.test(low) && /우선|중요|prefer|prioriti/.test(low) && !negative) {
      if (/조용|quiet/.test(low)) emit("preference", "user", "hotel.priority", "quiet");
      else if (/위치|location/.test(low)) emit("preference", "user", "hotel.priority", "location");
      else if (/가격|저렴|price|cheap|budget/.test(low)) emit("preference", "user", "hotel.priority", "price");
    }
    if (/카페인|caffeine/.test(low) && /오후\s*2|14:00|2\s*p\.?m/.test(low) && negative) emit("preference", "user", "food.caffeine_cutoff", "14:00", {});
    const role = quote.match(/(?:내 직업은|나는)\s*(.+?)(?:이야|입니다|로 일해)[.!]?$/) ?? quote.match(/I (?:work as|am) an?\s+(.+?)[.!]?$/i);
    if (role && role[1]!.length < 80 && /개발자|디자이너|엔지니어|연구원|교사|developer|designer|engineer|researcher|teacher/i.test(role[1]!) && !/아니|not/.test(low)) emit("semantic", "user", "self.role", role[1]!.trim(), {});
    const rel = quote.match(/^(.+?)(?:은|는)\s*(.+?)\s*프로젝트(?:의)?\s*(담당자|디자이너|개발자)(?:야|다|입니다)?[.!]?$/)
      ?? quote.match(/^(.+?) is (?:the )?(owner|designer|developer) (?:of|for) (.+?)[.!]?$/i);
    if (rel) {
      const english = / is /i.test(quote); const person = rel[1]!.trim(), project = rel[english ? 3 : 2]!.trim();
      const r = rel[english ? 2 : 3]!, predicate = /담당자|owner/.test(r) ? "project.owner" : /디자이너|designer/.test(r) ? "project.designer" : "project.developer";
      emit("semantic", project, predicate, person, { project });
    }
    const coworker = quote.match(/^(.+?)(?:은|는)\s*내\s*(동료|친구|배우자)(?:야|다|입니다)?[.!]?$/)
      ?? quote.match(/^(.+?) is my (colleague|friend|spouse)[.!]?$/i);
    if (coworker) emit("semantic", "user", "relation." + (/동료|colleague/.test(coworker[2]!) ? "colleague" : /친구|friend/.test(coworker[2]!) ? "friend" : "spouse"), coworker[1]!.trim(), {});
    // Explicit, reusable project knowledge. Preserve the ENTIRE sentence, including negations/numbers.
    if (/^(?:프로젝트 규칙|사이트 지식|Project rule|Site knowledge):/i.test(quote)) emit("knowledge", "project", "knowledge.rule", quote.split(":").slice(1).join(":").trim(), {});
    // Completed outcomes, not a prediction that a plan happened. One-off meals/greetings do not promote.
    if (/(?:완료했|결정했|해결했|실패했|completed|decided|resolved|failed)/i.test(low) && !/예정|할 것|will |plan to|not completed|완료하지/.test(low)) emit("episodic", "user", "event.outcome", quote, {});
  }
  return atoms;
}
export function sameExtraction(a: ExtractedAtom, b: { subject: string; predicate: string; value: string; context: Record<string,string> }): boolean {
  return a.subject === b.subject && a.predicate === b.predicate && a.value === b.value && stableContext(a.context) === stableContext(b.context);
}
export function stableContext(context: Record<string, string>): string { return JSON.stringify(Object.entries(context).sort(([a], [b]) => a.localeCompare(b))); }
