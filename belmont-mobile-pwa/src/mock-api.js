import { normalizeFleet, responseBehavior } from "./core.js";

const now = Date.now();

const initialBots = [
  {
    id: "belmont",
    threadId: "thread-belmont",
    name: "Belmont",
    title: "Chief of Staff",
    description: "목표를 이해하고 필요한 에이전트를 선택해 결과를 검토합니다.",
    notifications: true,
    color: "#0EA5C6",
    unread: true,
    busy: false,
    pinned: true,
    chiefOfStaff: true,
    modelSelection: { instanceId: "local", model: "codex" },
    createdAt: now - 86_400_000,
    messages: []
  },
  {
    id: "researcher",
    threadId: "thread-researcher",
    name: "Researcher",
    title: "Research",
    description: "근거와 원본을 확인합니다.",
    notifications: false,
    color: "#8057C8",
    unread: false,
    busy: false,
    modelSelection: { instanceId: "local", model: "codex" },
    createdAt: now - 43_200_000,
    taskStatus: "완료",
    taskSummary: "OpenMaus 모바일 구조와 PWA 경계를 확인했습니다."
  },
  {
    id: "builder",
    threadId: "thread-builder",
    name: "Builder",
    title: "Engineer",
    description: "승인된 설계를 구현하고 검증합니다.",
    notifications: false,
    color: "#E78531",
    unread: false,
    busy: true,
    modelSelection: { instanceId: "local", model: "codex" },
    createdAt: now - 21_600_000,
    taskStatus: "진행 중",
    taskSummary: "설치형 PWA 수직 흐름을 구현하고 있습니다."
  }
];

const initialMessages = [
  {
    id: "m-1",
    role: "user",
    kind: "text",
    at: now - 260_000,
    text: "OpenMausBot 모바일 흐름을 참고해서 우리 PWA를 만들어줘. 나는 Belmont하고만 대화할게."
  },
  {
    id: "m-2",
    role: "bot",
    kind: "text",
    at: now - 245_000,
    text: "확인했습니다. 모바일 구조는 제가 정하고, 프로토콜 검토와 구현을 각각 필요한 에이전트에게 맡겼습니다. 결과는 제가 직접 확인한 뒤 보고하겠습니다."
  },
  {
    id: "m-2b",
    role: "bot",
    kind: "text",
    at: now - 230_000,
    text: "먼저 공개된 iOS 화면과 실제 인터랙션 수치를 기준으로 맞추겠습니다."
  },
  {
    id: "m-3",
    role: "bot",
    kind: "activity",
    at: now - 160_000,
    tool: { name: "Researcher", ok: true, spoken: "모바일 API와 iOS 화면 흐름 검토 완료" }
  },
  {
    id: "m-4",
    role: "bot",
    kind: "activity",
    at: now - 110_000,
    tool: { name: "Builder", ok: null, spoken: "PWA 화면과 오프라인 셸 구현 중" }
  },
  {
    id: "m-5",
    role: "bot",
    kind: "text",
    at: now - 50_000,
    text: "이 화면은 데모입니다. 실제 Belmont 연결은 전용 모바일 어댑터를 실행한 뒤 표시되는 페어링 코드로 시작합니다."
  },
  {
    id: "approval-1",
    role: "bot",
    kind: "options",
    at: now - 45_000,
    card: {
      title: "데모 승인 카드",
      subtitle: "실제 연결에서는 Belmont 승인 종류에 맞는 명령으로 각각 전달됩니다.",
      options: ["Allow", "Deny"],
      requestId: "request-connect-pwa",
      tool: "BelmontGateway",
      allowKey: "BelmontGateway:mobile-read-write"
    }
  }
];

export function createMockApi() {
  const bots = structuredClone(initialBots);
  const messages = structuredClone(initialMessages);
  let eventListener = null;

  const api = {
    async health() {
      return { ok: true, app: "Belmont PWA Demo" };
    },

    async fleet() {
      const manager = bots.find((bot) => bot.id === "belmont");
      manager.messages = structuredClone(messages);
      return normalizeFleet({ bots: structuredClone(bots), groups: [] });
    },

    async messages(threadId) {
      if (threadId && threadId !== "thread-belmont") {
        return { messages: [], hasMore: false, before: null };
      }
      return { messages: structuredClone(messages), hasMore: false, before: null };
    },

    async send({ text }) {
      messages.push({ id: crypto.randomUUID(), role: "user", kind: "text", at: Date.now(), text });
      const manager = bots.find((bot) => bot.id === "belmont");
      manager.busy = true;
      eventListener?.({ event: "fleet", data: { reason: "message-sent" } });
      await delay(420);
      messages.push({
        id: crypto.randomUUID(),
        role: "bot",
        kind: "text",
        at: Date.now(),
        text: "알겠습니다. 필요한 작업을 제가 판단해서 진행하고, 확인된 결과만 정리해 보고하겠습니다."
      });
      manager.busy = false;
      manager.unread = true;
      eventListener?.({ event: "message", data: { threadId: manager.threadId } });
      return null;
    },

    async respond({ requestId, behavior, message: answer = null }) {
      const message = messages.find((entry) => entry.card?.requestId === requestId);
      if (!message) throw new Error("승인 요청을 찾지 못했습니다.");
      message.card.answered = behavior === "answer" ? answer : behavior === "deny" ? "Deny" : "Allow";
      messages.push({
        id: crypto.randomUUID(),
        role: "bot",
        kind: "text",
        at: Date.now(),
        text: behavior === "answer"
          ? `선택을 받았습니다: ${answer}`
          : behavior === "deny"
          ? "연결하지 않겠습니다. 데모 상태는 그대로 유지합니다."
          : "데모 승인을 처리했습니다. 실제 연결에서는 Belmont 응답을 다시 조회합니다."
      });
      return { behavior: responseBehavior(message.card.answered, true) };
    },

    async alwaysAllow({ allowKey }) {
      if (!allowKey) throw new Error("항상 허용 범위를 확인할 수 없습니다.");
      return null;
    },

    subscribe({ onEvent, onStatus } = {}) {
      eventListener = onEvent;
      onStatus?.("connected");
      return () => {
        eventListener = null;
        onStatus?.("closed");
      };
    }
  };

  return api;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
