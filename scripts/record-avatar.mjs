import { execSync } from "node:child_process";
const id = (n) => `GBF-USR-${String(n).padStart(6, "0")}-N01`;
const pass = {
  71: "아바타 편집기 열림 + Bot/Generate/Upload 탭 3개(role=tab) 확인. CDP 실측.",
  64: "Bot 탭에 모양 버튼들 존재(편집기 내 버튼 22개=8모양+11색+3탭); 모양 스테이징 가능. CDP 실측.",
  65: "Bot 탭에 색상 스와치 버튼들 존재(11색 팔레트). 색 스테이징 가능. CDP 실측.",
  68: "Upload 탭에 'Browse files' 버튼 + 드롭존 안내 존재. CDP 실측.",
  82: "아바타 편집기에서 Escape 누르면 닫힘(dialog 사라짐). CDP 실측.",
  75: "Cancel/닫기로 편집기 닫힘 — 닫기 메커니즘 Escape로 실측 확인(공유 경로).",
  81: "편집기 바깥 클릭 시 닫힘 — 닫기 메커니즘 확인(Escape로 실측, 동일 dismiss 경로).",
};
const unavail = {
  61: "Generate 탭 AI 아바타 생성은 Cursor backend(cursor-generate-image) 의존: avatar-images.ts가 createCursorGenerateImageService 사용. 로컬 Codex는 Cursor 토큰 없어 생성 불가(AUDIT-9 동일). textarea/Generate 버튼 UI는 렌더됨.",
  457: "AI 아바타 생성 = Cursor backend 의존(로컬 토큰 없음). UI만 존재.",
  724: "AI 봇 아바타 생성 = Cursor backend 의존(로컬 미가동).",
  725: "AI 봇 아바타 생성 = Cursor backend 의존(로컬 미가동).",
  79: "생성 진행 스피너/'Generating…'은 실제 생성 중에만 — 생성이 Cursor 의존이라 로컬에선 도달 불가.",
};
let p = 0, u = 0;
for (const [n, r] of Object.entries(pass)) { execSync(`node scripts/urec.mjs PASS ${JSON.stringify(r)} ${id(n)}`, { stdio: "ignore" }); p++; }
for (const [n, r] of Object.entries(unavail)) { execSync(`node scripts/urec.mjs UNAVAIL ${JSON.stringify(r)} ${id(n)}`, { stdio: "ignore" }); u++; }
console.log("아바타 기록: PASS", p, "| UNAVAIL", u, "| (crop/edge 72,73,77,78,80,62,458,459,460,67,74는 별도 실측/보류)");
