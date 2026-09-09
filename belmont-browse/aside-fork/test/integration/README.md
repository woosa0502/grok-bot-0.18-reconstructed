# 통합 테스트 — 포크 + 원본 Aside 확장 + 실제 데몬 (2026-09-04 통과, 2026-09-05 적대적 검증 후 재통과)

## 방법
belmont-browse serve.mjs를 포크 chrome + 원본(비시밍) 확장으로 띄운다:
```
BELMONT_BROWSE_CHROME=/home/hoon/chromium/src/out/aside/chrome \
BELMONT_BROWSE_EXTENSION=<repo>/vendor/aside-ext/AsideAgentManager \
BELMONT_BROWSE_NO_SANDBOX=1 \
ASIDE_INSTALLATION_KEY=<PKCS#8 DER 키> \
BELMONT_BROWSE_DISPLAY=:99 BELMONT_BROWSE_ENGINE=902 \
node src/serve.mjs
```
- `BELMONT_BROWSE_NO_SANDBOX=1`: WSL 포크는 --no-sandbox 필요. (cdp-relay.mjs·chrome.mjs에 env 게이트 추가함)
- 키: `make-installation-key.mjs .state/installation-keys.json <out>` 로 만든 PKCS#8 DER.

## 결과 (통과)
- 데몬 21420 listening, 엔진 902 ready, 포크 chrome 실행 ✓
- **데몬 ↔ 확장 지속 연결 12개** (`ss -tn | grep 21420`, 루프백 양끝 카운트 = 서버측 6개; 인증 실패면 데몬이 끊음 → 지속 = 인증 성공)
- 데몬 `accounts.ensureProfileAccount` BAD_REQUEST 0회 (getProfileContext가 미바인딩 필드를 생략해야 통과 — patch 026)
- 원본 확장 SW 컨텍스트에서 `signDaemonAuthChallenge` → 실제 서명 반환(에러 없음), `getProfiles` → 실제 프로필
- 결론: 포크 + 원본 확장 + 데몬이 함께 돌아감. 데몬 인증 네이티브로 작동.

## 도구
- cdp-sw-console.mjs: SW 콘솔 캡처 (포트, 초, ID필터)
- relay-eval.mjs: 토큰 게이트 relay 통해 확장 컨텍스트 평가 (relay wsUrl은 serve.json cdpWsUrl)

## run-contract.sh
적대적 검증(patch 026)으로 교정된 원본 계약을 fresh profile에서 단언한다. 기대: passCount 41, failCount 0.

## 세션 3 테스트 (보안 CDP·에이전트 탭·계정 등록부)
```
SP=<scratch>; ASIDE_INSTALLATION_KEY=$SP/AsideInstallationKey
# 브라우저를 --remote-debugging-port 없이 띄우면 localhost:45103 보안 서버가 켜진다.
python3 test/secure-cdp-test.py          # 12개 검사(데몬과 같은 핸드셰이크 순서)
python3 test/agent-attach.py 40          # 에이전트 탭에 CDP 세션 부착 + setAiTabsMetadata
BOOKMARKS_FIXTURE=test/fixtures/Bookmarks ASIDE_HOME=<데몬의 aside-home> \
EXTRA_CHROME_ARGS=--aside-debug-update-prompt bash test/run-secure-ui.sh <tag> [actions.sh]
```
- `test/agent-tabs-test-ext/`: "Agent Tabs" 그룹을 만드는 테스트 확장.
- `test/fixtures/aside-home/accounts.json`: 계정 등록부 픽스처(userId 포함 → 프로필 바인딩 POST 유발).
