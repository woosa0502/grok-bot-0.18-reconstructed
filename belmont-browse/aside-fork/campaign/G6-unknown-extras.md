# G6-unknown-extras — 담당 구간 7개, 202,912 B

원자료: data/artifacts/aside_fork_map_825_20260906/analysis/patch-map.json (start_hex로 찾기). 상태: 미재현=안 만듦, 부분=덜 만듦, 미확인=못 알아냄, 재현(표면)=겉만.

| # | 구간(x86_64) | 크기 | 상태 | 하위 계통 | 이름표 |
|---|---|---|---|---|---|
| 1 | 0x048f2710–0x0491b8b0 | 147,040 | 재현(표면) | extension-api | 확장 API 구현 — browserImport / omnibox / browserPreferences |
| 2 | 0x04c65910–0x04c6a320 | 18,336 | 미확인 | unknown | (미확인) |
| 3 | 0x0d0013f0–0x0d004c60 | 12,784 | 부분 | webui | WebUI 인터페이스 바인더 목록 변경 |
| 4 | 0x045dd200–0x045e03a0 | 10,160 | 미확인 | unknown | (미확인) |
| 5 | 0x049ca150–0x049cc670 | 7,728 | 미확인 | unknown | (미확인) |
| 6 | 0x047c51f0–0x047c6600 | 3,856 | 미확인 | unknown | (미확인, 해시맵 인라인) |
| 7 | 0x0d145880–0x0d146b10 | 3,008 | 미확인 | unknown | (미확인) |

## 추가 후보 (옛 버전 짝 비교에서 나온 것, 본 표 밖)
- 북마크가 열린 탭을 대표하는 구조 (bookmark_tab_representation_node_id/host, ScheduleRefreshTabsRepresentedByBookmarks)
- chrome://settings 의 "Aside Account" 구역 (asideAccountBadgeLabel 등 문자열 8개)
- 비밀번호 관리자 툴바 버튼 자동 고정 pref (aside_password_manager_toolbar_pin_initialized)
- 확장 페이지 배경색 측정
- 툴바 접기 버튼 호버 타이머
- 프로필 지시 아이콘
