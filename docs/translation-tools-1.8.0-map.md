# 번역 프리셋·단어장 1.8.0 → LV-Translator 이식 지도

작성 2026-11-15 (설계·조사만, 제품 코드 변경 없음). 기준:
- 업스트림 클론 `~/dev/marinara-translation-tools-upstream`, 범위 `e381e40`(1.6.4) .. `807d6a3`(1.8.0), 비병합 커밋 15개 + 병합 3개(#1 `50550ec`, #2 `6709022`, #3 `8694b0e`는 같은 내용의 재수록). `extension.js` 6593줄(+587/-45).
- 현재 LV-Translator 0.3.6 (`fix/fetch-diet` `ee29900`). 이 확장은 **1.5.4를 보고 새로 쓴 것**이라 업스트림 `extension.js` 코드를 가지고 있지 않습니다. 가진 것은 프리셋 원문(`src/presets/upstream/*.ts`, `catalog.ts`가 1.5.4 줄 17-162를 그대로 복사)과 요청 조립(`src/translate/prompt.ts`)뿐입니다.
- 표기: ✅직접 확인 / ⚠️추정·미확인.

## 0. 먼저 알아야 할 사실 (위험·전제)

1. ✅ **업스트림 클론의 이력은 1.6.4(`e381e40`)부터입니다.** LV가 기준으로 삼은 1.5.4와 1.6.4 사이(문단 번역 일괄 `[로컬 수정 1.6.1]` 막힌 프롬프트 문단별 재시도, `1.6.2` 스와이프 중 번역 저장·모바일 탭 등, `extension.js` e381e40:2412, 2590, 2773-2807, 2871-2884, 4124-4202)는 git 이력이 없어 **커밋별 비교가 불가능**합니다. 이 지도는 `e381e40..807d6a3`만 커밋별로 다루고, 1.5.4→1.6.4 차이는 7절에 따로 적었습니다(코드 대조가 필요한 미확인 구간).
2. ✅ 업스트림 `extension.js`는 **Marinara 브라우저 확장**입니다. Marinara의 `window.fetch` 가로채기(`/api/translate` 5111·6373, `/api/generate` 1104-1805), React Query 캐시(2492-2562), Marinara 채팅 설정 마크업(5992~), localStorage `marinara-active-chat-id`(1809)에 의존합니다. LV-Translator는 **백엔드 워커(`src/backend.ts`) + 프런트(`src/frontend.ts`) 분리 구조**라 이 층은 통째로 이식할 수 없고 LV의 기존 대응물이 이미 있습니다(`GENERATION_ENDED` backend.ts:464, 메시지 이벤트 :486, 설정 탭 frontend.ts).
3. ✅ **호스트 API 사실(중요, 사용자 규칙 "채팅 전체 조회 금지"와 직결).** LV-Translator는 `lumiverse-spindle-types@0.6.59`에 맞춰 개발돼 `getMessages(chatId)`가 인자 없는 전체 조회뿐이라고 보고(REPORT-fetch-diet.md) 스냅샷으로 줄였습니다. 그러나 **호스트 소스(`~/Lumiverse` HEAD `8e0f3945`, 1.3.0, 타입 0.6.79)에는 이미 부분 조회가 있습니다**: `getMessages(chatId, { limit, offset, tail, light, includeExtra, ownMetadataOnly })`, `updateMessage(..., { metadata_patch, ownMetadata })`(커밋 `1cf2133f`, 2026-10-27; 호스트가 `spindle.host.capabilities['chat-lean-messages-v1']`, `['chat-metadata-patch-v1']`를 광고, `~/Lumiverse/src/spindle/worker-host.ts:1391`, 문서 `developer-docs/docs/backend-api/chat-mutation.md:180`, 구형 호스트는 옵션을 **무시**하고 전체를 돌려줌). → 설계: 능력 확인 후 `tail`/`light`/`includeExtra:false`를 쓰고, 능력이 없으면 지금의 스냅샷 경로(`backend.ts:129`)로 폴백. `spindle-types`는 0.6.79 이상으로 올려야 타입이 보입니다(⚠️ 올릴 때 다른 타입 변화 확인 필요).
4. ✅ 1.7.0의 이름 변경은 "원래 이름으로 되돌림"(`9258aea`)이라 LV에는 영향 없음(LV identifier `st_translator`, 표시명 "양방향 번역").
5. ⚠️ LV는 번역을 **메시지 전체·문단 단위 `parts[]`** 로 저장(`shared.ts:270` TranslationRecord, 키 `sourceHash(content)`)하고 업스트림은 **문단 키→번역 맵** `extra.paraTranslate = {v:1,map,edited,view,at}`(`extension.js:1808` PT_KEY, 2564-2645)로 저장합니다. 손으로 고친 문단 표시(`edited`)·문단 키 이동(영어 원문 재작성)을 이식하려면 LV 기록 구조에 `edited`가 필요합니다(아래 §3).

## 1. 커밋별 지도

분류: **있음 / 부분 / 없음 / 해당없음(N/A, Marinara 전용)**. "LV 위치"는 넣을 파일·줄(현재 줄 번호 기준).

| # | 커밋 | 사용자에게 보이는 기능 | 업스트림 위치 (`extension.js`) | LV 0.3.6 | LV에서 들어갈 곳 |
|---|---|---|---|---|---|
| 1 | `8ac3112` 외국어 대사 프리셋 + 말투 스캔 | (a) 프리셋 2종 "한국어 문체·이름 중심·외국인 대사 병기 (원문 있을 때만 / 외국어 대사 생성)" (b) 말투 자동 정리 JSON에 `"language"` 필드, 결과에 `- 사용 언어:` 줄, 국적만 있으면 `(추정)` (c) 대사 지침 켜짐 필요 | 프리셋 ADDITIONAL_BUILTIN_PRESETS 4575-4650대(신규 id `builtin-korean-style-foreign-dialogue`, `-generate`), 정렬표 BUILTIN_PRESET_ORDER; 스캔 `SCAN_SPEECH` 3100-3118, 정제 3284-3300 | 프리셋 **없음**. 말투 자동 정리(스캔) **없음**(LV는 `incomingVoicePrompt` 텍스트칸만, `shared.ts` ChatSettings, `prompt.ts:150`) | 프리셋: `src/presets/catalog.ts`(자동 생성 파일 — "수정 금지") 옆에 `src/presets/tt180.ts` 신설해 `ADDITIONAL_BUILTIN_PRESETS`·순서표에 합류(`presets/index.ts:15-18` BUILTINS 합성부). 스캔: §3의 "자동 수집" 항목 |
| 2 | `19405ef` 페르소나 이름 전달 + 250ms 채팅 폴 제거 | 위 두 프리셋 + 지문만 번역 프리셋은 대사 지침이 꺼져 있어도 요청에 `# User Persona … named "<이름>"`을 넣음. 말투 스캔 결과의 유저 항목에 `- 역할: 유저 페르소나`. 채팅 전환 감지를 폴링 대신 history/visibility 이벤트로 | `personaSection` 4983-5005, `buildSystemPrompt(...persona)` 5008-5022, `LIVE_PROMPT_PRESET_IDS`, 스캔 personaName 3263-3266; 폴링 제거 6757-6790 | 페르소나 이름 **없음**. 폴링은 **N/A**(LV는 호스트 이벤트 `CHAT_SWITCHED` 사용 — frontend 쪽 hint 경로) | `src/translate/prompt.ts:108` `buildTranslationRequest`에 `persona?: string` 입력을 더하고 `sections.push(persona)`(:145 직후). 이름 출처: ✅ 스냅샷의 **최근 user 메시지 `name`**(권한 불필요) → 없으면 `spindle.personas.getActive(userId)`(권한 `personas` 추가 필요, 미부여 시 생략) |
| 3 | `7bb38b4` 지문만 번역 프리셋 | "한국어 문체·이름 중심·모델 병기 유지 (지문만 번역)": 모델이 이미 쓴 `"원어" (한국어)` 병기·한국어 대사는 글자 그대로 유지, 한국어 없는 대사만 `"원문" (번역)` 추가 | 프리셋 `builtin-korean-style-keep-model-dialogue` | **없음** | #1과 같은 `tt180.ts`. 이 프리셋은 `unitKind`(아래 #8)와 한 쌍이라 문단 단위 번역 경로(`translate/engine.ts` `partSources`)에서 "이미 병기된 문단은 번역 생략" 판정이 필요 |
| 4 | `03adf14` 마크업 태그 유지 + 외국어 대사 짝 | #3 프리셋 문구 보강(`<x1>`·`<speaker=…>` 보존, `§RP` 메타줄) | 프리셋 문구만 | **없음** | #3에 포함 |
| 5 | `95ba1fe` 장면 구분선 유지 | #3 프리셋에 `***` 구분선 보존 문구 | 프리셋 문구만 | **없음** | #3에 포함 |
| 6 | `b4074cf` 기타 지침 한도 상향·스타일 지침화 | 기타 지침 4000→**12000자**(`FREE_CONTEXT_MAX` 4469→). 위 3개 "라이브" 프리셋을 고르면 기타 지침이 참고용(`<…>` 이스케이프)이 아니라 `# User Translation Style Instructions`(따르라는 지시)로 들어감, 로어북은 계속 참고용 | `freeContextSection(raw, lore, scope)` 4942-4960, `LIVE_PROMPT_PRESET_IDS`, `livePresetPrompt` 4962-4971 | 한도: LV는 시스템 프롬프트 200,000자(`prompt.ts:20`)라 **상위 호환**, 기타 지침 자체 상한 없음 → 12000 별도 상한 불필요. 스타일 지침화 **없음**(`prompt.ts:71` `freeContextSection`는 항상 참고용) | `prompt.ts:71`을 `freeContextSection(raw, presetId)`로 바꾸고 라이브 프리셋 3개 id 집합 상수 추가. ⚠️ "마리나라 설정칸에 옛 프롬프트가 남아도 확장의 최신 프롬프트로 번역"(README `기본 번역 버튼도 최신 프리셋 사용`)은 Marinara 전용 문제라 LV에는 **N/A**(LV는 항상 프리셋 id로 최신 본문 조회, `presets/index.ts:20`) |
| 7 | `2cb198f` 번역 손수정 → 영어 원문 고치기 | 대조·수정 창의 "영어 원문도 같이 고치기"(기본 켬, localStorage 기억): 고친 문단마다 모델이 이전/수정 번역을 비교해 영어 문단을 **바뀐 곳만** 고쳐 `PATCH message content`, 번역은 새 원문 키로 이동, 영어 재작성은 `temperature 0.3`, 모델 응답 코드펜스 제거 | `SYNC_SOURCE_SYSTEM` 2950-2954, `syncSourceToEdits` 2995-3030, 대조·수정 UI 4029-4082 | **없음**(LV에는 대조·수정 창 자체가 없음 — 문단 대조는 *보기*뿐, `display/paragraph-view.ts`) | §3 상세. 백엔드 `src/backend.ts`에 `edit_translation` 핸들러(`handle` switch :521~) + `src/translate/sync-source.ts` 신설. `updateMessage(chatId, id, { content, ownMetadata })` **한 번 호출**로 내용·번역 동시 저장(두 번 쓰면 MESSAGE_EDITED가 둘 → 기억 서재가 중간 상태를 봄) |
| 8 | `ce67bb0`/`50550ec` 지문만 번역: 모델 병기 대사 보호 | `unitKind`가 `isPairedDialogue`(한국어 대상일 때 `"…" (한글…)`뿐인 문단)이면 `"same"`(번역 생략) | `unitKind` 2327-2352, `PAIRED_QUOTE_RE`, `isPairedDialogue` | **없음**. LV는 글자 없는 문단만 생략(`paragraphs.ts:43` `hasNoText`) | `src/translate/paragraphs.ts`에 `isPairedDialogue(text, lang)` 순수 함수로 이식(코드 거의 그대로). 호출은 `engine.ts:64` `partSources`/`requestsNeeded`(:78)의 건너뜀 판정 |
| 9 | `e1d28b7`/`6709022` 한국어 문체 3종: 행동 방향 유지 | 세 한국어 문체 프리셋에 "생략해도 행동의 방향(누구에게/어디에)은 남기기" 한 줄 | 프리셋 문구 | #1·#3 프리셋이 없으므로 **없음** | #1·#3에 포함 |
| 10 | `659e747` 1.7.0 기억 서재 호환판 + 예시 정리 | README·테스트 예시를 지어낸 이름으로, 이름 "(기억 서재 호환)" 추가(→`9258aea`가 되돌림). **연동 계약은 코드 변경 없이 기억 서재 쪽이 읽는 방식**(README "기억 서재와 함께 쓰기") | manifest·README·tests | N/A(이름). 연동은 아래 "연동 계약" | §4 |
| 11 | `9258aea` 확장 이름 원복 | 설치된 것 위에 업데이트되도록 | manifest | N/A | — |
| 12 | `0b3b171`/`9be769d` 기타 지침 예시 `기타 지침/지문 문체.txt` + README 링크 | 지문 문체 기타 지침 18줄 샘플(아카이브 외 배포) | 데이터 파일 | **없음** | 그대로 `docs/`나 설정 화면 "예시" 접이식에. 라이선스: 업스트림 README가 동봉 허용 문구이나 ⚠️ 재배포 문구 확인 필요. `기타 지침/지문 문체.txt`는 `git show 807d6a3:"기타 지침/지문 문체.txt"`로 확보 |
| 13 | `b9aa181`/`8694b0e` 1.7.1 끝 신호 없이 끊긴 생성도 자동 번역 | 스트림이 `done` 없이 끊겨도(화면 꺼짐·연결 유실·Engine 유휴 감시자) 사용자 Stop이 아니면 생성 종료를 확인하고 자동 번역. `userAborts`, `STOP_GRACE_MS=1000`, `generationEnded`(`/api/generate/status`) | `createMarinaraAutomaticTranslation` 1118-1124, 1535-1600, 1736-1745 | **N/A**: LV의 자동 번역은 **서버 워커**가 `GENERATION_ENDED`로 돌리므로 브라우저 스트림 끊김에 영향받지 않음(`backend.ts:464`, 브라우저를 닫아도 동작 — README). 단 ⚠️ 호스트가 `GENERATION_ENDED`를 안 쏘는 경로(중단 `GENERATION_STOPPED`, 생성 오류)에서 누락 가능 → 아래 #14로 보완 | 코드 이식 없음. 테스트 시나리오만 가져옴(`tests/auto-translate.test.js` 87줄: stop 후 번역 안 함, 끊김 후 번역함) → `tests/backend-auto.test.ts`에 대응 케이스 |
| 14 | `22092ad` 1.7.2 놓친 최신 답변 자동 번역 보충 | 채팅을 열거나 화면으로 돌아왔을 때, 자동 번역이 켜진 채팅의 **최신 assistant 답변**이 30분 안이고 번역이 하나도 없으면 번역. 시도 키 `id:hash`로 중복 방지, 생성 중이면 건너뜀 | `catchUpLatest` 3737-3770, 호출부 6757-6770 | **없음** | 백엔드 `hint` 처리(`backend.ts:526`)에서 호출. **채팅 전체 조회 금지 준수**: 업스트림은 `listMessages(chatId, 4)`인데 LV는 `getMessages(chatId,{tail:4, light:true})`(능력 있을 때) 또는 이미 있는 스냅샷 재사용. 시도 키 집합은 메모리에만. 생성 중 판단은 스냅샷의 busy 맵 + `GENERATION_STARTED/ENDED` 이벤트 |
| 15 | `807d6a3` 1.8.0 기타 지침 저장·재사용 + 한글 전용 줄 | (a) 기타 지침을 이름 붙여 **전역 저장**(최대 100개, 이름 60자, 본문 12000자, id `note-<uuid>`), 불러오기(채팅의 기타 지침 교체+즉시 저장, 켜기 포함), 같은 이름 덮어쓰기(확인), 삭제(이미 불러온 채팅 불변), 전체 백업에 포함·가져오기 시 같은 id/이름은 파일 우선 병합 (b) 한국어 출력 기본 프리셋 전부 끝에 `HANGUL_ONLY_RULE`(한자·가나 금지; 보존 지시된 원문 대사·태그·§RP는 예외) | (a) `normalizeNotes` 4779-4797, `newNoteId`, 저장 UI `saveNote/loadNote/deleteNote` 5921-5996, 백업 6043-6050·6136-6170 (b) `HANGUL_ONLY_RULE`/`withHangulRule` 4469-4483, 프리셋 전부 래핑, `V2_PRESETS` 마이그레이션 비교 4833-4838·5340-5345 | (a) **없음**. 가장 가까운 것은 "번역 지침 묶음"(`shared.ts:84` UserBundle: glossary+freeContext+incomingVoicePrompt 한 묶음, `bundles.ts`) (b) **없음** | **결정 필요**: 기타 지침 노트는 LV 묶음과 개념이 겹침. 권장: 업스트림 의미(전역 보관함 + "불러오기=복사")를 따라 `Store.notes: Note[]`를 추가(`shared.ts:118` Store, `normalizeStore:208`)하고 묶음은 그대로 둠. ⚠️ 충돌: 묶음은 *참조*, 노트는 *복사* — UI 문구로 구분. (b) `HANGUL_ONLY_RULE` 문자열을 `tt180.ts`에서 상수로 만들고 한국어 도착 프리셋의 `prompt`에만 덧붙임. **프리셋 지문(SHA-256) 시험(`tests/presets.test.ts`, `prompt-fingerprints.json`)은 1.5.4 원문 기준 고정이므로 래핑된 문자열은 별도 지문 표로** |

### 한국어 기본 프리셋 규칙 (#15b 상세)
- ✅ 대상: 한국어 기본 프리셋 중 `withHangulRule`이 적용된 것 — `builtin-english-korean`(+v2), `builtin-chinese-korean`(+v2), `builtin-japanese-korean`(+v2), `builtin-bilingual-dialogue-korean`(+v2), `builtin-english-paraphrase-korean`, `builtin-english-source-style-korean`, `builtin-chinese-paraphrase-korean`, 새 3종. **제외**: 대상 언어를 고르는 범용(`builtin-roleplay`, `-literary-roleplay`)과 인풋용(`builtin-literary-roleplay-input*`) (README "한국어로 내는 기본 프리셋: 한글로만").
- LV 영향: `presets/index.ts:20-28`의 `promptPresets()`가 모델 요청에 쓰는 프롬프트이므로 **번역 결과가 바뀝니다**. 기존 사용자 채팅의 번역은 안 바뀌고 "다시 번역"부터 적용. 사용자 정의 프리셋(`custom-*`)에는 붙이지 않음(업스트림도 `custom` 항목 비교에서만 `withHangulRule(prompt)`로 v2 승격 판별).

## 2. 프리셋 데이터 요약 (신규·변경)

| id | 이름 | 비고 |
|---|---|---|
| `builtin-korean-style-foreign-dialogue` | 한국어 문체·이름 중심·외국인 대사 병기 (원문 있을 때만) | 순서표 2번째(`builtin-inherit` 다음), `LIVE_PROMPT_PRESET_IDS` |
| `builtin-korean-style-foreign-dialogue-generate` | … (외국어 대사 생성) | 순서표 3번째, 라이브 |
| `builtin-korean-style-keep-model-dialogue` | 한국어 문체·이름 중심·모델 병기 유지 (지문만 번역) | ⚠️ `BUILTIN_PRESET_ORDER`에는 앞 두 개만 추가된 것으로 diff에 보임(세 번째는 순서표 밖 → 맨 뒤). 업스트림 동작 그대로 따를지 결정 필요 |
| 기존 한국어 프리셋 | 문구 끝에 `HANGUL_ONLY_RULE` | 위 §#15b |

프리셋 문구는 `git show 807d6a3:personal-extension/extension.js | sed -n '4575,4660p'`(대략)에서 **글자 그대로** 복사(요약·번역 금지; LV가 "원문 수정 금지 + 지문 시험" 원칙). 이식 후 `tests/presets.test.ts`에 새 지문 4개(3 프리셋 + 한글 규칙 문자열)를 추가.

## 3. 큰 기능별 설계

### 3.1 외국어 대사·말투 스캔·페르소나
- 스캔(`SCAN_GLOSSARY`·`SCAN_SPEECH`·`SCAN_WORLD`, 3030-3245)은 **카드·페르소나·로어북·최근 대화**를 읽어 모델에게 JSON을 받는 기능입니다. LV 이식 시 필요한 호스트 호출: 캐릭터 카드(`characters.get`, 권한 `characters`), 페르소나(`personas`), 로어북(`world_books`), 최근 메시지. **현재 LV-Translator 권한은 `generation`, `chat_mutation`뿐** → 스캔을 이식하면 권한 3개 추가(사용자 재승인). 대안: 스캔을 **1차 범위에서 제외**하고(수동 입력칸 유지) 프리셋·노트·수정 동기화·페르소나 이름만 먼저 이식 — 사용자 결정 사항.
- 메시지 자료 수집은 `tail`로 최근 N개만(전체 조회 금지). 업스트림 `collectMaterial`(3247 이전)의 `listMessages` 호출 위치를 `getMessages(chatId,{tail:N,light:true,includeExtra:false})`로 교체.
- 결과는 대사 지침 텍스트(`incomingVoicePrompt`)에 **`- 사용 언어:` 줄 형태로** 저장 → 프리셋이 그 줄을 읽음. 따라서 스캔이 없어도 사용자가 손으로 `- 사용 언어: 영어`를 적으면 프리셋은 동작(README 사용 방법과 동일).
- 대사 지침을 꺼 두면 사용 언어가 전달되지 않지만 페르소나 이름은 전달됨(#2) — `prompt.ts:150` 조건(`incomingVoiceEnabled`)과 별개 섹션으로 둘 것.

### 3.2 손수정 → 영어 원문 재작성 (#7)
업스트림 흐름(2995-3030): ① 메시지 본문을 `\n[ \t]*\n`로 쪼개 **원문 구분자를 보존**(손대지 않은 문단은 바이트 그대로) ② 키가 일치하는 문단마다 LLM 호출(시스템 `SYNC_SOURCE_SYSTEM`, user = `[Original English]/[Previous Korean translation]/[Corrected Korean translation]`) ③ 결과가 비었거나 원문과 같으면 건너뜀 ④ `PATCH content` ⑤ 번역 기록의 `map[oldKey]`를 `map[newKey]`로 옮기고 `edited[newKey]=1`.
LV 이식:
- 필요 선행: **대조·수정 창**(원문/번역 문단별 편집 UI, 4029-4082 `openCompare`)과 기록의 `edited` 표시. LV 기록은 `parts[i]`=문단 i의 번역(`unit==='paragraph'`일 때) → 편집 가능 단위는 **문단 단위 번역 기록**뿐. 메시지 통째 번역(`unit==='whole'`)은 문단 대응이 보장되지 않으므로(`pairParagraphs`가 문단 수가 같을 때만 짝짓기, `paragraph-view.ts:33`) 대조·수정 시 "문단 단위로 다시 번역" 안내 또는 동일 문단 수일 때만 허용.
- 키: 업스트림은 `normalizeForKey`→FNV-1a base36(`extension.js:1840-1910`). LV 기록은 위치 기반이라 키가 없음. 재작성 후 "번역을 새 문단에 연결"은 **같은 인덱스의 `parts[i]`를 corrected로 두고 새 `sourceHash(newContent)` 항목으로 기록 이동**(`shared.ts:252`, `METADATA_KEY` 항목 `entries[hash]`). 기억 서재용 공개 투영(§4)에는 문단 키 맵으로 변환.
- 호출 비용: 문단마다 1회. 선행조건: 번역 연결 지정. 실패 시 "번역은 저장했지만 영어 원문은 고치지 못했습니다" 처리(업스트림 문구).
- 스와이프: `updateMessage({content})`는 활성 스와이프 슬롯을 덮어씀(`spindle-api.d.ts` `updateMessage` 주석). 이후 `sourceHash`가 바뀌므로 **다른 스와이프의 기록은 불변**(키가 내용 해시라서 자연스럽게 유지, `shared.ts:286` 주석).
- ⚠️ 위험: 사용자 본문을 AI로 고쳐 저장 → 되돌리기 수단 필요. 업스트림에 없음. LV에서는 `entries[oldHash]`를 삭제하지 말고 `prevSource`(원래 영어 문단 배열)를 같은 항목에 한 번 보관해 "원문 되돌리기" 버튼 제공 권장(업스트림 이상, 선택).

### 3.3 자동 번역 수정(1.7.1/1.7.2)
LV에는 필요한 구조가 이미 다름(§1 #13·#14). **추가할 것은 보충 로직 하나**(#14). 호스트가 생성 도중 오류로 `GENERATION_ENDED`를 안 쏘는 경우를 위해 `GENERATION_STOPPED`를 무시하는 현재 동작(사용자 Stop은 번역 안 함)을 유지하고, 오류 종료는 ⚠️ 호스트 이벤트 확인 필요(미확인).

## 4. 연동 계약 (기억 서재 ↔ 번역 도구)

### 4.1 Marinara 판이 데이터를 주고받는 방식 (업스트림 코드로 확인)

| 흐름 | 쓰는 쪽 | 저장 위치·키 | 읽는 쪽 | 트리거 |
|---|---|---|---|---|
| **단어장 → 기억 번역** | 번역 도구가 채팅별 설정 `config.chats[chatId].glossary`(없으면 `config.defaults.glossary`) 텍스트(한 줄 `영어 = 한국어`)를 Marinara 개인확장 저장소에 보관(`marinara.storage.patch({config})` 5169) | 확장 저장소 `/api/personal-extensions/<id>/storage`의 `value.config` | **기억 서재 UI(브라우저)**: `/api/personal-extensions/runtime/client`에서 이름이 "번역 프리셋·단어장"으로 시작하는 확장을 찾고(id가 설치마다 다름) 저장소를 읽어 `POST /api/memory-module/chats/:id/glossary {glossary,source}` (`runtime.up.js:365-392`). 서버가 `T.parseGlossary`로 쌍을 만들어 `translations.json`의 `glossary:{pairs,hash,source,at}`에 저장(`service.up.cjs:4201-4216`), 해시 같으면 무시 | 방을 열 때(`loadRoom` 267-270)마다 1회, 같은 텍스트면 재전송 안 함. 빈 글도 사용자가 저장했으면 전송 |
| **응답 번역 → 한국어 낱말 회상** | 번역 도구(또는 Marinara 기본 번역)가 메시지 `extra.translation`(+`translationSource`=원문, `translationHidden`) 저장(`extension.js:1364`, 읽기 1305·5004) | 메시지 `extra` | 기억 서재 **서버**가 메시지 읽을 때 `tr`로 첨부, 원문과 같을 때만(`translationSource===content`): `chatMessages` `service.up.cjs:1300`; 회상에서 낱말 비교(`recall.cjs:247, 272`) — **찾기에만 쓰고 기억 내용에는 넣지 않음** | 답변 생성 후 기억 정리·회상 때마다 |
| **손수정 번역 → 영어 원문 재작성** | 번역 도구만 (`PATCH /api/chats/:id/messages/:mid` content, 3010). 기억 서재는 모름 | 메시지 `content` | 기억 서재는 **일반 메시지 수정**으로 처리(내용 해시 불일치 → 장부 재조정). 별도 연동 없음. 기억 서재 쪽 0.15.0 "한국어 번역을 고치면 영어 기억도 고치기"는 **기억 서재 자체의 번역 칸**을 고치는 별개 기능 | — |
| **인용문 = 채팅의 문단 번역 (0.33.1, `6507a35`)** | 번역 도구 `extra.paraTranslate = {v:1, map:{<키>:한국어}, edited, view, at}` (`extension.js:1808, 2582-2645`) 키 = FNV-1a32 base36(`normalizeForKey(문단)`; 따옴표 정규화·`*_~\`#>` 제거·공백 정리, 1840-1910) | 메시지 `extra.paraTranslate` | 기억 서재 서버 `noteSourceKo`(`service.up.cjs:3098-3152`): 같은 정규화(`srcNorm`+`srcKey`)로 문단·줄·문장을 찾아 한국어 반환, 문장 수 같으면 문장별, 아니면 400자 이하 문단 통째, `<x1>` 마커 제거. `translationLookup` 3082-3095가 모델 번역보다 우선. **찾은 줄은 번역 모델로 안 보냄**, 인용문 번역을 꺼도 보임 | `chatMessages` 때마다(1279), 번역 조회 전(3223) |
| **분기에 번역·단어장 넘김 (`ce89884`)** | 기억 서재 서버 `branchMemory`(`service.up.cjs:680-686`) | 기억 서재 `<chatId>.translations.json`의 `items`+`glossary`를 분기방 파일로 복사(실패표시 `failed`는 제외). 번역 도구 데이터(메시지 extra)는 Marinara가 메시지를 복사하며 따라감 | 분기방 | `POST /api/chats/:id/branch` onSend 훅(`attach` 5666) |

⚠️ 위 중 "응답 번역→낱말 회상"이 쓰는 필드가 `extra.translation`(전체 번역) 하나, "인용문"이 쓰는 필드가 `extra.paraTranslate` 하나로 **서로 다른 필드**라는 점이 중요합니다. LV-Translator는 둘 다 만들지 않고 `metadata.st_translator.entries[hash].parts`만 만듭니다.

### 4.2 루미버스 판 계약 제안: "LV-TX v1"

호스트 사실(✅ 확인):
- 메시지 메타데이터는 `extra.spindle_metadata`이고 확장마다 manifest identifier를 키로 씀(`worker-host.ts:4045-4048` `getOwnSpindleMetadataKey`). `getMessages`는 `ownMetadataOnly`를 안 주면 **모든 확장의 키**를 `metadata`로 돌려줌(`worker-host.ts:4070-4090`) → 기억 서재가 `metadata.st_translator`를 읽을 수 있음. 읽기에는 `chat_mutation` 권한이 필요하며 두 확장 모두 보유(`spindle.json`).
- `updateMessage({ownMetadata})`는 **자기 키만** 원자적으로 병합(`worker-host.ts:4270-4282`, 호스트 능력 `chat-lean-messages-v1`). 구형 호스트는 `metadata` 전체 교체뿐(현재 LV가 `{...message.metadata, st_translator}`로 전체를 다시 쓰는 방식, `backend.ts:174`).
- 확장 간 직접 호출: **`spindle.rpcPool.sync/handle/read`** (`spindle-api.d.ts:1366-1383`, 구현 `~/Lumiverse/src/spindle/shared-rpc-pool.service.ts`). 엔드포인트는 `<manifest identifier>.<채널>`(`shared-rpc.ts:6-50`, 채널은 `[a-z0-9][a-z0-9_-]*`), 핸들러 문맥에는 **요청자 확장 id와 권한만** 있고 사용자·채팅 인자가 없음(`SharedRpcRequestContextDTO`, `api.d.ts:3222`) → **채팅별·사용자별 데이터 전달에는 부적합**, 존재 확인·버전 협상에는 적합. 소유자/요청자의 권한이 `requires` 정책 또는 소유자 권한 상속으로 검사됨(`shared-rpc-pool.service.ts:150-190`).
- 프런트 확장끼리는 공유 채널이 없고(`rpcPool`은 백엔드 전용) 서로의 `userStorage`도 못 읽음(storage는 확장별 가상 디스크, `spindle-api.d.ts:378-440`).
- 채팅 메타데이터: `chats.update`는 교체(병합 아님), `chats.compareAndSetMetadata`로 안전 갱신(권한 `chats`+`chat_mutation`, 능력 `chat-conditional-metadata-v1`) — `~/Lumiverse/developer-docs/docs/backend-api/chats.md:48,75`; `CHAT_CHANGED`에 `changedFields` 제공(`api.d.ts:1329-1337`).

**선택한 설계 (하나): 메타데이터 평면 + rpcPool 핸드셰이크.**

1. **핸드셰이크(rpcPool, 값 하나):** 각 확장이 시작 시 `rpcPool.sync('contract', { name:'lv-tx', v:1, ext:'<identifier>', version:'<semver>', provides:[…] })`. 번역 도구 `st_translator.contract` provides `["pub-translation@1","glossary@1"]`, 기억 서재 `anon_memory_lv.contract` provides `["reads-pub-translation@1"]`. 상대는 `read()`가 던지면 "미설치"로 처리. 설치·삭제 감지는 `SpindleEvent.EXTENSION_LOADED/UNLOADED`(`events.d.ts:2`)로 재확인.
2. **메시지 공개 투영 `pub` (번역 도구가 씀 → 기억 서재가 읽음).** 번역 도구의 자기 키 안, `entries`와 형제:
   ```
   metadata.st_translator = {
     v: 1, entries: {…기존…}, hidden?: …,
     pub: {                       // 활성 스와이프 하나만, 번역 도구가 저장할 때마다 갱신
       v: 1,
       h: "<FNV-1a32 base36 of message.content exactly as stored>",  // 기억 서재가 같은 함수로 계산해 일치할 때만 사용
       lang: "ko",
       text: "<번역문 전체, ⟦n⟧ 복원 후, HTML 보존>",   // = 업스트림 extra.translation
       paras: { "<key>": "<번역>" },                     // = 업스트림 paraTranslate.map; key = fnv32base36(normalizeForKey(문단))
       edited: { "<key>": 1 },                            // 손으로 고친 문단
       at: 1731600000000
     }
   }
   ```
   - `h` 해시는 ✅ `shared.ts:252`의 `sourceHash`(일러스트 정규화 포함)와 **다른 함수**임을 명시: 계약용은 `content` 원문 그대로의 FNV-1a(`extension.js:1840` `hashText`와 동일, 시험벡터를 계약에 포함). 이유: 기억 서재는 번역 도구 내부 규칙을 알 필요가 없어야 함.
   - 스와이프를 넘기거나 번역을 지우면 `pub`를 즉시 제거/교체(오래된 번역이 남지 않게). `entries`는 현재처럼 스와이프별 보존.
   - 크기: `text`+`paras`는 번역문 두 벌이라 메시지당 2배. 상한: `paras`는 한 메시지 400개(업스트림 `saveRecord` 상한 2564-2600과 동일), 초과분은 오래된 것부터 제거.
3. **채팅 단위: 단어장 `glossary` (번역 도구가 씀 → 기억 서재가 읽음).** `chat.metadata.st_translator = { v:1, glossary: { text:"<한 줄 영어 = 한국어>", hash:"<fnv32base36(text)>", at } }`. 번역 도구가 `chats.compareAndSetMetadata`로 자기 키만 바꿈(다른 키 보존), 단어장 저장 시 + 상대 확장 감지 시. 기억 서재는 `CHAT_CHANGED`(`changedFields`에 `metadata.st_translator.glossary`)와 방을 열 때 `chats.get`으로 읽어 업스트림 `POST /chats/:id/glossary` 라우트와 **같은 서비스 함수**에 넣음(`service.up.cjs:4201`). ⚠️ **번역 도구에 `chats` 권한이 추가됨**(재승인). 능력 `chat-conditional-metadata-v1`이 없으면 이 경로는 끄고 기억 서재의 수동 단어장 붙여넣기 칸을 씀.
4. **변경 통지:** 별도 이벤트를 만들지 않음. 번역 도구가 `updateMessage`로 쓰면 호스트가 `MESSAGE_EDITED`를 내보내고 페이로드 `message.extra.spindle_metadata`에 새 값이 실려 옴(`api.d.ts:3030-3068`, REPORT-fetch-diet.md가 이 형식을 이미 이용) → **기억 서재는 이벤트 페이로드만으로 스냅샷 갱신, 재조회 없음**.
5. **손수정→원문 재작성:** 번역 도구는 `updateMessage(chatId,id,{content:새원문, ownMetadata:{…entries…, pub:{h:새해시, …}}})` **한 번**. 기억 서재는 평소처럼 `MESSAGE_EDITED`(내용 변경)로 장부 재조정하고, `pub.h===hash(content)` 이므로 새 한국어가 바로 유효. 순서가 둘로 쪼개지면 기억 서재가 "번역 해시 불일치"를 잠깐 보게 되므로 단일 호출이 필수.
6. **버전·호환:** `pub.v`/`glossary.v`/핸드셰이크 `v`를 정수로 올림. 기억 서재는 `v > 지원 최대`이면 해당 입력만 무시(모르는 필드는 무시, 알던 필드 의미를 바꾸지 않음). 필드 추가는 v 유지, 의미 변경만 v 증가.
7. **한쪽만 설치:**
   - 번역 도구만: `pub`·`glossary`를 쓰지 않음(핸드셰이크에 기억 서재가 없으면 `chats` 쓰기 생략 — 권한 거부 시에도 번역 기능은 정상). 나중에 기억 서재가 설치되면 EXTENSION_LOADED로 감지해 **활성 채팅부터** 단어장 공개(전 채팅 일괄 쓰기 금지), `pub`는 이후 저장분부터(과거 메시지는 해시 일치하는 `entries`를 요청 시 투영 — 전체 재기록 금지).
   - 기억 서재만: 지금처럼 자체 번역(모델 호출)과 자체 단어장 입력만. `pub`/`glossary`를 읽는 코드는 값이 없으면 건너뜀(오류 아님).
   - 둘 다 있으나 버전 불일치: 해당 기능만 비활성, 설정 화면에 한 줄 안내.

⚠️ 미확인: (a) 포크(CHAT_FORKED) 시 호스트가 메시지 `spindle_metadata`·채팅 메타데이터를 복사하는지 — 기억 서재 분기 상속(`inheritBranch`)이 단어장·번역을 자기 파일로 복사하므로 영향은 적으나 확인 필요; (b) `ownMetadata` 옵션을 구형 호스트가 무시하는지 오류 내는지(문서는 "무시"); (c) 두 확장이 서로 다른 사용자 범위로 설치될 때 rpcPool 가시성.

## 5. 통이식 방식 (소유자 지시: 처음부터 다시 만들지 말고 업스트림 코드를 그대로 옮기고 호스트 층만 얇게)

### 5.1 정직한 진단
업스트림 `extension.js` 한 파일(6593줄)이 Marinara 브라우저 호스트에 깊이 결합돼 있어 **파일 통째 복사는 불가능**합니다. 구간별로 나누면 다음과 같습니다(줄 번호 `807d6a3`).

| 구간 | 줄 | 내용 | 복사 가능성 | 쓰는 Marinara 호스트 호출 |
|---|---|---|---|---|
| 프롬프트 상수 | 1-1103 (`MARINARA_TRANSLATION_*`) | 프리셋 원문·렌더러 | **그대로 복사**(이미 LV에 1.5.4판 존재; 1.6.4→1.8.0 사이 이 구간은 diff에 없음 ✅ — 다만 1.5.4→1.6.4 변화는 7절 확인 필요) | 없음 |
| 자동 번역 훅 | 1104-1805 `createMarinaraAutomaticTranslation` | `window.fetch`로 `/api/generate` 스트림·`/api/chats` 가로채기, 설정 복원 | **불가(N/A)** — LV 백엔드 `GENERATION_ENDED`가 대체 | `fetch` 가로채기, `marinara.storage.patch`(1169), `/api/generate/status`(1571), `marinara.setTimeout`(1594) |
| 문단 번역기 - 순수 helper | 1838-1970, 2692-2850(`prompt`/`context`/`segment translation`), 2947-3030(수정 동기화), 3030-3245(스캔), 4469-5100(프리셋·노트 정규화·프롬프트 조립) | 해시·정규화·`seal`·세그먼트 `<segment>` 파서·재시도·스캔 프롬프트·`normalizeNotes`·`buildSystemPrompt` | **거의 그대로 복사 가능**(주입 인자 `llm`, `getChat`, `api` 등으로 호스트 분리) | `api(path)` 2335(→`/api/chats/…`), `llm()` 2646(→ `/api/generate/raw`), `localStorage` |
| 문단 번역기 - DOM·UI | 1970-2330, 3247-3840, 3860-4160, 5546-6420 | 렌더 DOM 문단 토글, 대조·수정 모달, 설정 마크업(Marinara 클래스) | **불가** — LV `frontend.ts`·`toolbar.ts`·`display/paragraph-view.ts`가 이미 별도 구현. 모달 로직(대조·수정, 노트 저장·불러오기)은 **동작·문구만 재현** | `document` 쿼리, React Query 2492-2562, Marinara 마크업 5992~ |
| 메인 IIFE | 4368-6593 | `marinara.*` 초기화, 설정 저장/백업, 폼 | 설정 정규화·백업 병합 로직은 복사, 나머지 제외 | `marinara.extension/storage/log/onCleanup/setTimeout` |

### 5.2 권장 구조: "로직 층 통이식 + LV 호스트 어댑터"
- `src/vendor/tt-1.8.0/` 신설: 업스트림 `extension.js`에서 **줄 범위로 잘라낸 순수 로직 파일**(프리셋 상수 1-1103, helper 구간 등)을 **바이트 그대로** 두고 `scripts/verify-upstream.mjs`로 SHA-256 고정(기억 서재의 `verify:original` 방식 재사용; LV-Translator 현재 `catalog.ts`의 "수정 금지 + 지문 시험" 원칙과 같음). 잘라내기 스크립트가 `807d6a3:personal-extension/extension.js`의 줄 범위→파일을 만들고 **범위가 바뀌면 실패**하도록.
- 호스트 어댑터 `src/adapter/marinara-shim.ts`가 제공할 표면(복사한 코드가 부르는 이름 그대로):
  ```
  api(path: string, opts?: {method,body,signal,timeoutMs}): Promise<any>
      // '/chats/:id' → backend 'get_chat'; '/chats/:id/messages?limit=N' → {tail:N,light:true} 또는 스냅샷;
      // PATCH '/chats/:id/messages/:mid' {content} → updateMessage; '/generate/status/:id' → busy 맵
  llm(system: string, user: string, o: {chatId, maxTokens, temperature, signal, prefill, connectionId}): Promise<string>
      // → spindle.generate.quiet (backend.ts:260 completer 재사용)
  getChat(chatId, fresh?): Promise<{personaId?, metadata, characterIds…}>   // chats.get, 권한 chats
  getPersona(id): Promise<{name}|null>        // personas.get, 권한 personas, 없으면 최근 user 메시지 name
  listMessages(chatId, limit): Promise<Msg[]>  // 반드시 스냅샷 재사용 또는 tail/limit(전체 조회 금지)
  patchMessageExtra(chatId, messageId, patch)  // → updateMessage({ownMetadata}) (paraTranslate→pub 투영)
  storage: { get(): Promise<Config>, patch(partial): Promise<Config> }   // marinara.storage → userStorage
  log: {info,warn,error}, setTimeout, setInterval, onCleanup
  ```
  **전체 채팅 조회 금지 규칙은 이 어댑터 한 곳에서 강제**: `listMessages`는 `(a) 이미 로드된 스냅샷 → (b) capability chat-lean-messages-v1 이면 tail/limit → (c) 전체 조회는 첫 로딩 1회만`(`backend.ts:129 cachedChat` 재사용). 이벤트(`MESSAGE_EDITED/SENT/SWIPED/DELETED`)로 스냅샷 갱신(`backend.ts:486`).
- 저장 구조 충돌: 복사한 코드는 `paraTranslate` 맵을 읽고 쓰는데 LV 기록은 `entries[hash].parts`. **어댑터의 `patchMessageExtra`가 변환**(맵↔parts)하거나, LV 기록을 `paraTranslate` 형태로 이행. 권장: LV 기록을 바꾸지 말고 변환(기존 번역 보존).

### 5.3 LV 전용 기능 중 위에 다시 얹어야 할 것 (최소화)
| LV 기능 | 위치 | 업스트림과 충돌? |
|---|---|---|
| 번역하지 않을 부분(HTML·상태창·제외 태그) 보호·복원 `⟦n⟧` | `translate/protect.ts` | **충돌**: 업스트림도 `seal()`(`<x1>` 마커, 1900대)로 비슷한 일을 하되 마커 형식이 다름(`⟦n⟧` vs `<xN>`). 업스트림 프리셋 문구는 `<x1>` 마커 규칙을 언급(#4) → 마커 형식 통일 결정 필요(⚠️ 위험 큼). 최소 해법: 업스트림 프리셋을 쓰되 보호는 LV `⟦n⟧`로 유지하고 프리셋 문구의 `<x1>` 설명만 모델에게 무해하도록 유지(수정 금지 원칙상 그대로) |
| 끊긴 번역 이어서 하기·긴 지문 나누기 | `translate/engine.ts`, `chunk.ts` | 업스트림에 없음 → 충돌 없음, 그대로 유지 |
| 표시 6모드·문단 대조 | `display/*`, `frontend.ts` | 업스트림 "문단별 번역 보기"와 겹침 — LV 유지 |
| 연결 선택·번역 지침 묶음·메시지 동작 줄 버튼·일러스트 보호 | `connection.ts`, `bundles.ts`, `toolbar.ts`, `illustrations.ts` | 충돌 없음 |
| 스냅샷·화면 범위 뷰(0.3.6) | `backend.ts:99-235`, `view-requests.ts` | 어댑터가 이를 사용 — 유지 |

### 5.4 배치 계획 (통이식 기준, 각 단계 시험 가능)
1. **어댑터 + 복사.** 호스트 능력 감지(`spindle.host.capabilities`), `src/adapter/marinara-shim.ts`, `src/vendor/tt-1.8.0/` 잘라내기·SHA 고정 스크립트. 시험: `bun test`(어댑터 단위 — 전체 조회 횟수 0/1 단언), `verify-upstream`.
2. **LV 전용 얹기.** 프리셋 3종 + 한글 전용 줄(`tt180.ts`), 페르소나 이름, 노트(전역 기타 지침) 스토어, `isPairedDialogue`, 라이브 프리셋 스타일 지침. 시험: 프리셋 지문, 요청 형식 24건 회귀(`tests/fixtures/upstream-requests.json`)에 새 케이스 추가, 기타 지침 백업 왕복.
3. **연동.** `pub` 투영·`glossary` 메타데이터·핸드셰이크·손수정→원문 재작성 단일 `updateMessage`. 시험: 가짜 호스트에서 이벤트 페이로드만으로 상대가 갱신됨, 단일 호출 단언, 한쪽만 설치 시나리오 3종.
4. **QA.** 실제 Lumiverse(권한 재승인 포함), 모바일 360px, 전체 채팅 조회 횟수 실측(`REPORT-fetch-diet.md` 방식), 대조·수정 창 신규 UI.

## 6. 위험 요약
1. 권한 증가(`chats`, 스캔 포함 시 `characters`·`personas`·`world_books`) — 업데이트 시 재승인.
2. 마커 형식 충돌(`⟦n⟧` vs `<xN>`) — 통이식의 가장 큰 마찰.
3. 손수정→원문 재작성은 본문을 모델이 고침: 되돌리기 없음(업스트림도 동일), 스와이프·동시 편집 경쟁.
4. 호스트 능력 의존(`chat-lean-messages-v1`, `chat-metadata-patch-v1`, `chat-conditional-metadata-v1`)과 타입 버전(0.6.59→0.6.79).
5. 1.5.4→1.6.4 이력 공백(7절).
6. 프리셋 문구가 번역 결과를 바꿈(한글 전용 줄) — 기존 사용자에게 변경 고지.

## 7. 미확인 구간: 1.5.4 → 1.6.4
`e381e40`은 1.6.4 한 덩어리로 들어와 있고 LV는 1.5.4 기준입니다. 파일 안 `[로컬 수정 1.6.1/1.6.2]` 표식(줄 1690, 2412, 2590, 2751, 2773-2807, 2871-2884, 3356, 3412, 4082-4202, 6019)이 그 사이 변화의 흔적: 문단 번역 일괄 실행(`translateAllMissing`), 막힌 프롬프트(Gemini 등 안전 차단) 문단별 재시도, 스와이프 중 번역을 원래 스와이프에 저장, 누락된 `</segment>` 재시도, 모바일 탭 처리. **LV는 이 중 "스와이프별 번역 보존"(키=내용 해시)과 "막힌 응답 처리 일부"만 구조상 가지고 있을 수 있음 — 코드 대조 필요(1.5.4 소스가 로컬에 없음).** 1.5.4 원본(`github.com/minikkeuen/Marinara-Translation-Tools/releases/tag/1.5.4`)을 받아 1.6.4와 diff하는 작업을 별도 선행 과제로 권장.
