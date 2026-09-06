import {
  GROUP_MAX_MEMBER_TURNS,
  GROUP_MAX_MESSAGES_PER_TURN,
  GROUP_MAX_ROUNDS,
  SHARED_ROOM_HISTORY_LIMIT,
  buildGroupMemberSystemPrompt,
  buildGroupTurnPrompt,
  isPassContent,
  messagesSinceMemberLastSpoke,
  orderRoundSpeakers,
  resolveResponders,
  type GroupDescription,
  type GroupMember,
  type GroupMessage,
} from "../../groups/group-chat.js";

export interface GroupOrchestratorDeps {
  resolveMembers(ids: readonly string[]): Promise<GroupMember[]>;
  readHistory(): readonly GroupMessage[];
  isCurrent(): boolean;
  runMemberTurn(args: {
    member: GroupMember;
    systemPrompt: string;
    prompt: string;
  }): Promise<readonly string[] | GroupMemberTurnResult>;
  postMemberMessage(member: GroupMember, content: string): void;
  finalizeMemberTurn?(member: GroupMember): void;
  isSharedRoom?: boolean;
}

export interface GroupMemberTurnResult {
  readonly messages: readonly string[];
  readonly completed: boolean;
  readonly reason?: string;
}

export interface GroupRunResult {
  readonly completed: boolean;
  readonly reason: "done" | "aborted" | "cap" | "empty" | "unknown" | "member_pending";
  readonly memberTurns: number;
}

/** Drives a bounded, epoch-cancellable round robin for one room turn. */
export class GroupChatOrchestrator {
  constructor(readonly deps: GroupOrchestratorDeps) {}

  async run(args: {
    group: GroupDescription;
    memberIds: readonly string[];
  }): Promise<GroupRunResult> {
    const members = await this.deps.resolveMembers(args.memberIds);
    if (members.length === 0) return { completed: false, reason: "empty", memberTurns: 0 };

    const memberById = new Map(members.map((member) => [member.id, member]));
    let totalMessages = 0;
    let memberTurns = 0;
    const outcomes = new Map<string, GroupMemberTurnResult>();
    const deferredMembers = new Set<string>();
    const stopped = (reason: GroupRunResult["reason"]): GroupRunResult => ({ completed: false, reason, memberTurns });

    for (let round = 0; round < GROUP_MAX_ROUNDS; round += 1) {
      if (!this.deps.isCurrent()) return stopped("aborted");
      const responderIds = resolveResponders(
        members,
        this.deps.readHistory(),
      ).map((member) => member.id);
      let messagesThisRound = 0;

      for (const memberId of orderRoundSpeakers(responderIds, round)) {
        if (!this.deps.isCurrent()) return stopped("aborted");
        if (totalMessages >= GROUP_MAX_MEMBER_TURNS || memberTurns >= GROUP_MAX_MEMBER_TURNS)
          return stopped("cap");
        if (deferredMembers.has(memberId)) continue;
        const member = memberById.get(memberId);
        if (member == null) continue;

        const result = await this.runOneTurn(args.group, member, members);
        memberTurns += 1;
        outcomes.set(memberId, result);
        // Do not re-enter a pending member in the next conversational round and bypass its
        // continuation/approval/stop budget. Legacy remote string replies remain conversational.
        if (!result.completed && result.reason !== "unknown") deferredMembers.add(memberId);
        if (!this.deps.isCurrent()) {
          this.deps.finalizeMemberTurn?.(member);
          return stopped("aborted");
        }
        let hitCap = false;
        for (const content of result.messages) {
          this.deps.postMemberMessage(member, content);
          totalMessages += 1;
          messagesThisRound += 1;
          if (totalMessages >= GROUP_MAX_MEMBER_TURNS) {
            hitCap = true;
            break;
          }
        }
        this.deps.finalizeMemberTurn?.(member);
        if (hitCap) return stopped("cap");
      }

      if (messagesThisRound === 0) {
        const incomplete = [...outcomes.values()].find((outcome) => !outcome.completed);
        if (incomplete != null) return stopped(incomplete.reason === "unknown" ? "unknown" : "member_pending");
        return { completed: outcomes.size > 0, reason: outcomes.size > 0 ? "done" : "empty", memberTurns };
      }
    }
    return stopped("cap");
  }

  async runOneTurn(
    group: GroupDescription,
    member: GroupMember,
    members: readonly GroupMember[],
  ): Promise<GroupMemberTurnResult> {
    const peers = members.filter((other) => other.id !== member.id);
    const history = this.deps.readHistory();
    const newMessages =
      this.deps.isSharedRoom === true
        ? history.slice(-SHARED_ROOM_HISTORY_LIMIT)
        : messagesSinceMemberLastSpoke(history, member.id);
    const outcome = await this.deps.runMemberTurn({
      member,
      systemPrompt: buildGroupMemberSystemPrompt(member, group, peers, {
        isSharedRoom: this.deps.isSharedRoom === true,
      }),
      prompt: buildGroupTurnPrompt({ member, group, peers, newMessages }),
    });
    const result: GroupMemberTurnResult = Array.isArray(outcome)
      ? { messages: outcome, completed: false, reason: "unknown" }
      : outcome as GroupMemberTurnResult;

    const spoken: string[] = [];
    for (const content of result.messages) {
      if (isPassContent(content)) continue;
      const trimmed = content.trim();
      if (trimmed.length === 0) continue;
      spoken.push(trimmed);
      if (spoken.length >= GROUP_MAX_MESSAGES_PER_TURN) break;
    }
    return { ...result, messages: spoken };
  }
}
