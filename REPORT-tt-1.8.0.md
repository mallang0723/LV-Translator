# REPORT — 번역 프리셋·단어장 1.8.0 → LV-Translator 0.4.0

작성 2026-11-15. 브랜치 `wip/translation-tools-1.8.0`(출발 `fix/fetch-diet` `ee29900` = 0.3.6). 업스트림 `tlsiddl/marinara-translation-tools` `807d6a3`(1.8.0).
표기: ✅ 직접 확인(테스트·코드) / ⚠️ 미확인(실제 Lumiverse 7880 QA는 리뷰어 몫).

## 1. 통이식 결과

방식: `scripts/vendor-tt-1.8.0.mjs`가 `git show 807d6a3:personal-extension/extension.js`에서 **함수·상수 이름 앵커로** 조각을 잘라 `src/vendor/tt-1.8.0/*.ts`에 바이트 그대로 넣는다. 조각마다 `// ==== BEGIN VERBATIM … L<시작>-L<끝>, sha256 …` 표지가 붙고, `provenance.json`에 줄 범위·SHA-256이 있다. `tests/vendor.test.ts`가 (a) 파일 안 조각의 SHA와 provenance 일치, (b) 업스트림 클론이 있으면 `git show` 원문과 줄 단위 일치를 확인한다(클론 없이도 (a)는 돈다). 줄 번호는 지도 문서의 것이 어긋나 있어(예: `hashText` 1840→1899, `normalizeNotes` 4779→4782 이후) 앵커 방식으로 다시 구했다.

### 1.1 그대로 복사해서 쓰는 것 (복사 + 연결됨)

| 파일 | 조각(업스트림 줄) | 쓰임 |
|---|---|---|
| `prompts.ts` | 2-647 프롬프트 상수 8개(`GENERAL/LITERARY/BILINGUAL/PARAPHRASE/SOURCE_STYLE/INPUT/REFERENCE_PROMPTS`, `REFERENCE_RENDERERS`) | 프리셋 원문. 647줄 이후 Marinara Engine 게임 스냅샷(AGPL)은 **복사하지 않음** |
| `catalog.ts` | 4472-4477 한도·`CONTEXT_SYSTEM_INSTRUCTIONS`, 4478-4710 `HANGUL_ONLY_RULE`·`BUILTIN/V2/ADDITIONAL_BUILTIN_PRESETS`·`BUILTIN_PRESET_ORDER` | 프리셋 목록(새 3종, 한글 전용 줄). `src/presets/catalog.ts`는 이 파일의 재노출 |
| `assembly.ts` | 4711-4712 옛 대사 지침 표지, 4779-4806 `normalizeNotes`·`newNoteId`, 5122-5127 `escapeContextValue`, 5451-5499 `{{voice}}/{{vocab}}` 매크로·`fillPromptMacros`·`voiceSection`·`GLOSSARY_RULE`, 4917-5008 `parseGlossary`·`glossarySection`·`freeContextSection`·`LIVE_PROMPT_PRESET_IDS`·`personaSection`·`buildSystemPrompt` | `createAssembly(host)` 공장 함수 안(호스트 값은 `currentScope`/`storedConfig`/`paragraph`로 주입). 요청 조립 전부 |
| `helpers.ts` | 1899-1907 `hashText`, 1935-1944 `langScript`, 1954-1965 `normalizeForKey`·`blockKey`, 2276-2278 `stripMarks`, 2335-2353 `PAIRED_QUOTE_RE`·`isPairedDialogue` | 연동 계약의 키, 문단 짝 대사 판정 |
| `sync-source.ts` | 3009-3011 `SYNC_SOURCE_SYSTEM`, 3040-3081 `syncSourceToEdits` | 번역 고치기 → 영어 원문 재작성(원본 함수가 그대로 돈다) |
| `catch-up.ts` | 3900-3929 `catchUpLatest` | 놓친 최신 답변 번역(1.7.2) |
| `example-narration-style.ts` | `기타 지침/지문 문체.txt` 전체 | "예시 넣기" 버튼 |

### 1.2 복사했으나 연결하지 않은 것 / 복사하지 않은 것

- 복사했으나 안 쓰는 부분: `helpers.ts`의 `langScript`는 `isPairedDialogue`용으로만 쓰인다. `catalog.ts`의 `V2_PRESETS` 승격 상태는 쓰지 않는다(LV는 1.5.4 때처럼 v2를 처음부터 모두 보인다).
- **복사하지 않음(말투·단어 자동 수집 스캔)**: `SCAN_GLOSSARY/SPEECH/WORLD`, `scanChat`, `collectMaterial`, 사용 언어 줄 JSON 정제(3030-3300대). 캐릭터·페르소나·로어북 권한(`characters`/`personas`/`world_books`)이 없어서다. TODO: 사용자가 대사 지침에 `- 사용 언어: 영어`를 손으로 쓰면 프리셋이 읽는다(`tests/backend-tt180.test.ts` live preset 테스트가 이 줄이 요청에 실리는지 확인).
- 복사하지 않음(Marinara 전용): `createMarinaraAutomaticTranslation`(fetch 가로채기), React Query 캐시, 설정 마크업, 세그먼트 일괄 번역기(`translateBatch/extractSegments/seal`), 백업, 문단 대조 모달의 재번역 버튼.

### 1.3 어댑터로 바꾼 것 (LV 코드)

`src/adapter/host.ts`(호스트 능력, 꼬리 읽기 상수), `src/adapter/sync-source.ts`(원본 `syncSourceToEdits`를 메모리 기록에 대해 돌리고 쓰기는 한 번으로 모음), `src/adapter/contract.ts`(연동 계약), `src/translate/prompt.ts`(`buildTranslationRequest`가 원본 `buildSystemPrompt`를 부름), `src/translate/edit.ts`(번역 고치기의 문단 짝·기록), `src/translate/engine.ts`(짝 대사 건너뛰기, 페르소나 전달), `src/shared.ts`(Store.notes, TranslationRecord.edited, MessageTranslations.pub), `src/backend.ts`·`src/frontend.ts`·`src/toolbar.ts`·`src/message-ui.ts`, 테스트 헬퍼 `tests/helpers/fake-host.ts`.

## 2. 마커 결정 (⟦n⟧ vs <xN>)

✅ 업스트림의 자체 보호 `seal()`(1969-1987, 원본 줄 번호)도 **`⟦n⟧`** 를 쓴다. `<xN>…</xN>`·`⟪N⟫`은 Marinara 브라우저 DOM의 `serializeUnit`(렌더된 요소를 감싸는 2257-2306)에서만 생긴다. LV는 DOM이 아니라 메시지 원문(마크다운·HTML 소스)을 다루므로 `<xN>`은 생길 일이 없다. 따라서 **`⟦n⟧` 유지 = 업스트림을 따르는 것**이고, 저장된 옛 번역은 마이그레이션이 필요 없다. 프리셋 문구의 `<x1>` 설명은 원문 그대로 두었고 `⟦n⟧`을 쓰는 LV에는 무해하다(해당 줄은 "있으면 그대로"라는 조건문).

## 3. 기능

| 항목 | 상태 | 비고 |
|---|---|---|
| 새 프리셋 3종(한국어 문체: 외국인 대사 병기 2, 모델 병기 유지 지문만 번역) | ✅ | 목록 순서는 원본 따름: 앞 2종은 "채팅 설정 유지" 바로 뒤, 3번째는 순서표에 없어 내장 프리셋 맨 뒤 |
| 한국어 기본 프리셋의 한글 전용 줄 | ✅ | 1.5.4 프리셋 16개가 `{{voice}}/{{vocab}}`와 이 줄만 빼면 1.5.4 원문과 SHA-256 일치(`tests/presets.test.ts`) |
| `{{voice}}`·`{{vocab}}` 자리 | ✅ | **지도에 없던 사실**: 1.8.0 프롬프트는 대사 지침·단어장 자리를 프롬프트 안에 가진다. 기본 프롬프트(`base`)도 `{{vocab}}`를 가져 단어장이 이제 사용자 메시지가 아니라 시스템 프롬프트에 들어간다(원본의 `usesVocab`). 자리 없는 프롬프트(내 프리셋)는 전과 같음 |
| 기타 지침을 문체 지침으로(라이브 프리셋 3종) | ✅ | `# User Translation Style Instructions`, 이스케이프 없음 |
| 페르소나 이름 | ✅(권한 없이) | 라이브 프리셋일 때 가장 가까운 이전 user 메시지의 `name`. 원본은 채팅의 personaId → personas.get. ⚠️ 실제 Lumiverse에서 user 메시지 `name`이 페르소나 이름인지 라이브 확인 필요 |
| 기타 지침 보관함 | ✅ | `Store.notes`, 불러오기=복사(초안에 넣고 저장 버튼으로 적용: LV 설정 화면 규칙), 같은 이름 덮어쓰기 확인, 삭제해도 이미 불러온 채팅 불변. 기존 "번역 지침 묶음"(참조)과 UI 문구로 구분. **원본 한도를 그대로 상속: 100개/이름 60자/본문 12,000자 — 넘으면 자르지 않고 거절**(원본 `normalizeNotes`는 조용히 자름). 소유자가 한도를 정할 것 |
| 기타 지침 예시 | ✅ | 원본 `지문 문체.txt`를 그대로(SHA 고정), "예시 넣기"는 뒤에 이어 붙임 |
| 번역 고치기 + 영어 원문 재작성 | ✅ 로직 / ⚠️ UI | 툴바 연필 → 모달(문단별 원문·textarea·"직접 고침" 표지). 원본 `syncSourceToEdits`가 그대로 돌고 저장은 `updateMessage` **1회**(content + ownMetadata/metadata, 테스트가 호출 횟수 1을 단언). 모달·툴바 DOM은 단위 테스트가 없다 |
| 짝 대사 문단 건너뜀 | ✅ | 문단 단위 번역 + 한국어 도착일 때만(원본 `unitKind`와 같은 조건), `isPairedDialogue` 원본 |
| 1.7.1 끝 신호 없이 끊긴 생성 | ✅ 해당 없음 + 보완 | LV 자동 번역은 서버 `GENERATION_ENDED`가 일으키므로 브라우저 스트림 끊김과 무관. 사용자 Stop(`GENERATION_STOPPED`)은 번역하지 않음을 테스트로 고정 |
| 1.7.2 놓친 최신 답변 | ✅ | 원본 `catchUpLatest` 그대로. 채팅을 열 때·화면 복귀 때(`hint.open`) 트리거. 판단용 읽기는 스냅샷 → `tail:4, light:true` → (없으면) 첫 전체 로드 1회 |
| 사용자 Stop 답변 제외 | ✅ | 원본에는 없는 보완: `GENERATION_STOPPED`의 부분 내용 해시를 기억해 catch-up이 건드리지 않는다(테스트) |

## 4. 호스트 능력 `chat-lean-messages-v1` (근거)

- 능력 이름 정의: `~/Lumiverse/node_modules/lumiverse-spindle-types/dist/host.js:13` (`chat-lean-messages-v1`), `:8` `chat-metadata-patch-v1`, `:6` `chat-conditional-metadata-v1`. 호스트가 이 값들을 광고: `~/Lumiverse/src/spindle/worker-host.ts:1382`(`...SPINDLE_HOST_CAPABILITIES`).
- 읽기 옵션: `worker-host.ts:160-185`(검증), `:4064-4090`(`tail`/`limit`/`light`/`ownMetadataOnly` 처리). 쓰기 `ownMetadata`: `:4269-4281`. 문서 `developer-docs/docs/backend-api/chat-mutation.md:160-181`.
- 사용: `src/adapter/host.ts`. 번역 작업 시작의 새로고침이 `tail:12`(전체 swipes 유지, `light` 아님, `ownMetadataOnly` 안 씀)이고 대상 메시지가 꼬리 안에 없으면 전체 새로고침으로 되돌아간다. 쓰기는 능력이 있을 때만 `ownMetadata`(없는 호스트는 미지의 키를 **조용히 무시**하므로 엄격히 게이트), 없으면 기존처럼 `metadata` 전체 덮어쓰기. 판단용 `light` 읽기 행은 스냅샷에 합치지 않는다(비활성 swipe가 null이라 덮어쓰면 망가짐).
- ✅ 첫 로드(채팅 전체 1회)·화면 범위 뷰·진행 저장 합치기 등 0.3.6의 전체 조회 규칙은 그대로이고, 능력이 있으면 작업마다의 전체 새로고침이 꼬리 1회로 바뀐다(`tests/backend-lean.test.ts`: 전체 읽기 0, 꼬리 읽기 1, 능력 없는 호스트는 전과 동일, 꼬리 밖 메시지는 전체 새로고침).
- `lumiverse-spindle-types`는 0.6.59 그대로(타입에 옵션이 없어 호출부에서 캐스팅). 0.6.79로 올리지 않았다.

## 5. 연동 계약 (번역 쪽만 구현. 기억 서재 쪽은 다른 에이전트)

핸드셰이크: rpcPool `st_translator.contract`(정책 `{ requires: [] }`로 게시: 정책이 없으면 호스트가 읽는 쪽에 **이 확장의 모든 권한**(`generation`, `chat_mutation`, `chats`)을 요구한다 — `~/Lumiverse/src/spindle/shared-rpc-pool.service.ts:155-185`) = `{ name:'lv-tx', v:1, ext:'st_translator', version:'0.4.0', provides:['pub-translation@1','glossary@1'] }`. 상대 `anon_memory_lv.contract`(`src/adapter/contract.ts`의 `PEER_ID` 한 곳)를 20초 캐시로 읽고 `name==='lv-tx' && v===1`이면 `ok`, 읽기가 던지면 `none`(설치 안 됨), 그 외 `incompatible`(설정 화면에 한 줄). **기억 서재 쪽에 필요한 것:** `rpcPool.sync('contract', {...}, { requires: [] })`로 게시해야 한다. 정책이 없으면 읽는 쪽(이 확장)이 상대의 모든 권한을 가져야 읽을 수 있고, 거부되면 `peerState`가 `none`이 되어 `pub`·단어장이 조용히 꺼진다(호스트의 "requires" 거부 메시지는 경고 로그 1회로 남긴다). 설치 감지 이벤트 구독은 하지 않았다(⚠️ `EXTENSION_LOADED`가 확장에게 오는지 확인 못 함 → TTL로 대신).

메시지 `metadata.st_translator.pub`(상대가 있고 `ok`일 때만, 끝난 번역(`status:'done'`)만):
```
pub: { v:1, h:"<FNV-1a32 base36 of message.content, 저장된 그대로>", lang:"ko", text:"<⟦n⟧ 복원 후 번역 전문>",
       paras?: { "<blockKey(문단)>": "<번역>" }, edited?: { "<key>": 1 }, at: <ms> }
```
- `h`는 LV의 `sourceHash`와 **다른 함수**(업스트림 `hashText`). 시험 벡터(UTF-16 코드 유닛 기준, 파이썬으로 따로 계산): `""→ztntfp`, `"a"→1r9wi7g`, `"The lamp was still burning."→1sdhh2c`, `"등불은 아직 타고 있었다."→1log4n5`, `"Hi 👋"→aa3t2`.
- `paras` 키 = `hashText(normalizeForKey(문단))`(따옴표 정규화, `*_~\`#>` 제거, 공백 정리). **문단 단위 기록일 때만** 넣고(복원한 원문 문단 기준), 400개 초과 시 앞 문단부터 버린다. `edited`는 손으로 고친 문단.
- `writeTranslations`(모든 쓰기의 단일 관문)에서 **쓰는 시점의 `message.content` 기준**으로 계산하므로 `generatedContent`가 보이지 않는 swipe여도 어긋나지 않는다. 번역 삭제는 같은 쓰기에서 `pub`을 지운다. 번역 고치기는 한 번의 `updateMessage`에 새 `content`와 새 `pub.h`가 함께 실린다.
- 스와이프·수정 이벤트 후: `pub.h`가 현재 내용과 다르면 교체/삭제, `pub`이 없는데 현재 내용의 끝난 번역이 있으면 새로 투영. 새 쓰기가 만든 이벤트는 `pub.h`가 일치해 거기서 멈춘다(루프 없음, 테스트: 스와이프 왕복에서 쓰기 1회씩).
- 기억 서재가 없거나 끝난 번역이 아니면 `pub`을 쓰지 않고, 있던 `pub`은 같은 쓰기에서 **지운다**(같은 해시 밑에 옛 `text`가 남지 않게). 기억 서재가 다시 보이면 `refreshPub`이 다음 이벤트에서 되살린다(맵 §4.2.7). 과거 메시지의 일괄 재기록·요청 시 투영은 만들지 않았다.

채팅 `chat.metadata.st_translator = { v:1, glossary:{ text, hash, at } }`: 상대가 `ok` + 호스트 `chat-conditional-metadata-v1` + `chats` 권한이 모두 있을 때만, `chats.get` → `compareAndSetMetadata({expected_metadata, metadata})`(다른 키 보존, 1회 재시도). 단어장 저장(`save_settings`)과 채팅 열기(`hint.open`, 해시 같으면 쓰기 없음) 때. `text`는 묶음까지 합친 유효 단어장을 `왼쪽 = 오른쪽` 한 줄씩 정리한 것(**방향은 사용자가 쓴 그대로, 순서 없는 쌍**: LV 입력칸은 `내 언어 용어 = 모델 언어 용어`이고 원본 단어장도 양방향 `A = B`이므로 기억 서재도 순서 없는 쌍으로 읽어야 한다), `hash = hashText(text)`. 비어 있고 전에 공개한 적이 없으면 쓰지 않는다. 실패는 조용히 무시(경고 로그 1회).
권한: `spindle.json`에 `chats` 추가(재승인). 지도의 판단과 같다. 단어장 공개를 원치 않는 사용자가 `chats`를 거부해도 번역은 정상.

## 6. 테스트

`bun test` 288개 통과(0.3.6 시작 235 → 이번 +53), 타입 검사·빌드 통과. 주요 신규: `vendor.test.ts`(조각 SHA·원본 일치), `presets.test.ts`(1.5.4 해시와 1.8.0 차이는 매크로·한글 줄뿐), `prompt.test.ts`(24 요청 + 바뀐 7건은 줄 묶음 비교로 내용 보존 확인), `tt180-helpers.test.ts`(짝 대사 원본 판정 5건, `hashText` 벡터, 노트, 요청 조립), `backend-lean.test.ts`, `backend-tt180.test.ts`(번역 고치기 6건, 노트, catch-up, 짝 대사, 페르소나), `backend-contract.test.ts`(핸드셰이크, pub, 단어장, 열화 경로).
요청 24건 중 7건이 1.5.4와 달라졌고(`tests/fixtures/upstream-requests-1.8.0.json`, 1.5.4 값은 `expected154`로 보관) 이유는 전부 ① 기본 프롬프트의 `{{vocab}}`로 단어장이 시스템 프롬프트로 이동 ② `{{voice}}` 자리 ③ 한글 전용 줄이며, 줄 집합 비교로 그 외 변화가 없음을 검증한다. 1.5.4에서 "채팅 설정 유지 + 빈 프롬프트 + 대사 지침"일 때 지시문이 빠지던 버그는 1.8.0에서 사라져 이전의 보정 코드를 지웠다.

## 7. 확인하지 못한 것 (실제 Lumiverse 7880 QA는 리뷰어)

1. ⚠️ 번역 고치기 모달·연필 버튼·보관함 UI·연동 안내 줄의 실제 화면(360px 포함). 코드는 타입 검사만 통과.
2. ⚠️ `updateMessage({content})`가 활성 swipe 슬롯을 덮어쓰는 것(타입 주석 근거)과, 고친 뒤 호스트가 보내는 `MESSAGE_EDITED`가 `extra.spindle_metadata`에 새 `pub`을 싣는 것(가짜 호스트로만 확인).
3. ⚠️ user 메시지 `name`이 페르소나 이름인지.
4. ⚠️ catch-up의 시각: 메시지 `created_at`/`swipe_dates`(초 단위로 가정, 소스 `chats.service.ts:2640` 근거)와 `GENERATION_STARTED/STOPPED`가 확장에게 오는 것.
5. ⚠️ 구형 호스트가 `ownMetadata`·`tail`을 무시한다는 문서 서술(우리는 능력 게이트로 호출 자체를 피한다).
6. ⚠️ 두 확장이 서로 다른 사용자 범위일 때 rpcPool 가시성, 분기(CHAT_FORKED) 때 메타데이터 복사 여부(지도 §4 ⚠️ 그대로).
7. 프런트 번들이 101KB → 140KB(`shared.ts`가 노트 정규화를 위해 원본 조립 코드를 끌어옴). 줄이려면 노트 정규화를 백엔드로만 한정.
8. 1.5.4→1.6.4 이력 공백(지도 §7)은 이번에도 메우지 않았다. 다만 1.8.0 프롬프트·조립은 원본을 직접 복사했으므로 그 사이 변화(매크로 등)는 이번에 반영된 셈이다.
9. 번역 고치기에는 영어 원문을 되돌리는 기능이 없다(원본과 같음). 소유자 판단 필요: 되돌리기 보관(`prevSource`).
10. 이번 1.8.0 `expected` 값은 **내 빌드의 출력을 기록한 것**이다. 업스트림의 Playwright 테스트(`tests/test.js` 등)는 실행하지 못했다(브라우저 없음). 대신 1.5.4 값과의 줄 집합 비교, 프리셋 해시, 원본 조각 SHA로 막았다.
11. 나가는 번역(outgoing)에서 라이브 프리셋 판정(기타 지침을 문체 지침으로 쓸지)은 **나가는 프리셋 id**를 본다. 원본은 채팅의 incoming 프리셋 id를 본다. 의도적 어긋남(한국어 문체 프리셋이 영어로 나가는 번역의 기타 지침을 문체 지침으로 바꾸지 않게).
12. 짝 대사는 원본 `unitKind`의 절반(`isPairedDialogue`)만 옮겼다. 글자 비율(`scriptRatio ≥ 0.3`이면 이미 도착 언어) 절반은 LV에 없는 동작이라 옮기지 않았다. §3의 "같은 조건"은 이 절반에 한한 말이다.
13. Stop 제외는 `GENERATION_STOPPED.content`가 저장된 메시지 내용과 같다는 가정에 기댄다(`message-generation.ts:184-190`은 저장 메시지의 content를 싣는다).
14. 말투·단어 자동 수집 스캔 코드는 **복사하지 않았다**(권한 문제와 소유자 결정). 위치는 코드의 `TODO(tt-1.8.0 scan)`와 §1.2에 적었다. 소유자 규칙에는 "스캔 구간도 복사 대상"이라 적혀 있어 판단이 갈릴 수 있다.
15. 지도 문서 `docs/translation-tools-1.8.0-map.md`(커밋 전 untracked였음)를 첫 커밋에 함께 넣었다. push 전에 둘지 정해 달라.
16. 짝 대사 건너뜀이 `⟦n⟧`로 보호된 문단에서 원본과 같은 결과를 내는지는 소수 케이스만 확인했다.
