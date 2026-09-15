import { createHash } from "node:crypto";
import type { MemorySession } from "../repository.js";
import type { MemoryItem, Proposal } from "../types.js";
import { extractAtoms, EXTRACTOR_VERSION, stableContext } from "./extract.js";
import type { AtomicDetails, CapturedTurn, ExtractedAtom } from "./contracts.js";
export interface Episode { id: string; sessionId: string; start: number; end: number; turnIds: string[]; topic: string }
export function segmentEpisodes(turns: CapturedTurn[], gapMs = 30 * 60_000): Episode[] {
  const out: Episode[] = [];
  for (const t of [...turns].sort((a,b) => a.at - b.at || a.id.localeCompare(b.id))) {
    const atoms = extractAtoms(t.text);
    const topic = atoms[0]?.predicate.split(".")[0] ?? "other";
    const last = out.at(-1);
    if (last && last.sessionId === t.sessionId && t.at - last.end <= gapMs && (topic === last.topic || topic === "other")) {
      last.turnIds.push(t.id); last.end = t.at;
    } else out.push({ id: createHash("sha256").update(JSON.stringify([t.sessionId,t.id])).digest("hex").slice(0,24), sessionId: t.sessionId, start: t.at, end: t.at, turnIds: [t.id], topic });
  }
  return out;
}
export function allMemories(session: MemorySession, scope: string): MemoryItem[] {
  const all: MemoryItem[] = []; let after = "";
  for (;;) { const page = session.page(scope, after, 200); if (!page.length) break; all.push(...page); after = page.at(-1)!.id; }
  return all;
}
export interface LearningReport {
  episodes: Episode[]; capturedEvidenceIds: string[]; committedIds: string[]; duplicateIds: string[];
  deferred: { turnId: string; reason: string; predicate?: string }[];
}
/** User turns are captured through the host's user session; the agent never creates this session. */
export class DreamingEngine {
  constructor(private readonly user: MemorySession, private readonly consolidator: MemorySession, private readonly scope: string) {}
  learn(turns: CapturedTurn[]): LearningReport {
    const episodes = segmentEpisodes(turns);
    const report: LearningReport = { episodes, capturedEvidenceIds: [], committedIds: [], duplicateIds: [], deferred: [] };
    for (const turn of [...turns].sort((a,b) => a.at - b.at || a.id.localeCompare(b.id))) {
      const evidence = this.user.capture({ scope: this.scope, source: "user-message", sourceRef: `turn:${turn.sessionId}:${turn.id}`,
        content: turn.text, occurredAt: turn.at, expectedEpoch: turn.expectedEpoch ?? this.user.snapshot(this.scope).epoch });
      report.capturedEvidenceIds.push(evidence.id);
      const atoms = extractAtoms(turn.text);
      if (!atoms.length) { report.deferred.push({ turnId: turn.id, reason: "NO_SUPPORTED_DURABLE_ATOM" }); continue; }
      const episodeId = episodes.find(e => e.turnIds.includes(turn.id))!.id;
      for (const [index, atom] of atoms.entries()) {
        const writer = turn.explicitMemory === true ? this.user : this.consolidator;
        // Only functional slots replace an earlier value. Facts, people and events accumulate.
        const accumulating = atom.type === "knowledge" || atom.type === "episodic"
          || atom.predicate.startsWith("relation.") || ["project.designer", "project.developer", "flight.avoid_seat"].includes(atom.predicate);
        const current = allMemories(writer, this.scope).filter(m => {
          const d = m.details; return d?.kind === "atomic" && m.type === atom.type && d.subject === atom.subject && d.predicate === atom.predicate
            && stableContext(d.context) === stableContext(atom.context) && m.validTo == null
            && (!accumulating || d.value === atom.value)
            && (atom.type !== "episodic" || d.observedAt === turn.at);
        }).sort((a,b) => b.validFrom - a.validFrom)[0];
        const previous = current?.details as AtomicDetails | undefined;
        if (current && previous?.value === atom.value && !(turn.explicitMemory && current.authority !== "user_explicit")) {
          report.duplicateIds.push(current.id); continue;
        }
        if (current?.authority === "user_explicit" && !turn.explicitMemory) {
          report.deferred.push({ turnId: turn.id, predicate: atom.predicate, reason: "EXPLICIT_OVERRIDES_UNCONFIRMED_CHANGE" }); continue;
        }
        if (current && turn.at <= current.validFrom) {
          report.deferred.push({ turnId: turn.id, predicate: atom.predicate, reason: "OUT_OF_ORDER_OR_SIMULTANEOUS_CONFLICT" }); continue;
        }
        const details: AtomicDetails = {
          kind: "atomic", subject: atom.subject, predicate: atom.predicate, value: atom.value, context: atom.context,
          observedAt: turn.at, confidence: atom.confidence, assertion: turn.explicitMemory ? "explicit" : "stated",
          episodeId, extractorVersion: EXTRACTOR_VERSION,
          spans: [{ evidenceId: evidence.id, ...atom.span }],
          ...(current ? { supersedesId: current.id, contradictsIds: previous?.value !== atom.value ? [current.id] : [] } : {}),
        };
        const snap = writer.snapshot(this.scope), proposals: Proposal[] = [];
        if (current) proposals.push({ scope: this.scope, type: current.type, content: current.content, title: current.title, aliases: current.aliases,
          evidenceIds: current.evidenceIds, target: { id: current.id, expectedVersion: current.version },
          validFrom: current.validFrom, validTo: turn.at, details: current.details!, basedOn: snap,
          idempotencyKey: `retire:${turn.sessionId}:${turn.id}:${index}` });
        proposals.push({ scope: this.scope, type: atom.type, content: atom.content, title: `${atom.subject} ${atom.predicate}`,
          aliases: [atom.value], evidenceIds: [evidence.id], validFrom: turn.at, details, basedOn: snap,
          idempotencyKey: `atom:${turn.sessionId}:${turn.id}:${index}` });
        const results = writer.batch(this.scope, proposals);
        const last = results.at(-1)!;
        if (last.status === "committed") report.committedIds.push(last.id);
        else report.deferred.push({ turnId: turn.id, predicate: atom.predicate, reason: last.reason });
      }
    }
    return report;
  }
}
