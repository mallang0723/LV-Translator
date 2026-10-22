# Third-party notices

This repository is licensed under the MIT License (see `LICENSE`, Copyright (c) 2026 mallang0723). The parts listed below keep their own copyright and license.

## Marinara-Translation-Tools 1.5.4

`src/presets/upstream/*` and `src/presets/catalog.ts` are copied verbatim, and `src/translate/prompt.ts` ports the request-building logic, from
[minikkeuen/Marinara-Translation-Tools](https://github.com/minikkeuen/Marinara-Translation-Tools) 1.5.4 (`extension.js`, `prompts/*.js`). `src/presets/upstream/prompt-fingerprints.json` is the upstream `tests/prompt-fingerprints.json`.

```
MIT License

Copyright (c) 2026 minikkuen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Marinara Engine

[Pasta-Devs/Marinara-Engine](https://github.com/Pasta-Devs/Marinara-Engine), licensed under the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html). This extension follows the behaviour of its chat translation feature and reuses two short pieces of its text:

- The default translation prompt sentence ("You are a translator. Translate the given text accurately into {{targetLanguage}}, …"), used as `BASE_PROMPT` from `src/presets/upstream/general.ts`. The same sentence is also part of Marinara-Translation-Tools 1.5.4 `prompts/general.js` (MIT, above), from which that file is copied.
- The user message wording "Translate the following text to <language>:" in `src/translate/prompt.ts`.

## Paragraph Reader 0.2.0

The paragraph split, the no-text paragraph check, the HTML block grouping (`src/translate/paragraphs.ts`) and the paragraph view design come from Paragraph Reader 0.2.0, written by the owner of this repository.
