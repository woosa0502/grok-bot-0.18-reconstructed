// Marketplace → Belmont bot import (2026-09-05). The public marketplace page exposes a bot's
// memories (operating rules), skill names/descriptions, routine names/summaries and integrations,
// but not skill bodies or routine prompts. These tests pin the parser (RSC rows with $-references),
// the persona/skill/routine shaping, and the cron guess.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMarketplaceBot, parseSharePage, buildBotDescription, buildSkillMarkdown, buildRoutineSpec, guessCron, slugFromUrl } from "../scripts/lib/grok-bot-template.mjs";

const record = {
  id: "tech-demos", name: "Tech Demos", creatorName: "Matt Palmer", description: "Weekday scout.", summary: "Weekday scout that demos one library.",
  categories: ["Engineering"], color: "violet", shape: "teardrop", addHref: "grokbot://app/v1/bot-template?id=PaYvPhWPSynlUwFqMX7nc", instructions: "",
  memories: [{ id: "memory-0", name: "memory 1", description: "$2a" }, { id: "memory-1", name: "memory 2", description: "Never create a new repo per demo." }],
  skills: [{ id: "skill-0", name: "Project planning", description: "Use when scoping an idea.", content: "Use when scoping an idea." }],
  routines: [{ id: "routine-0", name: "Daily X tech scout", summary: "Weekdays at 9:00 AM. Lands paused on import." }],
  integrations: [{ id: "integration-0", name: "X", description: "Read timelines." }],
};
function page(rec) {
  const longText = "For tech demo cloud agents use model claude-fable-5.";
  const rows = [`0:["$","div",null,{"children":${JSON.stringify(rec)}}]`, `2a:T${longText.length.toString(16)},${longText}`];
  const payload = rows.join("\n").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `<html><head><title>Tech Demos by Matt Palmer</title></head><body><script>self.__next_f.push([1,"${payload}"])</script></body></html>`;
}

test("parseMarketplaceBot reads the embedded record and resolves $-references to text rows", () => {
  const parsed = parseMarketplaceBot(page(record));
  assert.equal(parsed.name, "Tech Demos");
  assert.equal(parsed.memories[0].description, "For tech demo cloud agents use model claude-fable-5.", "the $2a reference resolved to its T row");
  assert.equal(parsed.memories[1].description, "Never create a new repo per demo.");
  assert.equal(parsed.skills[0].name, "Project planning");
  assert.equal(parsed.routines[0].summary, "Weekdays at 9:00 AM. Lands paused on import.");
  assert.equal(parseMarketplaceBot("<html>no record here</html>"), null);
});

test("parseSharePage keeps to what the share page really has: name, creator, description, template id", () => {
  const html = `<html><head><title>Tech Demos by Matt</title><meta name="description" content="Weekday X-bookmark scout that picks one new library to demo."></head><body><a href="grokbot://app/v1/bot-template?id=zvkkoHMbclsUBWX8MRGpU">Add to Grok Bot</a></body></html>`;
  assert.deepEqual(parseSharePage(html), { name: "Tech Demos", description: "Weekday X-bookmark scout that picks one new library to demo.", creatorName: "Matt", templateId: "zvkkoHMbclsUBWX8MRGpU" });
});

test("the persona carries the memories as numbered operating rules and lists skills, routines and integrations honestly", () => {
  const parsed = parseMarketplaceBot(page(record));
  const persona = buildBotDescription(parsed, { availableIntegrations: "gmail-imap, browser" });
  assert.match(persona, /^You are Tech Demos, a bot originally published by Matt Palmer/);
  assert.match(persona, /Operating rules[\s\S]*1\. For tech demo cloud agents use model claude-fable-5\.\n2\. Never create a new repo per demo\./);
  assert.match(persona, /- Project planning: Use when scoping an idea\./);
  assert.match(persona, /Routines the original bot ran \(imported paused/);
  assert.match(persona, /Integrations the original bot used: X\. Available here: gmail-imap, browser\./);
  assert.doesNotMatch(persona, /\$2a/, "unresolved references never leak into the persona");
});

test("skills become SKILL.md: a thin note by default, the full body when one is supplied", () => {
  const note = buildSkillMarkdown(record.skills[0]);
  assert.match(note, /^---\nname: "Project planning"\ndescription: "Use when scoping an idea\."\n---/);
  assert.match(note, /does not publish skill bodies/);
  const full = buildSkillMarkdown(record.skills[0], "---\nname: x\n---\n# Planning\n\n1. Scope\n2. Plan\n");
  assert.match(full, /^---\nname: "Project planning"/);
  assert.match(full, /# Planning\n\n1\. Scope\n2\. Plan/);
  assert.doesNotMatch(full, /name: x/, "the source frontmatter is replaced by the marketplace name/description");
});

test("routines import paused with a best-effort cron from the summary", () => {
  assert.equal(guessCron("Weekdays at 9:00 AM. Lands paused on import."), "0 9 * * 1-5");
  assert.equal(guessCron("Every Monday morning, diffs the pages on the watch list"), "0 9 * * 1");
  assert.equal(guessCron("Each weekday morning, checks changelog pages"), "0 9 * * 1-5");
  assert.equal(guessCron("Every 30 minutes, watches PRs"), "@every 30m");
  assert.equal(guessCron("Daily at 6:30 pm summary"), "30 18 * * *");
  assert.equal(guessCron("Nightly audit of the repo"), "0 21 * * *");
  assert.equal(guessCron("whenever asked"), "0 9 * * 1-5", "unknown cadence falls back to weekday mornings, still paused");
  const spec = buildRoutineSpec(record.routines[0]);
  assert.equal(spec.isEnabled, false);
  assert.equal(spec.trigger.schedule, "0 9 * * 1-5");
  assert.match(spec.prompt, /^Weekdays at 9:00 AM/);
  assert.match(spec.prompt, /confirm the schedule with the user/);
});

test("slugFromUrl accepts slugs, marketplace urls and 21-char share ids", () => {
  assert.deepEqual(slugFromUrl("tech-demos"), { kind: "marketplace", slug: "tech-demos" });
  assert.deepEqual(slugFromUrl("https://x.ai/bot/marketplace/bots/engineer-bot"), { kind: "marketplace", slug: "engineer-bot" });
  assert.deepEqual(slugFromUrl("https://x.ai/bot/zvkkoHMbclsUBWX8MRGpU"), { kind: "share", id: "zvkkoHMbclsUBWX8MRGpU" });
  assert.equal(slugFromUrl("https://example.com/x"), null);
});
