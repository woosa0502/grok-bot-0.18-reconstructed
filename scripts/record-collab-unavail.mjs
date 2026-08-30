import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const assign = readFileSync("/tmp/method-assign.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const q = readFileSync("docs/testing/belmont-wsl-test-queue.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const qById = new Map(q.map((c) => [c.testCaseId, c]));

// cross-user sharing UI (gated off in local): shared rooms / channels / members / org chart / cross-user.
// EXCLUDE local group chat (groups/group-chat.ts exists locally) — those go to AX, not UNAVAIL.
const SHARING = /공유룸|정보-채널|채널|정보-멤버|조직도|cross-user|shared room|invite|초대|room|참가자|typing.*member|remote member/i;
const LOCAL_GROUP = /^정보-\S*그룹|group chat|로컬 그룹/i;

const collab = assign.filter((a) => a.method === "COLLAB");
const evidence = "cross-user-sharing 확장이 로컬에서 게이트오프: (1) sand_multiplayer 피처게이트, (2) dev-build 환경가드 resolveXuserSharingEnvironment.isAllowed=false(SAND_PACKAGED!=1이면 opt-in env 없이는 거부), (3) 실제 Cursor 클라우드 backend+JWT auth 필요(로컬 Codex는 상수 Belmont Local, sub 없음). 셋 미충족이라 createSharedRoom/join/invite 등 전부 'Sharing isn\\'t enabled for your account.' 반환. 로컬 단일사용자엔 미가동(결함 아님).";

let n = 0, skipped = [];
for (const a of collab) {
  const c = qById.get(a.id); const s = `${a.area} ${a.exp}`;
  if (LOCAL_GROUP.test(s) && !SHARING.test(s)) { skipped.push(a.id); continue; }
  execSync(`node scripts/urec.mjs UNAVAIL ${JSON.stringify(evidence)} ${a.id}`, { stdio: "ignore" });
  n++;
}
console.log("COLLAB UNAVAIL 기록:", n, "| 로컬그룹으로 보류(AX):", skipped.length, skipped.slice(0, 6).join(","));
