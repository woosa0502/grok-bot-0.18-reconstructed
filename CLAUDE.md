# CLAUDE.md — 리니어(Linear) / 브라우저(Browser)

이 저장소에서 작업하는 Claude가 지켜야 할 이름·기본 규칙.

## 명칭 (우리 이름 — 2026-09-15 확정)

두 부분을 **우리 이름**으로 부른다 (대화·문서·사용자 화면 라벨):

| 우리 이름 | 내부 코드명 | 뜻 |
|---|---|---|
| **리니어 (Linear)** | grok-bot (`grok-bot-0.18-reconstructed`, 이 repo) | 메인 런타임 — **Belmont와 팀 8봇**, 게이트웨이, 메모리, 호스트, 모바일 PWA. Belmont는 리니어 에이전트. |
| **브라우저 (Browser)** | Aside (`belmont-browse/` + 복원한 Aside 데몬) | 리니어에 붙인 브라우저 자동화 층. 봇을 Aside 브라우즈 세션에 **링크**해 웹·데스크탑 작업을 시킨다. |

- **Belmont와 팀은 "리니어"에 산다.** 브라우저 일이 필요하면 "브라우저(Aside)"에 링크한다.
- "데스크탑 컨트롤 / Computer Use" = **브라우저(Aside)** 쪽 얘기. 브라우저의 데스크탑 제어는 macOS 전용 → 실제 윈도우 제어는 우리가 브리지로 만들 자리.
- **코드/디렉토리 내부 이름(grok-bot, aside, belmont-browse, `source/`, `vendor/aside-*`)은 그대로 둔다.** 대규모 리네임 금지(위험·무의미). 우리 이름은 대화·문서·UI 라벨에서만.
- 상세: `belmont-work/NAMING.md`.

## 그 외

- 개발·검증·런타임 규칙은 `AGENTS.md`를 따른다(프로세스/포트/소유권 확인, 빌드 계보, PWA 별도 git 경계 등).
- 팀 세팅·역할·모델 정책·토큰 계측은 `belmont-work/`(roles/, control/, ops/, NAMING.md).
