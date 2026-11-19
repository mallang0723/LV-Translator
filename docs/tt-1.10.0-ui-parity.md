# 원작 화면 동등성 표 — 번역 프리셋·단어장 1.10.0 → LV-Translator 0.5.0

원작: `tlsiddl/marinara-translation-tools` `0ff1338`(1.10.0). 원작 파일은 `src/vendor/tt-1.10.0/`에 **바이트 그대로** 들어 있고(`npm run verify:original`: 파일 9개, 바이트 동일 9, 패치 0), 호스트 차이는 전부 `src/host-emu/`(어댑터)에서 흡수한다. 원작 `extension.js`는 통째로 실행된다(화면·DOM·CSS·문구는 원작의 코드 그대로).

표기: **있음** = 원작 코드 그대로 실행됨 / **대역** = 호스트 쪽 입구를 얇게 만들어 같은 동작을 냄 / **없음** = 옮기지 못함(이유). 확인: ✅ Chromium에서 가짜 호스트로 직접 확인(`node scripts/qa-original.mjs`), ⚠️ 코드는 원작 그대로이나 이 환경에선 미확인.

## 없음 (멈추고 알림: 결정 필요)

| # | 원작 요소 | 이유 |
|---|---|---|
| N1 | NPC 자동 수집(1.9.0)의 **작동 시점** | 화면(스위치·횟수)은 있으나, 원작은 Marinara 생성 스트림(`POST /api/generate` 응답)이 끝날 때 `onGenerated`를 부른다. Lumiverse에는 그 스트림이 없어 호출되지 않는다. 수동 버튼(말투 자동 정리·단어장 생성·세계관 자동 정리)은 된다 |
| N2 | "후처리 후 번역" 스위치의 효과 | Marinara 후처리 단계(`postProcessingPending`)가 Lumiverse에 없다. 스위치는 보이나 효과 없음 |
| N3 | 대화 모드의 설정 버튼·메뉴(`.ptx-act-btn`) | Lumiverse에는 대화 모드가 없어(채팅 행의 `mode`는 항상 roleplay) 나타나지 않는다 |
| N4 | 게임 모드 번역(원작 `MARINARA_GAME_TRANSLATION`) | Lumiverse에 게임 모드 없음 |
| N5 | 생성 스트림 기반 자동 번역(여러 메시지·재생성·이어쓰기 중 번역 표시 보호) | 위 대역(A1)이 대신한다: 최신 답변 1건만, 30분 이내, 번역이 하나도 없을 때 |
| N6 | 유저 입력(내 메시지) 번역에 **원작 설정 반영** | 원작의 `routedFetch`는 Marinara `/api/translate`를 가로챈다. LV의 내 메시지 번역·입력창 번역 버튼은 0.4.0 엔진과 LV 패널 설정(프리셋·단어장·지침)을 쓴다. 원작 화면의 "유저 입력 번역 프롬프트"를 골라도 내 메시지 번역에는 적용되지 않는다 |
| N7 | 기억 서재 연동(단어장→기억 번역, 응답 번역→낱말 회상) | 0.4.0의 lv-tx 계약(`pub`·`glossary`)은 0.4.0 번역 기록에서 만들었다. 이제 기록이 원작 형식이라 계약 핸드셰이크의 `provides`를 비웠다. 새 기록에서 `pub`을 만드는 일은 하지 않았다(기억 서재 쪽과 협의 필요) |
| N8 | 0.4.0 때 저장한 번역의 표시 | 옛 기록(`st_translator.entries`)은 지우지 않았지만 새 화면이 읽지 않는다. 변환은 하지 않았다(원작 블록 키는 렌더된 DOM에서 정해져 서버에서 흉내 낼 수 없다) |
| N9 | 0.4.0에서 **응답 번역**에 쓰던 LV 기능: 서버 워커 자동 번역, 번역 지침 묶음 적용, HTML·상태창 보호 규칙, 끊긴 번역 이어서 하기, 번역 단위 | 원작이 자체 번역 엔진(DOM 문단·`<segment>` 요청)을 쓰므로 한 메시지에 두 엔진을 얹을 수 없다. 서버 엔진은 `LEGACY_ENGINE=false`로 꺼 두었다(코드는 남아 내 메시지 번역이 쓴다). 묶음·제외 규칙은 LV 패널에 남아 있으나 **내 메시지 번역**에만 적용된다. `f87da3c` 병합 규칙은 서버 엔진용이라 현재 쓰이지 않는다 |

## 대역 (얇은 입구)

| # | 원작 요소 | 대역 |
|---|---|---|
| A1 | 응답 자동 번역 트리거 | Lumiverse `GENERATION_ENDED` → 1.5초 뒤 페이지 `visibilitychange`를 보내 원작의 `catchUpLatest`를 부른다(채팅 열기·화면 복귀·시작 3초 뒤는 원작 그대로). 생성 중이면 `generateActive`(백엔드 `generationActive`)가 막는다 |
| A2 | Marinara 번역 버튼(`svg.lucide-languages`) | Lumiverse 메시지 행동 줄에 같은 svg의 버튼을 추가(`src/host-emu/dom-bridge.ts`). 눌렀을 때 동작(번역→원문 보기→번역 보기, 제목 "문단 번역/원문 보기/번역 보기")은 원작 코드 ✅ |
| A3 | `.mari-message-content`, `.mari-message-actions`, `[data-chat-settings-section="translation"] > .mari-drawer__body` | Lumiverse `[data-component="MessageContent"]`·행동 줄·확장 탭 안의 같은 구조에 클래스 부여 ✅ |
| A4 | Marinara 테마 변수·Tailwind 유틸리티 클래스 | `src/host-emu/shim-css.ts`가 변수를 Lumiverse 변수로 잇고, 원작 마크업이 쓰는 클래스(약 90개)를 정의. 원작 마크업·문구는 불변. ⚠️ 폰 폭·Lumiverse 테마에서의 모양은 7880에서 확인 필요 |
| A5 | `/api` 12개 경로(채팅·메시지·extra·generate/raw·generate/status·연결·캐릭터·페르소나·로어북·항목) | `src/host-emu/api.ts`(`fetch` 대역) → `src/frontend.ts` RPC → `src/backend.ts` `emu` → `src/host-emu/backend-ops.ts`. 시험 `tests/emu*.test.ts` |
| A6 | 번역 공급자·연결·대상 언어·자동 번역 켜기(Marinara 채팅 설정 화면 소관) | LV 패널 "기본 번역"의 값에서 채팅 메타데이터(`translationProvider/ConnectionId/TargetLang`, `autoTranslate`)를 만들어 준다 |
| A7 | 메시지별 `extra.paraTranslate` | 스와이프별로 메시지 메타데이터 `st_translator_tt`에 저장(`metadata_patch`, 없는 호스트는 전체 덮어쓰기). 읽을 때 보이는 스와이프의 기록을 `extra.paraTranslate`로 합성 |
| A8 | 영어 원문 재작성 저장(`PATCH /messages/:id {content}`) | `updateMessage({content})` ⚠️ 활성 스와이프가 바뀌는지는 실호스트 확인 필요 |
| A9 | 확장 저장소(`marinara.storage`, `/api/personal-extensions`) | 사용자 저장소 파일 `tt-config.json` |
| A10 | 활성 채팅 id(localStorage `marinara-active-chat-id`) | 주소(`/chat/<id>`)를 0.7초마다 읽어 그 키에 대한 읽기만 대역 |
| A11 | React Query 캐시 읽기·갱신 | 없는 것으로 처리(원작이 없을 때의 경로로 직접 조회). 스와이프·수정은 DOM 변화로 감지 |
| A12 | 대화 전체 조회 | 원작의 "번역 안 된 메시지 모두 번역"·스캔·문맥은 끝에서 N개(최대 1000)만 읽는다. 1000개보다 앞의 메시지는 "모두 번역"이 건드리지 않는다 |
| A13 | 캐릭터 카드·페르소나·로어북 읽기 | 새 권한 `characters`·`personas`·`world_books`(재승인 필요). 로어북 연결은 캐릭터의 `world_book_ids`·페르소나의 연결 책을 `activeLorebookIds`로 합성(원작의 chat/persona 범위 규칙은 근사) |

## 있음 (원작 코드 그대로)

| 화면 요소 | 확인 |
|---|---|
| 설정 화면 전체(`createForm`): 번역 프롬프트 두 칸(프리셋 목록·한글로만 줄 포함) | ✅ 표시 |
| 지침 섹션: 대사 지침 스위치·인물 행·"+ 인물 추가"·"말투 자동 정리" | ✅ 표시 |
| 기타 지침 칸·"로어북 항목 선택"·"세계관 자동 정리"·저장한 기타 지침(불러오기·저장·삭제) | ⚠️ |
| 단어장 섹션("+ 단어 추가"·"단어장 생성"·좌우 양방향 안내) | ✅ 표시 |
| 문맥 섹션(이전 대화 참고, 후처리 후 번역 스위치) | ✅ 표시(효과는 N2) |
| NPC 자동 수집 스위치·횟수 | ✅ 표시(작동 시점은 N1) |
| 문단 번역 섹션: 표시 방식, 번역에서 제외할 태그, 프리필, 개별 문단 재번역 연결, "번역 안 된 메시지 모두 번역" | ✅ 표시 |
| 백업: 이 채팅 설정·전체 설정 내보내기, 가져오기 | ✅ 표시 |
| 공용 프리셋 관리: 새 프리셋·삭제·프리셋 업데이트, 저장 버튼 | ✅ 표시 |
| 번역문 표시(`.ptx-view`), 문단을 누르면 원문, 번역 중 알약 | ✅ 표시 / ⚠️ 누르기 |
| 하단 바: 대조·다시 번역·지우기 | ✅ 대조 / ⚠️ 나머지 |
| 대조·수정 창: 원문·번역 나란히, 문단별 고치기, **이 문단 다시 번역**, **전체 다시 번역**, 영어 원문도 같이 고치기(체크), 취소, 저장 | ✅ |
| 말투·단어·세계관 자동 정리 + 검토 창(`reviewScan`·`reviewWorld`·`pickLore`) | ⚠️ 원작 시험 통과(auto-collect 19·speaker-names 14) |
| 이름표·상태창 영어 이름 번역(1.10.0), 짝 대사·단어장 이름 치환 | ⚠️ 원작 코드 |
| 놓친 최신 답변 보충 | ⚠️ A1 경유 |
| 토스트·확인 상자·진행 상자·단축키(Esc) | ⚠️ |

## 원작 시험
원작의 `tests/`(5개)는 vendor에 그대로 있고 `node scripts/test-original.mjs`로 원작 `extension.js`에 대해 돌린다: auto-collect 19, auto-translate 5, notes 16, speaker-names 14, test 28 — 전부 통과(Playwright 필요).

## 7880에서 눈으로 볼 것
1. 확장 탭 맨 아래에 원작 설정 화면이 나오고 저장이 되는지(새로고침 뒤 유지), 폰 폭에서 모양
2. 메시지 행동 줄에 번역 버튼이 생기고, 눌러 번역→원문 보기→번역 보기가 도는지(말풍선 레이아웃·미니멀 레이아웃 둘 다)
3. 번역문이 메시지 아래/대신 원작 모양으로 보이고, 스와이프·수정·가상 스크롤(메시지 다시 그려짐) 뒤에도 유지되는지
4. 하단 바 → 대조 창 → "이 문단 다시 번역"·"전체 다시 번역"·저장, 영어 원문 같이 고치기가 메시지를 고치는지
5. 말투 자동 정리·세계관 자동 정리·로어북 선택이 캐릭터·페르소나·로어북을 읽는지(권한 재승인 뒤)
6. 응답 자동 번역(채팅 설정 "AI 응답 자동 번역" 켠 뒤 생성 끝 → 번역이 붙는지), 생성 중에는 번역이 시작되지 않는지
7. 내 메시지 번역·입력창 번역 버튼이 이전처럼 되는지
