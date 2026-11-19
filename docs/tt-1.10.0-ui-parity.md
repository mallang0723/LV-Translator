# 원작 화면 동등성 표 — 번역 프리셋·단어장 1.10.0 → LV-Translator 0.5.1

원작: `tlsiddl/marinara-translation-tools` `0ff1338`(1.10.0). 원작 파일은 `src/vendor/tt-1.10.0/`에 **바이트 그대로** 들어 있고(`npm run verify:original`: 파일 9개, 바이트 동일 9, 패치 0), 호스트 차이는 전부 `src/host-emu/`(어댑터)에서 흡수한다. 원작 `extension.js`는 통째로 실행된다(화면·DOM·CSS·문구는 원작의 코드 그대로).

표기: **있음** = 원작 코드 그대로 실행됨 / **대역** = 호스트 쪽 입구를 얇게 만들어 같은 동작을 냄 / **없음** = 옮기지 못함(이유). 확인: ✅ Chromium에서 가짜 호스트로 직접 확인(`node scripts/qa-original.mjs`), ⚠️ 코드는 원작 그대로이나 이 환경에선 미확인.

## 없음 (멈추고 알림: 결정 필요)

| # | 원작 요소 | 이유 |
|---|---|---|
| N2 | "후처리 후 번역" 스위치의 효과 | Marinara 후처리 단계(`postProcessingPending`)가 Lumiverse에 없다. 스위치는 보이나 효과 없음 |
| N3 | 대화 모드의 설정 버튼·메뉴(`.ptx-act-btn`) | Lumiverse에는 대화 모드가 없어(채팅 행의 `mode`는 항상 roleplay) 나타나지 않는다 |
| N4 | 게임 모드 번역(원작 `MARINARA_GAME_TRANSLATION`) | Lumiverse에 게임 모드 없음 |
| N9a | **브라우저가 닫혀 있어도 응답이 번역되는 서버 워커 보조**(0.5.1 할 일 2) | 미구현. 원작 `extension.js`는 브라우저 스크립트라서 서버(Bun)에서 돌리려면 진짜 DOM이 필요하다(문단 단위 `collectUnits`가 `querySelectorAll`·`splitText`·`replaceWith` 등을 쓴다). 서버 번역이 원작과 같은 키·같은 결과를 내려면 `linkedom`/`happy-dom` 같은 DOM 구현을 개발 의존성으로 넣어 `dist/backend.js`에 묶어야 하는데, 의존성 설치가 이 환경에서 차단돼 시도하지 못했다. 자체 DOM을 새로 짜는 것은 "원작 코드 그대로"에 어긋나 하지 않았다. 지금은 브라우저가 열려 있을 때만(원작의 `catchUpLatest`가 화면 복귀·채팅 열기 때 놓친 최신 답변을 보충) 번역된다 |
| N9b | 0.4.0의 **번역 지침 묶음·제외 규칙(HTML·상태창 보호)을 응답 번역에 적용** | 응답 번역은 원작 엔진이 하므로 얹을 곳이 없다(한 메시지에 두 엔진 불가). 묶음·제외 규칙·HTML/코드 보호는 LV 패널에 남아 **내 메시지 번역에만** 적용된다. 응답 번역의 단어장·기타 지침·말투는 원작 화면(설정)에서 한다. 끊긴 번역 이어서 하기·번역 단위(whole/paragraph)는 원작의 문단 번역·"전체 다시 번역"으로 대체 |

## 대역 (얇은 입구)

| # | 원작 요소 | 대역 |
|---|---|---|
| A1 | 생성 스트림(`POST /api/generate` SSE)을 보는 원작 코드: 응답 자동 번역(`translateGenerated`), 생성 중 표시 보호, 사용자 Stop·impersonate 건너뛰기, 생성 뒤 NPC 자동 수집(`onGenerated`) — **N1·N5** | `src/host-emu/generation.ts`가 Lumiverse `GENERATION_STARTED/ENDED/STOPPED`를 그 요청으로 다시 재생한다. 시작 때 원작의 설치된 `fetch`로 `/api/generate`를 열고(재생성·이어쓰기는 `regenerateMessageId`·`continueMessageId`, impersonate는 `impersonate:true`), 끝나면 `message_saved`+`done`, 오류면 `error`, Stop이면 `/api/generate/abort`를 먼저 보내고 스트림을 끊는다. 번역·보호·Stop 판단·횟수 세기는 전부 원작 코드가 한다(`autoTranslate` 켜진 채팅만, 횟수는 페이지를 연 뒤부터). 열린 페이지가 여럿이면 `lease`로 한 페이지만 재생한다. 화면 복귀·채팅 열기·시작 3초 뒤 보충(`catchUpLatest`)은 원작 그대로 ✅(브라우저 QA: 번역 기록·NPC 수집 스캔 2회·Stop 뒤 무동작·lease) |
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
| NPC 자동 수집 스위치·횟수 | ✅ 표시 + 생성 뒤 자동 실행(A1) ✅ |
| 문단 번역 섹션: 표시 방식, 번역에서 제외할 태그, 프리필, 개별 문단 재번역 연결, "번역 안 된 메시지 모두 번역" | ✅ 표시 |
| 백업: 이 채팅 설정·전체 설정 내보내기, 가져오기 | ✅ 표시 |
| 공용 프리셋 관리: 새 프리셋·삭제·프리셋 업데이트, 저장 버튼 | ✅ 표시 |
| 번역문 표시(`.ptx-view`), 문단을 누르면 원문, 번역 중 알약 | ✅ 표시 / ⚠️ 누르기 |
| 하단 바: 대조·다시 번역·지우기 | ✅ 대조 / ⚠️ 나머지 |
| 대조·수정 창: 원문·번역 나란히, 문단별 고치기, **이 문단 다시 번역**, **전체 다시 번역**, 영어 원문도 같이 고치기(체크), 취소, 저장 | ✅ |
| 말투·단어·세계관 자동 정리 + 검토 창(`reviewScan`·`reviewWorld`·`pickLore`) | ⚠️ 원작 시험 통과(auto-collect 19·speaker-names 14) |
| 이름표·상태창 영어 이름 번역(1.10.0), 짝 대사·단어장 이름 치환 | ⚠️ 원작 코드 |
| 놓친 최신 답변 보충(채팅 열기·화면 복귀·시작 3초 뒤) | ⚠️ 원작 코드 그대로(생성 직후에는 A1이 번역하므로 보충은 놓친 경우만) |
| 토스트·확인 상자·진행 상자·단축키(Esc) | ⚠️ |

## 원작 시험
원작의 `tests/`(5개)는 vendor에 그대로 있고 `node scripts/test-original.mjs`로 원작 `extension.js`에 대해 돌린다(Playwright 필요, 필요하면 `PLAYWRIGHT_DIR`·`PLAYWRIGHT_BROWSERS_PATH`): auto-collect 19, auto-translate 5, notes 16, speaker-names 14, test 28 — 전부 통과(0.5.1에서도 같음).

## 7880에서 눈으로 볼 것
1. 확장 탭 맨 아래에 원작 설정 화면이 나오고 저장이 되는지(새로고침 뒤 유지), 폰 폭에서 모양. 번역 프롬프트 프리셋을 골랐을 때 "…에 표시했습니다" 안내가 나오는지(숨긴 기본 프롬프트 칸이 있어야 한다)
2. 메시지 행동 줄에 번역 버튼이 생기고, 눌러 번역→원문 보기→번역 보기가 도는지(말풍선 레이아웃·미니멀 레이아웃 둘 다)
3. 번역문이 메시지 아래/대신 원작 모양으로 보이고, 스와이프·수정·가상 스크롤(메시지 다시 그려짐) 뒤에도 유지되는지
4. 하단 바 → 대조 창 → "이 문단 다시 번역"·"전체 다시 번역"·저장, 영어 원문 같이 고치기가 메시지를 고치는지
5. 말투 자동 정리·세계관 자동 정리·로어북 선택이 캐릭터·페르소나·로어북을 읽는지(권한 재승인 뒤)
6. 응답 자동 번역: 채팅 설정 "AI 응답 자동 번역"을 켜고 생성 → **끝나자마자** 번역이 붙는지. 생성 중·사용자가 Stop한 답변·impersonate는 번역되지 않는지. 재생성·이어쓰기 때 옛 번역이 가려지는지. NPC 자동 수집을 켜고 횟수 N으로 N번째 응답 뒤(약 3초 뒤) 알림이 뜨는지. 탭을 둘 열어도 한 번만 번역되는지
7. 내 메시지 번역: 입력창 번역 버튼과 보내기 전 번역이 원작 설정의 "유저 입력 번역 프롬프트"·단어장·기타 지침을 따르는지. 제외 규칙(상태창 등)이 지켜지는지
8. 기억 서재가 있으면: 번역 뒤 메시지 메타데이터에 `pub`이 생기고(스와이프를 넘기면 따라 바뀌고), 단어장이 채팅 메타데이터로 공개되는지
9. 0.4.0으로 번역해 둔 옛 채팅을 열면 문단별로 번역됐던 메시지가 원작 모양으로 보이는지(통째·부분 번역은 안 보인다)

## 0.5.1에서 더한 것 (대역·변환)

| # | 항목 | 내용 |
|---|---|---|
| A14 | **N6 내 메시지 번역** | 입력창 번역 버튼·보내기 전 번역이 원작의 `/api/translate` 처리(`routedFetch`: 유저 입력 번역 프롬프트, 단어장, 기타 지침, 이전 대화)를 거친다. Marinara가 그 프롬프트를 두는 "기본 프롬프트 칸" 두 개를 원작 설정 화면 컨테이너에 **숨겨 둔다**(`src/host-emu/dom-bridge.ts`). 원작이 고른 프리셋을 거기에 써 넣고, 그 칸의 값이 요청의 `systemPrompt`가 된다. `/translate` 경로가 모델을 부른다(`generate/raw`와 같은 연결·같은 메시지 모양). LV 묶음(묶음 자체의 단어집·추가 지침만)은 시스템 프롬프트 뒤에, 제외 규칙·HTML/코드 보호는 앞뒤에 얹는다(원작이 긴 프롬프트를 `generate/raw`로 돌려도 같이 간다). 번역 중 "이전 대화 참고"가 읽는 메시지는 끝 40개로 묶는다. 칸은 채팅을 바꾸면 비운다 ✅(브라우저 QA: 채팅 A의 프리셋이 B로 새지 않음) |
| A15 | **N7 기억 서재 연동(lv-tx v1)** | 원작 기록(`st_translator_tt`)의 보이는 스와이프에서 `metadata.st_translator.pub = {v:1,h,lang,text,paras,edited,at}`를 만든다(`src/adapter/pub.ts`, vendor 밖). `h`는 content의 FNV-1a32(base36), `paras` 키는 원작의 `blockKey`, `text`는 content 순서. 기억 서재 시험 픽스처와 같음을 `tests/pub.test.ts`가 고정한다. 계약 `provides`는 0.4.0대로 `pub-translation@1`·`glossary@1`(기억 서재 쪽이 `reads-pub-translation@1`·`reads-glossary@1`로 읽는다). 단어장은 원작 설정(`tt-config.json`의 채팅 범위, 없으면 기본)에서 `chat.metadata.st_translator.glossary`로 공개. 스와이프·수정 때 `pub`을 맞춘다 |
| A16 | **N8 0.4.0 번역 기록 변환** | 채팅을 열어 원작이 메시지를 읽을 때(끝에서 N개만) 0.4.0 `st_translator.entries`의 **문단 단위·완료** 기록을 원작 기록으로 한 번 옮겨 `st_translator_tt`에 저장한다(60개 이하로 읽을 때만 저장. "모두 번역" 같은 큰 읽기는 메모리에서만 옮기고 쓰지 않는다). 이미 원작 기록이 있으면 건드리지 않고, 0.4.0 기록은 지우지 않는다. 통째 번역·부분 번역·문단 수가 안 맞는 기록은 옮기지 않는다(원작 화면에 안 나온다). ⚠️ 문단은 원작이 화면에 없는 메시지를 다룰 때 쓰는 방식(`fallbackRoot`)으로 찾으므로 렌더 결과가 원문과 다른 메시지(HTML 카드 등)는 일부 문단이 안 이어질 수 있다 |
| A17 | **스와이프별 `pub`** | 번역 기록은 스와이프별이고 `pub`은 보이는 스와이프 것만이다. 0.4.0은 끝까지 번역된 메시지만 공개했지만 원작 기록은 문단 단위로 쌓이므로 일부만 번역된 메시지도 번역된 문단만으로 `pub`이 만들어진다(안 된 문단은 원문 그대로 `text`에 들어간다). 스와이프를 넘기거나 수정하면 `MESSAGE_SWIPED`·`MESSAGE_EDITED`·`SWIPE_EDITED`에서 맞추고, 기록이 없는 스와이프면 지운다 |
