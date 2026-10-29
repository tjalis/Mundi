// Games and saves. A new game creates native SillyTavern objects: the cast's cards (when the world's example
// cast is used), the player's persona, the world's lorebook and a group chat. The save lives in that chat.
import { pictureAt } from './daynight.js';
import { addXp, makeSheet, syncLife, type NewSheet } from './rpg.js';
import { rpgOf, withRpg, type RpgDef } from '../core/rpgdef.js';
import { SCHEMA } from '../core/saves.js';
import { worldFile, isScenario, SCENARIO_STARTS } from '../core/world.js';
import { DIFFICULTIES, type Difficulty } from './bills.js';
import { placeOf as placeOf2 } from './places.js';
import { TUT, settings as settings2 } from '../core/store.js';
import { note, placeName } from './facts.js';
import {
    settings, saveSettings, state, game, setGame, saveGame, notify, toast, type Save, type Resident, type GameEntry,
    type AttachedEntry, type Host,
} from '../core/store.js';
import { loadWorld, getWorld, exampleTag, type WorldDef, type Origin, type GameMode } from '../core/world.js';
import { setWorldDicts } from '../core/tr.js';
import { lang } from '../core/i18n.js';
import {
    characters, charOf, createCharacter, createPersona, usePersona, createGroup, openGame, groupOf, clearGreetings,
    writeLorebook, bindChatLore, setPresent, saveMeta, chat, currentChatId, selectedGroup, pastChats,
    deleteChat, deleteGroup, setPersonaSheet, personaSheet, personaName, recentChats, ctx, deleteScenarioChat,
    saveName, copyGroupChat, groupChatId,
    readChatMeta, openChatRef, chatLores, setChatLores, openChat,
} from '../st/bridge.js';
import { playerHomeId } from './places.js';
import { presentAt } from './people.js';
import { sceneText, refreshPrompt } from './prompt.js';
import { liveTogether, setTie, normalizeHomes, startingStand, LOVE_TIES, loveStatus, type TieType, type TieTone } from './living.js';
import { applyGameLore } from './lore.js';

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

// A square portrait with initials on a gradient (used when no image is chosen).
export function initialsAvatar(name: string, colors: [string, string]): Promise<Blob> {
    const c = document.createElement('canvas'); c.width = c.height = 400;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 400, 400); grad.addColorStop(0, colors[0]); grad.addColorStop(1, colors[1]);
    g.fillStyle = grad; g.fillRect(0, 0, 400, 400);
    g.fillStyle = 'rgba(255,255,255,.92)'; g.font = '700 170px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase(), 200, 215);
    return new Promise(res => c.toBlob(b => res(b!), 'image/png'));
}
const PALETTE: [string, string][] = [['#ff7a9a', '#7a2e8f'], ['#3b82f6', '#6d28d9'], ['#f59e0b', '#b45309'], ['#10b981', '#065f46'], ['#ef4444', '#7f1d1d'], ['#8b5cf6', '#312e81'], ['#06b6d4', '#164e63'], ['#ec4899', '#831843']];

/* ---------- the player's character ---------- */

export interface Hero {
    name: string; age: number; appearance: Record<string, string>; origin: string;
    traits: Record<string, string[]>; bio: string; portrait: Blob | null;
}

export function heroDescription(w: WorldDef, h: Hero): string {
    const origin = w.catalogs.origins?.find(o => o.id === h.origin);
    const look = (w.sheet.appearance ?? []).map(a => h.appearance[a.id] ? `${a.label.toLowerCase()}: ${h.appearance[a.id].toLowerCase()}` : '').filter(Boolean).join(', ');
    const traits = (w.sheet.traits ?? []).map(t => (h.traits?.[t.id]?.length ? `${t.label}: ${h.traits[t.id].map(x => x.toLowerCase()).join(', ')}.` : '')).filter(Boolean);
    return [
        `{{user}} is ${h.name}, ${h.age}.`,
        look ? `Appearance: ${look}.` : '',
        origin ? `Background: ${origin.name} — ${origin.desc ?? ''}` : '',
        ...traits,
        h.bio.trim(),
    ].filter(Boolean).join('\n');
}

// What the persona was made from, kept inside the persona itself so the Library can show and edit it.
export interface PersonaSheet { world: string; name: string; age: number; appearance: Record<string, string>; origin: string; traits: Record<string, string[]>; bio: string }
export const sheetOf = (w: WorldDef, h: Hero): PersonaSheet => ({ world: w.id, name: h.name, age: h.age, appearance: { ...h.appearance }, origin: h.origin, traits: JSON.parse(JSON.stringify(h.traits ?? {})), bio: h.bio });

/* ---------- the cast ---------- */

// The world's example characters become real cards (created once, reused by later games).
async function exampleCards(w: WorldDef): Promise<string[]> {
    const out: string[] = [];
    let i = 0;
    for (const ex of w.cast.examples) {
        const tag = exampleTag(w, ex);
        const slugName = ex.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const byFile = new RegExp(`^mundi_(?:${[ex.from, w.id].filter(Boolean).map(x => String(x).replace(/[^a-z0-9_-]/gi, '')).join('|')})_${slugName}(?:_?\\d+)?\\.png$`, 'i');
        const found = characters().find(c => c.data?.extensions?.mundi?.example === tag) ?? characters().find(c => byFile.test(String(c.avatar ?? '')));
        if (found) { out.push(found.avatar); i++; continue; }
        const file = `mundi_${w.id}_${ex.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
        const avatar = await createCharacter({
            name: ex.name, description: ex.description, first_mes: ex.first_mes ?? '', personality: ex.personality ?? '',
            scenario: w.setting, tags: ['Mundi', w.name], file,
            extensions: { mundi: { example: tag, world: w.id, occupation: ex.occupation, home: ex.home, routine: ex.routine, leisure: ex.leisure ?? [] } },
        }, await initialsAvatar(ex.name, PALETTE[i++ % PALETTE.length]));
        out.push(avatar);
    }
    return out;
}

export { spotKey, takenHomes, homeSpot } from './homes.js';
import { spotKey, homeSpot, takenHomes } from './homes.js';

// Home: someone given a "second flat" at a bedroom (more people than bedrooms) shares that bedroom instead.
export function shareRooms(g: Save) { for (const r of Object.values(g.cast)) { delete (r.home as any).unit; r.occupation = null; } }   // (and no ready-made jobs in a Home)
// Home: a character joins the house in the middle of a game (a free bedroom, or sharing one).
export async function addResident(g: Save, w: WorldDef, avatar: string): Promise<Resident | null> {
    if (g.cast[avatar]) return null;
    const r = resident(w, avatar, takenHomes(g), g.player.home);
    delete (r.home as any).unit; r.occupation = null;
    const st = SCENARIO_STARTS.find(s => s.id === (g as any).cfg?.start?.id);
    r.met = !!st?.met;
    g.cast[avatar] = r;
    normalizeHomes(g);
    note(g, '{0} moved into the house.', [r.name], [avatar], g.player.loc, 'event');
    await syncScene();
    return r;
}
// Home: someone moves out of the house (their card and chats stay in SillyTavern; their memories of the house stay in
// the story's facts). Plans with them are called off.
export function removeResident(g: Save, avatar: string) {
    const r = g.cast[avatar]; if (!r) return;
    const soc: any = (g as any).social;
    if (soc) { soc.with = (soc.with ?? []).filter((c: any) => c.avatar !== avatar); for (const a of soc.appts ?? []) if (a.avatar === avatar && (a.state === 'set' || a.state === 'met')) a.state = 'cancelled'; if (soc.solo === avatar) soc.solo = ''; }
    for (const x of Object.values(g.cast)) if ((x as any).homeWith === avatar) delete (x as any).homeWith;
    delete g.cast[avatar];
    normalizeHomes(g);
    note(g, '{0} moved out of the house.', [r.name], [avatar], g.player.loc, 'event');
}
// Home: moves someone to another bedroom (a spot of a housing area); with someone there already, they share it.
export function moveToRoom(g: Save, avatar: string, h: { zone: string; x: number; y: number }) {
    const r = g.cast[avatar]; if (!r) return;
    r.home = { zone: h.zone, x: h.x, y: h.y };
    delete (r as any).homeWith;
    normalizeHomes(g);
}

export function resident(w: WorldDef, avatar: string, taken: Set<string>, avoid?: { zone: string; x: number; y: number }): Resident {
    const ch = charOf(avatar);
    const card = ch?.data?.extensions?.mundi ?? {};
    // one of this world's own people: her job, home and routine come from the world (also in copied worlds)
    const ex = w.cast.examples.find(e => exampleTag(w, e) === card.example);
    const meta = ex ? { world: w.id, occupation: ex.occupation, home: ex.home, routine: ex.routine, leisure: ex.leisure ?? [] } : card;
    const occupation = meta.world === w.id ? meta.occupation ?? null : pick([...w.occupations.map(o => o.id), null]);
    const templateId = meta.world === w.id && meta.routine ? meta.routine : (occupation ? pick(['office', 'early']) : pick(Object.keys(w.cast.routineTemplates)));
    const routine = structuredClone(w.cast.routineTemplates[templateId] ?? Object.values(w.cast.routineTemplates)[0]);
    const zone = meta.world === w.id && meta.home ? meta.home : pick(w.homes.zones).id;
    return { avatar, name: ch?.name ?? avatar, occupation, home: homeSpot(w, zone, taken, avoid), routine, leisure: meta.world === w.id ? meta.leisure ?? [] : [], met: false };
}

/* ---------- new game ---------- */

export interface NewGame {
    world: WorldDef; cast: string[]; examples: boolean; hero: Hero; persona?: string; lore?: string[];
    /** households made at the start (people who share a home, and their ties), your household, and your chosen home */
    households?: { members: string[]; ties: { a: string; b: string; type: TieType; tone: TieTone }[]; home?: { zone: string; x: number; y: number; n: number } }[];
    family?: { avatar: string; type: TieType; tone: TieTone }[];
    home?: { zone: string; x: number; y: number; n: number };
    difficulty?: Difficulty;
    /** where people stand with you at the start (−100 … 100), from a preset */
    approval?: Record<string, number>;
    /** relations between any two people of the cast ('__you' is you), whatever household they live in */
    ties?: { a: string; b: string; type: TieType; tone: TieTone }[];
    /** how this game is played (a world with an RPG can be played either way) */
    mode?: GameMode;
    /** RPG: the class, attributes and skills chosen */
    rpg?: Omit<NewSheet, 'origin'>;
    /** RPG: the system chosen, when it is not the world's own */
    rpgDef?: RpgDef;
    /** a scenario: the rooms the house has in this game */
    rooms?: string[];
    /** a scenario: rooms added for this game, and the actions chosen for some rooms (room id → action ids) */
    extraRooms?: any[]; roomActs?: Record<string, string[]>;
    /** jobs chosen for your characters: an occupation id, or 'none' (no job); left out: at random */
    jobs?: Record<string, string>;
    /** a scenario: how you fit in it (SCENARIO_STARTS id) and, for `custom`, the premise you wrote */
    start?: { id: string; text?: string };
    /** memories from another game (a save's chat id): only what the people of this cast remember */
    memoriesFrom?: string;
    /** attach the world to the open chat (one of your own) instead of making a new group chat (sim/attach.ts) */
    attach?: boolean;
}

export async function startNewGame(o: NewGame) {
    const w = o.world;
    // attaching: the open chat stays as it is (its lines, greetings, lorebook and Author's Note); the save goes into it
    const host = o.attach ? openChatRef() : null;
    if (o.attach && !host) throw new Error('Open a chat first.');
    if (o.attach && game()) throw new Error('This chat already has a world.');
    state.busy = 'Creating the cast'; notify();
    const cast = [...new Set([...(o.examples ? await exampleCards(w) : []), ...o.cast])];
    if (!cast.length) throw new Error('Choose at least one person to live in the world.');

    // your character: a persona you already have, or a new one saved to your personas
    let personaFile = o.persona ?? '';
    if (personaFile) {
        o.hero.name = personaName(personaFile);
        const sheet = personaSheet(personaFile);
        // the origin, traits and words chosen in the new game win; the persona keeps them for its next game here
        const chosen = Object.values(o.hero.traits ?? {}).some(v => (Array.isArray(v) ? v.length : !!v));
        if (!chosen && sheet?.traits && sheet.world === w.id) o.hero.traits = sheet.traits;
        setPersonaSheet(personaFile, { ...(sheet ?? {}), world: w.id, origin: o.hero.origin, traits: JSON.parse(JSON.stringify(o.hero.traits ?? {})), bio: o.hero.bio ?? '' });
    } else {
        state.busy = 'Creating your character'; notify();
        const portrait = o.hero.portrait ?? await initialsAvatar(o.hero.name, ['#22d3ee', '#4f46e5']);
        personaFile = await createPersona(o.hero.name, heroDescription(w, o.hero), portrait);
        setPersonaSheet(personaFile, sheetOf(w, o.hero));
    }

    state.busy = 'Writing the world\'s lorebook'; notify();
    const loreName = `Mundi - ${w.name}`;
    await writeLorebook(loreName, [
        { keys: [w.name], content: w.setting, constant: true, comment: 'Setting' },
        ...w.lore.map(l => ({ keys: l.keys, content: l.content, constant: !!l.constant })),
        ...w.places.map(p => ({ keys: [p.name], content: `${p.name}: ${p.desc ?? ''}`, comment: `Place: ${p.name}` })),
    ]);

    let groupId = host?.group ?? '';
    if (!host) {
        state.busy = 'Creating the world\'s group chat'; notify();
        groupId = await createGroup(`Mundi · ${w.name} · ${o.hero.name}`, cast);
        await openGame(groupId);
        clearGreetings();
    }

    const taken = new Set<string>();
    const origin: Origin | undefined = w.catalogs.origins?.find(x => x.id === o.hero.origin) ?? w.catalogs.origins?.[0];
    const picked = o.home && w.homes.zones.find(z => z.id === o.home!.zone);
    if (picked) taken.add(spotKey(o.home!.zone, o.home!.x, o.home!.y));
    // homes chosen for households are nobody else's
    for (const h of o.households ?? []) if (h.home && w.homes.zones.some(z => z.id === h.home!.zone)) taken.add(spotKey(h.home.zone, h.home.x, h.home.y));
    const home = picked ? { zone: o.home!.zone, x: o.home!.x, y: o.home!.y, n: o.home!.n } : homeSpot(w, origin?.home ?? w.homes.zones[0].id, taken);
    const zone = w.homes.zones.find(z => z.id === home.zone)!;
    const save: Save = {
        v: 1, world: w.id, lang: lang(), day: w.time.startDay, minutes: w.time.startMinutes, speed: w.time.speed,
        player: {
            loc: playerHomeId, home: { ...home, kind: zone.kind },
            stats: Object.fromEntries(w.statuses.map(s => [s.id, s.start])),
            money: Math.round((origin?.money ?? 0) * (DIFFICULTIES.find(d => d.id === (o.difficulty ?? 'normal'))?.start ?? 1)), traits: JSON.parse(JSON.stringify(o.hero.traits ?? {})), origin: origin?.id ?? '', job: null, rentPaidDay: w.time.startDay,
        },
        cast: {}, tick: {}, log: [],
        ...({ cfg: { difficulty: o.difficulty ?? 'normal', ...(o.mode ? { mode: o.mode } : {}) }, schema: SCHEMA } as any),
    };
    // a persona's words about you in this world (its own description stays as it is)
    if (o.persona && o.hero.bio?.trim()) (save.player as any).bio = o.hero.bio.trim().slice(0, 1200);
    // nobody lives in your home unless you chose them (your household)
    for (const a of cast) save.cast[a] = resident(w, a, taken, save.player.home);
    // jobs chosen at the start: the job, and a routine that goes to work (or none that does)
    for (const [a, id] of Object.entries(o.jobs ?? {})) {
        const r = save.cast[a]; if (!r) continue;
        const job = id === 'none' ? null : w.occupations.find(x => x.id === id); if (id !== 'none' && !job) continue;
        r.occupation = job?.id ?? null;
        const goes = (t: any) => [...(t?.weekday ?? []), ...(t?.weekend ?? [])].some((s: any) => s[1] === 'work');
        if (!!job !== goes(r.routine)) {
            const tpl = Object.entries(w.cast.routineTemplates).find(([k, t]) => goes(t) === !!job && (!job || k === 'office' || k === 'early')) ?? Object.entries(w.cast.routineTemplates).find(([, t]) => goes(t) === !!job);
            if (tpl) r.routine = structuredClone(tpl[1]);
        }
    }
    // RPG: the character sheet (class, attributes, skills; the background adds its own)
    if ((o.mode ?? w.mode) === 'rpg' && rpgOf(w) && o.rpg) {
        if (o.rpgDef) (save as any).rpgDef = structuredClone(o.rpgDef);   // another system than the world's
        withRpg(o.rpgDef ?? w.rpg, () => { (save as any).rpg = makeSheet(w, { ...o.rpg!, origin }); syncLife(save, w); });
    }
    // memories carried over from another life (another game with some of the same people): memories only
    if (o.memoriesFrom) { try { await portMemories(save, o.memoriesFrom); } catch (e) { console.warn('[Mundi] memories', e); } }
    // your household moves in with you; each other household shares the home of its first member
    for (const f of o.family ?? []) {
        if (!save.cast[f.avatar]) continue;
        save.cast[f.avatar].met = true;
        liveTogether(save, '__you', f.avatar);
        setTie(save, { a: f.avatar, b: '__you', type: f.type, tone: f.tone });
    }
    for (const h of o.households ?? []) {
        const [head, ...rest] = h.members.filter(a => save.cast[a]);
        if (!head) continue;
        if (h.home && w.homes.zones.some(z => z.id === h.home!.zone)) { save.cast[head].home = { zone: h.home.zone, x: h.home.x, y: h.home.y, n: h.home.n }; delete (save.cast[head] as any).homeWith; }
        for (const a of rest) liveTogether(save, head, a);
        for (const t of h.ties) if (save.cast[t.a] && save.cast[t.b]) setTie(save, t);
    }
    // relations: the world's own (between its example people) and the ones chosen for this game (anyone with anyone)
    const exAvatar = new Map<string, string>();
    for (const a of Object.keys(save.cast)) { const tag = charOf(a)?.data?.extensions?.mundi?.example; const ex = w.cast.examples.find(e => exampleTag(w, e) === tag); if (ex) exAvatar.set(ex.name, a); }
    for (const ex of w.cast.examples) for (const t of ex.ties ?? []) { const a = exAvatar.get(ex.name), b = exAvatar.get(t.to); if (a && b && a !== b) setTie(save, { a, b, type: t.type as TieType, tone: t.tone as TieTone }); }
    for (const t of o.ties ?? []) {
        if ((t.a !== '__you' && !save.cast[t.a]) || (t.b !== '__you' && !save.cast[t.b]) || t.a === t.b) continue;
        setTie(save, t);
        applyTie(save, t);
    }
    // a scenario: how you fit in the house (you know everyone already, or nobody), unless a relation said otherwise
    const st0 = isScenario(w) && o.start ? SCENARIO_STARTS.find(s => s.id === o.start!.id) : undefined;
    if (st0) {
        if (o.rooms) (save as any).cfg.rooms = o.rooms.filter(id => w.places.some(p => p.id === id));
        if (o.rooms) (save as any).cfg.roomsSeen = w.places.filter(p => !p.link).map(p => p.id);   // the rooms there were to choose from
        if (o.extraRooms?.length) (save as any).cfg.extraRooms = o.extraRooms.filter(r => r?.id && r?.name).map(r => ({ id: r.id, name: String(r.name).slice(0, 60), map: w.maps[0]?.id ?? '', x: 50, y: 50, tags: r.tags ?? ['leisure'], desc: String(r.desc ?? '').slice(0, 400), ...(r.bg ? { bg: r.bg } : {}), closed: [] }));
        if (o.roomActs && Object.keys(o.roomActs).length) (save as any).cfg.roomActs = o.roomActs;
        (save as any).cfg.start = { id: st0.id, ...(st0.id === 'custom' && o.start!.text?.trim() ? { text: o.start!.text.trim().slice(0, 4000) } : {}) };
        if (st0.met) for (const r of Object.values(save.cast)) {
            const soc = ((save as any).social ??= {}); const liv = ((save as any).living ??= {});
            if (!r.met) { (soc.bond ??= {})[r.avatar] ??= st0.bond ?? 0; (liv.approval ??= {})[r.avatar] ??= st0.approval ?? 0; }
            r.met = true;
        }
    }
    // where each one stands with you, from a preset
    for (const [a, v] of Object.entries(o.approval ?? {})) {
        if (!save.cast[a] || !Number.isFinite(v)) continue;
        const liv = ((save as any).living ??= {}); (liv.approval ??= {})[a] = Math.max(-100, Math.min(100, v));
        const soc = ((save as any).social ??= {}); (soc.bond ??= {})[a] = Math.max(0, Math.min(100, Math.round(50 + v / 2)));
        save.cast[a].met = true;
    }
    if (isScenario(w)) shareRooms(save);   // Home: more people than bedrooms share a room (no second flat in a house)
    normalizeHomes(save);
    // the world's lorebooks and the characters' lorebooks chosen to stay on in this world
    const books = [...new Set([...(w.lorebooks ?? []), ...(o.lore ?? [])])];
    if (books.length) (save as any).cfg = { ...(save as any).cfg, lore: books };   // keeps the difficulty
    Object.values(save.cast).slice(0, origin?.knows ?? 0).forEach(r => { r.met = true; });
    const m = ctx().chatMetadata;
    if (host) {
        // the people the chat already knows, and what attaching changes in the chat (put back when it is detached)
        for (const r of Object.values(save.cast)) r.met = true;
        const h: Host = {
            kind: host.group ? 'group' : 'solo', ...(host.group ? { group: host.group } : { avatar: host.avatar }), chatId: host.chatId,
            attachedAt: chat().length, lore: loreName, prevLore: chatLores(),
            ...(host.group ? { prevDisabled: [...(groupOf(host.group)?.disabled_members ?? [])] } : {}),
        };
        (save as any).host = h;
        (save as any).visitStart = chat().length;   // the lines before the world came are never hidden
        setGame(save);
        await setChatLores([...h.prevLore, loreName]);   // the chat's own lorebook stays its "chat lore"
        if (w.note?.text && !String(m.note_prompt ?? '').trim()) {
            m.note_prompt = w.note.text; m.note_interval = w.note.interval ?? 1; m.note_depth = w.note.depth ?? 4; m.note_position = w.note.position ?? 1;
            h.noteSet = true;
        }
    } else {
        setGame(save);
        await bindChatLore(loreName);
        if (w.note?.text) {   // the world's Author's Note, the same one SillyTavern uses
            m.note_prompt = w.note.text; m.note_interval = w.note.interval ?? 1; m.note_depth = w.note.depth ?? 4; m.note_position = w.note.position ?? 1;
        }
        await usePersona(personaFile);
    }
    await saveMeta();

    const entry: GameEntry = { groupId, world: w.id, title: `${w.name} · ${o.hero.name}`, persona: personaFile, created: Date.now(), last: Date.now() };
    if (host) {
        const a: AttachedEntry = { ...entry, title: `${w.name} · ${host.group ? groupOf(host.group)?.name ?? '' : charOf(host.avatar!)?.name ?? ''}`, chatId: host.chatId, ...(host.avatar ? { avatar: host.avatar } : {}), attached: true };
        settings().attached = [a, ...(settings().attached ?? []).filter(e => e.chatId !== host.chatId)];
        settings().last = { kind: 'world', attached: true, group: host.group, avatar: host.avatar, chatId: host.chatId };
    } else {
        settings().games.unshift(entry);
        settings().lastGame = groupId;
        settings().last = { kind: 'world', group: groupId, chatId: currentChatId() };
    }
    saveSettings();
    await applyGameLore();
    await afterEnter();
}

/* ---------- entering and leaving ---------- */

export const gameEntry = (groupId: string | null) => settings().games.find(e => e.groupId === groupId) ?? null;
export const attachedEntry = (chatId: string | null | undefined) => (chatId ? (settings().attached ?? []).find(e => e.chatId === chatId) ?? null : null);
export const currentEntry = (): GameEntry | null => gameEntry(selectedGroup()) ?? (game() ? attachedEntry(currentChatId()) : null);

// Opens one of your own chats that has a world attached.
export async function enterAttached(chatId: string) {
    const entry = attachedEntry(chatId);
    if (!entry) { toast('This chat has no world attached.', 'error'); return; }
    if (entry.avatar ? !charOf(entry.avatar) : !groupOf(entry.groupId)) { toast('This chat no longer exists in SillyTavern.', 'error'); return; }
    await loadWorld(entry.world);
    await openChat({ avatar: entry.avatar, group: entry.groupId || undefined, chatId });
    if (!game()) { toast('This chat has no Mundi save any more.', 'error'); return; }
    entry.last = Date.now();
    tokenNote();
    settings().last = { kind: 'world', attached: true, group: entry.groupId || undefined, avatar: entry.avatar, chatId };
    saveSettings();
    await afterEnter();
}

export async function enterGame(groupId: string, chatId?: string) {
    const entry = gameEntry(groupId);
    if (!entry || !groupOf(groupId)) { toast('This game no longer exists in SillyTavern.', 'error'); return; }
    await loadWorld(entry.world);
    await openGame(groupId, chatId);
    if (!game()) { toast('This chat has no Mundi save.', 'error'); return; }
    entry.last = Date.now();
    tokenNote();
    settings().lastGame = groupId;
    settings().last = { kind: 'world', group: groupId, chatId: currentChatId() };
    saveSettings();
    await usePersona(entry.persona);
    await afterEnter();
}

// When a save loads: how big its chat is, and how much of it actually goes to the AI (only the current scene's lines
// are sent; older ones are hidden and live on as facts and the diary).
function tokenNote() {
    const list = chat(); const g = game(); if (!g) return;
    const est = (t: string) => Math.ceil(t.length / 3.6);
    const all = list.reduce((n, m) => n + est(String(m.mes ?? '')), 0);
    const sent = list.filter(m => !m.is_system).reduce((n, m) => n + est(String(m.mes ?? '')), 0);
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    toast(`This save: ${list.length} messages (≈ ${k(all)} tokens in all). Sent to the AI now: ≈ ${k(sent)} from the chat + ≈ ${k(est(sceneText()))} from Mundi, plus your preset and the cards of who is in the scene.`, 'info', { ms: 9000 });
}

async function afterEnter() {
    const g = game();
    const w = g && getWorld(g.world);
    if (w) setWorldDicts(w.id, w.i18n ?? {});
    state.view = 'map';
    state.sel = null;
    await syncScene();
    notify();
}

// A branch: a copy of this save as it is now (story, diary, state), saved next to it. You stay where you are;
// the branch shows up in Load.
export async function branchSave() {
    const g = game(); const gid = selectedGroup();
    if (!g || !gid) return;
    saveGame(); await saveMeta();
    const id = saveName(' (branch)');
    await copyGroupChat(gid, id, structuredClone(ctx().chatMetadata ?? {}), structuredClone(chat()));
    toast('Branch saved. You are still in this save; the branch is in Load.', 'success');
}

/* ---------- the scene follows the player ---------- */

let syncing: Promise<void> = Promise.resolve();
// Who is here: present residents are unmuted in the group, everyone else is muted. Then the prompt is refreshed.
// Someone you did not know becomes someone you know: only through an interaction (they answered you in the scene,
// you stopped to talk or said hi, you introduced yourself…), never just by being in the same place.
export function markMet(g: Save, avatar: string): boolean {
    const r = g.cast[avatar]; const w = getWorld(g.world);
    if (!r || r.met || !w) return false;
    r.met = true;
    note(g, '{u} met {0} for the first time, at {1}.', [r.name, placeName(g, w, g.player.loc)], [r.avatar], g.player.loc, 'meet');
    addXp(g, w, 10, 'met someone');   // RPG: meeting people is experience too
    return true;
}
export function syncScene(): Promise<void> {
    syncing = syncing.then(async () => {
        const g = game(); const gid = selectedGroup();
        if (!g || TUT.save) return;   // the tutorial's world is not a group chat
        // a world attached to a one-on-one chat has no group to mute: who is here goes to the AI in the scene prompt
        if (!gid && !(g as any).host) return;
        const w = getWorld(g.world);
        if (!w) return;
        const here = presentAt(g, w, g.player.loc);
        // talking with only one person: the others stay in the scene but keep quiet
        let solo = String((g as any).social?.solo ?? '');
        // the one you were talking to alone left: everyone talks again
        if (solo && !here.some(r => r.avatar === solo)) { (g as any).social.solo = ''; solo = ''; }
        const talking = solo ? [solo] : here.map(r => r.avatar);
        if (gid) await setPresent(gid, Object.keys(g.cast), talking);
        // Home: the room's dress code (the outfits are looked up in the background; the next sync catches up)
        { const { applyDress, dressAt } = await import('./dress.js'); const { outfitsOf, hasOutfit } = await import('../ui/outfits.js'); const code = dressAt(g, g.player.loc);
          applyDress(g, w, a => { const l = outfitsOf(a); if (!code) return l; const h = hasOutfit(a, code); return h === null ? null : h ? [...(l ?? []), code] : (l ?? []); }); }
        followBackground(g, w);
        refreshPrompt();
        saveGame();
        void import('../ui/spritegen.js').then(m => m.spritesFor(here.map(r => r.avatar)));   // sprites for people who have none
    }).catch(e => console.warn('[Mundi] scene sync', e));
    return syncing;
}

/* ---------- memories from another life ---------- */

// Only memories travel between games (Life-Sim ↔ RPG, or two games of the same people): what the people of this cast
// remember from the other game, marked as from another life. Nothing else (money, skills, jobs) comes along.
export async function portMemories(save: Save, chatId: string) {
    const meta = await readChatMeta(chatId);
    const old = meta?.mundi; if (!old) return 0;
    const here = new Set(Object.keys(save.cast));
    const list = ((old.facts ?? []) as any[]).filter(f => (f.who ?? []).some((a: string) => here.has(a))).slice(-120);
    const facts = ((save as any).facts ??= []) as any[];
    for (const f of list) facts.push({ ...f, id: `life2:${f.id}`, at: 0, place: '', t: `(In another life) ${f.t}` });
    return list.length;
}

/* ---------- saves list ---------- */

// A row of "Load": a world save (a chat of a game's group) or a scenario (any other SillyTavern chat).
export interface SaveRow { kind: 'world' | 'chat'; groupId: string; avatar?: string; chatId: string; title: string; world: string; last: number; count: number; current: boolean; preview?: string; /** a world attached to one of your own chats */ attached?: boolean }
export async function listSaves(): Promise<SaveRow[]> {
    const rows: SaveRow[] = [];
    for (const e of settings().games) {
        const g = groupOf(e.groupId);
        if (!g) continue;
        for (const c of await pastChats(e.groupId)) {
            const id = groupChatId(e.groupId, String(c.file_name ?? '').replace(/\.jsonl$/, ''));
            rows.push({ kind: 'world', groupId: e.groupId, chatId: id, title: e.title, world: e.world, last: Date.parse(c.last_mes) || Number(c.last_mes) || 0, count: Number(c.chat_items ?? 0), current: id === currentChatId() });
        }
    }
    // every other SillyTavern chat is a scenario, unless a world is attached to it
    const games = new Set(settings().games.map(e => e.groupId));
    const attached = new Map((settings().attached ?? []).map(e => [e.chatId, e] as const));
    try {
        for (const c of await recentChats()) {
            if (c.group && games.has(c.group)) continue;
            const a = attached.get(c.chatId);
            if (a && (a.avatar ? a.avatar === c.avatar : a.groupId === c.group)) {
                rows.push({ kind: 'world', attached: true, groupId: c.group ?? '', avatar: c.avatar, chatId: c.chatId, title: a.title, world: a.world, last: c.last, count: c.count, current: c.chatId === currentChatId(), preview: c.preview });
                continue;
            }
            // a chat nobody played (only the greeting, or empty: SillyTavern opens one by itself) is not a save
            if (c.count <= 1) continue;
            rows.push({ kind: 'chat', groupId: c.group ?? '', avatar: c.avatar, chatId: c.chatId, title: c.avatar ? charOf(c.avatar)?.name ?? '' : groupOf(c.group!)?.name ?? '', world: '', last: c.last, count: c.count, current: c.chatId === currentChatId(), preview: c.preview });
        }
    } catch (e) { console.warn('[Mundi] recent chats', e); }
    return rows.sort((a, b) => b.last - a.last);
}

export async function deleteSave(r: SaveRow) {
    // your own chat with a world attached: Mundi never deletes it (detach the world from inside, or delete the chat in SillyTavern)
    if (r.attached) throw new Error('This is one of your own chats with a world attached. Open it and use "Detach world", or delete the chat in SillyTavern.');
    if (r.kind === 'chat') { await deleteScenarioChat({ avatar: r.avatar, group: r.groupId || undefined, chatId: r.chatId }); return; }
    const g = groupOf(r.groupId);
    if (!g) return;
    if ((g.chats ?? []).length <= 1) {   // the last save of a game: the whole game goes
        await deleteGroup(r.groupId);
        settings().games = settings().games.filter(e => e.groupId !== r.groupId);
        if (settings().lastGame === r.groupId) settings().lastGame = null;
        if (settings().last?.group === r.groupId) settings().last = null;
        saveSettings();
    } else await deleteChat(r.groupId, r.chatId);
}

// 35: SillyTavern's own chat background can follow the place you are in (Settings → Game).
function followBackground(g: Save, w: WorldDef) {
    if ((settings2() as any).bgFollow !== 'chat') return;
    const p = placeOf2(g, w, g.player.loc);
    if (!p) return;
    let img = pictureAt(w, g.minutes, p.bg, w.places.find(x => x.id === p.id)?.bgs) ?? '';
    if (!img && p.home) { const k = w.homes.kinds[p.id === 'home:player' ? g.player.home.kind : (w.homes.zones.find(z => z.id === g.cast[p.id.slice(5)]?.home.zone)?.kind ?? '')]; img = (k && pictureAt(w, g.minutes, k.image, k.images)) ?? ''; }
    if (!img) return;
    const url = `url("${worldFile(w, img)}")`;
    const m = ctx().chatMetadata;
    if (m.custom_background === url) return;
    m.custom_background = url; ctx().saveMetadataDebounced();
    const el = document.getElementById('bg1'); if (el) el.style.backgroundImage = url;
}

// What a tie means beyond the tie itself: with you, where you stand with them (bond, approval, met, the romance:
// a spouse is "married", not a stranger); between two others, a couple. Used at the start and when a tie is
// added in This world → Family and ties. It never lowers what is already there.
export function applyTie(save: Save, t: { a: string; b: string; type: TieType }) {
    const other = t.a === '__you' ? t.b : t.b === '__you' ? t.a : '';
    if (other) {
        if (!save.cast[other]) return;
        const st = startingStand(t.type);
        const soc = ((save as any).social ??= {}); soc.bond ??= {}; soc.bond[other] = Math.max(soc.bond[other] ?? -Infinity, st.bond);
        const liv = ((save as any).living ??= {}); liv.approval ??= {}; liv.approval[other] = Math.max(liv.approval[other] ?? -Infinity, st.approval);
        save.cast[other].met = true;
        if (LOVE_TIES.includes(t.type)) {
            soc.partner ??= []; if (!soc.partner.includes(other)) soc.partner.push(other);
            const rom = ((save as any).romance ??= {}); const rank = ['none', 'dating', 'engaged', 'married'];
            const cur = rom[other], want = loveStatus(t.type);
            if (!cur || rank.indexOf(cur.status) < rank.indexOf(want)) rom[other] = { ...(cur ?? {}), value: Math.max(cur?.value ?? 0, 70), status: want };
        }
    } else if (LOVE_TIES.includes(t.type)) {
        const liv = ((save as any).living ??= {}); liv.pairs ??= [];
        if (!liv.pairs.some((p: string[]) => p.includes(t.a) && p.includes(t.b))) liv.pairs.push([t.a, t.b]);
        if (t.type === 'spouse' || t.type === 'fiance') (liv.pairInfo ??= {})[[t.a, t.b].sort().join('|')] = { since: save.day, stage: loveStatus(t.type) };
    }
}
