import { z } from "zod";
import {
  describeAddress,
  SAND_CREATE_AGENT_TOOL_NAME,
  SAND_LIST_AGENTS_TOOL_NAME,
  SAND_LIST_GROUPS_TOOL_NAME,
  SAND_SEND_TO_AGENT_TOOL_NAME,
  SAND_UPDATE_AGENT_TOOL_NAME,
  type AgentAddress,
  type AgentGroupAddress,
} from "../../agents/agent-messaging.js";
import { randomUUID } from "node:crypto";

import { defineCommunicateTool } from "./communicate-tool.js";
import { isValidAttachmentUrl } from "./send-message-schema.js";
import { withRemoteHooks } from "../../../packages/agent/tools/core/remote-hooks.js";
import type { Context } from "../../../packages/context/core.js";

export interface AgentImage {
  readonly url: string;
  readonly alt?: string;
}

export interface SendToAgentDependencies<_Context = Context> {
  getSelfAgentId(): string | undefined;
  resolveImageSource?(context: Context, url: string): Promise<string>;
  sendToAgent(
    targetId: string,
    message: string,
    images?: readonly AgentImage[],
    priority?: true,
  ): string | Promise<string>;
  /**
   * Remote hooks (preToolUse/postToolUse via .cursor/hooks.json), the same
   * mechanism WebSearch/WebFetch use. Wired so agent-to-agent messages can be
   * observed (e.g. a durable job ledger) or gated without touching this tool.
   */
  hookOptions?: {
    resourceAccessor: unknown;
    enableExecuteHookExec?: boolean;
    configuredSteps?: readonly string[];
  };
}

export interface AgentManagementDependencies {
  create(profile: { readonly name: string; readonly description: string }): Promise<{
    readonly id: string;
    readonly name: string;
  }>;
  /** Persists a per-agent model/reasoning selection (AUDIT-W1). Optional; wired by the host. */
  setAgentModelSelection?(agentId: string, selection: { readonly modelId: string; readonly maxMode: boolean; readonly parameters: readonly { readonly id: string; readonly value: string }[] }): void;
  update(
    agentId: string,
    patch: { readonly name?: string; readonly description?: string },
  ): Promise<{ readonly id: string; readonly name: string } | null>;
}

const imageSchema = z.object({
  url: z.string().trim().min(1).describe("file:// or https:// URL of the image."),
  alt: z.string().trim().optional().describe(
    "Optional short description of this image, shown on hover and as its fullscreen caption.",
  ),
});

export const sendToAgentParameters = z.object({
  target_id: z.string().trim().min(1).describe(
    "The id of the target — either another agent or a GROUP you belong to. Use an id from your teammates list, ListAgents, or ListGroups — not a name.",
  ),
  message: z.string().trim().min(1).describe(
    "What to say. Write it as if texting a teammate: lead with the point, keep it short.",
  ),
  images: z.array(imageSchema).optional().describe(
    "Optional image(s) to send with the message — a screenshot, chart, or photo the other agent needs. Delivered with your message: a 1:1 recipient actually sees them (like an image the user sends), and they render with your text in the exchange. Not delivered to groups.",
  ),
  priority: z.boolean().optional().describe(
    "When true (1:1 only; ignored for groups), interrupt the recipient's current non-user work and wake them immediately — same steer as a direct user message. Use for STOP / supersede / time-critical instructions. Default false: waits out the current turn, but still runs ahead of automations and other background work.",
  ),
}).superRefine((value, context) => {
  for (const [index, image] of (value.images ?? []).entries()) {
    if (!isValidAttachmentUrl(image.url)) {
      context.addIssue({
        code: "custom",
        path: ["images", index, "url"],
        message: "each images url must include a file:// or https:// scheme",
      });
    }
  }
});

export const createAgentParameters = z.object({
  name: z.string().trim().min(1).describe("A short, human-readable name for the new agent."),
  description: z.string().trim().default("").describe(
    "The new agent's persona / instructions: what it is for and how it should behave. This becomes its profile and shapes its replies. Optional but strongly recommended.",
  ),
  reasoning: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional().describe(
    "Optional reasoning effort for the new agent's model. Pick lower efforts (minimal/low) for quick mechanical workers and higher ones (high/xhigh) for analysis-heavy teammates; omit to inherit the default.",
  ),
});

export const updateAgentParameters = z.object({
  agent_id: z.string().trim().min(1).describe("The id of the agent to update."),
  name: z.string().trim().optional().describe("A new name for the agent. Omit to leave the name unchanged."),
  description: z.string().trim().optional().describe("A new persona/description for the agent. Omit to leave it unchanged."),
});

export async function resolveSendToAgentImages(
  context: Context,
  images: readonly z.infer<typeof imageSchema>[],
  resolveImageSource?: (context: Context, url: string) => Promise<string>,
): Promise<AgentImage[]> {
  const resolved: AgentImage[] = [];
  for (const image of images) {
    const url = resolveImageSource == null
      ? image.url
      : await resolveImageSource(context, image.url);
    const alt = image.alt != null && image.alt.length > 0 ? image.alt : undefined;
    resolved.push({ url, ...(alt == null ? {} : { alt }) });
  }
  return resolved;
}

export function createSendToAgentTool(
  dependencies: SendToAgentDependencies,
) {
  return defineCommunicateTool(dependencies, {
    id: "SEND_TO_TASK",
    name: SAND_SEND_TO_AGENT_TOOL_NAME,
    description: `Send a message to ANOTHER of your user's agents, OR post into a GROUP chat you belong to, by its id (not the user \u2014 SendMessage is how you reach the user). This is FIRE-AND-FORGET and asynchronous, like texting: it delivers your message, wakes that agent (or the group's members), and returns immediately with a delivery acknowledgement. Peer messages run ahead of automations and other background work; pass priority=true on a 1:1 send to interrupt the recipient's current non-user turn (STOP / supersede), like a direct user message (ignored for groups). It does NOT return their reply, and you must not wait or poll for one in this turn \u2014 send it and move on. Any reply arrives later as its own message that wakes you on a fresh turn. Get agent ids from your teammates list or ListAgents, and group ids from ListGroups. To include image(s) \u2014 a screenshot, chart, or photo the other agent needs \u2014 pass images: [{"url":"file:///absolute/path/to/shot.png","alt":"..."}] (file:// or https://). A 1:1 recipient actually sees them, like an image the user sends; never paste an image as a markdown ![](...) in the message text. Group posts are text-only today, so send images to an agent directly. Use it deliberately and sparingly \u2014 waking another agent or a whole group is a real side effect, so treat it like messaging on the user's behalf. Message someone or post to a group only when it truly serves the user's goal, not because one was mentioned or complained about, and don't spam a group. Never relay the user's private or unfiltered words (especially a complaint or criticism) verbatim; if relaying is warranted, paraphrase the actionable point diplomatically, not their tone. If you're unsure the user wants this sent, handle it yourself or ask first. Keep the message purposeful, professional, and minimal. One clearly relevant recipient can be normal work; messaging SEVERAL agents about the same effort (or posting it to a group) is a fan-out that wakes every recipient, and their replies land back in the user's chats and rooms \u2014 so fan out only when the user explicitly asked you to contact those agents. Otherwise propose it first with a question widget and wait for a yes, and never fan out "meanwhile" while you're waiting on the user for data or a decision.`,
    parameters: sendToAgentParameters,
    describeActivity: (args: z.infer<typeof sendToAgentParameters>) => ({
      target: args.target_id,
    }),
    async execute(context: Context, args: z.infer<typeof sendToAgentParameters>, resolved) {
      const self = resolved.getSelfAgentId();
      if (self != null && args.target_id === self) {
        return "You can't message yourself with SendToAgent. Use SendMessage to talk to the user, or pick a different target id.";
      }
      const executeCore = async (ctx: Context, coreArgs: z.infer<typeof sendToAgentParameters>): Promise<string> => {
        const images = await resolveSendToAgentImages(
          ctx,
          coreArgs.images ?? [],
          resolved.resolveImageSource,
        );
        return resolved.sendToAgent(
          coreArgs.target_id,
          coreArgs.message,
          images.length > 0 ? images : undefined,
          coreArgs.priority === true ? true : undefined,
        );
      };
      // Remote hooks (preToolUse/postToolUse), mirroring WebSearch/WebFetch: lets
      // .cursor/hooks.json observe every agent-to-agent send (job ledger) or deny one.
      const hookOptions = dependencies.hookOptions;
      if (hookOptions?.resourceAccessor !== undefined && hookOptions.enableExecuteHookExec === true) {
        const wrapped = withRemoteHooks({
          executeFn: (ctx: Context, toolArgs: z.infer<typeof sendToAgentParameters>) => executeCore(ctx, toolArgs),
          config: {
            toolName: SAND_SEND_TO_AGENT_TOOL_NAME,
            createToolInput: (a: z.infer<typeof sendToAgentParameters>) => ({
              target_id: a.target_id,
              message: a.message,
              ...(a.priority === true ? { priority: true } : {}),
              ...(resolved.getSelfAgentId() === undefined ? {} : { from_agent_id: resolved.getSelfAgentId() }),
            }),
            createRejectedResult: (_a: unknown, reason: string) => `Permission denied: ${reason}`,
            createSuccessOutput: (_a: unknown, result: unknown) => ({ status: "sent", ack: String(result).slice(0, 300) }),
            // sendToAgent reports failures as plain strings, not exceptions — a
            // ledger that records those as "sent" makes the sweeper wait forever
            // on a job that never left (external review #3). Successful acks all
            // start with "Sent to "/"Posted"; everything else is a failed send.
            getFailureInfo: (result: unknown) => {
              const text = String(result);
              return /^(Sent to |Posted )/.test(text)
                ? undefined
                : { errorMessage: text.slice(0, 300), failureType: "error" };
            },
          },
          requestContext: { toolCallId: randomUUID() },
          options: {
            resourceAccessor: hookOptions.resourceAccessor,
            enableExecuteHookExec: true,
            configuredSteps: hookOptions.configuredSteps,
          },
        });
        return await wrapped(context, args) as string;
      }
      return executeCore(context, args);
    },
  });
}

export function createCreateAgentTool(management: AgentManagementDependencies) {
  return defineCommunicateTool(management, {
    id: "CREATE_TASK",
    name: SAND_CREATE_AGENT_TOOL_NAME,
    description: `Create a new agent (a new teammate assistant) for your user, with a name and an optional persona/description. Returns the new agent's id so you can immediately message it with SendToAgent. Use this to spin up a focused teammate for a job. You have no tool to delete an agent, so only create one when it is genuinely useful; the user can delete an agent themselves from the sidebar (right-click the agent \u2192 "Delete").`,
    parameters: createAgentParameters,
    async execute(_context, args: z.infer<typeof createAgentParameters>, resolved) {
      const created = await resolved.create({
        name: args.name,
        description: args.description,
      });
      // Per-agent reasoning (AUDIT-W1): persist a model selection keyed by the new
      // agent's id; turn-run-shell consults it ahead of the global default.
      let reasoningNote = "";
      if (args.reasoning !== undefined) {
        try {
          // modelId "" = inherit: the host resolves it against the CURRENT global
          // default at save time (external review #4 — hardcoding gpt-5.5 here
          // silently switched new bots off a customized default model).
          resolved.setAgentModelSelection?.(created.id, {
            modelId: "",
            maxMode: false,
            parameters: [{ id: "effort", value: args.reasoning }],
          });
          reasoningNote = ` Its reasoning effort is set to ${args.reasoning}.`;
        } catch {
          reasoningNote = " (Reasoning preference could not be saved; it will use the default.)";
        }
      }
      return `Created agent "${created.name}" (id: ${created.id}).${reasoningNote} Message it with SendToAgent using that id.`;
    },
  });
}

export function createUpdateAgentTool(management: AgentManagementDependencies) {
  return defineCommunicateTool(management, {
    id: "PLATFORM_ACTION",
    name: SAND_UPDATE_AGENT_TOOL_NAME,
    description: "Edit an existing agent's profile: its name and/or description. Only the fields you provide are changed; the rest are left exactly as they were, and there is no way to clear or delete an agent through this tool. Use it to refine a teammate you (or the user) created.",
    parameters: updateAgentParameters,
    describeActivity: (args: z.infer<typeof updateAgentParameters>) => ({
      target: args.agent_id,
    }),
    async execute(_context, args: z.infer<typeof updateAgentParameters>, resolved) {
      const patch: { name?: string; description?: string } = {};
      if (args.name != null && args.name.length > 0) patch.name = args.name;
      if (args.description != null && args.description.length > 0) {
        patch.description = args.description;
      }
      if (patch.name == null && patch.description == null) {
        return "Nothing to update: provide a new name and/or description.";
      }
      const updated = await resolved.update(args.agent_id, patch);
      return updated == null
        ? `No agent found with id ${args.agent_id}.`
        : `Updated agent "${updated.name}" (id: ${updated.id}).`;
    },
  });
}

/**
 * Read-only roster tools. The SendToAgent / SendMessage descriptions already
 * point the model at "ListAgents, or ListGroups"; these provide them from the
 * same roster the system prompt renders (ids are what SendToAgent needs).
 */
export interface AgentRosterDependencies {
  listAgents(): readonly AgentAddress[];
  listGroups(): readonly AgentGroupAddress[];
}

const emptyParameters = z.object({});

export function createListAgentsTool(roster: AgentRosterDependencies) {
  return defineCommunicateTool(roster, {
    id: "PLATFORM_ACTION",
    name: SAND_LIST_AGENTS_TOOL_NAME,
    description: "List your user's other agents (your teammates) with the ids you need for SendToAgent. Read-only; group chats are listed by ListGroups.",
    parameters: emptyParameters,
    async execute(_context, _args: z.infer<typeof emptyParameters>, resolved) {
      const agents = resolved.listAgents();
      if (agents.length === 0) {
        return `This user has no other agents yet. If a task would be better handled by a dedicated teammate, offer to ${SAND_CREATE_AGENT_TOOL_NAME} one.`;
      }
      return ["Teammates you can message with SendToAgent (use the id):", ...agents.map(describeAddress)].join("\n");
    },
  });
}

export function createListGroupsTool(roster: AgentRosterDependencies) {
  return defineCommunicateTool(roster, {
    id: "PLATFORM_ACTION",
    name: SAND_LIST_GROUPS_TOOL_NAME,
    description: "List the group chats you belong to, with their ids (SendToAgent with a group id posts to the whole group) and members. Read-only.",
    parameters: emptyParameters,
    async execute(_context, _args: z.infer<typeof emptyParameters>, resolved) {
      const groups = resolved.listGroups();
      if (groups.length === 0) return "You are not in any group chats.";
      return [
        "Group chats you're in (post to one by its id to reach all its members):",
        ...groups.map((group) => {
          const memberNames = group.members.map((member) => member.name).join(", ");
          return `- ${group.name} (id: ${group.id})${memberNames.length > 0 ? ` — with ${memberNames}` : ""}`;
        }),
      ].join("\n");
    },
  });
}
