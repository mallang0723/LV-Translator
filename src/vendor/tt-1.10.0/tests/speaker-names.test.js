// Node-only checks for translating English speaker names (no browser). The helpers are cut out of extension.js:
// 1) the glossary lookup works from either side of "A = B"
// 2) names in `Name | "line"` labels and in the status lines under a §RP line are swapped; nothing else in the paragraph changes
// 3) a name the glossary lacks is reported as missing and the paragraph is left as it was
// 4) Korean names, narration, and status-looking lines outside a §RP block are left alone
// 5) the keep-dialogue preset tells the translator to translate the label and status names
// Run: node tests/speaker-names.test.js personal-extension/extension.js
const fs = require("fs");
const file = process.argv[2];
const code = fs.readFileSync(file, "utf8");
const cut = (from, to) => {
  const a = code.indexOf(from);
  const b = code.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`source markers not found: ${from} … ${to}`);
  return code.slice(a, b);
};

let failed = 0;
const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !extra ? "" : ` — ${extra}`}`); if (!ok) failed++; };

const { labelLookup, relabelNames } = new Function(`
${cut("  const LATIN_NAME_RE", "  // Dialogue the chat model already wrote as")}
  return { labelLookup, relabelNames };`)();

const lookup = labelLookup("Minerva McGonagall = 미네르바 맥고나걸\n마거릿 = Margaret\nHogwarts = 호그와트\nbad line\n= 빈 왼쪽");
check("lookup maps English to Korean from the left side", lookup.get("minerva mcgonagall") === "미네르바 맥고나걸");
check("lookup maps English to Korean from the right side", lookup.get("margaret") === "마거릿");

const dialogue = 'Minerva McGonagall | "You must be Miss Vane." (당신이 베인 양이군요.)';
const d = relabelNames(dialogue, lookup);
check("dialogue label name is swapped, the line is untouched", d.text === '미네르바 맥고나걸 | "You must be Miss Vane." (당신이 베인 양이군요.)' && d.found === 1 && !d.missing.length);

const block = [
  "§RP | 1988-07-24 (일) | 10:15 | 리버풀 | 흐림§",
  "Margaret: 흑백 메이드복 | 문밖으로 물러남 | (⊙_⊙;)",
  "Minerva McGonagall: 초록색 드레스 | 이리나 앞에 서서 손을 모음 | (￣^￣)ゞ",
  "이리나: 검은색 스커트 | 편지를 들고 서 있음",
].join("\n");
const s = relabelNames(block, lookup);
check("status line names are swapped, the §RP line and the rest stay",
  s.text === block.replace("Margaret:", "마거릿:").replace("Minerva McGonagall:", "미네르바 맥고나걸:") && s.found === 2 && !s.missing.length, s.text);

const unknown = relabelNames('Albus Dumbledore | "Ah, Minerva." (아, 미네르바.)\nMinerva McGonagall | "Albus." (알버스.)', lookup);
check("a name the glossary lacks is reported missing", unknown.found === 2 && unknown.missing.join() === "Albus Dumbledore");
check("the paragraph is not half-swapped in the report's source text", unknown.text.includes("미네르바 맥고나걸 |") && unknown.text.includes("Albus Dumbledore |"));

check("Korean label names are left alone", relabelNames('이리나 | "안녕." (hello.)', lookup).found === 0);
check("narration with a colon or bar is left alone", relabelNames("Margaret: she said | quietly.\nShe nodded.", lookup).found === 0);
check("a status-looking line outside a §RP block is left alone", relabelNames("Margaret: 흑백 메이드복 | 서 있음", lookup).found === 0);
check("a blank line ends the status block", relabelNames("§RP | a | b§\n\nMargaret: 복장 | 자세", lookup).found === 0);
check("an inline marker before the name is not treated as a label", relabelNames('<x1>Minerva McGonagall</x1> | "Hi." (안녕.)', lookup).found === 0);

// ---- 5. preset text ----
const preset = cut('id: "builtin-korean-style-keep-model-dialogue"', "replace: true");
check("preset: label names are translated, not kept", preset.includes("Speaker names") && !preset.includes('speaker labels such as "Name |"'));
check("preset: status lines under the §RP line are covered", preset.includes("status block under the §RP line") && preset.includes("except the names in its status lines"));
check("preset: the dialogue line itself stays untouched", preset.includes("the label name aside"));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
