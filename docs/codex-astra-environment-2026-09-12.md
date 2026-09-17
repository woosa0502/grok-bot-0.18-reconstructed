# Codex GPT-6 Astra 환경 정리 — 2026-09-12

상태: 설정·지침 적용 및 로딩 검증 완료. 실행 속도·답변 품질의 향상은 비교 측정하지 않았다.

## 적용 기준

사용자가 지정한 [OpenAI 원문](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)을 직접 읽었다. 상시 지침은 짧게, 스킬 발동은 구체적으로, 상세 운영 지식은 필요한 작업에서만 읽도록 정리했다. 모델 설정은 [Astra 가이드](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)와 설치된 CLI의 모델 카탈로그를 대조했다.

## 변경

- WSL `/home/hoon/.codex/config.toml`: 기존 `gpt-6-astra / xhigh` 유지. 중복·무효 설정과 기본값 반복을 제거했다. 변경 전후 실제 기능 플래그 출력은 동일하다. 권한·sandbox·MCP·프로젝트 신뢰 설정은 유지했다.
- Windows `C:\Users\HOON\.codex\config.toml`: 기본 모델을 Astra로 변경하고 기존 `high` 유지. Codex 내부의 재귀 `codex-as-mcp`, Claude→Codex 연결 플러그인, Ralph 종료 루프, 중복 Claude skill-creator를 비활성화했다. 다른 앱·MCP와 컴퓨터 사용 알림은 유지했다.
- 전역·홈·Belmont의 AGENTS.md 5개: 총 39,346 → 8,690바이트. 모든 작업에 강제하던 전체 상태 조사, 형식적 캠페인, 검증 패널, 파일 수 기반 계획, 자동 Telegram 전송, 자기개선 규칙 누적을 제거했다. 자율 진행, 실제 서비스·데이터 보호, 중요한 주장에 대한 독립 검증은 유지했다.
- Belmont는 프로젝트 경로, Node 버전, 변경 종류별 검증, 런타임 계보 및 실제 모바일 결과의 구분을 명시했다. 설정/문서 변경에는 앱 전체 빌드를 요구하지 않는다.
- 개인 스킬 78개: 진입 파일 합계 757,291 → 286,327바이트. 검색/문제/이미지 수 할당량, 디자인 강제 승인·워터마크, 일반 요청을 OMX로 보내는 조건, 고정 모델 등급을 정리했다. 운영에 필요한 상세 자료는 11개 보조 파일로 분리했다. 이 숫자는 파일 바이트이며 토큰 절감이나 성능 향상 수치가 아니다.
- Windows의 자동 `npx @thestackai/zclean` Stop 훅을 제거했다. WSL의 Orca 연동과 프로젝트가 `.forge/STRICT`로 선택하는 게이트는 유지했다. 사용되지 않는 독립 `audit.config.toml`은 백업 후 제거했다.

## 검증

- WSL CLI 0.153.4: `codex doctor --json`, `codex app-server --strict-config --listen stdio://` (빈 stdin으로 즉시 종료), `codex debug prompt-input`, `codex features list` 통과.
- Windows CLI 0.147.0: 새 `debug prompt-input` 실행에서 새 전역/홈 지침 로딩과 기존 강제 계획·자동 Telegram 규칙 제거를 확인했다. GUI 앱의 열린 대화가 새 지침을 채택했는지는 검사하지 않았다.
- 변경 스킬 78개는 공식 skill-creator의 `quick_validate.py` 통과. 새 참조 링크 누락 0. TOML 및 `git diff --check` 통과. 최신 온라인 config schema에는 설치 CLI가 지원하는 `artifact` 플래그가 빠져 있어 해당 필드만 로컬 지원 근거로 보완했으며, 실제 CLI strict 검사도 통과했다.
- 별도 읽기 전용 검토자가 백업 해시, 변경량, 기능/권한 유지, 참조 경로, 오타 수정·라우팅 변경·요청된 알림·트레이딩 승격 시나리오를 독립 검토했다. 지적한 OMX 잔여 지침과 Belmont 명령 실행 위치를 수정 후 재확인했다. 시나리오 검토는 지침 해석이며 실제 업무 성능 실험은 아니다.

## 적용 범위와 남은 사실

새 Codex 대화/프로세스부터 변경된 지침을 사용한다. 이 작업은 사용자 서비스를 재시작하지 않았고, 앱 코드·인증·프로필·DB·메모리를 수정하지 않았다. 작업 중 다른 기여자의 `belmont-browse/src/` 변경과 Aside 데몬 PID 변동이 관측되어 보존했다; 서비스 연속 실행을 검증했다는 뜻은 아니다.

기존 `codex doctor`의 rollout/DB 인벤토리 불일치 경고는 전후 동일하게 남아 있다. 과거 Content_ops 게시/영상 레시피의 누락 경로도 기존 문제이며, NotebookLM 진입점에는 의존 경로 부재를 표시했다. 해당 워크플로의 복구·게시·알림 전송은 실행하지 않았다. 관리형 플러그인 캐시는 직접 수정하지 않았으므로 업데이트 시 개인 스킬과의 중복은 다시 생길 수 있다.

## 백업과 재현

백업: `/home/hoon/.codex/backups/astra-optimization-20260912T144050Z`

- `manifest-before.json`: 원본 경로·SHA-256·백업 위치.
- `changed-files.json`: 실제 변경/생성/삭제 파일과 적용 후 해시.
- `skill-changes.json`, `skill-validation.json`: 변경 스킬 및 검사 원문.
- `prompt-before.stdout`, `prompt-after.stdout`, `windows-prompt-final.stdout`: 새 프로세스의 지침 로딩 증거.
- `features-before.stdout`, `features-after.stdout`, `doctor-after.stdout`, `wsl-strict.stderr`: 설정 검사 증거.

```bash
cd /home/hoon/_roots/labs/work/Belmont
codex features list
codex debug prompt-input "Fix a typo in a comment in Belmont."
python3 /home/hoon/.codex/backups/astra-optimization-20260912T144050Z/restore.py
```

`restore.py`는 기본적으로 복원 예정 목록만 출력한다. 실제 복원은 `--apply`; `--path-prefix`로 WSL/Windows 또는 특정 파일 범위를 제한할 수 있다. 이후 변경된 파일이나 손상된 백업이 있으면 덮어쓰기를 거부한다. 복원은 서비스를 재시작하지 않으며 이 보고서와 백업은 남긴다.
