// The only file that talks to SillyTavern's internals. Everything Mundi creates is a native ST object:
// personas, character cards, lorebooks, group chats. Generation, swipes, editing, streaming, TTS and
// expressions all stay SillyTavern's own; Mundi only drives them.
// (Paths are relative to dist/st/bridge.js inside public/scripts/extensions/third-party/Mundi.)
// @ts-ignore
import { getContext } from '../../../../../st-context.js';
import { safeUrl, scriptText } from '../core/safe.js';
// @ts-ignore
import { getCurrentChatId, deleteMessage, updateMessageBlock, saveChatDebounced, getCharacters, setUserName, printCharacters, doNewChat, processDroppedFiles, deleteCharacterChatByName } from '../../../../../../script.js';
// @ts-ignore
import { groups, selected_group, openGroupById, openGroupChat, editGroup, getGroups, createNewGroupChat, getGroupPastChats, deleteGroupChat as stDeleteGroupChat } from '../../../../../group-chats.js';
// @ts-ignore
import { convertSoloToGroupChat } from '../../../../../bookmarks.js';
// @ts-ignore
import { user_avatar, setUserAvatar, initPersona, setPersonaLockState, getUserAvatars } from '../../../../../personas.js';
// @ts-ignore
import { power_user } from '../../../../../power-user.js';
// @ts-ignore
import { tags, tag_map, addTagsToEntity, removeTagFromEntity } from '../../../../../tags.js';
// @ts-ignore
import { createNewWorldInfo, deleteWorldInfo, saveWorldInfo, loadWorldInfo, createWorldInfoEntry, updateWorldInfoList, world_names, METADATA_KEY, selected_world_info, world_info, importWorldInfo } from '../../../../../world-info.js';

export const ctx = (): any => getContext();
const headers = (json = true) => ctx().getRequestHeaders(json ? undefined : { omitContentType: true });

/* ---------- characters ---------- */

export const characters = (): any[] => (ctx().characters ?? []).filter((c: any) => c?.avatar);
export const charOf = (avatar: string) => characters().find(c => c.avatar === avatar) ?? null;
export const nameOf = (avatar: string) => charOf(avatar)?.name ?? '?';
// Pictures at their original resolution (default), or SillyTavern's small thumbnails when chosen in Settings (faster).
const fullPics = () => (ctx().extensionSettings?.mundi?.ui?.picQuality ?? 'full') !== 'thumb';
const fullQ = () => (picVersion ? `?v=${picVersion}` : '');
// The tutorial's guide is not a SillyTavern character: her pictures come with the extension.
const tutPic = (avatar: string, face: boolean) => new URL(`../../assets/tutorial/${avatar.slice(6)}${face ? '-face' : '-portrait'}.png`, import.meta.url).href;
export const thumb = (avatar: string) => avatar?.startsWith('__tut:') ? tutPic(avatar, true) : (fullPics() ? `/characters/${encodeURIComponent(avatar)}${fullQ()}` : `${ctx().getThumbnailUrl('avatar', avatar)}${picQuery()}`);
export const avatarUrl = (avatar: string) => (avatar?.startsWith('__tut:') ? tutPic(avatar, false) : `/characters/${encodeURIComponent(avatar)}`);
export const me = () => ctx().name1 || 'You';

export interface NewCard {
    name: string; description: string; first_mes?: string; personality?: string; scenario?: string;
    tags?: string[]; extensions?: Record<string, unknown>; file?: string;
}

// Creates a character card through SillyTavern's own endpoint and returns its avatar file name.
export async function createCharacter(card: NewCard, avatar?: Blob): Promise<string> {
    const form = new FormData();
    form.append('ch_name', card.name);
    form.append('description', card.description ?? '');
    form.append('personality', card.personality ?? '');
    form.append('scenario', card.scenario ?? '');
    form.append('first_mes', card.first_mes ?? '');
    form.append('mes_example', '');
    form.append('creator', 'Mundi');
    form.append('creator_notes', 'Created by Mundi.');
    form.append('tags', (card.tags ?? []).join(','));
    form.append('talkativeness', '0.5');
    form.append('fav', 'false');
    if (card.file) form.append('file_name', card.file);
    if (card.extensions) form.append('extensions', JSON.stringify(card.extensions));
    if (avatar) form.append('avatar', avatar, `${card.file ?? 'avatar'}.png`);
    const res = await fetch('/api/characters/create', { method: 'POST', headers: headers(false), body: form });
    if (!res.ok) throw new Error(`Could not create ${card.name}.`);
    const file = (await res.text()).trim();
    await getCharacters();
    return file;
}

/* ---------- personas ---------- */

export const persona = () => String(user_avatar ?? '');
// In the tour you play Seraphina (her picture comes with the extension, in case she was deleted from SillyTavern).
const tutMe = () => (globalThis as any).__mundiTutPersona as { name: string; pic: string } | undefined;
export const personaName = (file = persona()) => tutMe()?.name ?? String(power_user.personas?.[file] ?? me());
export const personaThumb = (file = persona()) => tutMe()?.pic ?? (!file ? '' : fullPics() ? `/User Avatars/${encodeURIComponent(file)}${fullQ()}` : `/thumbnail?type=persona&file=${encodeURIComponent(file)}${picQuery()}`);

// Uploads the avatar and registers the persona with SillyTavern's own initPersona.
export async function createPersona(name: string, description: string, image: Blob): Promise<string> {
    const wanted = `mundi-${Date.now()}.png`;
    const form = new FormData();
    form.append('avatar', image, wanted);
    form.append('overwrite_name', wanted);
    const res = await fetch('/api/avatars/upload', { method: 'POST', headers: headers(false), body: form, cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not upload the portrait.');
    let file = wanted;
    try { const j = await res.json(); if (j?.path) file = j.path; } catch { /* keeps the requested name */ }
    power_user.personas ??= {};
    power_user.persona_descriptions ??= {};
    await initPersona(file, name, description, '');
    return file;
}

// Selects the persona and locks it to the open chat, so the save always opens with its own Pilot.
export async function usePersona(file: string) {
    if (!file) return;
    if (persona() !== file) await setUserAvatar(file, { toastPersonaNameChange: false });
    try { await setPersonaLockState(true, 'chat'); } catch (e) { console.warn('[Mundi] persona lock', e); }
}

/* ---------- scenario: a plain chat with one character ---------- */

// The character of the open one-on-one chat (none in a group chat).
export function currentCharacter(): any | null {
    const c = ctx();
    if (c.groupId || selected_group) return null;
    const id = c.characterId;
    return id !== undefined && id !== null && id !== '' ? c.characters?.[Number(id)] ?? null : null;
}
// Opens the chat with a character (her latest chat, or a new one), like clicking her in SillyTavern's list.
export async function openCharacter(avatar: string, fresh = false) {
    const i = (ctx().characters ?? []).findIndex((c: any) => c?.avatar === avatar);
    if (i < 0) throw new Error('Character not found.');
    if (String(ctx().characterId) !== String(i) || selected_group) await ctx().selectCharacterById(String(i));
    // a new chat only when the open one has already been played (opening a character without chats already starts one)
    if (fresh && chat().some((m: any) => m.is_user)) await doNewChat({ deleteCurrentChat: false });
}

// Starts the open chat with one of the card's greetings (0 = the first, then the alternate ones).
export function useGreeting(k: number) {
    const m = chat()[0];
    if (!m || m.is_user || !Array.isArray(m.swipes) || !m.swipes[k]) return;
    m.swipe_id = k; m.mes = m.swipes[k];
    updateMessageBlock(0, m); saveChatDebounced();
}

// A scenario is any chat that is not a Mundi game: one character, or a group made from it.
// (A one-on-one chat with a world attached is a game, not a scenario.)
export const scenarioGroup = () => (selected_group && !ctx().chatMetadata?.mundi ? groupOf(selected_group) : null);
export const scenarioOpen = () => !!((currentCharacter() && !ctx().chatMetadata?.mundi) || scenarioGroup());
export function scenarioCast(): string[] {
    const c = currentCharacter();
    if (c) return [c.avatar];
    const g = scenarioGroup();
    return g ? (g.members ?? []).filter((a: string) => !(g.disabled_members ?? []).includes(a)) : [];
}
export const scenarioTitle = () => currentCharacter()?.name ?? scenarioGroup()?.name ?? '';
// Adds a character: a one-on-one chat becomes a group first (SillyTavern's own "convert to group", which asks to confirm).
export async function addToScenario(avatar: string): Promise<boolean> {
    if (!selected_group) {
        await convertSoloToGroupChat();
        if (!selected_group) return false;
    }
    const g = groupOf(selected_group);
    if (!g) return false;
    if (!g.members.includes(avatar)) { g.members.push(avatar); await editGroup(g.id, true, false); }
    return true;
}
export async function removeFromScenario(avatar: string) {
    const g = scenarioGroup();
    if (!g || g.members.length <= 1) return;
    g.members = g.members.filter((a: string) => a !== avatar);
    await editGroup(g.id, true, false);
}
// The chat's own background (SillyTavern's "lock background to this chat").
export function setChatBackground(file: string) {
    const url = file.includes('/') ? `url("${safeUrl(file)}")` : `url("backgrounds/${encodeURIComponent(file)}")`;   // a Mundi picture: its path
    ctx().chatMetadata['custom_background'] = url;
    ctx().saveMetadataDebounced();
    const bg = document.getElementById('bg1');
    if (bg) bg.style.backgroundImage = url;
}
// Every SillyTavern chat (one-on-one and group), newest first: they all open in Mundi as scenarios.
export interface StChat { avatar?: string; group?: string; chatId: string; last: number; count: number; preview: string }
export async function recentChats(max = 300): Promise<StChat[]> {
    const res = await fetch('/api/chats/recent', { method: 'POST', headers: headers(), body: JSON.stringify({ max }), cache: 'no-cache' });
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map((c: any) => ({
        avatar: c.avatar || undefined, group: c.group || undefined, chatId: String(c.file_name ?? '').replace(/\.jsonl$/, ''),
        last: Number(c.last_mes) || Date.parse(c.last_mes) || 0, count: Number(c.chat_items ?? 0), preview: String(c.mes ?? ''),
    })).filter((c: StChat) => c.chatId && (c.avatar ? charOf(c.avatar) : groupOf(c.group!)));
}
// Opens one chat (of a character or of a group), like SillyTavern's own "recent chats".
export async function openChat(c: { avatar?: string; group?: string; chatId: string }) {
    if (c.group) {
        if (selected_group !== c.group) await openGroupById(c.group);
        if (String(getCurrentChatId()) !== c.chatId) await openGroupChat(c.group, c.chatId);
        return;
    }
    await openCharacter(c.avatar!);
    if (String(getCurrentChatId()) !== c.chatId) await ctx().openCharacterChat(c.chatId);
}
// What is open right now, to "Continue" it later.
export function openChatRef(): { avatar?: string; group?: string; chatId: string } | null {
    const chatId = currentChatId();
    if (!chatId) return null;
    if (selected_group) return { group: String(selected_group), chatId };
    const c = currentCharacter();
    return c ? { avatar: c.avatar, chatId } : null;
}

// Deletes a scenario chat (of a character or of a group that is not a Mundi game).
export async function deleteScenarioChat(c: { avatar?: string; group?: string; chatId: string }) {
    if (c.chatId === currentChatId()) throw new Error('This chat is open right now. Open another one first.');
    if (c.group) { await stDeleteGroupChat(c.group, c.chatId, { jumpToNewChat: false }); return; }
    const i = (ctx().characters ?? []).findIndex((x: any) => x?.avatar === c.avatar);
    if (i < 0) throw new Error('Character not found.');
    await deleteCharacterChatByName(i, c.chatId);
}

export async function newScenarioChat() {
    const g = scenarioGroup();
    if (g) await createNewGroupChat(g.id);
    else await doNewChat({ deleteCurrentChat: false });
}

/* ---------- groups: a game is a group, a save is one of its chats ---------- */

export const allGroups = (): any[] => groups;
export const groupOf = (id: string) => groups.find((g: any) => g.id === id) ?? null;
export const selectedGroup = () => selected_group as string | null;
export const currentChatId = () => String(getCurrentChatId() ?? '');

// A save's name. No ":" in it: on Windows the file is saved without it, and SillyTavern then cannot find the chat
// by the name it keeps in the group (a save made like that could not be loaded).
export const saveName = (suffix = '') => `Mundi ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h')}${suffix}`;
// the same name the way the file system writes it
export const fileSafe = (s: string) => s.replace(/[<>:"/\\|?*]/g, '').trim();
// The name a group keeps for a chat, from its file name (older saves have ":" in the group but not in the file).
export function groupChatId(groupId: string, fileId: string): string {
    const g = groupOf(groupId);
    return (g?.chats ?? []).find((c: string) => c === fileId) ?? (g?.chats ?? []).find((c: string) => fileSafe(c) === fileSafe(fileId)) ?? fileId;
}

export async function createGroup(name: string, members: string[], avatarUrl = ''): Promise<string> {
    const chatId = saveName();
    const res = await fetch('/api/groups/create', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({
            name, members, avatar_url: avatarUrl, allow_self_responses: false, hideMutedSprites: true,
            activation_strategy: 0, generation_mode: 0, disabled_members: members.slice(), fav: false,
            chat_id: chatId, chats: [chatId], auto_mode_delay: 5,
        }),
    });
    if (!res.ok) throw new Error('Could not create the group.');
    const { id } = await res.json();
    await getGroups();
    refreshList();
    return id;
}

// SillyTavern's own character list only redraws on its own; Mundi's games are ordinary groups and show up there too.
// SillyTavern's character list. Two redraws running at once (ours and SillyTavern's own, or two of ours) add every
// card twice, so the redraw waits for things to settle, and never runs over another.
let listTimer: any = null, listBusy = false, listAgain = false;
export function refreshList() {
    clearTimeout(listTimer);
    listTimer = setTimeout(async () => {
        if (listBusy) { listAgain = true; return; }
        listBusy = true;
        try { await printCharacters(true); } catch (e) { console.warn('[Mundi] list', e); }
        listBusy = false;
        if (listAgain) { listAgain = false; refreshList(); }
    }, 400);
}

export async function openGame(groupId: string, chatId?: string) {
    if (selected_group !== groupId) await openGroupById(groupId);
    const g = groupOf(groupId);
    const id = chatId ? groupChatId(groupId, chatId) : '';
    if (id && g && g.chat_id !== id) await openGroupChat(groupId, id);
}

// A copy of the open save as a new chat of the same group (all its lines and its state), without leaving this one.
export async function copyGroupChat(groupId: string, newId: string, metadata: any, lines: any[]) {
    const g = groupOf(groupId); if (!g) throw new Error('Group not found.');
    const header = { chat_metadata: { ...metadata, integrity: crypto.randomUUID() }, user_name: 'unused', character_name: 'unused' };
    const res = await fetch('/api/chats/group/save', { method: 'POST', headers: headers(), body: JSON.stringify({ id: newId, chat: [header, ...lines], force: true }) });
    if (!res.ok) throw new Error('Could not save the copy.');
    g.chats = [...(g.chats ?? []), newId];
    await editGroup(groupId, true, false);
}
export const newChat = (groupId: string) => createNewGroupChat(groupId);
export const pastChats = async (groupId: string): Promise<any[]> => (await getGroupPastChats(groupId)) ?? [];
export const deleteChat = (groupId: string, chatId: string) => stDeleteGroupChat(groupId, chatId, { jumpToNewChat: false });

export async function deleteGroup(groupId: string) {
    await fetch('/api/groups/delete', { method: 'POST', headers: headers(), body: JSON.stringify({ id: groupId }) });
    await getGroups();
    refreshList();
}

// Who is in the scene: present members speak, everyone else is muted. Saves only when something changed.
export async function setPresent(groupId: string, members: string[], present: string[]) {
    const g = groupOf(groupId);
    if (!g) return;
    const off = members.filter(a => !present.includes(a));
    const same = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
    let dirty = false;
    if (!same(g.members ?? [], members)) { g.members = members.slice(); dirty = true; }
    if (!same(g.disabled_members ?? [], off)) { g.disabled_members = off; dirty = true; }
    if (dirty) await editGroup(g.id, true, false);
}

// Mutes exactly these members of a group again (a world detached from a group chat gives it back as it was).
export async function setMuted(groupId: string, muted: string[]) {
    const g = groupOf(groupId);
    if (!g) return;
    g.disabled_members = (muted ?? []).filter(a => (g.members ?? []).includes(a));
    await editGroup(g.id, true, false);
}

/* ---------- the open chat ---------- */

export const chat = (): any[] => (globalThis as any).__mundiTutChat ?? ctx().chat ?? [];   // the tutorial has its own lines
export const saveMeta = () => ctx().saveMetadata();
export const saveChat = () => saveChatDebounced();

// Who wrote a message in a group (avatar file).
export function speakerOf(m: any): string | null {
    if (!m || m.is_user || m.is_system) return null;
    if (m.original_avatar) return m.original_avatar;
    return characters().find(c => c.name === m.name)?.avatar ?? null;
}

// A fresh group chat starts with every member's greeting: Mundi removes them (greetings come when you meet someone).
export function clearGreetings() {
    const list = chat();
    let n = 0;
    while (n < list.length && !list[n].is_user && !list[n].extra?.mundi && !list[n].gen_started) n++;
    if (!n) return;
    list.splice(0, n);
    document.querySelectorAll('#chat .mes').forEach((el, i) => { if (i < n) el.remove(); });
    saveChatDebounced();
}

// Sends through SillyTavern's own input, so the normal generation flow (group turn order, streaming,
// TTS, expressions, other extensions) runs exactly as in the native chat.
// SillyTavern's Chat Translation: the language it shows the chat in, when it translates automatically ('' when off).
export const chatLang = (): string => { const t = ctx().extensionSettings?.translate; return t && t.auto_mode && t.auto_mode !== 'none' ? String(t.target_language ?? '') : ''; };
// Translates with the extension (same provider and settings as the chat). The text comes back as is when it is off or fails.
export async function translateTo(text: string, lang = chatLang()): Promise<string> {
    if (!lang || !text.trim()) return text;
    try {
        const path = '/scripts/extensions/translate/index.js';
        const mod: any = await import(/* @vite-ignore */ path);
        const out = String(await mod.translate(text, lang) ?? '').trim();
        return out || text;
    } catch (e) { console.warn('[Mundi] translation', e); return text; }
}
// A line Mundi writes for you (a button's message): in the chat's language when Chat Translation is on.
export function sendCanned(text: string): boolean {
    if (!document.getElementById('send_textarea') || !document.getElementById('send_but')) return false;
    if (!chatLang()) return sendText(text);
    void translateTo(text).then(t => sendText(t));
    return true;
}
export function sendText(text: string): boolean {
    const value = String(text ?? '').trim();
    const field = document.getElementById('send_textarea') as HTMLTextAreaElement | null;
    const btn = document.getElementById('send_but');
    if (!field || !btn) return false;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();
    return true;
}
const click = (id: string) => { const b = document.getElementById(id); if (!b) return false; b.click(); return true; };
export const regenerate = () => click('option_regenerate');
export const continueLast = () => click('option_continue');
export const impersonate = () => click('option_impersonate');
export const stop = () => ctx().stopGeneration();
export const swipeLeft = () => ctx().swipe.left(null);
export const swipeRight = () => ctx().swipe.right(null);

export function editMessage(index: number, text: string) {
    const m = chat()[index];
    if (!m) return false;
    m.mes = String(text ?? '');
    if (m.swipes && typeof m.swipe_id === 'number') m.swipes[m.swipe_id] = m.mes;
    if (m.extra) delete m.extra.display_text;
    updateMessageBlock(index, m);
    saveChatDebounced();
    return true;
}
export const deleteMessageAt = (index: number) => deleteMessage(index, undefined, false);   // Mundi asks first, in its own screen

// Writes a line as a character (a greeting when you first meet her). Marked as Mundi's own.
export async function sendAs(name: string, text: string) {
    const before = chat().length;
    const clean = scriptText(text);
    await ctx().executeSlashCommandsWithOptions(`/sendas name="${scriptText(name.replace(/"/g, ''))}" ${clean}`);
    for (let i = before; i < chat().length; i++) chat()[i].extra = { ...(chat()[i].extra ?? {}), mundi: true };
    saveChatDebounced();
}

// Lines added without starting a reply: your own line, and the hidden narrator's (scenes where you are alone).
// The next reply comes from this person (a group member), whoever would have spoken otherwise.
export async function replyAs(avatar: string) {
    const i = (ctx().characters ?? []).findIndex((c: any) => c?.avatar === avatar);
    if (i < 0) return;
    await ctx().generate('normal', { force_chid: i });
}
export async function addUserLine(text: string) {
    await ctx().executeSlashCommandsWithOptions(`/send ${scriptText(text)}`);
}
export async function narratorLine(text: string) {
    const before = chat().length;
    await ctx().executeSlashCommandsWithOptions(`/sys ${scriptText(text)}`);
    for (let i = before; i < chat().length; i++) chat()[i].extra = { ...(chat()[i].extra ?? {}), mundi: true, mundi_narrator: true };
    saveChatDebounced();
}

// An AI call outside the conversation (a diary, a description).
// Models that think before answering (Claude with thinking, reasoning models) spend part of the length on thinking:
// a small length left nothing for the answer ("No message generated"). So the length asked is never small, the
// answer is cut by Mundi afterwards, and an empty answer is tried once more with room to spare.
export async function quiet(prompt: string, responseLength = 300, systemPrompt = ''): Promise<string> {
    const ask = async (len: number) => String(await ctx().generateRaw({ prompt, systemPrompt, responseLength: len }) ?? '')
        .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();
    try {
        const out = await ask(Math.max(responseLength, 1000));
        if (out) return out;
    } catch (e: any) { if (!/no message generated|empty/i.test(String(e?.message ?? e))) throw e; }
    return ask(Math.min(Math.max(responseLength * 2, 3000), 4000));   // one more try, with more room (models that think first)
}

// Hides lines from the AI's prompt (SillyTavern's /hide: the messages stay in the chat).
export async function hideMessages(start: number, end: number) {
    if (end < start) return;
    try { await ctx().executeSlashCommandsWithOptions(`/hide ${start}-${end}`); } catch (e) { console.warn('[Mundi] hide', e); }
}
// Shows hidden lines to the AI again (SillyTavern's /unhide).
export async function unhideMessages(start: number, end: number) {
    if (end < start) return;
    try { await ctx().executeSlashCommandsWithOptions(`/unhide ${start}-${end}`); } catch (e) { console.warn('[Mundi] unhide', e); }
}

// One line of dialogue. The prompt is a transcript that ends with "Name:", so any model (text completion
// without instruct, instruct, or chat APIs) simply continues it with that person's line; the answer is then
// cut to that one line and cleaned.
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function cleanLine(raw: string, names: string[], max = 280): string {
    const who = names.filter(Boolean).map(escRe).join('|') || '\\w+';
    const prefix = new RegExp(`^\\s*(?:${who})\\s*(?:\\(@[^)]*\\))?\\s*(?:posted|replied)?\\s*:\\s*`, 'i');
    let lines = String(raw ?? '').replace(/\r/g, '').split('\n').map(l => l.trim());
    // the first line with real words once the speaker's name is taken off (models sometimes open with "***",
    // a blank line, or the name alone on its line, with the words below it: that is not "no answer")
    const words = (l: string) => /[\p{L}\p{N}]/u.test(l.replace(prefix, '').replace(/[*_~`"“”'«»]/g, ''));
    while (lines.length && !words(lines[0])) lines.shift();
    let t = (lines[0] ?? '').replace(prefix, '');
    t = t.replace(/\*{2,}/g, '').replace(/^\*|\*$/g, '').replace(/^["“'«]+|["”'»]+$/g, '').replace(/\s+/g, ' ').trim();
    // stop if another speaker starts on the same line ("… Name: …")
    const other = t.search(new RegExp(`\\s(?:${who})\\s*(?:\\(@[^)]*\\))?\\s*:`, 'i'));
    if (other > 20) t = t.slice(0, other).trim();
    t = t.replace(/^["“'«]+|["”'»]+$/g, '').trim();
    if (t.length > max) {
        const cut = t.slice(0, max);
        const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
        t = end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
    }
    return t;
}
export async function sayLine(transcript: string, speaker: string, names: string[], max = 280, tokens = 120): Promise<string> {
    let line = cleanLine(await quiet(`${transcript}\n${speaker}:`, tokens), names, max);
    // a reply of a word or two ("Vooom!") says nothing: one more try
    if (line.replace(/[^\p{L}\p{N}]/gu, '').length < 8) {
        const again = cleanLine(await quiet(`${transcript}\n${speaker}:`, tokens), names, max);
        if (again.length > line.length) line = again;
    }
    return line;
}

export const setPrompt = (key: string, text: string, depth = 0) => ctx().setExtensionPrompt(key, text, 0, depth);   // 0 = in the prompt, after the story string
// The engine's word on what was just asked (an invitation, a question), for the next reply only: a newer ask replaces
// it, and the old one's timer never clears the newer one (asking three times in a row used to leave the AI answering the first).
let askSeq = 0;
export function setAsk(text: string, ms = 60000) { const my = ++askSeq; setPrompt('mundi_ask', text, 0); setTimeout(() => { if (askSeq === my) setPrompt('mundi_ask', ''); }, ms); }
export const clearAsk = () => { askSeq++; setPrompt('mundi_ask', ''); };

/* ---------- lorebooks ---------- */

export interface NewLore { keys: string[]; content: string; constant?: boolean; comment?: string }

// Creates (or rewrites) a lorebook with SillyTavern's own World Info functions.
export async function writeLorebook(name: string, entries: NewLore[]) {
    const data: any = { entries: {} };
    for (const e of entries) {
        const entry = createWorldInfoEntry(name, data);
        if (!entry) continue;
        entry.key = e.keys;
        entry.content = e.content;
        entry.comment = e.comment ?? e.keys[0] ?? '';
        entry.constant = !!e.constant;
    }
    await saveWorldInfo(name, data, true);
    await updateWorldInfoList();
}
export const lorebooks = (): string[] => (Array.isArray(world_names) ? [...world_names] : []);

// Binds a lorebook to the open chat (SillyTavern's "chat lore").
export async function bindChatLore(name: string) {
    ctx().chatMetadata[METADATA_KEY] = name;
    await ctx().saveMetadata();
}

/* ---------- expressions ---------- */

let exprMod: any = undefined;
// The emotion of a line, using whatever classifier the user set up in the Expressions extension.
export async function expressionOf(text: string): Promise<string | null> {
    if (exprMod === undefined) {
        try {
            // @ts-ignore
            exprMod = await import('../../../../expressions/index.js');
        } catch { exprMod = null; }
    }
    if (!exprMod?.getExpressionLabel) return null;
    try { return (await exprMod.getExpressionLabel(text)) || null; } catch { return null; }
}

// Sprites in the character's Expressions folder (and its outfit subfolders). A persona ("persona:<file>") has
// the folder of its name, which a card of that name (Play as) shares.
export const spriteFolder = (avatar: string) => {
    if (avatar.startsWith('persona:')) return personaName(avatar.slice(8));
    const key = avatar.replace(/\.png$/i, '');
    const o = ctx().extensionSettings?.expressionOverrides?.find((e: any) => e.name == key);
    return o?.path || charOf(avatar)?.name || key;
};
// The character's own Expressions folder (without the outfit worn now).
export const baseSpriteFolder = (avatar: string) => (avatar.startsWith('persona:') ? personaName(avatar.slice(8)) : String(charOf(avatar)?.name || avatar.replace(/\.png$/i, '')));
// Outfits: subfolders of the Expressions folder ("Frieren/pajamas"). Wearing one is SillyTavern's own costume
// override (what /costume sets), so the Expressions extension shows it too.
export function outfitOf(avatar: string): string {
    const base = baseSpriteFolder(avatar), cur = spriteFolder(avatar);
    return cur.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? cur.slice(base.length + 1) : '';
}
export function wearOutfit(avatar: string, outfit: string) {
    const es = ctx().extensionSettings as any; if (!es) return;
    const key = avatar.replace(/\.png$/i, '');
    const list: any[] = (es.expressionOverrides ??= []);
    const i = list.findIndex(e => e.name == key);
    if (!outfit) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i].path = `${baseSpriteFolder(avatar)}/${outfit}`;
    else list.push({ name: key, path: `${baseSpriteFolder(avatar)}/${outfit}` });
    ctx().saveSettingsDebounced();
}
// `outfit`: left out, what they wear now; '' their usual sprites; a name, that outfit.
export async function fetchSprites(avatar: string, outfit?: string): Promise<any[]> {
    // the tour's people have one sprite of their own, used as their "neutral" expression
    if (avatar?.startsWith('__tut:')) return outfit ? [] : [{ label: 'neutral', path: new URL(`../../assets/tutorial/${avatar.slice(6)}.png`, import.meta.url).href }];
    const name = outfit === undefined ? spriteFolder(avatar) : outfit ? `${baseSpriteFolder(avatar)}/${outfit}` : baseSpriteFolder(avatar);
    try {
        const r = await fetch(`/api/sprites/get?name=${encodeURIComponent(name)}`, { headers: headers() });
        const list = r.ok ? await r.json() : [];
        return Array.isArray(list) ? list : [];
    } catch { return []; }
}

/* ---------- library: reading and editing what shapes the roleplay ---------- */

// Character cards may load "shallow" (without their text) in big libraries: this loads the full card.
export async function fullCharacter(avatar: string) {
    const list = ctx().characters ?? [];
    const i = list.findIndex((c: any) => c?.avatar === avatar);
    if (i >= 0 && list[i].shallow && ctx().unshallowCharacter) await ctx().unshallowCharacter(i);
    return charOf(avatar);
}

export interface CardPatch {
    name?: string; description?: string; personality?: string; scenario?: string; first_mes?: string; mes_example?: string;
    creator_notes?: string; system_prompt?: string; post_history_instructions?: string; talkativeness?: number;
    depth_prompt?: { prompt: string; depth: number; role: string }; tags?: string[]; alternate_greetings?: string[];
}
// Saves card fields with SillyTavern's own merge endpoint (the card file keeps its name and image).
export async function saveCharacter(avatar: string, p: CardPatch) {
    const top: any = {}, data: any = {}, ext: any = {};
    for (const k of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'tags'] as const) if (p[k] !== undefined) { top[k] = p[k]; data[k] = p[k]; }
    if (p.creator_notes !== undefined) { top.creatorcomment = p.creator_notes; data.creator_notes = p.creator_notes; }
    if (p.system_prompt !== undefined) data.system_prompt = p.system_prompt;
    if (p.alternate_greetings !== undefined) data.alternate_greetings = p.alternate_greetings;   // the list is replaced as a whole
    if (p.post_history_instructions !== undefined) data.post_history_instructions = p.post_history_instructions;
    if (p.talkativeness !== undefined) { top.talkativeness = p.talkativeness; ext.talkativeness = p.talkativeness; }
    if (p.depth_prompt !== undefined) ext.depth_prompt = p.depth_prompt;
    if (Object.keys(ext).length) data.extensions = ext;
    const res = await fetch('/api/characters/merge-attributes', { method: 'POST', headers: headers(), body: JSON.stringify({ avatar, ...top, data }) });
    if (!res.ok) throw new Error('Could not save the character.');
    // the open copy, so the change is used right away
    const c = charOf(avatar);
    if (c) {
        Object.assign(c, top);
        c.data = { ...(c.data ?? {}), ...data, extensions: { ...(c.data?.extensions ?? {}), ...ext } };
    }
    try { if (ctx().getOneCharacter) await ctx().getOneCharacter(avatar); } catch { /* the local copy is already updated */ }
}

export interface PersonaRow { file: string; name: string; description: string; position: number; depth: number; role: number; title: string }
export function personas(): PersonaRow[] {
    const names = power_user.personas ?? {};
    return Object.keys(names).map(file => {
        const d = power_user.persona_descriptions?.[file] ?? {};
        return { file, name: String(names[file] ?? ''), description: String(d.description ?? ''), position: Number(d.position ?? 0), depth: Number(d.depth ?? 2), role: Number(d.role ?? 0), title: String(d.title ?? '') };
    });
}
export async function savePersona(file: string, p: Partial<Omit<PersonaRow, 'file'>>) {
    power_user.personas ??= {};
    power_user.persona_descriptions ??= {};
    if (p.name !== undefined) power_user.personas[file] = p.name;
    const d = (power_user.persona_descriptions[file] ??= { description: '', position: 0 });
    for (const k of ['description', 'position', 'depth', 'role', 'title'] as const) if (p[k] !== undefined) d[k] = p[k];
    if (file === persona()) {   // the persona in use: SillyTavern reads these copies when it builds the prompt
        power_user.persona_description = d.description ?? '';
        power_user.persona_description_position = d.position ?? 0;
        power_user.persona_description_depth = d.depth ?? 2;
        power_user.persona_description_role = d.role ?? 0;
        if (p.name !== undefined && p.name !== ctx().name1) { try { setUserName(p.name, { toastPersonaNameChange: false }); } catch { /* older SillyTavern */ } }
    }
    ctx().saveSettingsDebounced();
}

export const loadLore = async (name: string): Promise<any> => (await loadWorldInfo(name)) ?? { entries: {} };
export async function saveLore(name: string, data: any) { await saveWorldInfo(name, data, true); loreCounts.set(name, Object.keys(data?.entries ?? {}).length); }
// How many entries each lorebook has (read once, in the background, one book at a time).
const loreCounts = new Map<string, number>();
const countQueue: string[] = []; let counting = false;
export function loreCount(name: string, onReady: () => void): number | undefined {
    if (loreCounts.has(name)) return loreCounts.get(name);
    if (!countQueue.includes(name)) countQueue.push(name);
    if (!counting) {
        counting = true;
        void (async () => {
            let n = 0;
            while (countQueue.length) {
                const b = countQueue.shift()!;
                try { loreCounts.set(b, Object.keys((await loadWorldInfo(b))?.entries ?? {}).length); } catch { loreCounts.set(b, 0); }
                if (++n % 8 === 0 || !countQueue.length) onReady();
            }
            counting = false;
        })();
    }
    return undefined;
}
export const newLoreEntry = (name: string, data: any) => createWorldInfoEntry(name, data);
/* ---------- importing files (SillyTavern's own importers) ---------- */

// Character cards (.png, .json, .charx, .yaml, .byaf), exactly like dropping them on SillyTavern.
export async function importCharacterFiles(files: File[]) {
    await processDroppedFiles(files);
    try { await getCharacters(); } catch { /* the list refreshes on its own */ }
}
// Lorebooks (.json; SillyTavern converts Novel AI, Agnai and other formats).
export async function importLorebookFiles(files: File[]) {
    for (const f of files) { try { await importWorldInfo(f); } catch (e) { console.warn('[Mundi] import lorebook', e); } }
    try { await updateWorldInfoList(); } catch { /* list refreshes when opened */ }
}
// Personas from pictures: each picture becomes a persona named after the file.
export async function importPersonaPictures(files: File[]) {
    for (const f of files) {
        const name = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Persona';
        await createPersona(name, '', f);
    }
}

// A character's lorebooks (SillyTavern's own: the card's main lorebook plus "additional" ones kept in settings).
const charFile = (avatar: string) => avatar.replace(/\.[^.]+$/, '');
export function charLorebooks(avatar: string): string[] {
    const main = String(charOf(avatar)?.data?.extensions?.world ?? '');
    const extra: string[] = (world_info as any)?.charLore?.find((e: any) => e.name === charFile(avatar))?.extraBooks ?? [];
    return [...(main ? [main] : []), ...extra.filter(x => x !== main)];
}
export async function setCharLorebooks(avatar: string, books: string[]) {
    const [main = '', ...extra] = books;
    const res = await fetch('/api/characters/merge-attributes', { method: 'POST', headers: headers(), body: JSON.stringify({ avatar, data: { extensions: { world: main } } }) });
    if (!res.ok) throw new Error('Could not save the character.');
    const c = charOf(avatar);
    if (c) c.data = { ...(c.data ?? {}), extensions: { ...(c.data?.extensions ?? {}), world: main } };
    const wi = world_info as any; wi.charLore ??= [];
    const i = wi.charLore.findIndex((e: any) => e.name === charFile(avatar));
    if (extra.length) { if (i >= 0) wi.charLore[i].extraBooks = extra; else wi.charLore.push({ name: charFile(avatar), extraBooks: extra }); }
    else if (i >= 0) wi.charLore.splice(i, 1);
    ctx().saveSettingsDebounced();
    try { if (ctx().getOneCharacter) await ctx().getOneCharacter(avatar); } catch { /* local copy updated */ }
}

// Lorebooks switched on for every chat (SillyTavern's global World Info selection).
export const globalLore = (): string[] => (Array.isArray(selected_world_info) ? [...selected_world_info] : []);
export async function setGlobalLore(name: string, on: boolean) {
    if (globalLore().includes(name) === on) return;
    try { await ctx().executeSlashCommandsWithOptions(`/world state=${on ? 'on' : 'off'} silent=true ${scriptText(name.replace(/\|/g, ' '))}`); } catch (e) { console.warn('[Mundi] world info', e); }
}
export const chatLore = () => String(ctx().chatMetadata?.[METADATA_KEY] ?? '');
// Several lorebooks for one chat: SillyTavern keeps one "chat lore"; the others are kept with the chat and switched on
// (as global lorebooks) by Mundi while the chat is open.
export const chatLoreExtra = (): string[] => { const x = ctx().chatMetadata?.mundi_lore; return Array.isArray(x) ? x.filter((n: any) => typeof n === 'string' && n) : []; };
export const chatLores = () => [chatLore(), ...chatLoreExtra()].filter((n, i, a) => n && a.indexOf(n) === i);
export async function setChatLores(names: string[]) {
    const list = names.filter((n, i, a) => n && a.indexOf(n) === i);
    ctx().chatMetadata[METADATA_KEY] = list[0] ?? '';
    ctx().chatMetadata.mundi_lore = list.slice(1);
    await ctx().saveMetadata();
}

/* ---------- folders (SillyTavern's folder tags), favorites, deleting ---------- */

export interface Folder { id: string; name: string }
export const folders = (): Folder[] => (tags as any[]).filter(t => t.folder_type && t.folder_type !== 'NONE').map(t => ({ id: String(t.id), name: String(t.name) }));
export const tagIdsOf = (avatar: string): string[] => (tag_map[avatar] ?? []).map(String);
export const allTags = (): Folder[] => (tags as any[]).filter(t => !t.folder_type || t.folder_type === 'NONE').map(t => ({ id: String(t.id), name: String(t.name) })).sort((x, y) => x.name.localeCompare(y.name));
const tagById = (id: string) => (tags as any[]).find(t => String(t.id) === id);
export function renameFolder(id: string, name: string) { const t = tagById(id); if (!t) return; t.name = name; ctx().saveSettingsDebounced(); }
export const folderMade = (id: string) => Number(tagById(id)?.create_date) || 0;

// A folder is a tag of the "folder" kind, exactly like the ones made in SillyTavern's tag manager.
export function newFolder(name: string): Folder {
    const clean = name.trim();
    let t = (tags as any[]).find(x => String(x.name).toLowerCase() === clean.toLowerCase());
    if (t) { if (!t.folder_type || t.folder_type === 'NONE') t.folder_type = 'CLOSED'; }
    else {
        t = { id: `${Date.now()}${Math.floor(Math.random() * 1000)}`, name: clean, folder_type: 'CLOSED', filter_state: 'UNDEFINED', sort_order: tags.length, color: '', color2: '', create_date: Date.now() };
        tags.push(t);
    }
    ctx().saveSettingsDebounced();
    return { id: String(t.id), name: String(t.name) };
}
export const folderColor = (id: string) => String(tagById(id)?.color || '');
export function setFolderColor(id: string, color: string) { const t = tagById(id); if (!t) return; t.color = color; ctx().saveSettingsDebounced(); }
// Deleting a folder deletes the tag; the characters in it stay.
export function deleteFolder(id: string) {
    const i = (tags as any[]).findIndex(t => String(t.id) === id);
    if (i < 0) return;
    tags.splice(i, 1);
    for (const k of Object.keys(tag_map)) tag_map[k] = (tag_map[k] ?? []).filter((x: any) => String(x) !== id);
    ctx().saveSettingsDebounced();
}
// A persona's own lorebook (SillyTavern's persona lorebook).
export const personaLore = (file: string) => String(power_user.persona_descriptions?.[file]?.lorebook ?? '');
export function setPersonaLore(file: string, name: string) {
    power_user.persona_descriptions ??= {};
    const d = (power_user.persona_descriptions[file] ??= { description: '', position: 0 });
    d.lorebook = name; ctx().saveSettingsDebounced();
}
// A character card as PNG or JSON (SillyTavern's own export).
export async function cardFile(avatar: string, format: 'png' | 'json'): Promise<Blob> {
    const res = await fetch('/api/characters/export', { method: 'POST', headers: headers(), body: JSON.stringify({ format, avatar_url: avatar }) });
    if (!res.ok) throw new Error('Could not export.');
    return res.blob();
}
export const fileNameOf = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim() || 'untitled';
export async function exportCharacter(avatar: string, format: 'png' | 'json') {
    const blob = await cardFile(avatar, format);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${String(charOf(avatar)?.name ?? 'character').replace(/[^\w -]/g, '')}.${format}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// Tokens of a card (description, personality, scenario, greeting, examples), counted with the chosen tokenizer.
const tokenCache = new Map<string, number>();
export async function cardTokens(avatar: string): Promise<number> {
    if (tokenCache.has(avatar)) return tokenCache.get(avatar)!;
    const c = charOf(avatar); if (!c) return 0;
    const text = [c.description, c.personality, c.scenario, c.first_mes, c.mes_example, c.data?.system_prompt].filter(Boolean).join('\n');
    let n = 0;
    try { n = await ctx().getTokenCountAsync(text); } catch { n = Math.round(text.length / 4); }
    tokenCache.set(avatar, n);
    return n;
}
export const cachedTokens = (avatar: string) => tokenCache.get(avatar);
// The chats of one character (how many, how many messages).
export async function characterChats(avatar: string): Promise<{ file: string; count: number; last: string }[]> {
    try {
        const res = await fetch('/api/characters/chats', { method: 'POST', headers: headers(), body: JSON.stringify({ avatar_url: avatar, simple: false }) });
        const data = await res.json();
        return (Array.isArray(data) ? data : Object.values(data ?? {})).map((c: any) => ({ file: String(c.file_name ?? ''), count: Number(c.chat_items ?? 0), last: String(c.last_mes ?? '') }));
    } catch { return []; }
}
// A character's tags (SillyTavern's own tags, the same as in its tag manager; folders are left out).
export const charTags = (avatar: string): Folder[] => { const fs = new Set(folders().map(f => f.id)); return tagIdsOf(avatar).filter(id => !fs.has(id)).map(id => tagById(id)).filter(Boolean).map((t: any) => ({ id: String(t.id), name: String(t.name) })); };
export const tagColor = (id: string) => String(tagById(id)?.color || '');
export function tagCharacter(avatar: string, name: string): boolean {
    const clean = name.trim(); if (!clean) return false;
    let t = (tags as any[]).find(x => String(x.name).toLowerCase() === clean.toLowerCase());
    if (!t) { t = { id: `${Date.now()}${Math.floor(Math.random() * 1000)}`, name: clean, folder_type: 'NONE', filter_state: 'UNDEFINED', sort_order: tags.length, color: '', color2: '', create_date: Date.now() }; tags.push(t); }
    addTagsToEntity(t, [avatar]); ctx().saveSettingsDebounced(); return true;
}
export function untagCharacter(avatar: string, id: string) { const t = tagById(id); if (!t) return; removeTagFromEntity(t, [avatar]); ctx().saveSettingsDebounced(); }
export function putInFolder(folderId: string, avatars: string[], on: boolean) {
    const t = tagById(folderId);
    if (!t || !avatars.length) return;
    if (on) addTagsToEntity(t, avatars); else removeTagFromEntity(t, avatars);
}

export const isFav = (c: any) => c?.fav === true || c?.fav === 'true' || c?.data?.extensions?.fav === true;
export async function setFavorite(avatars: string[], on: boolean) {
    for (const avatar of avatars) {
        const res = await fetch('/api/characters/merge-attributes', { method: 'POST', headers: headers(), body: JSON.stringify({ avatar, fav: on, data: { extensions: { fav: on } } }) });
        if (!res.ok) throw new Error('Could not save the character.');
        const c = charOf(avatar);
        if (c) { c.fav = on; c.data = { ...(c.data ?? {}), extensions: { ...(c.data?.extensions ?? {}), fav: on } }; }
    }
}

// Deletes cards through SillyTavern's endpoint. The card open in a one-on-one chat is skipped (closing it is SillyTavern's job).
export async function deleteCharacters(avatars: string[], deleteChats: boolean): Promise<number> {
    const open = ctx().characters?.[ctx().characterId]?.avatar;
    let n = 0;
    for (const avatar of avatars) {
        if (avatar === open && !selected_group) continue;
        const res = await fetch('/api/characters/delete', { method: 'POST', headers: headers(), body: JSON.stringify({ avatar_url: avatar, delete_chats: deleteChats }), cache: 'no-cache' });
        if (!res.ok) continue;
        delete tag_map[avatar];
        n++;
    }
    await getCharacters();
    ctx().saveSettingsDebounced();
    return n;
}
export async function deletePersonas(files: string[]): Promise<number> {
    let n = 0;
    // the persona selected now can go too: SillyTavern switches to another one first (the default, or any other)
    if (files.includes(persona())) {
        const others = Object.keys(power_user.personas ?? {}).filter(f => !files.includes(f));
        const next = others.includes(power_user.default_persona) ? power_user.default_persona : others[0];
        if (next) { try { await setUserAvatar(next, { toastPersonaNameChange: false }); } catch (e) { console.warn('[Mundi] switch persona', e); } }
    }
    for (const file of files) {
        if (file === persona()) continue;   // the only persona left
        const res = await fetch('/api/avatars/delete', { method: 'POST', headers: headers(), body: JSON.stringify({ avatar: file }) });
        if (!res.ok && res.status !== 404) continue;   // 404: the picture was already gone; the persona entry still goes
        delete power_user.personas?.[file];
        delete power_user.persona_descriptions?.[file];
        if (power_user.default_persona === file) power_user.default_persona = null;
        n++;
    }
    ctx().saveSettingsDebounced();
    try { await getUserAvatars(true); } catch { /* the persona panel refreshes when opened */ }
    return n;
}
export async function deleteLorebooks(names: string[]): Promise<number> {
    let n = 0;
    for (const name of names) { try { await deleteWorldInfo(name); n++; } catch (e) { console.warn('[Mundi] delete lorebook', e); } }
    return n;
}

// A save's state without opening it (the chat's metadata: where Mundi keeps the game).
export async function readChatMeta(chatId: string): Promise<any> {
    if (chatId === currentChatId()) return ctx().chatMetadata;
    const res = await fetch('/api/chats/group/get', { method: 'POST', headers: headers(), body: JSON.stringify({ id: chatId }) });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) ? list.find((m: any) => m && m.chat_metadata)?.chat_metadata ?? null : null;
}
// A save's messages without opening it (the open save comes from memory, with unsaved changes).
export async function readChat(chatId: string): Promise<any[]> {
    if (chatId === currentChatId()) return chat();
    const res = await fetch('/api/chats/group/get', { method: 'POST', headers: headers(), body: JSON.stringify({ id: chatId }) });
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list.filter((m: any) => m && typeof m.mes === 'string') : [];
}

/* ---------- creating, duplicating, pictures ---------- */

export const personaImage = (file: string) => `/User Avatars/${encodeURIComponent(file)}`;
const bust = () => `${Date.now()}`;
let picVersion = '';
export const picQuery = () => (picVersion ? `&v=${picVersion}` : '');

export async function duplicateCharacter(avatar: string): Promise<string> {
    const res = await fetch('/api/characters/duplicate', { method: 'POST', headers: headers(), body: JSON.stringify({ avatar_url: avatar }) });
    if (!res.ok) throw new Error('Could not duplicate.');
    let path = '';
    try { path = String((await res.json())?.path ?? ''); } catch { /* older SillyTavern */ }
    await getCharacters();
    return path.replace(/^.*[\\/]/, '');
}
// Replaces a card's picture (SillyTavern's own endpoint keeps the card data).
export async function setCharacterImage(avatar: string, image: Blob) {
    const form = new FormData();
    form.append('avatar_url', avatar);
    form.append('avatar', image, 'avatar.png');
    const res = await fetch('/api/characters/edit-avatar', { method: 'POST', headers: headers(false), body: form, cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not change the picture.');
    picVersion = bust();
}
export async function setPersonaImage(file: string, image: Blob) {
    const form = new FormData();
    form.append('avatar', image, file);
    form.append('overwrite_name', file);
    const res = await fetch('/api/avatars/upload', { method: 'POST', headers: headers(false), body: form, cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not change the picture.');
    picVersion = bust();
    try { await getUserAvatars(true); } catch { /* refreshes when opened */ }
}
export async function duplicatePersona(file: string): Promise<string> {
    const p = personas().find(x => x.file === file);
    const blob = await (await fetch(personaImage(file))).blob();
    const copy = await createPersona(`${p?.name ?? 'Persona'} (2)`, p?.description ?? '', blob);
    const from = power_user.persona_descriptions?.[file];
    if (from) power_user.persona_descriptions[copy] = { ...JSON.parse(JSON.stringify(from)) };
    ctx().saveSettingsDebounced();
    return copy;
}
export const defaultPersona = () => String(power_user.default_persona ?? '');
export function setDefaultPersona(file: string | null) {
    power_user.default_persona = file;
    ctx().saveSettingsDebounced();
}
// Mundi's own record inside a persona (the sheet it was made from).
export const personaSheet = (file: string): any => power_user.persona_descriptions?.[file]?.mundi ?? null;
export function setPersonaSheet(file: string, sheet: any) {
    power_user.persona_descriptions ??= {};
    const d = (power_user.persona_descriptions[file] ??= { description: '', position: 0 });
    d.mundi = sheet;
    ctx().saveSettingsDebounced();
}

export async function createLorebook(name: string): Promise<string> {
    const clean = name.trim();
    if (!clean) throw new Error('Write a name.');
    const ok = await createNewWorldInfo(clean, { interactive: false });
    if (ok === false) throw new Error('A lorebook with this name already exists.');
    return clean;
}
export async function duplicateLorebook(name: string): Promise<string> {
    const data = await loadLore(name);
    let copy = `${name} (2)`; let n = 2;
    while (lorebooks().includes(copy)) copy = `${name} (${++n})`;
    await saveWorldInfo(copy, JSON.parse(JSON.stringify(data)), true);
    await updateWorldInfoList();
    return copy;
}

/* ---------- user files (SillyTavern's user/files folder): worlds made with the creator and their pictures ---------- */

const toB64 = (b: Blob) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => bad(r.error); r.readAsDataURL(b); });
// Saves a file and returns its path ("user/files/name"); names may only have letters, digits, "_", "-" and ".".
export async function uploadUserFile(name: string, data: Blob | string): Promise<string> {
    const clean = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const b64 = typeof data === 'string' ? btoa(unescape(encodeURIComponent(data))) : await toB64(data);
    const res = await fetch('/api/files/upload', { method: 'POST', headers: headers(), body: JSON.stringify({ name: clean, data: b64 }) });
    if (!res.ok) throw new Error(`Could not save the file (${await res.text().catch(() => res.status)}).`);
    return String((await res.json()).path ?? `user/files/${clean}`).replace(/\\/g, '/').replace(/^\//, '');
}
export async function deleteUserFile(path: string) {
    try { await fetch('/api/files/delete', { method: 'POST', headers: headers(), body: JSON.stringify({ path }) }); } catch { /* already gone */ }
}

/* ---------- backgrounds (SillyTavern's own files and folders) ---------- */

export interface BgFolder { id: string; name: string }
export interface Bgs { images: string[]; folders: BgFolder[]; map: Record<string, string[]> }
const post = (url: string, body: unknown = {}) => fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
export async function bgList(): Promise<Bgs> {
    const all = await (await post('/api/backgrounds/all')).json();
    let folders: BgFolder[] = [], map: Record<string, string[]> = {};
    try { const f = await (await post('/api/backgrounds/folders')).json(); folders = (f.folders ?? []).map((x: any) => ({ id: String(x.id), name: String(x.name) })); map = f.imageFolderMap ?? {}; } catch { /* older SillyTavern: no folders */ }
    return { images: (all.images ?? []).map((x: any) => String(x.filename ?? x)), folders, map };
}
export const bgThumb = (file: string) => `${ctx().getThumbnailUrl('bg', file)}${picQuery()}`;
export const bgUrl = (file: string) => `/backgrounds/${encodeURIComponent(file)}`;
// Tells SillyTavern's own backgrounds panel to reload.
async function bgRefresh() { try { const path = '../../../../../backgrounds.js'; const m: any = await import(/* @vite-ignore */ new URL(path, import.meta.url).href); await m.getBackgrounds?.(); } catch { /* panel refreshes on open */ } }
export async function bgUpload(file: Blob, name: string): Promise<string> {
    const form = new FormData();
    form.append('avatar', file, name);
    const res = await fetch('/api/backgrounds/upload', { method: 'POST', headers: headers(false), body: form, cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not upload the image.');
    const bg = (await res.text()).trim();
    await bgRefresh();
    return bg;
}
export async function bgRename(oldBg: string, newBg: string) {
    const res = await post('/api/backgrounds/rename', { old_bg: oldBg, new_bg: newBg });
    if (!res.ok) throw new Error('Could not rename.');
    picVersion = bust(); await bgRefresh();
}
export async function bgDelete(files: string[]): Promise<number> {
    let n = 0;
    for (const bg of files) if ((await post('/api/backgrounds/delete', { bg })).ok) n++;
    await bgRefresh();
    return n;
}
export async function bgFolderCreate(name: string): Promise<BgFolder> {
    const res = await post('/api/image-metadata/folders/create', { name });
    if (!res.ok) throw new Error('Could not create the folder.');
    const f = await res.json();
    return { id: String(f.id), name: String(f.name ?? name) };
}
export async function bgFolderPut(id: string, files: string[], on: boolean) {
    const res = await post(on ? '/api/image-metadata/folders/assign' : '/api/image-metadata/folders/unassign', { id, paths: files.map(f => `backgrounds/${f}`) });
    if (!res.ok) throw new Error('Could not move.');
    await bgRefresh();
}

/* ---------- expression sprites ---------- */

export const DEFAULT_EXPRESSIONS = ['admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring', 'confusion', 'curiosity', 'desire', 'disappointment', 'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear', 'gratitude', 'grief', 'joy', 'love', 'nervousness', 'optimism', 'pride', 'realization', 'relief', 'remorse', 'sadness', 'surprise', 'neutral'];
export const expressionLabels = (): string[] => [...new Set([...DEFAULT_EXPRESSIONS, ...(ctx().extensionSettings?.expressions?.custom ?? [])])];
export async function uploadSprite(avatar: string, label: string, file: Blob, spriteName = label, outfit?: string) {
    const form = new FormData();
    form.append('name', outfit === undefined ? spriteFolder(avatar) : outfit ? `${baseSpriteFolder(avatar)}/${outfit}` : baseSpriteFolder(avatar));
    form.append('label', label);
    form.append('avatar', file, `${spriteName}.png`);
    form.append('spriteName', spriteName);
    const res = await fetch('/api/sprites/upload', { method: 'POST', headers: headers(false), body: form });
    if (!res.ok) throw new Error('Could not upload the image.');
}
export async function deleteSprite(avatar: string, label: string, spriteName: string, outfit?: string) {
    const name = outfit === undefined ? spriteFolder(avatar) : outfit ? `${baseSpriteFolder(avatar)}/${outfit}` : baseSpriteFolder(avatar);
    const res = await fetch('/api/sprites/delete', { method: 'POST', headers: headers(), body: JSON.stringify({ name, label, spriteName }) });
    if (!res.ok) throw new Error('Could not delete the image.');
}

/* ---------- events ---------- */

export const on = (name: string, fn: (...a: any[]) => void) => {
    const c = ctx();
    if (c.eventTypes?.[name]) c.eventSource.on(c.eventTypes[name], fn);
};
