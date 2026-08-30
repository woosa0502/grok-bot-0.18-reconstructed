import { appendFileSync } from "node:fs";
import { execSync } from "node:child_process";

const rec = {
  id: "DEFECT-3",
  pri: "P0",
  verdict: "FIXED",
  title: "이미지/파일 첨부 전송 시 앱 전체 크래시 (attachment kinds shape 불일치)",
  evidence:
    "session-projection.ts buildAttachmentLastEntry가 kinds를 countKinds()의 객체 {image:1}로 넣음. 렌더러 Yun/mergeKindCounts는 배열 [{kind,count}] 기대. 객체엔 .length=undefined라 빈-가드 통과 후 n.filter 폭발 -> 'TypeError: n.filter is not a function' -> 루트 에러경계 -> 앱 전체 크래시(reload로만, 심하면 agent 삭제로만 복구). 게이트웨이 주입/직접 CDP 앱제어 둘 다 동일 재현.",
  fix:
    "kinds: Object.entries(countKinds(kinds)).map(([kind,count])=>({kind,count})) — 렌더러가 기대하는 AttachmentKindCount[] 배열로 변환. wsl:setup 재빌드 완료(esbuild가 소스 반영), lineage 재스탬프.",
  liveVerify:
    "CDP 앱 직접제어로 valid PNG 첨부+전송: err AFTER SEND=false(크래시 없음), 채팅에 썸네일 렌더, 봇이 이미지 보고 답장(vision 전달 확인), 사이드바 미리보기 정상.",
};
appendFileSync("/tmp/audit-findings.jsonl", JSON.stringify(rec) + "\n");
console.log("finding recorded:", rec.id);

// 라이브 실측한 케이스만 PASS
const verified = {
  "GBF-USR-000904-N01": "사이드바에서 non-text(첨부) 마지막 엔트리 렌더 — 바로 이 크래시 케이스. 수정 후 'I see the blue image...' 미리보기 정상 렌더(크래시 없음).",
  "GBF-USR-000244-N01": "composer file-input으로 파일 첨부 시 파란 썸네일로 스테이징됨(라이브 확인).",
};
for (const [id, reason] of Object.entries(verified)) {
  execSync(`node scripts/urec.mjs PASS ${JSON.stringify(reason)} ${id}`, { stdio: "inherit" });
}
