// Marketplace/share-page → Belmont bot: the parsing and shaping half of scripts/import-grok-bot.mjs.
// Pure functions only (no network, no gateway) so they can be tested.
//
// What the public marketplace page exposes (verified 2026-09-05 over all 69 bots): name, creator,
// description, categories, avatar color/shape, and — the substantive part — the bot's memories
// (behaviour rules, avg 2,600 chars). Skills come as name + one-line description (content equals
// description on every entry), routines as name + summary, integrations as plugin names. The
// system-prompt field is empty everywhere; the app-only template (grokbot:// deep link, account
// required) is what carries skill bodies and routine prompts.

/** Rows of a Next.js RSC flight payload: `id:` JSON rows and `id:T<hexlen>,` text rows. */
export function rscRows(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/gs)].map((m) => m[1]);
  const blob = chunks.map(unescapeJs).join("");
  const rows = new Map();
  const rowStart = /(?:^|\n)([0-9a-f]+):(T[0-9a-f]+,)?/g;
  let m;
  while ((m = rowStart.exec(blob)) !== null) {
    const id = m[1];
    const bodyStart = m.index + m[0].length;
    if (m[2]) {
      const length = Number.parseInt(m[2].slice(1, -1), 16);
      rows.set(id, blob.slice(bodyStart, bodyStart + length));
      rowStart.lastIndex = bodyStart + length;
    } else {
      const next = blob.slice(bodyStart).search(/\n[0-9a-f]+:/);
      rows.set(id, next < 0 ? blob.slice(bodyStart) : blob.slice(bodyStart, bodyStart + next));
    }
  }
  return { blob, rows };
}

function unescapeJs(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/** Resolves `$<rowId>` references (long strings are stored as separate T rows). */
export function resolveRefs(value, rows) {
  if (typeof value === "string") {
    const ref = /^\$([0-9a-f]+)$/.exec(value);
    return ref !== null && rows.has(ref[1]) ? rows.get(ref[1]) : value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, rows));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, rows)]));
  return value;
}

/** The marketplace bot record embedded in a `/bot/marketplace/bots/<slug>` page, or null. */
export function parseMarketplaceBot(html) {
  const { blob, rows } = rscRows(html);
  const at = blob.indexOf('"instructions":');
  if (at < 0) return null;
  const start = blob.lastIndexOf('{"id":"', at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < blob.length; i += 1) {
    const ch = blob[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return resolveRefs(JSON.parse(blob.slice(start, i + 1)), rows); } catch { return null; }
      }
    }
  }
  return null;
}

/** The public share page (`x.ai/bot/<id>`) only carries name/author/description meta tags. */
export function parseSharePage(html) {
  const title = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] ?? /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  const description = /<meta (?:property="og:description"|name="description") content="([^"]*)"/.exec(html)?.[1] ?? "";
  const template = /bot-template\?id=([A-Za-z0-9_-]+)/.exec(html)?.[1];
  const name = title.replace(/\s+by\s+.*$/i, "").replace(/\s*[|·-]\s*Grok Bot.*$/i, "").trim();
  const creator = /\bby\s+([^|·]+?)\s*(?:[|·]|$)/i.exec(title)?.[1]?.trim();
  return { name: decodeEntities(name), description: decodeEntities(description), ...(creator ? { creatorName: creator } : {}), ...(template ? { templateId: template } : {}) };
}

function decodeEntities(text) {
  return text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export const AVATAR_SHAPES = new Set(["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"]);

/**
 * The bot's persona (Belmont's `description` is the system-prompt-like identity). The marketplace
 * memories are the bot's own operating rules, so they become numbered rules here; skills, routines
 * and integrations are listed so the bot knows what it is expected to have and what is missing.
 */
export function buildBotDescription(record, options = {}) {
  const lines = [];
  const summary = (record.summary || record.description || "").trim();
  lines.push(`You are ${record.name}${record.creatorName ? `, a bot originally published by ${record.creatorName} on the Grok Bot marketplace` : ""}.`);
  if (summary) lines.push(summary);
  const memories = (record.memories ?? []).map((m) => String(m.description ?? "").trim()).filter((t) => t.length > 0 && !/^\$[0-9a-f]+$/.test(t));
  if (memories.length > 0) {
    lines.push("", "Operating rules (carried over from the original bot's memory):");
    memories.forEach((text, index) => lines.push(`${index + 1}. ${text}`));
  }
  const skills = record.skills ?? [];
  if (skills.length > 0) {
    lines.push("", "Skills you are expected to have (imported as skill notes; flesh a note out into a full skill the first time you use it):");
    for (const skill of skills) lines.push(`- ${skill.name}: ${String(skill.description ?? "").trim()}`);
  }
  const routines = record.routines ?? [];
  if (routines.length > 0) {
    lines.push("", "Routines the original bot ran (imported paused; confirm the schedule with the user before enabling):");
    for (const routine of routines) lines.push(`- ${routine.name}: ${String(routine.summary ?? "").trim()}`);
  }
  const integrations = record.integrations ?? [];
  if (integrations.length > 0) {
    lines.push("", `Integrations the original bot used: ${integrations.map((i) => i.name).join(", ")}. ${options.availableIntegrations ? `Available here: ${options.availableIntegrations}. ` : ""}When one is missing, say so and use the closest tool you do have instead of pretending.`);
  }
  return lines.join("\n");
}

/** SKILL.md for a marketplace skill: a full body when one was supplied, otherwise a thin note. */
export function buildSkillMarkdown(skill, fullBody) {
  const name = String(skill.name ?? "").trim();
  const description = String(skill.description ?? "").trim();
  const frontmatter = ["---", `name: ${JSON.stringify(name)}`, `description: ${JSON.stringify(description)}`, "---"].join("\n");
  if (fullBody && fullBody.trim().length > 0) {
    const body = fullBody.replace(/^---[\s\S]*?---\s*/, "");
    return `${frontmatter}\n\n${body.trim()}\n`;
  }
  return `${frontmatter}\n\n# ${name}\n\n${description}\n\nThis skill was imported from the Grok Bot marketplace with only its one-line description (the marketplace does not publish skill bodies). The first time you use it, write the full procedure here: inputs, steps, decision rules, definition of done, and what needs the user's approval.\n`;
}

const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

/** Best-effort cron from a routine summary such as "Weekdays at 9:00 AM" or "Every Monday morning". */
export function guessCron(summary, fallback = "0 9 * * 1-5") {
  const text = String(summary ?? "").toLowerCase();
  const time = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/.exec(text);
  let hour = 9;
  let minute = 0;
  if (time) {
    hour = Number.parseInt(time[1], 10) % 12 + (time[3] === "pm" ? 12 : 0);
    minute = Number.parseInt(time[2] ?? "0", 10);
  } else if (/\bevening\b/.test(text)) hour = 18;
  else if (/\bnoon\b/.test(text)) hour = 12;
  else if (/\bnight(ly)?\b/.test(text)) hour = 21;
  const every = /every\s+(\d+)\s*(minutes?|hours?)/.exec(text);
  if (every) return `@every ${every[1]}${every[2].startsWith("min") ? "m" : "h"}`;
  if (/\b(weekdays?|each weekday|every weekday)\b/.test(text)) return `${minute} ${hour} * * 1-5`;
  const day = Object.keys(WEEKDAYS).find((d) => new RegExp(`\\b(every|each)\\s+${d}\\b`).test(text) || new RegExp(`\\b${d}s\\b`).test(text));
  if (day) return `${minute} ${hour} * * ${WEEKDAYS[day]}`;
  if (/\b(daily|every day|each day|every morning|each morning|nightly|every night|each night)\b/.test(text)) return `${minute} ${hour} * * *`;
  if (/\b(weekly|every week)\b/.test(text)) return `${minute} ${hour} * * 1`;
  if (/\b(hourly|every hour)\b/.test(text)) return "@every 1h";
  return fallback;
}

/** Routine spec for createAgentAutomation: paused, prompt seeded from the marketplace summary. */
export function buildRoutineSpec(routine) {
  const name = String(routine.name ?? "Imported routine").trim();
  const summary = String(routine.summary ?? "").trim();
  return {
    name,
    prompt: `${summary}\n\n(Imported from the Grok Bot marketplace as a summary only. Before the first real run, restate this routine as concrete steps in your own words, confirm the schedule with the user, and keep every outward action behind their approval.)`,
    trigger: { type: "cron", schedule: guessCron(summary) },
    isEnabled: false,
  };
}

export function slugFromUrl(input) {
  const m = /marketplace\/bots\/([a-z0-9-]+)/i.exec(input);
  if (m) return { kind: "marketplace", slug: m[1] };
  if (/^[a-z0-9-]+$/i.test(input) && !/^https?:/i.test(input) && input.length <= 64 && !/^[A-Za-z0-9_-]{21}$/.test(input)) return { kind: "marketplace", slug: input };
  const share = /x\.ai\/bot\/([A-Za-z0-9_-]{15,})/.exec(input);
  if (share) return { kind: "share", id: share[1] };
  return null;
}
