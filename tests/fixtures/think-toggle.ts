import ORIGINAL from '../../src/vendor/tt-1.10.0/personal-extension/extension.js' with { type: 'text' };
import { createSettingsHost, startOriginal } from '../../src/host-emu/boot';
import { startDomBridge } from '../../src/host-emu/dom-bridge';
import { runOriginal } from '../../src/host-emu/runtime';
import { mountLvForm, type LvValues } from '../../src/host-emu/lv-form';
import { DEFAULT_SETTINGS } from '../../src/shared';

// Local fake host and deterministic model: no server or network is needed.
Object.assign(window, {
  setupThinkTest(baseline: boolean, initial = true, keepTags = '', parsed = false) {
    let enabled = initial;
    let config: any = { paragraph: { keepTags }, defaults: {}, chats: {} };
    (window as any).thinkTestKeepTags = () => config.paragraph.keepTags;
    const requests: string[] = [];
    (window as any).thinkTestRequests = requests;
    const tags = ['think', 'thinking', 'reasoning'];
    const thought = tags.map((tag, i) => `<${tag}>Private plan ${i}.</${tag}>`).join('\n\n');
    const body = 'The lamp was still burning.\n\nThe door was open.';
    const content = `${thought}\n\n${body}`;
    const messages = ['on', 'off', 'again'].map((id) => ({ id, chatId: 'chat', role: 'assistant', content, createdAt: new Date().toISOString(), extra: {} as Record<string, unknown>, activeSwipeIndex: 0 }));
    document.body.innerHTML = '<main id="messages"></main><aside id="settings"></aside>';
    for (const msg of messages) {
      const row = document.createElement('div');
      row.dataset.messageId = msg.id;
      row.dataset.component = 'BubbleMessage';
      row.innerHTML = `<div><div data-component="MessageContent">${(parsed ? body : content).split('\n\n').map((p) => `<p>${p}</p>`).join('')}</div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>`;
      document.querySelector('#messages')!.append(row);
    }
    const chat = { id: 'chat', name: 'Test', mode: 'roleplay', characterIds: [], personaId: null, metadata: { translationProvider: 'ai', translationConnectionId: 'connection', translationTargetLang: 'ko', autoTranslate: false } };
    const bridge: any = {
      getChat: async () => chat,
      listMessages: async () => messages,
      getMessage: async (_chat: string, id: string) => messages.find((m) => m.id === id),
      patchExtra: async (_chat: string, id: string, patch: object) => Object.assign(messages.find((m) => m.id === id)!.extra, patch),
      generateRaw: async (req: any) => {
        const text = req.messages.find((m: any) => m.role === 'user')?.content ?? '';
        requests.push(text);
        return { content: [...text.matchAll(/<segment id="(\d+)">/g)].map((m) => `<segment id="${m[1]}">번역 ${m[1]}</segment>`).join('\n') };
      },
      generateActive: async () => false,
      connections: async () => [{ id: 'connection', name: 'Test', model: 'test' }],
      character: async () => null, persona: async () => null,
      lorebooks: async () => [], lorebookEntries: async () => [],
    };
    const storage = {
      get: async () => ({ config, lvExcludeThinking: enabled }),
      patch: async (p: any) => { if (p.config) config = p.config; return { config, lvExcludeThinking: enabled }; },
    };
    document.querySelector('#settings')!.append(createSettingsHost());
    if (baseline) {
      startDomBridge(document);
      // Original directly, with no thinking-storage adapter or LV settings form.
      runOriginal({ source: ORIGINAL, bridge, storage, activeChatId: () => 'chat' });
    } else {
      startOriginal({ bridge, storage, activeChatId: () => 'chat', addStyle: (css) => {
        const style = document.createElement('style'); style.textContent = css; document.head.append(style); return () => style.remove();
      } });
      let values: Omit<LvValues, 'asDefault'> = { ...DEFAULT_SETTINGS, excludeThinking: enabled, voice: { from: '', backupSaved: false, backupPrompt: '', backupEnabled: false } };
      mountLvForm(document.querySelector('#settings')!, {
        state: () => ({ ready: true, chatKey: 'chat', hasChat: true, values, connections: [['connection', 'Test']], connectionNote: { text: '', kind: '' }, linkNote: '', bundles: [] }),
        save: async (v) => { values = v; enabled = v.excludeThinking; },
        editBundle() {}, deleteBundle() {},
      });
    }
    return { content };
  },
});
