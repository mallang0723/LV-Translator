import { expect, test } from 'bun:test';
import { withHost } from './helpers/fake-host';
import { normalizeStore } from '../src/shared';
import { BUNDLE_EDIT_NOTE, planRoomVoice } from '../src/bundles';

const base = normalizeStore(null).defaults;
const bundle = { id: 'b', name: 'B', glossary: '', freeContext: '', incomingVoicePrompt: 'old voice' };
const room = { ...base, bundleId: 'b', voiceFrom: 'b', voiceBackupSaved: true, voiceBackupPrompt: 'mine', voiceBackupEnabled: false };
const tt = (value: string, enabled = true) => ({ config: { chats: { a: { incomingVoicePrompt: value, incomingVoiceEnabled: enabled, glossary: 'g' }, c: { incomingVoicePrompt: 'other', incomingVoiceEnabled: false } } } });
const setup = (value = 'old voice') => ({ store: { userBundles: [bundle], chats: { a: room, c: { ...base } } }, ttConfig: tt(value) });
const edit = (h: any, incomingVoicePrompt: string) => h.send({ type: 'save_bundle', bundle: { ...bundle, incomingVoicePrompt } });
const voiceOf = (h: any) => {
  const r = h.store().chats.a;
  return { from: r.voiceFrom, backupSaved: r.voiceBackupSaved, backupPrompt: r.voiceBackupPrompt, backupEnabled: r.voiceBackupEnabled };
};

test('editing the bundle writes the new 대사 지침 into the room\'s own scope in tt-config, keeping the saved original', async () => {
  await withHost(setup(), async (h) => {
    await edit(h, 'new voice');
    expect(h.ttConfig().config.chats.a).toMatchObject({ incomingVoicePrompt: 'new voice', incomingVoiceEnabled: true, glossary: 'g' });
    expect(h.ttConfig().config.chats.c).toMatchObject({ incomingVoicePrompt: 'other', incomingVoiceEnabled: false });
    expect(voiceOf(h)).toMatchObject({ backupSaved: true, backupPrompt: 'mine', backupEnabled: false });
  });
});

test('a room whose text was hand edited keeps it when the bundle changes', async () => {
  await withHost(setup('hand edit'), async (h) => {
    await edit(h, 'new voice');
    expect(h.ttConfig().config.chats.a.incomingVoicePrompt).toBe('hand edit');
    expect(voiceOf(h)).toMatchObject({ backupSaved: true, backupPrompt: 'mine' });
  });
});

test('emptying the bundle prompt restores the original value; 없음 afterwards leaves it intact', async () => {
  await withHost(setup(), async (h) => {
    await edit(h, '');
    expect(h.ttConfig().config.chats.a).toMatchObject({ incomingVoicePrompt: 'mine', incomingVoiceEnabled: false });
    const plan = planRoomVoice('', h.store().userBundles, { prompt: 'mine', enabled: false }, voiceOf(h));
    expect(plan).toMatchObject({ prompt: 'mine', enabled: false });
  });
});

test('emptying with a hand edited room keeps the backup, so 없음 still restores the original value', async () => {
  await withHost(setup('hand edit'), async (h) => {
    await edit(h, '');
    expect(h.ttConfig().config.chats.a.incomingVoicePrompt).toBe('hand edit');
    expect(voiceOf(h)).toMatchObject({ backupSaved: true, backupPrompt: 'mine' });
    const plan = planRoomVoice('', h.store().userBundles, { prompt: 'hand edit', enabled: true }, voiceOf(h));
    expect(plan).toMatchObject({ prompt: 'mine', enabled: false, restored: true });
  });
});

test('an open original form that still holds the old text cannot undo the edit when it saves', async () => {
  await withHost(setup(), async (h) => {
    await edit(h, 'new voice');
    await h.send({ type: 'emu', id: 'p', op: 'storage.patch', args: [{ config: tt('old voice').config }] });
    expect(h.ttConfig().config.chats.a.incomingVoicePrompt).toBe('new voice');
    // a later hand edit through the form is not touched
    await h.send({ type: 'emu', id: 'q', op: 'storage.patch', args: [{ config: tt('typed later').config }] });
    expect(h.ttConfig().config.chats.a.incomingVoicePrompt).toBe('typed later');
  });
});

test('what the original reads when it starts (storage.get) carries the edited text at once; the dialog says a reload is needed for an open screen', async () => {
  await withHost(setup(), async (h) => {
    await edit(h, 'new voice');
    await h.send({ type: 'emu', id: 'g', op: 'storage.get', args: [] });
    const reply = h.sent.findLast((m: any) => m.type === 'emu_result' && m.id === 'g');
    expect(reply.data.config.chats.a).toMatchObject({ incomingVoicePrompt: 'new voice', incomingVoiceEnabled: true });
  });
  expect(BUNDLE_EDIT_NOTE).toContain('새로고침');
  expect(BUNDLE_EDIT_NOTE).toContain('대사 지침');
});
