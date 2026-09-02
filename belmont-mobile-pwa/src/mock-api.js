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
    id: "m-att-1",
    role: "bot",
    kind: "attachment",
    at: now - 170_000,
    attachment: { kind: "image", mime: "image/png", name: "screenshot.png", alt: "데모 스크린샷", src: "data:image/png;base64,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" }
  },
  {
    id: "m-att-2",
    role: "bot",
    kind: "attachment",
    at: now - 165_000,
    attachment: { kind: "text", mime: "text/markdown", name: "주간-보고서.md", text: "# 주간 보고서\n\n## 요약\n- 모바일 API 검토 완료\n- PWA 설치 흐름 구현 중\n\n## 다음 주\n1. 첨부 뷰어\n2. 파일 탐색기\n\n| 항목 | 상태 |\n|---|---|\n| 컴퓨터 화면 | 완료 |\n| 뷰어 | 진행 중 |\n" }
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

    async files(_botId, path = "") {
      const tree = {
        "": [{ name: "reports", kind: "dir" }, { name: "screenshots", kind: "dir" }, { name: "notes.md", kind: "text", mime: "text/markdown", size: 812, text: "# 메모\n\n- 데모 작업 폴더입니다.\n- 파일을 탭하면 뷰어가 열립니다.\n" }],
        reports: [{ name: "주간-보고서.md", kind: "text", mime: "text/markdown", size: 2310, text: initialMessages.find((item) => item.id === "m-att-2").attachment.text }],
        screenshots: [{ name: "screenshot.png", kind: "image", mime: "image/png", size: 5084, src: initialMessages.find((item) => item.id === "m-att-1").attachment.src }]
      };
      const entries = tree[path];
      if (!entries) throw new Error("no such folder in the demo workspace");
      return { path, entries: entries.map((entry) => ({ ...entry, mtime: now })) };
    },

    fileUrl() { return ""; },

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
