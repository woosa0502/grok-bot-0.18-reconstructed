# 진짜 Grok Bot 업데이트 확인 — 우리 버전 이후 (2026-09-11)

우리 재구성 기준선 **0.18.0** 이후, 실제 Grok Bot 데스크톱 앱이 어디까지 올라갔는지
**진짜 배포 서버에 직접 조회**해 확인했다.

---

## 결론 (한 줄)

**현재 최신은 0.47.0.** 우리(0.18) 대비 29개 마이너 버전 뒤. 우리 직전 조사(0.30, 8/30) 이후로도
**0.31~0.47이 더 나왔다.** 단, per-version 세부 변경내역은 xAI가 공개 안 함(설치파일 diff로만 알 수 있음).

---

## 어떻게 확인했나 (실측)

앱 소스의 업데이트 체크 로직을 그대로 사용:
- 체크 엔드포인트: `https://api2.cursor.sh/updates/api/update/<platform>/sand/<현재버전>/<machineId>/stable`
- (source: `source/electron-main/update/update-feed.ts`, `sand-update-service.ts`)

**서버 실제 응답** (0.30 기준으로 조회):
```json
darwin-arm64 → {"url":".../grokbot/stable/darwin-arm64/0.47.0/Grok_Bot_0.47.0.zip","name":"0.47.0"}
win32-x64    → {"version":"0.47.0","url":".../win32-x64/0.47.0/Grok_Bot_0.47.0_Setup.exe","timestamp":1789092174681}
```
- **0.47.0 기준으로 다시 조회 → HTTP 204** = "이미 최신". 0.48+ 아티팩트 없음(403).
- **최신 = 0.47.0 확정.** Windows 타임스탬프 1789092174681 ≈ 2026-09-10.

---

## 버전 계보 (0.30 → 0.47, 아티팩트 존재 실측)

각 버전 다운로드 URL에 HEAD 요청한 결과:

| 버전 | 상태 |
|---|---|
| 0.30 ~ 0.44 | ✅ 전부 존재 (HTTP 200) |
| 0.45 | ⚠️ HTTP 403 (접근 제한 — 0.21 때와 같은 케이스) |
| 0.46, **0.47** | ✅ 존재 (0.47 = 최신) |
| 0.48+ | ❌ 없음 (403) |

→ **0.30 이후에도 최소 16개 버전이 더 배포됐다.**

---

## 배포 경로가 바뀌었다 (중요)

우리 원장(0.18→0.30)이 쓰던 경로 → 현재 경로:

| 시점 | 다운로드 경로 |
|---|---|
| 0.30 무렵 (기존 원장) | `downloads.cursor.com/**sand**/stable/darwin-arm64/<v>/Grok_Bot_<v>.dmg` |
| **현재 (0.47)** | `downloads.cursor.com/**grokbot**/stable/darwin-arm64/<v>/Grok_Bot_<v>.zip` |

- 경로 세그먼트 `sand` → `grokbot`으로 리브랜딩.
- macOS 확장자도 `.dmg` → `.zip`(Squirrel.Mac 자동업데이트용)으로 관찰됨.
- 업데이트 체크 API(`api2.cursor.sh/updates`, appName=`sand`)는 그대로.

---

## 세부 변경내역은 왜 못 주나 (정직하게)

- **xAI는 데스크톱 앱의 per-version 공식 changelog를 공개하지 않는다.** (커뮤니티·포럼 확인:
  "공식 changelog 없음, 업데이트는 X의 @bot에서 안내"가 공식 입장)
- releasebot.io 등에 있는 건 **Grok Build(터미널 CLI, 1.0.x)** 릴리스노트지 데스크톱 앱이 아니다.
- 따라서 0.31~0.47 각각의 의미 변경은 **우리가 했던 방식 — 설치파일(app.asar) 추출·diff — 로만**
  확정 가능. (기존 `docs/testing/grok-bot-018-to-030-change-ledger-2026-08-30.md`가 그 방법)

---

## 우리 원장에서 이미 아는 0.18 → 0.30 흐름 (참고)

```
0.18 baseline
  → 0.19 i18n 기반
  → 0.22 runtime/coordination 계약 변화
  → 0.24 Bot 공유·harness
  → 0.25 process topology 대전환
  → 0.26 package/dependency rebase
  → 0.29 cookie approval
  → 0.30 virtual card·voice-call harness·messages-mac
```
0.31~0.47 구간은 **미조사**. 알려면 그 버전들 설치파일을 받아 diff 떠야 함.

---

## 다음 수 (원하면)

1. **0.47 설치파일을 받아 0.30(또는 0.18)과 diff** → 0.31~0.47 실제 변경 원장 작성
   (기존 조사 방법론 그대로, 하지만 시간·용량 듦)
2. **특정 버전만** 콕 집어 확인 (예: 0.47만 받아 주요 marker 확인)
3. 여기까지 (최신=0.47, 계보 확인)로 마무리

---

## 부록: 출처

- 업데이트 체크 URL·경로: 우리 앱 소스 (`source/electron-main/update/`) + **실제 api2.cursor.sh 응답**
- 버전 존재: `downloads.cursor.com/grokbot/...` HEAD 요청 실측
- "공식 changelog 없음": Cursor 커뮤니티 포럼 / releasebot.io (Grok Build ≠ 데스크톱 앱)
