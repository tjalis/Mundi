// A world attached to one of your own chats: any one-on-one or group chat becomes a Mundi game without a new group
// chat. The chat's characters are the people of the world, its lines before the world came stay as they are, and its
// own lorebook and Author's Note are kept. Detaching gives the chat back as it was (the save is kept in the chat, so
// the world can be brought back later).
import { game, settings, saveSettings, state, notify, TUT, hostOf, type Save, type Host } from '../core/store.js';
import { backup } from '../core/saves.js';
import { loadWorld, getWorld, worldLocked } from '../core/world.js';
import {
    ctx, chat, persona, personaName, openChatRef, scenarioOpen, groupOf, charOf, saveMeta, setChatLores, chatLores,
    setMuted, unhideMessages, setPrompt, clearAsk,
} from '../st/bridge.js';
import { startNewGame, syncScene, type Hero } from './game.js';
import { clearPrompt, refreshPrompt } from './prompt.js';
import { applyGameLore } from './lore.js';

// The chat open now can take a world: one of your own chats (not a Mundi game already, not the tutorial).
export const canAttach = () => !TUT.save && !game() && scenarioOpen() && !!openChatRef();
// A world detached from this chat earlier, kept in the chat to bring back.
export const detachedSave = (): Save | null => { const d = ctx().chatMetadata?.mundi_detached; return d?.v === 1 ? d as Save : null; };

export async function attachWorld(worldId: string) {
    if (!canAttach()) throw new Error('Open one of your own chats first (not a Mundi game).');
    const w = await loadWorld(worldId);
    if (worldLocked(w)) throw new Error('This world is not ready yet.');
    const ref = openChatRef()!;
    // everyone in the chat lives in the world (in a group, the muted members too: Mundi mutes whoever is not here)
    const cast = ref.group ? [...(groupOf(ref.group)?.members ?? [])] : [ref.avatar!];
    if (!cast.length) throw new Error('This chat has no characters.');
    const hero: Hero = {
        name: personaName(), age: w.sheet.age?.default ?? 24, appearance: {}, origin: w.catalogs.origins?.[0]?.id ?? '',
        traits: Object.fromEntries((w.sheet.traits ?? []).map(t => [t.id, [] as string[]])), bio: '', portrait: null,
    };
    await startNewGame({ world: w, cast, examples: false, hero, persona: persona() || undefined, attach: true });
}

// Takes the world off the chat open now. The chat gets back its lorebooks, Author's Note, muted members and the lines
// Mundi hid; the save is backed up and kept in the chat (`mundi_detached`) so it can be brought back.
export async function detachWorld() {
    const g = game(); const h = hostOf(g);
    if (!g || !h || TUT.save) throw new Error('This save is not attached to one of your chats.');
    const m = ctx().chatMetadata;
    backup(g, 'detached from the chat');
    m.mundi_detached = structuredClone(g);
    await setChatLores((h.prevLore ?? []).filter(n => n !== h.lore));
    if (h.noteSet) m.note_prompt = '';
    if (h.group) await setMuted(h.group, h.prevDisabled ?? []);
    await unhideMessages(h.attachedAt, chat().length - 1);
    delete m.mundi;
    await saveMeta();
    forget(h);
    clearPrompt(); setPrompt('mundi_roll', ''); clearAsk();
    await applyGameLore();
    state.view = 'chat'; state.sel = null;
    notify();
}

// Brings back the world detached from this chat, where it was left (day, people, money…).
export async function reattachWorld() {
    const d = detachedSave(); const ref = openChatRef();
    if (!d || !ref || !canAttach()) throw new Error('There is no detached world in this chat.');
    const w = await loadWorld(d.world);
    const old = hostOf(d)!;
    const m = ctx().chatMetadata;
    const h: Host = {
        ...old, chatId: ref.chatId, lore: old?.lore ?? `Mundi - ${w.name}`, prevLore: chatLores(), noteSet: false,
        ...(ref.group ? { group: ref.group, prevDisabled: [...(groupOf(ref.group)?.disabled_members ?? [])] } : {}),
    };
    (d as any).host = h;
    // lines written while the world was away are this visit's (never the ones before it was first attached)
    (d as any).visitStart = Math.min(Math.max((d as any).visitStart ?? h.attachedAt, h.attachedAt), chat().length);
    m.mundi = d;
    delete m.mundi_detached;
    await setChatLores([...h.prevLore, h.lore]);
    const note = getWorld(d.world)?.note;
    if (note?.text && !String(m.note_prompt ?? '').trim()) {
        m.note_prompt = note.text; m.note_interval = note.interval ?? 1; m.note_depth = note.depth ?? 4; m.note_position = note.position ?? 1;
        h.noteSet = true;
    }
    await saveMeta();
    const title = `${w.name} · ${ref.group ? groupOf(ref.group)?.name ?? '' : charOf(ref.avatar!)?.name ?? ''}`;
    settings().attached = [{ groupId: ref.group ?? '', world: w.id, title, persona: persona(), created: Date.now(), last: Date.now(), chatId: ref.chatId, ...(ref.avatar ? { avatar: ref.avatar } : {}), attached: true },
        ...(settings().attached ?? []).filter(e => e.chatId !== ref.chatId)];
    settings().last = { kind: 'world', attached: true, group: ref.group, avatar: ref.avatar, chatId: ref.chatId };
    saveSettings();
    await applyGameLore();
    state.view = 'map'; state.sel = null;
    await syncScene();
    refreshPrompt();
    notify();
}

function forget(h: Host) {
    const s = settings();
    s.attached = (s.attached ?? []).filter(e => e.chatId !== h.chatId);
    if (s.last?.chatId === h.chatId) s.last = { kind: 'chat', group: h.group, avatar: h.avatar, chatId: h.chatId };
    saveSettings();
}
