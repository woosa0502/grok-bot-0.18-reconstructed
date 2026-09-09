# 브라우저 봇 실행기 단독 검증 (호스트 없이)
`source/host/extensions/browse-runtime/{aside-bot-runner,browse-client,browse-subagent-session}.ts`를 복사해
상대 import를 `./stubs.ts`(에이전트 디렉터리 스텁)로 바꾼 뒤 tsc(ESM)로 변환하고, 가짜 러너 + 실제 서비스(9340)로
`wrapRunnerForAsideBot`을 직접 호출한다. 시나리오: A 링크 없음+숨은 턴 → Aside의 현재 채팅 이어받기·미러,
B 사용자 턴 → 이어 쓰기, C Aside 쪽 새 채팅(tRPC createAndPrompt) → 숨은 턴이 최신 채팅을 따라감, D 이어 쓰기.
```
cp 위 3개 .ts → botlab/ (import 경로 치환), echo '{"type":"module"}' > package.json
tsc --module nodenext --moduleResolution nodenext --target es2022 --rewriteRelativeImportExtensions --skipLibCheck --outDir out ... *.ts
BOTLAB_ROOT=$PWD ASIDE_UI_CHAT=../aside-ui-chat.py ASIDE_INSTALLATION_KEY=<키> node out/driver.js
```
