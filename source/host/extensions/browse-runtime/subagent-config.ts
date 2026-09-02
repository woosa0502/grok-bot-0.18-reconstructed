import { CustomSubagentPermissionMode, SubagentType, SubagentTypeCustom } from "../../../packages/proto/generated/agent/v1/subagents_pb.js";

/** Opt-in flag: SAND_ASIDE_BROWSE=1 offers the Aside-engine browser worker as a Task subagent type. */
export const ASIDE_BROWSE_ENABLED = process.env.SAND_ASIDE_BROWSE === "1";
export const ASIDE_BROWSE_SUBAGENT_TYPE = "aside-browse";

export function isAsideBrowseSubagentType(name: string | undefined): boolean {
  return typeof name === "string" && name.trim().toLowerCase().replace(/[-_]/g, "") === "asidebrowse";
}

const ASIDE_BROWSE_DESCRIPTION = [
  "Browser worker running on the Aside browsing engine (text snapshots + Playwright REPL) in a signed-in Chrome on this computer.",
  "Use it for ANY web task that needs more than a single page read: searching a site, navigating menus, reading tables or dashboards, filling forms, checking account pages, gathering evidence across pages.",
  "Give it the whole job in one prompt: the goal, the exact site or URL, what to read or do, what to change (or 'do not change anything'), and the format you want back. It reports the final answer as text and may attach screenshot paths.",
  "If it needs approval or an answer from the user it returns a message starting with [approval needed] or [question]; ask the user, then call Task again with resume=<its agent id> and the answer (allow / deny / confirm / cancel / free text) as the prompt.",
  "Do not use it for plain HTTP fetches of a single public page (use webfetch) or for tasks on this computer's files.",
].join(" ");

export function createAsideBrowseSubagentConfig(): {
  readonly subagent_type: SubagentType;
  readonly description: string;
  readonly preserveTaskTool: false;
  readonly subagentSource: "builtin";
  readonly permissionMode: CustomSubagentPermissionMode;
} {
  return {
    subagent_type: new SubagentType({ type: { case: "custom", value: new SubagentTypeCustom({ name: ASIDE_BROWSE_SUBAGENT_TYPE }) } }),
    description: ASIDE_BROWSE_DESCRIPTION,
    preserveTaskTool: false,
    subagentSource: "builtin",
    permissionMode: CustomSubagentPermissionMode.DEFAULT,
  };
}
