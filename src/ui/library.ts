// Library: everything in SillyTavern that shapes the roleplay. Characters, personas, lorebooks, backgrounds, the
// open save's notes and the world's rules. Reading is the default; "Edit" turns the fields into forms; "Advanced
// settings" (shown only while editing) adds the fields most players never touch and SillyTavern's own panels.
// Every change is saved into the native SillyTavern object (card, persona, lorebook, chat).
import { state, notify, esc, game, toast, busy, settings, saveSettings, type LibFolder } from '../core/store.js';
import { getWorld, loadWorld, BUILT_IN, activeStatuses, worlds } from '../core/world.js';
import {
    ctx, characters, charOf, thumb, fullCharacter, saveCharacter, personas, savePersona, personaThumb, persona,
    lorebooks, loadLore, saveLore, newLoreEntry, chatLore, groupOf, bindChatLore, type CardPatch,
    charLorebooks, setCharLorebooks, importCharacterFiles, importLorebookFiles, importPersonaPictures, folders, tagIdsOf, newFolder, putInFolder, isFav, setFavorite, deleteCharacters, deletePersonas, deleteLorebooks,
    createCharacter, createPersona, createLorebook, duplicateCharacter, duplicatePersona, duplicateLorebook,
    setCharacterImage, setPersonaImage, defaultPersona, setDefaultPersona, personaSheet, setPersonaSheet,
    fetchSprites, uploadSprite, deleteSprite, expressionLabels,
    bgList, bgThumb, bgUrl, bgUpload, bgRename, bgDelete, bgFolderCreate, bgFolderPut, type Bgs,
    refreshList, folderColor, setFolderColor, deleteFolder, personaLore, setPersonaLore, exportCharacter, cardFile, fileNameOf, baseSpriteFolder, loreCount, charTags, tagColor, tagCharacter, untagCharacter, allTags, cardTokens, cachedTokens, folderMade, renameFolder, characterChats, useGreeting, openCharacter,
} from '../st/bridge.js';
import { currentEntry, heroDescription, initialsAvatar } from '../sim/game.js';
import { mundify, mundifiedOf, madeForMundi, mundiCopies, hasStyle, addStyle } from '../sim/mundify.js';
import { mundifyLore, loreMundifiedOf, loreCopies } from '../sim/mundifylore.js';
import { sceneText } from '../sim/prompt.js';
import { ACT, INPUT } from './reg.js';
import { leaveHtml } from './creator.js';
import { icon } from './icons.js';
import { makeZip, uniqueName, download, type ZipFile } from '../core/zip.js';
import { outfitsOf, outfitLabel, savedOutfits, addOutfit, removeOutfit, forgetOutfits } from './outfits.js';
import { pickAndCrop, pickFile } from './cropper.js';
import { toggleTrait } from './traits.js';
import { nativeHost } from './native.js';
import { presetsTabHtml } from './castpresets.js';
import { spriteLookHtml, spriteTileButton, checkSprites, spriteStatus, drawEveryone, personaKey } from './spritegen.js';

const L = state.lib;
type Tab = 'characters' | 'personas' | 'lorebooks' | 'backgrounds' | 'presets' | 'save' | 'world' | 'st-characters' | 'st-personas' | 'st-worldinfo';
type ListTab = 'characters' | 'personas' | 'lorebooks' | 'backgrounds';
const TABS: [Tab, string][] = [['characters', 'Characters'], ['personas', 'Personas'], ['lorebooks', 'Lorebooks'], ['backgrounds', 'Backgrounds'], ['presets', 'Presets']];   // the save's and the world's settings live in the game (the globe button)
const ST_TABS: Tab[] = ['st-characters', 'st-personas', 'st-worldinfo'];
const isList = (t: string): t is ListTab => t === 'characters' || t === 'personas' || t === 'lorebooks' || t === 'backgrounds';
type Opt = [string | number, string];
const ROLES: Opt[] = [[0, 'System'], [1, 'User'], [2, 'Assistant']];
const ROLE_NAMES: Opt[] = [['system', 'System'], ['user', 'User'], ['assistant', 'Assistant']];
const btn = (act: string, ic: string, label: string, cls = '', extra = '') => `<button class="${cls}" data-act="${esc(act)}" ${extra}>${icon(ic)}<span>${label}</span></button>`;
const ibtn = (act: string, ic: string, title: string, cls = '', extra = '') => `<button class="mu-ibtn ${cls}" data-act="${esc(act)}" title="${title}" aria-label="${title}" ${extra}>${icon(ic)}</button>`;

/* ---------- favorites and folders, the same way for every list ---------- */
// Characters use SillyTavern's own favorites and folder tags; personas and lorebooks keep theirs in Mundi's settings.

interface Folder { id: string; name: string }
const LP = () => settings().lib;
const mundiFolders = (tab: ListTab): LibFolder[] => (LP().folders[tab] ??= []);
// Backgrounds: SillyTavern's own list and folders, loaded on demand.
const B = (): Bgs | null => L.bgs;
let bgLoading = false;
async function loadBgs() { if (bgLoading) return; bgLoading = true; try { L.bgs = await bgList(); } catch { L.bgs = { images: [], folders: [], map: {} }; } finally { bgLoading = false; } notify(); }
const F = {
    list: (tab: ListTab): Folder[] => (tab === 'characters' ? folders() : tab === 'backgrounds' ? (B()?.folders ?? []) : mundiFolders(tab)),
    of: (tab: ListTab, id: string): string[] => (tab === 'characters' ? tagIdsOf(id) : tab === 'backgrounds' ? (B()?.map[id] ?? []).map(String) : mundiFolders(tab).filter(f => f.items.includes(id)).map(f => f.id)),
    async put(tab: ListTab, fid: string, ids: string[], on: boolean) {
        if (tab === 'characters') { putInFolder(fid, ids, on); return; }
        if (tab === 'backgrounds') {
            const b = B(); if (b) for (const i of ids) { const l = new Set(b.map[i] ?? []); on ? l.add(fid) : l.delete(fid); b.map[i] = [...l]; }
            await bgFolderPut(fid, ids, on); return;
        }
        const f = mundiFolders(tab).find(x => x.id === fid); if (!f) return;
        f.items = on ? [...new Set([...f.items, ...ids])] : f.items.filter(x => !ids.includes(x));
        saveSettings();
    },
    rename(tab: ListTab, id: string, name: string) {
        if (tab === 'characters') { renameFolder(id, name); return; }
        const f = mundiFolders(tab).find(x => x.id === id); if (!f) return;
        f.name = name; saveSettings();
    },
    async make(tab: ListTab, name: string): Promise<Folder> {
        if (tab === 'characters') return newFolder(name);
        if (tab === 'backgrounds') { const have = B()?.folders.find(f => f.name.toLowerCase() === name.toLowerCase()); if (have) return have; const f = await bgFolderCreate(name); B()?.folders.push(f); return f; }
        const have = mundiFolders(tab).find(f => f.name.toLowerCase() === name.toLowerCase());
        if (have) return have;
        const f: LibFolder = { id: `f${Date.now()}`, name, items: [] };
        mundiFolders(tab).push(f); saveSettings();
        return f;
    },
};
const FAV = {
    is: (tab: ListTab, id: string) => (tab === 'characters' ? isFav(charOf(id)) : tab === 'backgrounds' ? false : (LP().fav[tab] ?? []).includes(id)),
    async set(tab: ListTab, ids: string[], on: boolean) {
        if (tab === 'backgrounds') return;
        if (tab === 'characters') { await setFavorite(ids, on); return; }
        const l = new Set(LP().fav[tab] ?? []);
        ids.forEach(i => (on ? l.add(i) : l.delete(i)));
        LP().fav[tab] = [...l]; saveSettings();
    },
};

/* ---------- the items of each list ---------- */

interface Item { id: string; name: string; img: string; fav: boolean; crown?: boolean; mfy?: boolean }
const match = (name: string) => !L.q || name.toLowerCase().includes(L.q.toLowerCase());

function items(tab: ListTab): Item[] {
    let list: Item[];
    if (tab === 'characters') list = characters().map(c => ({ id: c.avatar, name: String(c.name ?? ''), img: thumb(c.avatar), fav: isFav(c), mfy: !!mundifiedOf(c) }));
    else if (tab === 'personas') { const d = defaultPersona(); list = personas().map(p => ({ id: p.file, name: p.name, img: personaThumb(p.file), fav: FAV.is(tab, p.file), crown: p.file === d })); }
    else if (tab === 'backgrounds') { if (!B()) { loadBgs(); return []; } list = B()!.images.map(f => ({ id: f, name: f.replace(/\.[^.]+$/, ''), img: bgThumb(f), fav: false })); }
    else list = lorebooks().map(n => ({ id: n, name: n, img: '', fav: FAV.is(tab, n), mfy: !!loreMundifiedOf(n) }));
    list = list.filter(i => match(i.name) && (!L.favOnly || i.fav) && (!MF.on || (tab !== 'characters' && tab !== 'lorebooks') || i.mfy));
    if (NS.on && (tab === 'characters' || tab === 'personas')) {
        const key = (i: Item) => (tab === 'personas' ? personaKey(i.id) : i.id);
        checkSprites(list.map(key));
        list = list.filter(i => { const st = spriteStatus(key(i)); return !!st && st !== 'has'; });
    }
    return sortItems(tab, list);
}
// The "No sprites" filter: only the characters (or personas) whose Expressions folder is empty.
const NS = { on: false };
// The "Mundified" filter: only the mundified copies (characters and lorebooks).
const MF = { on: false };
const sprKey = (tab: ListTab, id: string) => (tab === 'personas' ? personaKey(id) : id);

/* ---------- sorting the list (favorites stay on top) ---------- */

const SORTS: Record<ListTab, [string, string][]> = {
    characters: [['name', 'Name (A–Z)'], ['name-desc', 'Name (Z–A)'], ['new', 'Newest first'], ['old', 'Oldest first'], ['chat', 'Last chatted'], ['tokens', 'Most tokens'], ['tokens-asc', 'Fewest tokens']],
    personas: [['name', 'Name (A–Z)'], ['name-desc', 'Name (Z–A)']],
    lorebooks: [['name', 'Name (A–Z)'], ['name-desc', 'Name (Z–A)'], ['entries', 'Most entries'], ['entries-asc', 'Fewest entries']],
    backgrounds: [['name', 'Name (A–Z)'], ['name-desc', 'Name (Z–A)']],
};
const SO = { open: false };
const sortOf = (tab: ListTab) => { const s = (LP() as any).sorts?.[tab] ?? 'name'; return SORTS[tab].some(([k]) => k === s) ? s : 'name'; };
const dateOf = (c: any) => Number(c?.date_added) || Date.parse(String(c?.create_date ?? '')) || 0;
// tokens of the cards not counted yet: one at a time in the background, the list redraws as they come
const tokenQueue: string[] = []; let counting = false;
function tokensOf(id: string): number | undefined {
    const n = cachedTokens(id); if (n !== undefined) return n;
    if (!tokenQueue.includes(id)) tokenQueue.push(id);
    if (!counting) { counting = true; void (async () => { let k = 0; while (tokenQueue.length) { try { await cardTokens(tokenQueue.shift()!); } catch { /* skip */ } if (++k % 10 === 0 || !tokenQueue.length) notify(); } counting = false; })(); }
    return undefined;
}
function sortItems(tab: ListTab, list: Item[]): Item[] {
    const s = sortOf(tab);
    const num = (i: Item): number | undefined => tab === 'characters'
        ? (s.startsWith('tokens') ? tokensOf(i.id) : s === 'chat' ? Number(charOf(i.id)?.date_last_chat) || 0 : dateOf(charOf(i.id)))
        : tab === 'lorebooks' && s.startsWith('entries') ? loreCount(i.id, notify) : 0;
    const cmp = (a: Item, b: Item) => {
        if (s === 'name') return a.name.localeCompare(b.name);
        if (s === 'name-desc') return b.name.localeCompare(a.name);
        const x = num(a), y = num(b);
        if (x === undefined || y === undefined) return x === y ? a.name.localeCompare(b.name) : x === undefined ? 1 : -1;   // not counted yet: last
        const up = s === 'old' || s.endsWith('-asc');
        return (up ? x - y : y - x) || a.name.localeCompare(b.name);
    };
    return list.sort((a, b) => Number(b.fav) - Number(a.fav) || cmp(a, b));
}
const sortBtn = (tab: ListTab) => `<span class="mu-exp-wrap mu-sort-wrap mu-right">${ibtn('lib-sort-open', 'sort', `Sort: ${SORTS[tab].find(([k]) => k === sortOf(tab))![1]}`, SO.open ? 'is-on' : '')}
    ${SO.open ? `<span class="mu-exp-pop mu-panel"><small>Sort by</small>${SORTS[tab].map(([k, l]) => `<button class="mu-ghost ${sortOf(tab) === k ? 'is-on' : ''}" data-act="lib-sort" data-v="${esc(k)}">${sortOf(tab) === k ? icon('check') : '<i class="mu-sort-sp"></i>'}<span>${l}</span></button>`).join('')}</span>` : ''}</span>`;

/* ---------- fields: text to read, or a form while editing ---------- */

const dv = (k: string, v: any) => (k in L.draft ? L.draft[k] : v);
const read = (label: string, value: unknown, pre = true) => {
    const v = String(value ?? '').trim();
    return `<section class="mu-lib-read"><h4>${label}</h4>${v ? `<div class="${pre ? 'mu-lib-text' : ''}" data-notr>${esc(v)}</div>` : '<p class="mu-muted">—</p>'}</section>`;
};
interface FOpt { rows?: number; options?: Opt[]; hint?: string; min?: number; max?: number; step?: number; placeholder?: string }
function field(label: string, key: string, value: any, kind: 'text' | 'area' | 'num' | 'check' | 'select' = 'text', o: FOpt = {}) {
    const v = dv(key, value);
    const attrs = `data-input="lib-f" data-k="${esc(key)}" data-kind="${esc(kind)}" data-focus="lib-${esc(key)}"`;
    const hint = o.hint ? `<small>${o.hint}</small>` : '';
    if (kind === 'check') return `<label class="mu-check"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}><span>${label}${hint}</span></label>`;
    let input: string;
    if (kind === 'area') input = `<textarea rows="${o.rows ?? 4}" ${attrs} placeholder="${esc(o.placeholder ?? '')}">${esc(v ?? '')}</textarea>`;
    else if (kind === 'select') input = `<select ${attrs}>${(o.options ?? []).map(([val, l]) => `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else input = `<input type="${kind === 'num' ? 'number' : 'text'}" ${attrs} value="${esc(v ?? '')}" ${o.min !== undefined ? `min="${o.min}"` : ''} ${o.max !== undefined ? `max="${o.max}"` : ''} ${o.step !== undefined ? `step="${o.step}"` : ''} placeholder="${esc(o.placeholder ?? '')}">`;
    return `<label class="mu-field"><span>${label}</span>${input}${hint}</label>`;
}
const advHead = () => `<h4 class="mu-lib-advhead">Advanced settings</h4>`;
const dirty = () => Object.keys(L.draft).length > 0;
// The action bar under a card: Save (while editing), Duplicate, Expressions (characters, personas), Delete, side by side.
function actionBar(o: { save?: boolean; dup?: string; expr?: boolean; del?: string | null } = {}) {
    const save = o.save ?? L.edit;
    return `<div class="mu-lib-savebar">
        ${save ? btn('lib-save', 'save', 'Save', 'mu-primary') : ''}
        ${o.dup ? btn(o.dup, 'copy', 'Duplicate') : ''}
        ${o.expr ? btn('lib-expr', 'smile', 'Expressions') : ''}
        ${o.del ? btn(o.del, 'trash', 'Delete', 'mu-danger') : ''}
        ${dirty() ? `${btn('lib-discard', 'undo', 'Undo changes', 'mu-ghost')}<span class="mu-warn">Unsaved changes</span>` : ''}</div>`;
}
const has = (k: string) => k in L.draft;
const num = (k: string, fallback: number | null = null) => { const v = L.draft[k]; return v === '' || v === null || Number.isNaN(Number(v)) ? fallback : Number(v); };
const csv = (s: string) => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);

// The header of a card: picture (click to change it while editing), name, tags, favorite and folder buttons.
function headHtml(tab: ListTab, id: string, name: string, img: string, sub: string, tags: string, extraBtns = '') {
    const inF = F.list(tab).filter(f => F.of(tab, id).includes(f.id));
    const pic = img ? (L.edit && (tab === 'characters' || tab === 'personas')
        ? `<button class="mu-lib-pic" data-act="lib-pic" title="Change the picture"><img src="${esc(img)}" alt=""><span>${icon('image')}</span></button>`
        : `<img src="${esc(img)}" alt="">`) : `<i class="mu-lib-bookpic">${icon('book')}</i>`;
    const fav = FAV.is(tab, id);
    return `<header class="mu-lib-head">${pic}<div><h2 data-notr>${esc(name)}</h2><small data-notr>${esc(sub)}</small>
            <span>${tags}${inF.map(f => `<span class="mu-tag is-folder" data-notr>${icon('folder')} ${esc(f.name)}</span>`).join('')}</span></div>
        <div class="mu-lib-headbtns mu-right">${extraBtns}
            ${tab === 'characters' ? `<span class="mu-exp-wrap">${ibtn('lib-export-open', 'upload', 'Export this character', EXP.open ? 'is-on' : '')}
                ${EXP.open ? `<span class="mu-exp-pop mu-panel"><small>Export as</small>${btn('lib-export', 'image', 'PNG card', 'mu-ghost', 'data-f="png"')}${btn('lib-export', 'copy', 'JSON file', 'mu-ghost', 'data-f="json"')}</span>` : ''}</span>` : ''}
            ${tab === 'backgrounds' ? '' : ibtn('lib-fav', fav ? 'starFill' : 'star', fav ? 'Remove from favorites' : 'Add to favorites', `mu-favbtn ${fav ? 'is-on' : ''}`)}
            ${ibtn('lib-folder-dlg', 'move', 'Move to a folder')}</div></header>`;
}

/* ---------- characters ---------- */

function charDetail(avatar: string) {
    const c = charOf(avatar);
    if (!c) return '<p class="mu-muted mu-pad">This character no longer exists.</p>';
    const d = c.data ?? {}; const ext = d.extensions ?? {}; const dp = ext.depth_prompt ?? {};
    const head = headHtml('characters', avatar, c.name, thumb(avatar), avatar, madeForMundi(c) ? '<span class="mu-tag">Mundi</span>' : mundifiedOf(c) ? '<span class="mu-tag is-mfy">Mundified</span>' : '');
    const bar = actionBar({ dup: 'lib-dup', expr: true, del: 'lib-del-one' });
    if (c.shallow) return `${head}<p class="mu-muted">Loading the card…</p>`;
    if (!L.edit) return `${head}${charToolsHtml(avatar)}${mfyHtml(c, avatar)}${read('Description', c.description)}${read('Personality', c.personality)}${read('Scenario', c.scenario)}${greetingsHtml(c, avatar)}${charTagsHtml(avatar)}${charLoreHtml(avatar)}${bar}`;
    return `${head}<div class="mu-lib-form">${charTagsHtml(avatar)}${charLoreHtml(avatar)}
        ${field('Name', 'name', c.name)}
        ${field('Description', 'description', c.description, 'area', { rows: 9 })}
        ${field('Personality', 'personality', c.personality, 'area', { rows: 4 })}
        ${field('Scenario', 'scenario', c.scenario, 'area', { rows: 4 })}
        ${field('Greeting', 'first_mes', c.first_mes, 'area', { rows: 5, hint: 'In Mundi, they say it when you meet for the first time.' })}
        ${altGreetingsHtml(c)}
        ${L.adv ? `${advHead()}
            ${field('Example dialogue', 'mes_example', c.mes_example, 'area', { rows: 6 })}
            ${field('Main prompt override', 'system_prompt', d.system_prompt, 'area', { rows: 3 })}
            ${field('Post-history instructions', 'post_history_instructions', d.post_history_instructions, 'area', { rows: 3 })}
            ${field('Character\'s note', 'dp_prompt', dp.prompt, 'area', { rows: 3, hint: 'Sent at a fixed depth in the chat, every turn.' })}
            <div class="mu-lib-grid">${field('Depth', 'dp_depth', dp.depth ?? 4, 'num', { min: 0, max: 999 })}${field('Role', 'dp_role', dp.role ?? 'system', 'select', { options: ROLE_NAMES })}
            ${field('Talkativeness', 'talk', ext.talkativeness ?? c.talkativeness ?? 0.5, 'num', { min: 0, max: 1, step: 0.05, hint: 'How often they speak in a group.' })}</div>
            ${field('Tags', 'tags', (c.tags ?? d.tags ?? []).join(', '), 'text', { hint: 'Separated by commas.' })}
            ${field('Creator\'s notes', 'creator_notes', d.creator_notes ?? c.creatorcomment, 'area', { rows: 3 })}` : ''}
        ${bar}</div>`;
}

const EXP = { open: false };   // the export menu by the favorite star
// Mundify: on a mundified copy, where it came from; on any other card (not made by Mundi), what a copy would lose and
// the button to make one, with the copies already made.
const STRIPPED: [string, (c: any) => any][] = [
    ['scenario', c => c.scenario], ['greetings', c => c.first_mes || c.data?.alternate_greetings?.length], ['example dialogue', c => c.mes_example],
    ['main prompt override', c => c.data?.system_prompt], ['post-history instructions', c => c.data?.post_history_instructions],
    ["Character's note", c => c.data?.extensions?.depth_prompt?.prompt],
];
// A mundified copy (or a card Mundi wrote) made before cards had their own clothing and style: the button to add it.
const styleBtn = (c: any) => hasStyle(c) ? '' : `<div class="mu-row">${btn('lib-style', 'sparkles', 'Add clothing and style')}</div>
        <small class="mu-muted">This card has no clothing and style section yet. The AI writes one from the card (choosing what fits where the card says little), so their sprites and the story know how they dress.</small>`;
function mfyHtml(c: any, avatar: string) {
    const m = mundifiedOf(c);
    if (m) {
        const orig = charOf(m.from);
        return `<section class="mu-lib-read mu-mfy">${styleBtn(c)}<small class="mu-muted">${icon('sparkles')} Mundified copy of ${orig ? btn('lib-mfy-go', 'user', esc(orig.name), 'mu-ghost', `data-id="${esc(m.from)}"`) : `<b data-notr>${esc(m.name)}</b> (the original was deleted)`}, ${m.ai ? 'cleaned up by the AI' : 'stripped without the AI'} on ${new Date(m.at).toLocaleDateString()}. It keeps only who they are; the world sets the scene and the first meeting.</small></section>`;
    }
    if (madeForMundi(c)) return hasStyle(c) ? '' : `<section class="mu-lib-read mu-mfy">${styleBtn(c)}</section>`;
    const copies = mundiCopies(avatar);
    const extra = STRIPPED.filter(([, f]) => String(f(c) || '').trim()).map(([k]) => k);
    return `<section class="mu-lib-read mu-mfy"><div class="mu-row">${btn('lib-mfy', 'sparkles', copies.length ? 'Mundify again' : 'Mundify', copies.length ? '' : 'mu-primary')}
            ${copies.map(x => btn('lib-mfy-go', 'sparkles', `Open the copy${copies.length > 1 ? ` (${new Date(mundifiedOf(x)!.at).toLocaleDateString()})` : ''}`, 'mu-ghost', `data-id="${esc(x.avatar)}"`)).join('')}</div>
        <small class="mu-muted">${extra.length ? `This card has its own <span data-notr>${extra.join(', ')}</span>, which fight the world in Mundi. ` : ''}Mundify makes a copy for Mundi with only their appearance, clothing and style, backstory, personality and details. This card stays as it is.</small></section>`;
}
// Export, tokens, chats and the Mundi saves the character is in (30, 31, 33).
const STATS: Record<string, { chats: number; msgs: number } | 'loading'> = {};
function charToolsHtml(avatar: string) {
    const tok = cachedTokens(avatar);
    if (tok === undefined) cardTokens(avatar).then(() => notify());
    const st = STATS[avatar];
    if (!st) { STATS[avatar] = 'loading'; characterChats(avatar).then(l => { STATS[avatar] = { chats: l.length, msgs: l.reduce((a, b) => a + b.count, 0) }; notify(); }); }
    const saves = settings().games.filter(e => (groupOf(e.groupId)?.members ?? []).includes(avatar));
    return `<section class="mu-lib-read mu-charstats"><div class="mu-row">
            <span class="mu-tag">${tok === undefined ? '… tokens' : `${tok.toLocaleString('en-US')} tokens`}</span>
            ${st && st !== 'loading' ? `<span class="mu-tag">${st.chats} chats · ${st.msgs.toLocaleString('en-US')} messages</span>` : ''}
            <span class="mu-tag">${saves.length} Mundi save${saves.length === 1 ? '' : 's'}</span>
</div>
        ${saves.length ? `<small class="mu-muted">In: ${saves.map(e => esc(e.title)).join(', ')}</small>` : ''}</section>`;
}
// Editing: the card's other greetings (SillyTavern's "alternate greetings"), one box each, add or remove.
const altOf = (c: any): string[] => (Array.isArray(L.draft.alt) ? L.draft.alt : (c.data?.alternate_greetings ?? []).map((x: any) => String(x ?? '')));
function altGreetingsHtml(c: any) {
    const list = altOf(c);
    return `<section class="mu-field mu-altg"><span>Other greetings (${list.length})</span>
        <small class="mu-muted">SillyTavern lets you swipe between them at the start of a chat, and "Start with this" opens a chat with one of them.</small>
        ${list.map((t, k) => `<div class="mu-altg-item"><header><b>#${k + 2}</b><button class="mu-ibtn mu-ghost" data-act="lib-alt-del" data-k="${esc(k)}" title="Remove this greeting">${icon('trash')}</button></header>
            <textarea rows="4" data-input="lib-alt" data-k="${esc(k)}" data-focus="lib-alt-${k}" placeholder="Another way the story can begin…">${esc(t)}</textarea></div>`).join('')}
        ${btn('lib-alt-add', 'plus', 'Add a greeting', 'mu-ghost')}</section>`;
}
// All the greetings of the card, side by side; one can start a new chat (32).
function greetingsHtml(c: any, avatar: string) {
    const list = [c.first_mes, ...(c.data?.alternate_greetings ?? [])].filter((x: any) => String(x ?? '').trim());
    if (list.length < 2) return read('Greeting', c.first_mes);
    return `<section class="mu-lib-read"><h4>Greetings (${list.length})</h4><div class="mu-greets">${list.map((t: string, k: number) => `<article class="mu-greet"><header><b>#${k + 1}</b>${btn('lib-greet', 'chat', 'Start with this', 'mu-ghost', `data-k="${esc(k)}" data-avatar="${esc(avatar)}"`)}</header><p data-notr>${esc(String(t).slice(0, 420))}${String(t).length > 420 ? '…' : ''}</p></article>`).join('')}</div></section>`;
}

// Her lorebooks: the first is the card's own, the others SillyTavern's "additional" lorebooks for her.
// Tags: SillyTavern's own (its tag manager and filters see the same ones). They are saved at once.
const TG = { text: '' };
function charTagsHtml(avatar: string) {
    const mine = charTags(avatar);
    const have = new Set(mine.map(t => t.id));
    const others = allTags().filter(t => !have.has(t.id));
    return `<section class="mu-lib-read mu-chartags"><h4>Tags</h4>
        <div class="mu-chips">${mine.map(t => `<span class="mu-chip is-on" style="${tagColor(t.id) ? `--tc:${esc(tagColor(t.id))}` : ''}"><span data-notr>${esc(t.name)}</span><button class="mu-ghost" data-act="lib-tag-del" data-id="${esc(t.id)}" title="Remove">${icon('x')}</button></span>`).join('') || '<span class="mu-muted">No tags.</span>'}</div>
        <div class="mu-lib-searchrow"><input type="text" list="mu-tag-list" placeholder="Add a tag (an existing one or a new one)" value="${esc(TG.text)}" data-input="lib-tag-text" data-focus="lib-tag-text">${btn('lib-tag-add', 'plus', 'Add')}</div>
        <datalist id="mu-tag-list">${others.map(t => `<option value="${esc(t.name)}"></option>`).join('')}</datalist>
        <small class="mu-muted">The same tags as in SillyTavern: they show in its character list and filters.</small></section>`;
}
function charLoreHtml(avatar: string) {
    const mine = charLorebooks(avatar);
    const others = lorebooks().filter(n => !mine.includes(n)).sort((a, b) => a.localeCompare(b));
    return `<section class="mu-lib-read mu-charlore"><h4>Lorebooks</h4>
        <div class="mu-chips">${mine.map((n, k) => `<span class="mu-chip is-on"><span data-notr>${esc(n)}</span>${k === 0 ? ' <small>(main)</small>' : ''}<button class="mu-ghost" data-act="lib-clore-del" data-name="${esc(n)}" title="Remove">${icon('x')}</button></span>`).join('') || '<span class="mu-muted">None.</span>'}</div>
        ${others.length ? `<select data-input="lib-clore-add"><option value="">+ Link a lorebook…</option>${others.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>` : ''}
        <small class="mu-muted">SillyTavern uses them when this character speaks. When a world starts with them, you can also keep them always on in that world.</small></section>`;
}

async function saveChar(avatar: string) {
    const c = charOf(avatar); if (!c) return;
    const p: CardPatch = {};
    for (const k of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes'] as const)
        if (has(k)) (p as any)[k] = String(L.draft[k]);
    if (has('name') && !String(L.draft.name).trim()) throw new Error('The name cannot be empty.');
    if (has('alt')) p.alternate_greetings = (L.draft.alt as string[]).map(t => String(t ?? '')).filter(t => t.trim());
    if (has('talk')) p.talkativeness = Math.min(1, Math.max(0, num('talk', 0.5)!));
    if (has('tags')) p.tags = csv(L.draft.tags);
    if (has('dp_prompt') || has('dp_depth') || has('dp_role')) {
        const dp = c.data?.extensions?.depth_prompt ?? {};
        p.depth_prompt = { prompt: String(dv('dp_prompt', dp.prompt ?? '')), depth: num('dp_depth', dp.depth ?? 4)!, role: String(dv('dp_role', dp.role ?? 'system')) };
    }
    await saveCharacter(avatar, p);
}

/* ---------- expressions: one picture per emotion, in the character's sprite folder ---------- */

// Outfits: the usual sprites, or a subfolder (pajamas, swimsuit…). Clicking a sprite in the game lets you change it.
const EO = { outfit: '', name: '' };
function outfitBar(avatar: string) {
    const list = outfitsOf(avatar) ?? []; const saved = savedOutfits(avatar);
    return `<div class="mu-outfits"><small class="mu-muted">Outfit</small><div class="mu-chips">
        <button class="mu-chip ${EO.outfit ? '' : 'is-on'}" data-act="lib-outfit" data-o="">Usual</button>
        ${list.map(o => `<span class="mu-chip-wrap"><button class="mu-chip ${EO.outfit.toLowerCase() === o.toLowerCase() ? 'is-on' : ''}" data-act="lib-outfit" data-o="${esc(o)}">${esc(outfitLabel(o))}</button>${saved.includes(o) ? `<button class="mu-ghost mu-ibtn" data-act="lib-outfit-del" data-o="${esc(o)}" title="Forget this outfit (the pictures stay)">${icon('x')}</button>` : ''}</span>`).join('')}</div>
        <div class="mu-lib-searchrow"><input type="text" placeholder="New outfit (a folder name, like pajamas)" value="${esc(EO.name)}" data-input="lib-outfit-name" data-focus="lib-outfit-name">${btn('lib-outfit-add', 'plus', 'Add')}</div>
        <small class="mu-muted">An outfit is a subfolder of their Expressions folder${EO.outfit ? ` (<span data-notr>${esc(baseSpriteFolder(avatar))}/${esc(EO.outfit)}</span>)` : ''}. Upload its pictures here; in the game, click their sprite to change clothes.</small></div>`;
}
// avatar: a character's card file, or "persona:<file>" (the persona's folder is its name)
function exprHtml(avatar: string) {
    const name = avatar.startsWith('persona:') ? baseSpriteFolder(avatar) : charOf(avatar)?.name ?? avatar;
    const back = `<div class="mu-gal-albumhead">${btn('lib-expr-close', 'back', avatar.startsWith('persona:') ? 'Back to the persona' : 'Back to the card', 'mu-ghost')}<div><h3>Expressions</h3><small data-notr>${esc(name)}</small></div></div>`;
    const look = spriteLookHtml(avatar, EO.outfit);
    if (L.sprites === null) {
        const want = EO.outfit;
        fetchSprites(avatar, want).then(list => { if (L.expr === avatar && EO.outfit === want) { L.sprites = list; notify(); } });
        return `${back}${outfitBar(avatar)}${look}<p class="mu-muted">Loading the pictures…</p>`;
    }
    const byLabel = new Map<string, any[]>();
    for (const s of L.sprites) { const k = String(s.label); if (!byLabel.has(k)) byLabel.set(k, []); byLabel.get(k)!.push(s); }
    const labels = [...new Set([...expressionLabels(), ...byLabel.keys()])];
    const done = labels.filter(l => byLabel.has(l)).length;
    return `${back}${outfitBar(avatar)}${look}<p class="mu-muted">${done} / ${labels.length} expressions have a picture. The character shows the picture of the emotion of each line; “neutral” is used when there is none.</p>
        <div class="mu-expr-grid">${labels.map(l => {
            const files = byLabel.get(l) ?? [];
            const f = files[0];
            const sprite = f ? String(f.path ?? '').replace(/^.*\//, '').replace(/\.[^.]+$/, '') : l;
            return `<div class="mu-expr ${f ? '' : 'is-empty'}">
                <div class="mu-expr-img">${f ? `<img src="${esc(f.path)}" alt="" loading="lazy">` : icon('image')}</div>
                <b data-notr>${esc(l)}</b>${files.length > 1 ? `<small>${files.length}</small>` : ''}
                <div class="mu-row">${ibtn('lib-expr-up', 'upload', f ? 'Replace' : 'Upload', '', `data-l="${esc(l)}" data-s="${esc(sprite)}"`)}
                    ${f ? ibtn('lib-expr-del', 'trash', 'Delete', 'mu-danger', `data-l="${esc(l)}" data-s="${esc(sprite)}"`) : ''}${spriteTileButton(avatar, l, EO.outfit)}</div>
            </div>`;
        }).join('')}</div>
        <p class="mu-muted">Which emotion each line has is decided by the Character Expressions extension (in Settings › Extensions).</p>`;
}

/* ---------- backgrounds ---------- */

function bgDetail(file: string) {
    if (!B()?.images.includes(file)) return '<p class="mu-muted mu-pad">This picture no longer exists.</p>';
    const name = file.replace(/\.[^.]+$/, ''), ext = file.slice(name.length);
    const head = headHtml('backgrounds', file, name, '', file, '');
    return `${head.replace(/<i class="mu-lib-bookpic">[\s\S]*?<\/i>/, '')}
        <img class="mu-bg-big" src="${esc(bgUrl(file))}" alt="">
        ${L.edit ? `<div class="mu-lib-form">${field('Name', 'bg_name', name, 'text', { hint: `The file keeps its type (${esc(ext)}).` })}</div>` : ''}
        ${actionBar({ del: 'lib-del-one' })}`;
}

/* ---------- personas ---------- */

const POSITIONS: Opt[] = [[0, 'In the prompt, with the character'], [2, 'Top of the Author\'s Note'], [3, 'Bottom of the Author\'s Note'], [4, 'In the chat, at a depth'], [9, 'Not sent']];
// Every trait the worlds offer, for the persona's dropdown (28).
const allTraits = (): [string, string][] => { const seen = new Set<string>(); const out: [string, string][] = []; for (const w of worlds()) for (const t of w.sheet.traits ?? []) for (const o of t.options) if (!seen.has(o)) { seen.add(o); out.push([t.label, o]); } return out; };
function personaDetail(file: string) {
    const p = personas().find(x => x.file === file);
    if (!p) return '<p class="mu-muted mu-pad">This persona no longer exists.</p>';
    const isDef = defaultPersona() === file;
    const crown = ibtn('lib-crown', isDef ? 'crownFill' : 'crown', isDef ? 'Default persona of the game (click to remove)' : 'Make this the default persona', `mu-crown ${isDef ? 'is-on' : ''}`);
    const head = headHtml('personas', file, p.name, personaThumb(file), file, `${file === persona() ? '<span class="mu-tag">In use</span>' : ''}${isDef ? '<span class="mu-tag is-gold">Default</span>' : ''}`, crown);
    const sheet = personaSheet(file);
    const w = sheet ? getWorld(sheet.world) : null;
    const bar = actionBar({ dup: 'lib-dup', expr: true, del: 'lib-del-one' });
    const sheetRead = sheet && w?.sheet.traits ? `<section class="mu-lib-read"><h4>Character sheet</h4><div class="mu-chips">${w.sheet.traits.flatMap(t => (sheet.traits?.[t.id] ?? []).map((x: string) => `<span class="mu-chip"><small>${esc(t.label)}</small> ${esc(x)}</span>`)).join('') || '<span class="mu-muted">—</span>'}</div></section>` : '';
    // the character sheet only exists to write a new character quickly (new game): the Library shows the persona itself
    void sheetRead;
    if (!L.edit) return `${head}${p.title ? read('Title', p.title, false) : ''}${personaLore(file) ? `<section class="mu-lib-read"><h4>Lorebook</h4><span class="mu-chip is-on" data-notr>${esc(personaLore(file))}</span></section>` : ''}${read('Description', p.description)}${bar}`;
    const pos = POSITIONS.some(o => o[0] === p.position) ? POSITIONS : [...POSITIONS, [p.position, `#${p.position}`] as Opt];

    return `${head}<div class="mu-lib-form">
        ${field('Name', 'name', p.name)}
        <div class="mu-lib-grid"><label class="mu-field"><span>Add a trait to the description</span><select data-input="lib-ptrait"><option value="">Choose a trait…</option>${allTraits().map(([g, t]) => `<option value="${esc(t)}">${esc(g)}: ${esc(t)}</option>`).join('')}</select></label>
            <label class="mu-field"><span>Persona lorebook</span><select data-input="lib-plore"><option value="">None</option>${lorebooks().map(n => `<option value="${esc(n)}" ${personaLore(file) === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
        ${field('Description', 'description', p.description, 'area', { rows: 9, hint: 'Who you are. The characters read this.' })}
        ${L.adv ? `${advHead()}
            ${field('Title', 'title', p.title, 'text', { hint: 'A short note shown under the name in SillyTavern.' })}
            ${field('Where the description goes', 'position', p.position, 'select', { options: pos })}
            <div class="mu-lib-grid">${field('Depth', 'depth', p.depth, 'num', { min: 0, max: 999 })}${field('Role', 'role', p.role, 'select', { options: ROLES })}</div>` : ''}
        ${bar}</div>`;
}
async function savePersonaDraft(file: string) {
    const out: any = {};
    if (has('name')) { if (!String(L.draft.name).trim()) throw new Error('The name cannot be empty.'); out.name = String(L.draft.name); }
    for (const k of ['description', 'title']) if (has(k)) out[k] = String(L.draft[k]);
    for (const k of ['position', 'depth', 'role']) if (has(k)) out[k] = num(k, 0);
    const sheet = personaSheet(file);
    if (sheet && (has('__traits') || has('name'))) {
        const next = { ...sheet, traits: L.draft.__traits ?? sheet.traits, name: out.name ?? sheet.name };
        setPersonaSheet(file, next);
        const w = getWorld(next.world);
        if (w && !has('description')) out.description = heroDescription(w, { ...next, portrait: null });
    }
    await savePersona(file, out);
}

/* ---------- lorebooks ---------- */

const LORE_POS: Opt[] = [[0, 'Before the character'], [1, 'After the character'], [2, 'Top of the Author\'s Note'], [3, 'Bottom of the Author\'s Note'], [4, 'In the chat, at a depth'], [5, 'Top of the examples'], [6, 'Bottom of the examples'], [7, 'Outlet']];
const LOGIC: Opt[] = [[0, 'Any of the secondary keywords'], [3, 'All of the secondary keywords'], [2, 'None of the secondary keywords'], [1, 'Not all of the secondary keywords']];
const TRI: Opt[] = [['', 'Default'], ['true', 'Yes'], ['false', 'No']];
const tri = (v: any) => (v === null || v === undefined ? '' : String(!!v));

function entries(): any[] {
    const all = Object.values(L.lore?.data?.entries ?? {}) as any[];
    return all.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.uid - b.uid);
}
const entryTitle = (e: any) => String(e.comment || (e.key ?? []).join(', ') || `#${e.uid}`);

function entryForm(e: any) {
    const k = (f: string) => `e.${f}`;
    return `<div class="mu-lib-form">
        ${field('Title', k('comment'), e.comment)}
        ${field('Keywords', k('key'), (e.key ?? []).join(', '), 'text', { hint: 'The entry is sent when one of these appears in the chat. Separated by commas.' })}
        ${field('Content', k('content'), e.content, 'area', { rows: 8 })}
        <div class="mu-row">${field('Always on', k('constant'), !!e.constant, 'check')}${field('Turned off', k('disable'), !!e.disable, 'check')}</div>
        ${L.adv ? `${advHead()}
            ${field('Secondary keywords', k('keysecondary'), (e.keysecondary ?? []).join(', '), 'text')}
            ${field('Logic', k('selectiveLogic'), e.selectiveLogic ?? 0, 'select', { options: LOGIC })}
            ${field('Position', k('position'), e.position ?? 0, 'select', { options: LORE_POS })}
            <div class="mu-lib-grid">
                ${field('Depth', k('depth'), e.depth ?? 4, 'num', { min: 0, max: 999 })}
                ${field('Role', k('role'), e.role ?? 0, 'select', { options: ROLES })}
                ${field('Order', k('order'), e.order ?? 100, 'num', { min: 0 })}
                ${field('Chance %', k('probability'), e.probability ?? 100, 'num', { min: 0, max: 100 })}
                ${field('Scan depth', k('scanDepth'), e.scanDepth ?? '', 'num', { min: 0, placeholder: 'Default' })}
                ${field('Case-sensitive', k('caseSensitive'), tri(e.caseSensitive), 'select', { options: TRI })}
                ${field('Whole words', k('matchWholeWords'), tri(e.matchWholeWords), 'select', { options: TRI })}
                ${field('Inclusion group', k('group'), e.group ?? '', 'text')}
                ${field('Sticky', k('sticky'), e.sticky ?? '', 'num', { min: 0, placeholder: '—' })}
                ${field('Cooldown', k('cooldown'), e.cooldown ?? '', 'num', { min: 0, placeholder: '—' })}
                ${field('Delay', k('delay'), e.delay ?? '', 'num', { min: 0, placeholder: '—' })}
            </div>
            <div class="mu-row">${field('Can\'t be triggered by other entries', k('excludeRecursion'), !!e.excludeRecursion, 'check')}${field('Doesn\'t trigger other entries', k('preventRecursion'), !!e.preventRecursion, 'check')}</div>` : ''}
        ${actionBar({ save: true, del: 'lib-del-entry' })}
    </div>`;
}

function loreDetail(name: string) {
    const bound = chatLore() === name;
    const head = `${headHtml('lorebooks', name, name, '', '', bound ? '<span class="mu-tag">This save\'s lorebook</span>' : loreMundifiedOf(name) ? '<span class="mu-tag is-mfy">Mundified</span>' : '')}
        ${actionBar({ save: false, dup: 'lib-dup', del: 'lib-del-one' }).replace('<div class="mu-lib-savebar">', `<div class="mu-lib-savebar is-top">${L.edit ? btn('lib-new-entry', 'plus', 'New entry') : ''}`)}
        ${L.edit ? '' : mfyLoreHtml(name)}`;
    if (!L.lore || L.lore.name !== name) return `${head}<p class="mu-muted">Loading the lorebook…</p>`;
    const list = entries();
    if (!list.length) return `${head}<p class="mu-muted">This lorebook is empty.</p>`;
    return `${head}<p class="mu-muted">${list.length} entries</p><ul class="mu-entries">${list.map(e => {
        const open = L.entry === String(e.uid);
        return `<li class="mu-entry ${open ? 'is-open' : ''} ${e.disable ? 'is-off' : ''}">
            <button class="mu-entry-head" data-act="lib-entry" data-uid="${esc(e.uid)}"><b data-notr>${esc(entryTitle(e))}</b>
                <small>${e.constant ? '<span class="mu-tag">Always on</span>' : ''}${e.disable ? '<span class="mu-tag is-off">Off</span>' : ''}<span data-notr>${esc((e.key ?? []).join(', '))}</span></small></button>
            ${open ? (L.edit ? entryForm(e) : `<div class="mu-entry-body" data-notr>${esc(e.content ?? '')}</div>`) : ''}
        </li>`;
    }).join('')}</ul>`;
}

// Mundify for a lorebook: on a mundified copy, where it came from and what changed; on any other lorebook, the button
// to make one, with the copies already made.
function mfyLoreHtml(name: string) {
    const m = loreMundifiedOf(name);
    if (m) {
        const orig = lorebooks().includes(m.from);
        return `<section class="mu-lib-read mu-mfy"><small class="mu-muted">${icon('sparkles')} Mundified copy of ${orig ? btn('lib-mfy-go', 'book', esc(m.from), 'mu-ghost', `data-id="${esc(m.from)}"`) : `<b data-notr>${esc(m.from)}</b> (the original was deleted)`}, ${m.ai ? 'sorted by the AI' : 'sorted without the AI'} on ${new Date(m.at).toLocaleDateString()}: ${m.off} entr${m.off === 1 ? 'y' : 'ies'} switched off${m.rewritten ? `, ${m.rewritten} rewritten with the facts only` : ''}. Switched-off entries are greyed out below: switch one back on in its form if it should stay.</small></section>`;
    }
    const copies = loreCopies(name);
    return `<section class="mu-lib-read mu-mfy"><div class="mu-row">${btn('lib-mfylore', 'sparkles', copies.length ? 'Mundify again' : 'Mundify', copies.length ? '' : 'mu-primary')}
            ${copies.map((x, i) => btn('lib-mfy-go', 'sparkles', `Open the copy${copies.length > 1 ? ` (${new Date(loreMundifiedOf(x)!.at).toLocaleDateString()})` : ''}`, i ? 'mu-ghost' : '', `data-id="${esc(x)}"`)).join('')}</div>
        <small class="mu-muted">Mundify makes a copy for Mundi worlds with only the facts about the world. Entries that tell the AI how to reply, set up the opening scene or say who {{user}} is are switched off, because the world does that. This lorebook stays as it is.</small></section>`;
}

async function saveEntry() {
    const e = L.lore?.data?.entries?.[L.entry ?? ''];
    if (!e || !L.lore) return;
    for (const [dk, v] of Object.entries(L.draft)) {
        if (!dk.startsWith('e.')) continue;
        const f = dk.slice(2);
        if (f === 'key' || f === 'keysecondary') e[f] = csv(String(v));
        else if (f === 'caseSensitive' || f === 'matchWholeWords') e[f] = v === '' ? null : v === 'true';
        else if (['scanDepth', 'sticky', 'cooldown', 'delay'].includes(f)) e[f] = v === '' || v === null ? null : Number(v);
        else if (['selectiveLogic', 'position', 'depth', 'role', 'order', 'probability'].includes(f)) e[f] = Number(v) || 0;
        else e[f] = v;
    }
    if (L.draft['e.keysecondary'] !== undefined) e.selective = true;
    if (L.draft['e.probability'] !== undefined) e.useProbability = true;
    await saveLore(L.lore.name, L.lore.data);
    try { ctx().reloadWorldInfoEditor?.(L.lore.name); } catch { /* the editor is closed */ }
}

/* ---------- this save: Author's Note and the chat lorebook ---------- */

const AN_POS: Opt[] = [[1, 'In the chat, at a depth'], [0, 'After the story string'], [2, 'Before the story string']];
function saveTab() {
    const g = game();
    if (!g) return '<p class="mu-muted">No save is open. Load a save to see its notes.</p>';
    const m = ctx().chatMetadata ?? {};
    const head = `<header class="mu-lib-head"><div><h2>This save</h2><small data-notr>${esc(currentEntry()?.title ?? '')}</small></div></header>`;
    if (!L.edit) return `${head}${read('Author\'s Note', m.note_prompt)}${read('Lorebook', chatLore(), false)}`;
    return `${head}<div class="mu-lib-form">
        ${field('Author\'s Note', 'note_prompt', m.note_prompt ?? '', 'area', { rows: 6, hint: 'A standing instruction for this save only: tone, pacing, what to focus on.' })}
        ${L.adv ? `${advHead()}
            <div class="mu-lib-grid">
                ${field('Every how many messages', 'note_interval', m.note_interval ?? 1, 'num', { min: 0 })}
                ${field('Depth', 'note_depth', m.note_depth ?? 4, 'num', { min: 0 })}
                ${field('Role', 'note_role', m.note_role ?? 0, 'select', { options: ROLES })}
            </div>
            ${field('Position', 'note_position', m.note_position ?? 1, 'select', { options: AN_POS })}
            ${field('Lorebook of this save', 'chat_lore', chatLore(), 'select', { options: [['', '(none)'], ...lorebooks().map(n => [n, n] as Opt)] })}
            <section class="mu-lib-read"><h4>What Mundi tells the AI right now</h4><div class="mu-lib-text is-code" data-notr>${esc(sceneText())}</div></section>` : ''}
        ${actionBar({})}</div>`;
}
async function saveSaveTab() {
    const m = ctx().chatMetadata;
    for (const k of ['note_prompt', 'note_interval', 'note_depth', 'note_position', 'note_role']) {
        if (!has(k)) continue;
        m[k] = k === 'note_prompt' ? String(L.draft[k]) : num(k, 0);
    }
    if (has('chat_lore')) { const n = String(L.draft.chat_lore); if (n) await bindChatLore(n); else delete m.world_info; }
    await ctx().saveMetadata();
    // SillyTavern's own Author's Note panel keeps a copy of the text: keeps it in step
    const set = (id: string, v: unknown) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el && v !== undefined) el.value = String(v); };
    set('extension_floating_prompt', m.note_prompt); set('extension_floating_interval', m.note_interval); set('extension_floating_depth', m.note_depth);
    const pos = document.querySelector<HTMLInputElement>(`input[name="extension_floating_position"][value="${m.note_position}"]`); if (pos) pos.checked = true;
}

/* ---------- the world's rules (read only for now) ---------- */

function worldTab() {
    const id = game()?.world ?? BUILT_IN[0];
    const w = getWorld(id);
    if (!w) { loadWorld(id).then(notify).catch(() => { /* shown as loading */ }); return '<p class="mu-muted">Loading the world…</p>'; }
    const list = (items: string[]) => `<div class="mu-chips">${items.map(x => `<span class="mu-chip">${esc(x)}</span>`).join('')}</div>`;
    const sec = (title: string, body: string) => `<section class="mu-lib-read"><h4>${title}</h4>${body}</section>`;
    return `<header class="mu-lib-head"><div><h2>${esc(w.name)}</h2><small>${esc(w.setting)}</small></div></header>
        <p>${esc(w.description)}</p>
        ${sec('Needs', list(activeStatuses(w).map(s => `${s.icon} ${s.name}`)))}
        ${sec('Places', list(w.places.map(p => p.name)))}
        ${sec('Jobs', `<ul class="mu-lib-jobs">${w.occupations.map(o => `<li><b>${esc(o.name)}</b> <small>${o.ranks.map(r => esc(r.name)).join(' → ')}</small></li>`).join('')}</ul>`)}
        ${sec('Origins', list((w.catalogs.origins ?? []).map(o => o.name)))}
        ${sec('Lore', `<p class="mu-muted">${w.lore.length} entries, written into the lorebook “Mundi - ${esc(w.name)}” when a game starts.</p>`)}
        <p class="mu-muted">Editing a world's rules comes with the world creator.</p>`;
}

// Several files at once, from the computer (Downloads…).
function pickFiles(accept: string): Promise<File[]> {
    return new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = accept; i.onchange = () => ok([...(i.files ?? [])]); i.click(); });
}

/* ---------- the list: toolbar, folders, list or grid, selection ---------- */

interface Row extends Item { folder?: boolean; count?: number }
function rows(tab: ListTab): Row[] {
    const list = items(tab);
    if (L.q || L.favOnly || NS.on || MF.on) return list;   // searching (and the filters) show everything, without folders
    if (L.folder) return list.filter(i => F.of(tab, i.id).includes(L.folder!));
    const fs = F.list(tab); const ids = new Set(fs.map(f => f.id));
    const out: Row[] = sortFolders(tab, fs.map(f => ({ id: f.id, name: f.name, img: '', fav: false, folder: true, count: list.filter(i => F.of(tab, i.id).includes(f.id)).length })));
    return out.concat(list.filter(i => !F.of(tab, i.id).some(t => ids.has(t))));
}
// Folders follow the same order: by name, by when they were made, or by how much is inside (for tokens and entries).
function sortFolders(tab: ListTab, fs: Row[]): Row[] {
    const s = sortOf(tab);
    const made = (f: Row) => tab === 'characters' ? folderMade(f.id) : 0;
    const cmp = (a: Row, b: Row) => {
        if (s === 'name-desc') return b.name.localeCompare(a.name);
        if (s === 'new' || s === 'old') return ((s === 'new' ? made(b) - made(a) : made(a) - made(b)) || a.name.localeCompare(b.name));
        if (s === 'tokens' || s === 'entries') return (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name);
        if (s.endsWith('-asc')) return (a.count ?? 0) - (b.count ?? 0) || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
    };
    return fs.sort(cmp);
}
const itemIds = () => (isList(L.tab) ? rows(L.tab).filter(r => !r.folder).map(r => r.id) : []);
// List or grid, per tab (lorebooks start as a list: their cards have no picture)
const viewOf = (tab: string) => ((LP() as any).views?.[tab] ?? (tab === 'lorebooks' ? 'list' : LP().view));
const grid = () => L.tab === 'backgrounds' || viewOf(L.tab) === 'grid';

function rowHtml(r: Row) {
    if (r.folder) {
        const fc = L.tab === 'characters' ? folderColor(r.id) : (mundiFolders(L.tab as ListTab).find(f => f.id === r.id) as any)?.color ?? '';
        return `<button class="mu-lib-item is-folder" data-act="lib-folder" data-id="${esc(r.id)}" data-drop="${esc(r.id)}" style="${fc ? `--fc:${esc(fc)}` : ''}"><i class="mu-lib-thumb">${icon('folder')}</i><span data-notr>${esc(r.name)}</span><small>${r.count}</small></button>`;
    }
    const picked = L.picked.includes(r.id);
    const box = L.picking || L.picked.length ? `<em class="mu-pick">${picked ? icon('check') : ''}</em>` : '';
    const pic = r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" draggable="false">` : `<i class="mu-lib-thumb">${icon('book')}</i>`;
    const badges = `${r.mfy ? `<b class="mu-mfymark" title="Mundified copy">${icon('sparkles')}</b>` : ''}${r.crown ? `<b class="mu-crownmark" title="Default persona">${icon('crownFill')}</b>` : ''}${r.fav ? `<b class="mu-fav">${icon('starFill')}</b>` : ''}`;
    const n = L.tab === 'lorebooks' && !grid() ? loreCount(r.id, notify) : undefined;
    const count = L.tab === 'lorebooks' && !grid() ? `<small class="mu-lib-count" title="Entries">${n ?? '…'}</small>` : '';
    return `<button class="mu-lib-item ${L.sel === r.id && !L.picked.length ? 'is-on' : ''} ${picked ? 'is-picked' : ''}" data-act="lib-sel" data-id="${esc(r.id)}" draggable="true" title="${esc(r.name)}">${box}${pic}<span data-notr>${esc(r.name)}</span>${badges}${count}</button>`;
}

const needsStyle = (a: string) => { const c = charOf(a); return !!c && (!!mundifiedOf(c) || madeForMundi(c)) && !hasStyle(c); };
// Adds the clothing and style section to each card, one by one; a card that fails is said and the others go on.
async function doStyle(ids: string[]) {
    let done = 0; const failed: string[] = [];
    for (const [k, id] of ids.entries()) {
        const name = nameOfId('characters', id);
        try { await busy(ids.length > 1 ? `Writing ${name}'s clothing and style (${k + 1} of ${ids.length})` : `Writing ${name}'s clothing and style`, () => addStyle(id)); done++; }
        catch (e: any) { failed.push(`${name}: ${String(e?.message ?? e)}`); }
    }
    if (failed.length) toast(failed.join('\n'), 'error');
    if (done) toast(done === 1 ? 'Clothing and style added to the card.' : `Clothing and style added to ${done} cards.`, 'success');
    L.draft = {}; notify();
}

function bulkBar(tab: ListTab) {
    const n = L.picked.length;
    if (!n && !L.picking) return '';
    const allFav = n > 0 && L.picked.every(id => FAV.is(tab, id));
    const dis = n ? '' : 'disabled';
    return `<div class="mu-lib-bulk"><b>${n} selected</b>${btn('lib-pick-all', 'select', 'Select all', 'mu-ghost')}
        <div class="mu-lib-bulkbtns">
            ${tab === 'backgrounds' ? '' : btn('lib-bulk-fav', allFav ? 'star' : 'starFill', allFav ? 'Unfavorite' : 'Favorite', '', dis)}
            ${btn('lib-bulk-folder', 'move', 'Move', '', dis)}
            ${tab === 'characters' ? btn('lib-bulk-mfy', 'sparkles', 'Mundify', '', dis) : ''}
            ${tab === 'characters' && L.picked.some(needsStyle) ? btn('lib-bulk-style', 'sparkles', 'Add clothing and style', '', dis) : ''}
            ${tab === 'characters' || tab === 'lorebooks' ? btn('lib-bulk-zip', 'download', 'Zip', '', dis) : ''}
            ${btn('lib-bulk-del', 'trash', 'Delete', 'mu-danger', dis)}
            ${ibtn('lib-pick-clear', 'x', 'Cancel selection')}</div></div>`;
}

const CREATE: Record<ListTab, string> = { characters: 'New character', personas: 'New persona', lorebooks: 'New lorebook', backgrounds: 'Upload pictures' };
function listPane(tab: ListTab) {
    const list = rows(tab);
    const folder = L.folder && !L.q && !L.favOnly && !NS.on && !MF.on ? F.list(tab).find(f => f.id === L.folder) : null;
    return `<aside class="mu-lib-list mu-panel ${grid() ? 'is-grid' : ''} ${tab === 'backgrounds' ? 'is-bgs' : ''}">
        <div class="mu-lib-filter">
            <div class="mu-lib-tools">
                ${ibtn('lib-create', 'plus', CREATE[tab], 'mu-primary')}
                ${tab === 'backgrounds' ? '' : ibtn('lib-import', 'upload', tab === 'characters' ? 'Import characters (PNG, JSON, CHARX…)' : tab === 'personas' ? 'Import personas (pictures)' : 'Import lorebooks (JSON)')}
                ${ibtn('lib-newfolder', 'folderPlus', 'New folder')}
                ${ibtn('lib-picking', 'select', 'Select several (or Ctrl+click, Shift+click)', L.picking ? 'is-on' : '')}
                ${ibtn('lib-search', 'search', 'Search', L.searching || L.q ? 'is-on' : '')}
                ${tab === 'backgrounds' ? '' : ibtn('lib-favonly', L.favOnly ? 'starFill' : 'star', 'Only favorites', `mu-favbtn ${L.favOnly ? 'is-on' : ''}`)}
                ${tab === 'characters' || tab === 'lorebooks' ? ibtn('lib-mfyonly', 'sparkles', 'Only mundified copies', `mu-mfybtn ${MF.on ? 'is-on' : ''}`) : ''}
                ${tab === 'characters' || tab === 'personas' ? ibtn('lib-nospr', 'image', 'Only those with no sprites', NS.on ? 'is-on' : '') : ''}
                ${sortBtn(tab)}${tab === 'backgrounds' ? '' : ibtn('lib-view', grid() ? 'list' : 'grid', grid() ? 'Show as a list' : 'Show as a grid')}
            </div>
            ${L.searching || L.q ? `<input type="search" placeholder="Search" value="${esc(L.q)}" data-input="lib-q" data-focus="lib-q">` : ''}
            ${NS.on && (tab === 'characters' || tab === 'personas') ? `<div class="mu-lib-nospr"><small class="mu-muted">${list.length ? `${list.length} with no sprites` : 'Everyone here has sprites (still looking at some).'}</small>${list.length ? btn('lib-nospr-draw', 'image', `Draw sprites for ${list.length === 1 ? 'this one' : `these ${list.length}`}`, 'mu-primary') : ''}</div>` : ''}
            ${folder ? `<div class="mu-lib-crumb">${btn('lib-folder-up', 'back', 'Folders', 'mu-ghost', 'data-drop=""')}<b data-notr>${icon('folder')} ${esc(folder.name)}</b>
                ${tab === 'backgrounds' ? '' : `<input type="color" title="Folder color" value="${esc((tab === 'characters' ? folderColor(folder.id) : (folder as any).color) || '#4fb0ff')}" data-input="lib-folder-color">${tab === 'characters' || tab === 'lorebooks' ? ibtn('lib-folder-zip', 'download', 'Export this folder as a zip', 'mu-ghost') : ''}${ibtn('lib-folder-ren', 'edit', 'Rename this folder', 'mu-ghost')}${ibtn('lib-folder-del', 'trash', 'Delete this folder (what is inside stays)', 'mu-ghost')}`}</div>` : ''}
        </div>
        <div class="mu-lib-items" data-keep="lib-items">${list.length ? list.slice(0, 600).map(rowHtml).join('') : '<p class="mu-muted mu-pad">Nothing here.</p>'}</div>
        ${bulkBar(tab)}
    </aside>`;
}

/* ---------- export as a zip (a folder, or what is selected) ---------- */

async function exportZip(tab: ListTab, ids: string[], name: string) {
    if (!ids.length) { toast('Nothing to export.', 'info'); return; }
    const used = new Set<string>(); const files: ZipFile[] = []; let failed = 0;
    await busy(`Exporting ${ids.length}`, async () => {
        for (const id of ids) {
            try {
                if (tab === 'characters') files.push({ name: uniqueName(`${fileNameOf(String(charOf(id)?.name ?? id))}.png`, used), data: new Uint8Array(await (await cardFile(id, 'png')).arrayBuffer()) });
                else if (tab === 'lorebooks') files.push({ name: uniqueName(`${fileNameOf(id)}.json`, used), data: new TextEncoder().encode(JSON.stringify(await loadLore(id), null, 4)) });
            } catch { failed++; }
        }
    });
    if (!files.length) { toast('Could not export.', 'error'); return; }
    download(makeZip(files), `${fileNameOf(name)}.zip`);
    toast(`Exported ${files.length} ${tab === 'characters' ? 'cards' : 'lorebooks'}${failed ? ` (${failed} could not be read)` : ''}.`, failed ? 'warn' : 'success');
}

/* ---------- dialogs: create, delete, folders ---------- */

const KIND: Record<string, string> = { characters: 'Delete {0} characters?', personas: 'Delete {0} personas?', lorebooks: 'Delete {0} lorebooks?', backgrounds: 'Delete {0} pictures?' };
const nameOfId = (what: string, id: string) => what === 'characters' ? String(charOf(id)?.name ?? id) : what === 'personas' ? (personas().find(p => p.file === id)?.name ?? id) : id;
const inGames = (avatar: string) => settings().games.some(e => (groupOf(e.groupId)?.members ?? []).includes(avatar));

function dialogHtml() {
    const m = state.modal;
    if (!m || !String(m.type).startsWith('lib-dlg')) return '';
    let body = '';
    if (m.type === 'lib-dlg-leave') return leaveHtml('lib');
    if (m.type === 'lib-dlg-del') {
        const ids: string[] = m.ids; const what: string = m.what;
        const title = what === 'entry' ? 'Delete this entry?'
            : ids.length === 1 ? `Delete “${esc(nameOfId(what, ids[0]))}”?` : KIND[what].replace('{0}', String(ids.length));
        const notes: string[] = [];
        if (ids.length > 1) notes.push(`<p class="mu-muted mu-dlg-names" data-notr>${esc(ids.map(i => nameOfId(what, i)).join(', '))}</p>`);
        if (what === 'characters') {
            const g = ids.filter(inGames).map(a => nameOfId(what, a));
            if (g.length) notes.push(`<p class="mu-warn">In a Mundi game: <span data-notr>${esc(g.join(', '))}</span></p><p class="mu-muted">The game goes on without them.</p>`);
            notes.push(`<label class="mu-check"><input type="checkbox" data-input="lib-delchats" ${m.chats ? 'checked' : ''}><span>Also delete their chats</span></label>`);
        }
        if (what === 'personas') {
            const games = settings().games.filter(e => ids.includes(e.persona));
            if (games.length) notes.push(`<p class="mu-warn">Used in Mundi worlds: <span data-notr>${esc(games.map(e => e.title).join(', '))}</span></p><p class="mu-muted">Those games will open with another persona.</p>`);
            if (ids.includes(persona())) notes.push(`<p class="mu-warn">It is the persona selected right now${personas().length > ids.length ? ': SillyTavern switches to another one first.' : ', and the only one left: it is kept.'}</p>`);
            notes.push('<p class="mu-muted">Chats that were locked to it go back to the persona selected in SillyTavern.</p>');
        }
        if (what === 'lorebooks' && ids.includes(chatLore())) notes.push('<p class="mu-warn">This save uses this lorebook.</p>');
        body = `<h3>${title}</h3>${notes.join('')}<p>This cannot be undone.</p>
            <div class="mu-row mu-dlg-btns"><button data-act="lib-dlg-close">Cancel</button>${btn('lib-del-yes', 'trash', 'Delete', 'mu-danger')}</div>`;
    } else if (m.type === 'lib-dlg-folder') {
        const tab: ListTab = m.tab; const ids: string[] = m.ids; const fs = F.list(tab);
        body = `<h3>Move to a folder</h3><p class="mu-muted">${ids.length === 1 ? esc(nameOfId(tab, ids[0])) : `${ids.length} items`}</p>
            <div class="mu-folder-list">${fs.length ? fs.map(f => {
                const n = ids.filter(a => F.of(tab, a).includes(f.id)).length;
                const st = n === ids.length ? 'is-on' : n ? 'is-some' : '';
                return `<button class="${st}" data-act="lib-folder-toggle" data-id="${esc(f.id)}"><em>${st === 'is-on' ? icon('check') : st ? '–' : ''}</em>${icon('folder')}<span data-notr>${esc(f.name)}</span></button>`;
            }).join('') : '<p class="mu-muted">No folders yet.</p>'}</div>
            <div class="mu-lib-searchrow"><input type="text" placeholder="New folder name" value="${esc(m.name ?? '')}" data-input="lib-dlg-name" data-focus="lib-dlg-name">${btn('lib-folder-new', 'folderPlus', 'Create')}</div>
            ${tab === 'characters' ? '<p class="mu-muted">Folders are SillyTavern\'s folder tags, so they also show in its character list.</p>' : ''}
            <div class="mu-row mu-dlg-btns"><button class="mu-primary" data-act="lib-dlg-close">Done</button></div>`;
    } else if (m.type === 'lib-dlg-mfy') {
        const ids: string[] = m.ids;
        body = `<h3>${ids.length === 1 ? `Mundify “${esc(nameOfId('characters', ids[0]))}”?` : `Mundify ${ids.length} characters?`}</h3>
            ${ids.length > 1 ? `<p class="mu-muted mu-dlg-names" data-notr>${esc(ids.map(i => nameOfId('characters', i)).join(', '))}</p>` : ''}
            <p>Mundi makes a copy of ${ids.length === 1 ? 'the card' : 'each card'} for its worlds. The original is not changed.</p>
            <p class="mu-muted"><b>Kept:</b> appearance, backstory, personality and other details about the character.<br><b>Removed:</b> scenario, greetings, example dialogue, main prompt override, post-history instructions and Character's note. The world handles all of these. Linked lorebooks stay linked.</p>
            <label class="mu-check"><input type="checkbox" data-input="lib-mfy-ai" ${m.ai ? 'checked' : ''}><span>Clean up with the AI<small>The AI sorts the card into appearance, clothing and style (chosen to fit them where the card says little), backstory, personality and details, and saves facts about the character hidden in the scenario, greetings or notes. Without it, the description and personality are copied word for word.</small></span></label>
            <div class="mu-row mu-dlg-btns"><button data-act="lib-dlg-close">Cancel</button>${btn('lib-mfy-yes', 'sparkles', 'Mundify', 'mu-primary')}</div>`;
    } else if (m.type === 'lib-dlg-mfylore') {
        body = `<h3>Mundify “${esc(m.id)}”?</h3>
            <p>Mundi makes a copy of the lorebook for its worlds. The original is not changed.</p>
            <p class="mu-muted"><b>Kept:</b> everything about the world: places, people, groups, history, technology, magic, creatures, customs.<br><b>Switched off:</b> instructions to the AI (how to reply, style, format, narrator rules, trackers), the opening scene, and who {{user}} is. The world handles all of these. Switched-off entries stay in the copy, so you can switch one back on.</p>
            <label class="mu-check"><input type="checkbox" data-input="lib-mfy-ai" ${m.ai ? 'checked' : ''}><span>Sort with the AI<small>The AI reads every entry (a few at a time), and rewrites entries that mix facts and instructions so only the facts stay. Without it, only entries that plainly are instructions are switched off.</small></span></label>
            <div class="mu-row mu-dlg-btns"><button data-act="lib-dlg-close">Cancel</button>${btn('lib-mfylore-yes', 'sparkles', 'Mundify', 'mu-primary')}</div>`;
    } else if (m.type === 'lib-dlg-newfolder') {
        body = `<h3>New folder</h3><input type="text" placeholder="New folder name" value="${esc(m.name ?? '')}" data-input="lib-dlg-name" data-focus="lib-dlg-name">
            ${L.picked.length ? `<p class="mu-muted">${L.picked.length} selected items go into it.</p>` : ''}
            <div class="mu-row mu-dlg-btns"><button data-act="lib-dlg-close">Cancel</button>${btn('lib-newfolder-yes', 'folderPlus', 'Create', 'mu-primary')}</div>`;
    } else if (m.type === 'lib-dlg-renfolder') {
        body = `<h3>Rename folder</h3><input type="text" placeholder="Folder name" value="${esc(m.name ?? '')}" data-input="lib-dlg-name" data-focus="lib-dlg-name">
            <div class="mu-row mu-dlg-btns"><button data-act="lib-dlg-close">Cancel</button>${btn('lib-folder-ren-yes', 'check', 'Rename', 'mu-primary')}</div>`;
    } else if (m.type === 'lib-dlg-create') {
        const tab: ListTab = m.tab;
        const pic = tab === 'lorebooks' ? '' : `<div class="mu-create-pic">${m.url ? `<img src="${esc(m.url)}" alt="">` : `<i>${icon('user')}</i>`}
            ${btn('lib-create-pic', 'image', m.url ? 'Change the image' : 'Choose an image')}</div>`;
        body = `<h3>${CREATE[tab]}</h3><div class="mu-create ${pic ? '' : 'is-nopic'}">${pic}<div class="mu-create-fields">
                <label class="mu-field"><span>Name</span><input type="text" value="${esc(m.name ?? '')}" data-input="lib-dlg-name" data-focus="lib-dlg-name"></label>
                ${tab === 'lorebooks' ? '' : `<label class="mu-field"><span>Description</span><textarea rows="5" data-input="lib-dlg-desc" data-focus="lib-dlg-desc">${esc(m.desc ?? '')}</textarea></label>`}
            </div></div>
            <div class="mu-row mu-dlg-btns"><button data-act="lib-dlg-close">Cancel</button>${btn('lib-create-yes', 'plus', 'Create', 'mu-primary')}</div>`;
    }
    return `<div class="mu-dlg-veil" data-act="lib-dlg-close"><div class="mu-dlg mu-panel" role="dialog" data-act="lib-stay">${body}</div></div>`;
}

/* ---------- the screen ---------- */

const NOTES: Record<string, string> = {
    'st-characters': 'SillyTavern\'s own panel. Clicking a character here opens their chat, as in SillyTavern.',
    backgrounds: 'Import pictures and organize them in folders. Clicking a picture here does not change the background.',
};
function detailPane(tab: ListTab) {
    let body: string;
    if (!L.sel) body = `<p class="mu-muted mu-pad">${tab === 'characters' ? 'Choose a character.' : tab === 'personas' ? 'Choose a persona.' : tab === 'backgrounds' ? 'Choose a picture. Pictures here are SillyTavern\'s backgrounds; Mundi uses them for its scenes.' : 'Choose a lorebook.'}</p>`;
    else if ((tab === 'characters' || tab === 'personas') && L.expr === sprKey(tab, L.sel)) body = exprHtml(L.expr);
    else body = tab === 'characters' ? charDetail(L.sel) : tab === 'personas' ? personaDetail(L.sel) : tab === 'backgrounds' ? bgDetail(L.sel) : loreDetail(L.sel);
    return `<section class="mu-lib-detail mu-panel" data-keep="lib-detail">${L.sel ? `${btn('lib-unsel', 'back', 'List', 'mu-ghost mu-lib-back')}` : ''}${body}</section>`;
}

export function libraryHtml() {
    if (ST_TABS.includes(L.tab as Tab) || L.tab === 'save' || L.tab === 'world') L.tab = 'characters';
    const tab = L.tab as Tab;
    const tabs = TABS;   // SillyTavern's own character/persona/World Info panels stay out of the Library
    let body: string;
    if (tab === 'backgrounds' && !B()) loadBgs();
    if (isList(tab)) body = `<div class="mu-lib-body ${grid() ? 'is-grid' : ''}">${tab === 'backgrounds' && !B() ? '<p class="mu-muted mu-pad">Loading…</p>' : `${listPane(tab)}${detailPane(tab)}`}</div>`;
    else if (tab === 'presets') body = presetsTabHtml();
    else if (tab === 'save') body = `<div class="mu-lib-body is-single"><section class="mu-lib-detail mu-panel" data-keep="lib-detail">${saveTab()}</section></div>`;
    else if (tab === 'world') body = `<div class="mu-lib-body is-single"><section class="mu-lib-detail mu-panel" data-keep="lib-detail">${worldTab()}</section></div>`;
    else body = `<div class="mu-lib-body is-single">${nativeHost(tab, NOTES[tab] ?? '')}</div>`;
    return `<div class="mu-library ${L.sel ? 'has-sel' : ''}">
        <div class="mu-subhead"><button data-act="lib-back" data-sfx="back">← Back</button><h2>Library</h2>
            <div class="mu-lib-switches">
                ${switchHtml('lib-edit', 'Edit', L.edit)}
                ${L.edit ? switchHtml('lib-adv', 'Advanced settings', L.adv) : ''}
            </div></div>
        <nav class="mu-lib-tabs">${tabs.map(([id, l]) => `<button class="${L.tab === id ? 'is-on' : ''} ${id.startsWith('st-') ? 'is-st' : ''}" data-act="lib-tab" data-tab="${esc(id)}">${l}</button>`).join('')}</nav>
        ${body}
        ${dialogHtml()}
    </div>`;
}
const switchHtml = (act: string, label: string, on: boolean) =>
    `<button class="mu-switch ${on ? 'is-on' : ''}" role="switch" aria-checked="${on}" data-act="${esc(act)}"><i></i><span>${label}</span></button>`;

/* ---------- actions ---------- */

// Leaving a card with changes not saved asks first (save, discard or stay); the click that tried to leave runs after.
let lastClick: HTMLElement | null = null;
if (typeof document !== 'undefined') document.addEventListener('click', (e) => { const el = (e.target as HTMLElement)?.closest?.('#mundi-root [data-act]') as HTMLElement | null; if (el && !String(el.dataset.act).startsWith('lib-leave')) lastClick = el; }, true);
let pending: HTMLElement | null = null;
function guard(): boolean {
    if (!dirty()) return true;
    pending = lastClick; state.modal = { type: 'lib-dlg-leave' }; notify();
    return false;
}
const resume = () => { const el = pending; pending = null; state.modal = null; if (el?.dataset.act && el.dataset.act !== 'lib-leave') (ACT as any)[el.dataset.act]?.(el); else notify(); };
async function select(id: string) {
    L.sel = id; L.entry = null; L.expr = null; state.modal = null;
    notify();
    if (L.tab === 'characters') { await fullCharacter(id); notify(); }
    if (L.tab === 'lorebooks') { L.lore = null; const data = await loadLore(id); if (L.sel === id) { L.lore = { name: id, data }; notify(); } }
}
let backTo = 'menu';
export function openLibrary(tab?: string) {
    backTo = state.view === 'worldcfg' ? 'worldcfg' : 'menu';
    if (tab) { L.tab = tab; L.sel = null; L.entry = null; L.q = ''; L.folder = null; }
    state.view = 'library'; L.draft = {}; state.modal = null; L.picked = []; L.picking = false; L.expr = null;
    if (L.tab === 'lorebooks' && L.sel && L.lore?.name !== L.sel) select(L.sel);
    notify();
}
// A character's (or "persona:<file>") Expressions page, from the game or Settings; Back returns there.
export function openExpressions(key: string) {
    const from = state.view, isP = key.startsWith('persona:');
    openLibrary(isP ? 'personas' : 'characters');
    if (from !== 'library') backTo = from;
    EO.outfit = '';
    void select(isP ? key.slice(8) : key).then(() => { L.expr = key; L.sprites = null; notify(); });
}
export function libraryEscape(): boolean {
    if (!L.picked.length && !L.picking) return false;
    clearPicks(); notify();
    return true;
}
const clearPicks = () => { L.picked = []; L.picking = false; L.anchor = null; };
const listTab = () => (isList(L.tab) ? L.tab : null);

// Click opens; Ctrl/⌘+click adds or removes one; Shift+click selects the range from the last one; in
// selection mode a plain click adds or removes.
function clickItem(id: string, e: MouseEvent) {
    if (e.shiftKey) {
        const ids = itemIds();
        const from = ids.indexOf(L.anchor ?? L.sel ?? id), to = ids.indexOf(id);
        if (from < 0 || to < 0) L.picked = [id];
        else {
            const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
            L.picked = (e.ctrlKey || e.metaKey) ? [...new Set([...L.picked, ...range])] : range;
        }
        if (!L.anchor) L.anchor = ids[from] ?? id;
        window.getSelection()?.removeAllRanges();
        notify(); return;
    }
    if (e.ctrlKey || e.metaKey || L.picking || L.picked.length) {
        if (!L.picked.length && L.sel && L.sel !== id && !L.picking) L.picked = [L.sel];
        L.picked = L.picked.includes(id) ? L.picked.filter(x => x !== id) : [...L.picked, id];
        L.anchor = id;
        notify(); return;
    }
    if (L.sel === id) return;
    if (!guard()) return;
    L.anchor = id;
    return select(id);
}

async function doDelete() {
    const m = state.modal; if (!m) return;
    const ids: string[] = m.ids; const what: string = m.what;
    state.modal = null;
    if (what === 'entry') {
        if (!L.lore || L.entry === null) return;
        delete L.lore.data.entries[L.entry];
        await saveLore(L.lore.name, L.lore.data);
        try { ctx().reloadWorldInfoEditor?.(L.lore.name); } catch { /* the editor is closed */ }
        L.entry = null; L.draft = {};
        toast('Entry deleted.', 'success'); notify(); return;
    }
    const n = await busy('Deleting', () => what === 'characters' ? deleteCharacters(ids, !!m.chats) : what === 'personas' ? deletePersonas(ids) : what === 'backgrounds' ? bgDelete(ids) : deleteLorebooks(ids));
    if (what === 'backgrounds') await loadBgs();
    if (what === 'personas' && ids.includes(defaultPersona()) && n) setDefaultPersona(null);
    if (what === 'personas' || what === 'lorebooks') { for (const f of mundiFolders(what as ListTab)) f.items = f.items.filter(x => !ids.includes(x)); LP().fav[what] = (LP().fav[what] ?? []).filter(x => !ids.includes(x)); saveSettings(); }
    if (L.sel && ids.includes(L.sel)) { L.sel = null; L.lore = null; L.draft = {}; L.expr = null; }
    clearPicks();
    toast(n === 1 ? '1 deleted.' : `${n} deleted.`, n ? 'success' : 'warn');
    if (n < ids.length) toast(what === 'personas' ? 'One persona was kept: SillyTavern always needs one.' : 'Some items could not be deleted.', 'warn');
    notify();
}

async function doCreate() {
    const m = state.modal; if (!m) return;
    const tab: ListTab = m.tab; const name = String(m.name ?? '').trim();
    if (!name) { toast('Write a name.', 'warn'); return; }
    const id = await busy('Creating', async () => {
        if (tab === 'characters') return createCharacter({ name, description: String(m.desc ?? '') }, m.blob ?? undefined);
        if (tab === 'personas') return createPersona(name, String(m.desc ?? ''), m.blob ?? await initialsAvatar(name, ['#22d3ee', '#4f46e5']));
        return createLorebook(name);
    });
    if (m.url) URL.revokeObjectURL(m.url);
    if (L.folder) await F.put(tab, L.folder, [id], true);   // created inside the open folder
    state.modal = null; L.q = '';
    L.edit = true;
    await select(id);
    toast('Created.', 'success');
}

async function uploadBgs() {
    const files = await new Promise<File[]>((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,video/*'; i.multiple = true; i.onchange = () => res([...(i.files ?? [])]); i.click(); });
    if (!files.length) return;
    const names = await busy('Uploading', async () => { const out: string[] = []; for (const f of files) out.push(await bgUpload(f, f.name)); return out; });
    if (L.folder) await F.put('backgrounds', L.folder, names, true);
    await loadBgs();
    toast(names.length === 1 ? 'Picture added.' : `${names.length} pictures added.`, 'success');
    if (names.length === 1) await select(names[0]);
}
async function renameBg(file: string) {
    if (!has('bg_name')) return;
    const name = String(L.draft.bg_name).trim();
    if (!name) throw new Error('The name cannot be empty.');
    const next = name + file.slice(file.replace(/\.[^.]+$/, '').length);
    if (next === file) return;
    await bgRename(file, next);
    await loadBgs();
    L.sel = next;
}

// Mundifies the cards of the dialog one by one; a card that fails is said and the others go on.
async function doMundify() {
    const m = state.modal; if (m?.type !== 'lib-dlg-mfy') return;
    const ids: string[] = m.ids; const ai = !!m.ai;
    state.modal = null;
    const made: string[] = [], failed: string[] = [];
    for (const [k, id] of ids.entries()) {
        const name = nameOfId('characters', id);
        try { made.push(await busy(ids.length > 1 ? `Mundifying ${name} (${k + 1} of ${ids.length})` : `Mundifying ${name}`, () => mundify(id, ai))); }
        catch (e: any) { failed.push(`${name}: ${String(e?.message ?? e)}`); }
    }
    if (failed.length) toast(failed.join('\n'), 'error');
    if (made.length) toast(made.length === 1 ? 'Mundified copy made. The original is unchanged.' : `${made.length} mundified copies made. The originals are unchanged.`, 'success');
    if (made.length) { clearPicks(); await select(made[0]); } else notify();
}

async function doMundifyLore() {
    const m = state.modal; if (m?.type !== 'lib-dlg-mfylore') return;
    const name: string = m.id, ai = !!m.ai;
    state.modal = null;
    try {
        const r = await busy(`Mundifying ${name}`, () => mundifyLore(name, ai, (i, n) => { if (n > 1) { state.busy = `Mundifying ${name}: part ${i + 1} of ${n}`; notify(); } }));
        toast(`Mundified copy made: ${r.off} entr${r.off === 1 ? 'y' : 'ies'} switched off${r.rewritten ? `, ${r.rewritten} rewritten` : ''}, ${r.kept} kept as they were. The original is unchanged.`, 'success');
        await select(r.name);
    } catch (e: any) { toast(String(e?.message ?? e), 'error'); notify(); }
}

async function doDuplicate() {
    const tab = listTab(); const id = L.sel;
    if (!tab || !id || !guard()) return;
    const copy = await busy('Duplicating', () => tab === 'characters' ? duplicateCharacter(id) : tab === 'personas' ? duplicatePersona(id) : duplicateLorebook(id));
    toast('Duplicated.', 'success');
    if (copy) await select(copy); else notify();
}

Object.assign(ACT, {
    'lib-clore-del': async (el) => { const a = L.sel; if (!a) return; try { await setCharLorebooks(a, charLorebooks(a).filter(n => n !== el.dataset.name)); } catch (e: any) { toast(String(e?.message ?? e), 'error'); } notify(); },
    'lib-back': () => { if (!guard()) return; state.view = (backTo === 'worldcfg' ? (game() ? 'worldcfg' : 'menu') : ['scene', 'map', 'chat', 'settings'].includes(backTo) && (backTo === 'settings' || game()) ? backTo : 'menu') as any; backTo = 'menu'; clearPicks(); notify(); },
    'lib-tab': (el) => { if (!guard()) return; if (el.dataset.tab === 'backgrounds') L.bgs = null; L.tab = el.dataset.tab!; L.sel = null; L.entry = null; L.expr = null; L.q = ''; L.searching = false; L.folder = null; state.modal = null; clearPicks(); notify(); },
    'lib-sel': (el, e) => clickItem(el.dataset.id!, e as MouseEvent),
    'lib-unsel': () => { if (!guard()) return; L.sel = null; L.expr = null; notify(); },
    'lib-folder': (el) => { L.folder = el.dataset.id!; L.picked = []; L.anchor = null; notify(); },
    'lib-folder-zip': () => {
        const tab = listTab(); if (!tab || !L.folder) return;
        const f = F.list(tab).find(x => x.id === L.folder);
        void exportZip(tab, items(tab).filter(i => F.of(tab, i.id).includes(L.folder!)).map(i => i.id), f?.name ?? 'folder');
    },
    'lib-bulk-zip': () => { const tab = listTab(); if (tab && L.picked.length) void exportZip(tab, [...L.picked], tab === 'characters' ? 'characters' : 'lorebooks'); },
    'lib-folder-del': () => {
        const tab = listTab(); if (!tab || !L.folder) return;
        if (tab === 'characters') deleteFolder(L.folder);
        else { const l = mundiFolders(tab); const i = l.findIndex(f => f.id === L.folder); if (i >= 0) l.splice(i, 1); saveSettings(); }
        L.folder = null; refreshList(); toast('Folder deleted. What was inside is still here.', 'success'); notify();
    },
    'lib-export-open': () => { EXP.open = !EXP.open; notify(); },
    'lib-tag-add': () => { if (!L.sel) return; if (!tagCharacter(L.sel, TG.text)) { toast('Write a tag.', 'info'); return; } TG.text = ''; notify(); },
    'lib-tag-del': (el) => { if (!L.sel) return; untagCharacter(L.sel, el.dataset.id!); notify(); },
    'lib-sort-open': () => { SO.open = !SO.open; notify(); },
    'lib-sort': (el) => { const tab = listTab(); if (!tab) return; const p = LP() as any; (p.sorts ??= {})[tab] = el.dataset.v; SO.open = false; saveSettings(); notify(); },
    'lib-export': async (el) => { EXP.open = false; notify(); if (!L.sel) return; try { await exportCharacter(L.sel, el.dataset.f as any); } catch (e: any) { toast(String(e?.message ?? e), 'error'); } },
    'lib-greet': async (el) => {
        try { await openCharacter(el.dataset.avatar!, true); useGreeting(Number(el.dataset.k)); state.view = 'chat' as any; notify(); }
        catch (e: any) { toast(String(e?.message ?? e), 'error'); }
    },
    'lib-folder-up': () => { L.folder = null; L.picked = []; L.anchor = null; notify(); },
    'lib-favonly': () => { L.favOnly = !L.favOnly; notify(); },
    'lib-search': () => { L.searching = !(L.searching || L.q); if (!L.searching) L.q = ''; notify(); if (L.searching) setTimeout(() => document.querySelector<HTMLInputElement>('#mundi-root [data-input="lib-q"]')?.focus(), 30); },
    'lib-view': () => { const p = LP() as any; (p.views ??= {})[L.tab] = grid() ? 'list' : 'grid'; saveSettings(); notify(); },
    'lib-picking': () => { L.picking = !L.picking; if (!L.picking) L.picked = []; notify(); },
    'lib-pick-all': () => { L.picked = itemIds(); L.picking = true; notify(); },
    'lib-pick-clear': () => { clearPicks(); notify(); },
    'lib-edit': () => { if (L.edit && !guard()) return; L.edit = !L.edit; if (!L.edit) L.adv = false; notify(); },
    'lib-adv': () => { L.adv = !L.adv; notify(); },
    'lib-entry': (el) => { const uid = el.dataset.uid!; if (!guard()) return; L.entry = L.entry === uid ? null : uid; state.modal = null; notify(); },
    'lib-discard': () => { L.draft = {}; notify(); },
    'lib-leave-stay': (el, e) => { if (e && el.classList.contains('mu-dlg-veil') && e.target !== el) return; pending = null; state.modal = null; notify(); },
    'lib-leave-go': () => { L.draft = {}; resume(); },
    'lib-leave-save': async () => { state.modal = null; await (ACT as any)['lib-save']?.(); if (!dirty()) resume(); else notify(); },
    'lib-alt-add': () => { const c = L.sel ? charOf(L.sel) : null; if (!c) return; L.draft.alt = [...altOf(c), '']; notify();
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`#mundi-root [data-focus="lib-alt-${L.draft.alt.length - 1}"]`)?.focus()); },
    'lib-alt-del': (el) => { const c = L.sel ? charOf(L.sel) : null; if (!c) return; const l = [...altOf(c)]; l.splice(Number(el.dataset.k), 1); L.draft.alt = l; notify(); },
    'lib-save': async () => {
        if (!dirty()) { toast('Nothing to save.'); return; }
        await busy('Saving', async () => {
            if (L.tab === 'characters' && L.sel) await saveChar(L.sel);
            else if (L.tab === 'personas' && L.sel) await savePersonaDraft(L.sel);
            else if (L.tab === 'lorebooks') await saveEntry();
            else if (L.tab === 'backgrounds' && L.sel) await renameBg(L.sel);
            else if (L.tab === 'save') await saveSaveTab();
        });
        L.draft = {};
        toast('Saved.', 'success');
        if (L.tab === 'save' || L.tab === 'personas') import('../sim/prompt.js').then(m => m.refreshPrompt());
    },
    'lib-new-entry': async () => {
        if (!guard() || !L.lore) return;
        const e = newLoreEntry(L.lore.name, L.lore.data);
        if (!e) return;
        e.comment = 'New entry';
        await saveLore(L.lore.name, L.lore.data);
        L.entry = String(e.uid); L.edit = true;
        notify();
    },
    // create, duplicate, picture
    'lib-import': async () => {
        const tab = L.tab as ListTab;
        const accept = tab === 'characters' ? '.png,.json,.charx,.yaml,.yml,.byaf' : tab === 'personas' ? 'image/*' : '.json,.png';
        const files = await pickFiles(accept);
        if (!files.length) return;
        try {
            await busy('Importing', () => tab === 'characters' ? importCharacterFiles(files) : tab === 'personas' ? importPersonaPictures(files) : importLorebookFiles(files));
            toast(files.length === 1 ? 'Imported.' : `${files.length} files imported.`, 'success');
        } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        notify();
    },
    'lib-create': async () => {
        const tab = listTab(); if (!tab || !guard()) return;
        if (tab === 'backgrounds') { await uploadBgs(); return; }
        state.modal = { type: 'lib-dlg-create', tab, name: '', desc: '' }; notify(); setTimeout(() => document.querySelector<HTMLInputElement>('#mundi-root [data-input="lib-dlg-name"]')?.focus(), 30);
    },
    'lib-create-pic': async () => {
        const blob = await pickAndCrop(); const m = state.modal;
        if (!blob || !m) return;
        if (m.url) URL.revokeObjectURL(m.url);
        m.blob = blob; m.url = URL.createObjectURL(blob); notify();
    },
    'lib-create-yes': () => doCreate(),
    'lib-dup': () => doDuplicate(),
    'lib-pic': async () => {
        const id = L.sel; const tab = listTab();
        if (!id || !tab) return;
        const blob = await pickAndCrop();
        if (!blob) return;
        await busy('Saving', () => tab === 'characters' ? setCharacterImage(id, blob) : setPersonaImage(id, blob));
        toast('Picture changed.', 'success'); notify();
    },
    'lib-crown': () => { const id = L.sel; if (!id) return; setDefaultPersona(defaultPersona() === id ? null : id); notify(); },
    // expressions
    'lib-expr': () => { if (!guard() || !L.sel || !listTab()) return; L.expr = sprKey(listTab()!, L.sel); L.sprites = null; notify(); },
    'lib-nospr': () => { NS.on = !NS.on; notify(); },
    'lib-mfyonly': () => { MF.on = !MF.on; notify(); },
    'lib-mfy': () => { if (L.sel && guard()) { state.modal = { type: 'lib-dlg-mfy', ids: [L.sel], ai: true }; notify(); } },
    'lib-bulk-mfy': () => {
        const ids = L.picked.filter(a => { const c = charOf(a); return c && !madeForMundi(c) && !mundifiedOf(c); });
        if (!ids.length) { toast('These are made for Mundi already.', 'info'); return; }
        state.modal = { type: 'lib-dlg-mfy', ids, ai: true }; notify();
    },
    'lib-style': () => { if (L.sel && guard()) void doStyle([L.sel]); },
    'lib-bulk-style': () => { const ids = L.picked.filter(needsStyle); if (ids.length && guard()) void doStyle(ids); },
    'lib-mfy-go': (el) => { if (guard()) void select(el.dataset.id!); },
    'lib-mfy-yes': () => void doMundify(),
    'lib-mfylore': () => { if (L.sel && guard()) { state.modal = { type: 'lib-dlg-mfylore', id: L.sel, ai: true }; notify(); } },
    'lib-mfylore-yes': () => void doMundifyLore(),
    'lib-nospr-draw': () => {
        const tab = listTab(); if (!tab) return;
        const n = drawEveryone(items(tab).map(i => sprKey(tab, i.id)));
        toast(n ? `Drawing ${n === 1 ? '1 person' : `${n} people`} on ComfyUI: everyone's neutral sprite first, then the rest.` : 'They are all being drawn already.', 'info');
        notify();
    },
    'lib-expr-close': () => { L.expr = null; EO.outfit = ''; notify(); },
    'lib-outfit': (el) => { EO.outfit = el.dataset.o ?? ''; L.sprites = null; notify(); },
    'lib-outfit-add': () => { const id = L.expr; if (!id) return; const n = addOutfit(id, EO.name); if (!n) { toast('Write the folder name.', 'info'); return; } EO.name = ''; EO.outfit = n; L.sprites = null; notify(); },
    'lib-outfit-del': (el) => { const id = L.expr; if (!id) return; removeOutfit(id, el.dataset.o ?? ''); forgetOutfits(id); if (EO.outfit === el.dataset.o) { EO.outfit = ''; L.sprites = null; } notify(); },
    'lib-expr-up': async (el) => {
        const id = L.expr; if (!id) return;
        const file = await pickFile('image/*');
        if (!file) return;
        await busy('Uploading', () => uploadSprite(id, el.dataset.l!, file, el.dataset.s || el.dataset.l!, EO.outfit));
        forgetOutfits(id); delete (state.sprites as any)[id];
        L.sprites = null; notify();
    },
    'lib-expr-del': async (el) => {
        const id = L.expr; if (!id) return;
        await busy('Deleting', () => deleteSprite(id, el.dataset.l!, el.dataset.s!, EO.outfit));
        delete (state.sprites as any)[id];
        L.sprites = null; notify();
    },
    // deleting always asks first
    'lib-del-one': () => { if (L.sel) { state.modal = { type: 'lib-dlg-del', what: L.tab, ids: [L.sel], chats: false }; notify(); } },
    'lib-del-entry': () => { state.modal = { type: 'lib-dlg-del', what: 'entry', ids: [L.entry] }; notify(); },
    'lib-bulk-del': () => { if (L.picked.length) { state.modal = { type: 'lib-dlg-del', what: L.tab, ids: L.picked.slice(), chats: false }; notify(); } },
    'lib-del-yes': () => doDelete(),
    'lib-dlg-close': (_el, e) => { e.stopPropagation(); if (state.modal?.url) URL.revokeObjectURL(state.modal.url); state.modal = null; notify(); },
    'lib-stay': () => { /* clicks inside a dialog do not close it */ },
    // favorites and folders
    'lib-fav': async () => { const tab = listTab(); if (!tab || !L.sel) return; await FAV.set(tab, [L.sel], !FAV.is(tab, L.sel)); notify(); },
    'lib-bulk-fav': async () => {
        const tab = listTab(); if (!tab) return;
        const on = !L.picked.every(id => FAV.is(tab, id));
        await busy('Saving', () => FAV.set(tab, L.picked, on));
        toast(on ? 'Added to favorites.' : 'Removed from favorites.', 'success'); notify();
    },
    'lib-folder-dlg': () => { const tab = listTab(); if (tab && L.sel) { state.modal = { type: 'lib-dlg-folder', tab, ids: [L.sel], name: '' }; notify(); } },
    'lib-bulk-folder': () => { const tab = listTab(); if (tab && L.picked.length) { state.modal = { type: 'lib-dlg-folder', tab, ids: L.picked.slice(), name: '' }; notify(); } },
    'lib-folder-toggle': async (el) => {
        const m = state.modal; if (!m) return;
        const all = m.ids.every((a: string) => F.of(m.tab, a).includes(el.dataset.id!));
        await F.put(m.tab, el.dataset.id!, m.ids, !all);
        notify();
    },
    'lib-folder-new': async () => {
        const m = state.modal; const name = String(m?.name ?? '').trim();
        if (!m || !name) { toast('Write a name for the folder.', 'warn'); return; }
        const f = await F.make(m.tab, name);
        await F.put(m.tab, f.id, m.ids, true);
        m.name = ''; notify();
    },
    'lib-newfolder': () => { if (listTab()) { state.modal = { type: 'lib-dlg-newfolder', name: '' }; notify(); setTimeout(() => document.querySelector<HTMLInputElement>('#mundi-root [data-input="lib-dlg-name"]')?.focus(), 30); } },
    'lib-folder-ren': () => {
        const tab = listTab(); const f = tab && L.folder ? F.list(tab).find(x => x.id === L.folder) : null; if (!tab || !f) return;
        state.modal = { type: 'lib-dlg-renfolder', tab, id: f.id, name: f.name }; notify();
        setTimeout(() => { const i = document.querySelector<HTMLInputElement>('#mundi-root [data-input="lib-dlg-name"]'); i?.focus(); i?.select(); }, 30);
    },
    'lib-folder-ren-yes': () => {
        const m = state.modal; if (m?.type !== 'lib-dlg-renfolder') return;
        const name = String(m.name ?? '').trim();
        if (!name) { toast('Write a name for the folder.', 'warn'); return; }
        if (F.list(m.tab).some(f => f.id !== m.id && f.name.toLowerCase() === name.toLowerCase())) { toast('There is already a folder with this name.', 'warn'); return; }
        F.rename(m.tab, m.id, name);
        state.modal = null; notify(); toast('Folder renamed.', 'success');
    },
    'lib-newfolder-yes': async () => {
        const tab = listTab(); const name = String(state.modal?.name ?? '').trim();
        if (!tab) return;
        if (!name) { toast('Write a name for the folder.', 'warn'); return; }
        const f = await F.make(tab, name);
        if (L.picked.length) await F.put(tab, f.id, L.picked, true);
        state.modal = null; clearPicks(); notify();
        toast('Folder created.', 'success');
    },
    'lib-trait': (el) => {
        const sheet = L.sel ? personaSheet(L.sel) : null; const w = sheet ? getWorld(sheet.world) : null;
        if (!sheet || !w) return;
        const t = L.draft.__traits ?? JSON.parse(JSON.stringify(sheet.traits ?? {}));
        toggleTrait(w.sheet.traits ?? [], t, el.dataset.k!, el.dataset.v!);
        L.draft.__traits = t; notify();
    },
});

Object.assign(INPUT, {
    'lib-folder-color': (el) => {
        const tab = listTab(); if (!tab || !L.folder) return;
        if (tab === 'characters') setFolderColor(L.folder, el.value);
        else { const f = mundiFolders(tab).find(x => x.id === L.folder) as any; if (f) { f.color = el.value; saveSettings(); } }
        notify();
    },
    'lib-ptrait': (el) => { if (!el.value) return; const cur = String(L.draft.description ?? personas().find(p => p.file === L.sel)?.description ?? ''); L.draft.description = `${cur.trim()}${cur.trim() ? '\n' : ''}{{user}} is ${el.value.toLowerCase()}.`; el.value = ''; notify(); },
    'lib-plore': (el) => { if (!L.sel) return; setPersonaLore(L.sel, el.value); toast('Lorebook linked to this persona.', 'success'); notify(); },
    'lib-clore-add': async (el) => { const a = L.sel; if (!a || !el.value) return; try { await setCharLorebooks(a, [...charLorebooks(a), el.value]); toast('Lorebook linked.', 'success'); } catch (e: any) { toast(String(e?.message ?? e), 'error'); } notify(); },
    'lib-q': (el) => { L.q = el.value; notify(); },
    'lib-delchats': (el) => { if (state.modal) state.modal.chats = el.checked; },
    'lib-dlg-name': (el) => { if (state.modal) state.modal.name = el.value; },
    'lib-outfit-name': (el) => { EO.name = el.value; },
    'lib-tag-text': (el) => { TG.text = el.value; },
    'lib-mfy-ai': (el) => { if (state.modal?.type === 'lib-dlg-mfy' || state.modal?.type === 'lib-dlg-mfylore') state.modal.ai = (el as HTMLInputElement).checked; },
    'lib-dlg-desc': (el) => { if (state.modal) state.modal.desc = el.value; },
    'lib-alt': (el) => {
        const c = L.sel ? charOf(L.sel) : null; if (!c) return;
        const first = !dirty();
        const l = [...altOf(c)]; l[Number(el.dataset.k)] = el.value; L.draft.alt = l;
        if (first) notify();   // shows "Unsaved changes"
    },
    'lib-f': (el) => {
        const kind = el.dataset.kind;
        L.draft[el.dataset.k!] = kind === 'check' ? el.checked : el.value;
        // forms keep their own text while typing; a redraw only for switches and lists, and to show "Undo changes"
        if (kind === 'check' || kind === 'select' || Object.keys(L.draft).length === 1) notify();
    },
});
// the export menu closes when you click anywhere else
document.addEventListener('click', (e) => {
    if ((!EXP.open && !SO.open) || (e.target as HTMLElement).closest?.('.mu-exp-wrap')) return;
    EXP.open = false; SO.open = false; setTimeout(notify, 0);
}, true);

/* ---------- drag a card onto a folder (it moves there; nothing is copied) ---------- */
// The browser's own drag of a picture would reach SillyTavern's file drop and import the card again, so a drag
// started in the Library carries only Mundi's own data and every drop inside Mundi is caught here.
const DRAG = { ids: [] as string[], tab: '' as ListTab | '' };
const MIME = 'application/x-mundi-item';
const inMundi = (e: Event) => !!(e.target as HTMLElement)?.closest?.('#mundi-root');
document.addEventListener('dragstart', (e) => {
    const el = (e.target as HTMLElement)?.closest?.<HTMLElement>('#mundi-root .mu-lib-item[data-act="lib-sel"]');
    if (!el) { if (inMundi(e) && (e.target as HTMLElement)?.tagName === 'IMG') e.preventDefault(); return; }
    const tab = listTab(); const id = el.dataset.id!;
    if (!tab || !e.dataTransfer) { e.preventDefault(); return; }
    DRAG.tab = tab; DRAG.ids = L.picked.includes(id) ? L.picked.slice() : [id];
    e.dataTransfer.clearData(); e.dataTransfer.setData(MIME, DRAG.ids.join('\n')); e.dataTransfer.effectAllowed = 'move';
    el.classList.add('is-dragging');
}, true);
document.addEventListener('dragend', () => {
    DRAG.ids = []; DRAG.tab = '';
    document.querySelectorAll('#mundi-root .is-dragging, #mundi-root .is-drop').forEach(x => x.classList.remove('is-dragging', 'is-drop'));
}, true);
const target = (e: DragEvent) => (e.target as HTMLElement)?.closest?.<HTMLElement>('#mundi-root [data-drop]');
document.addEventListener('dragover', (e) => {
    if (!DRAG.ids.length) return;
    e.preventDefault(); e.stopPropagation();
    const t = target(e);
    if (e.dataTransfer) e.dataTransfer.dropEffect = t ? 'move' : 'none';
    document.querySelectorAll('#mundi-root .is-drop').forEach(x => { if (x !== t) x.classList.remove('is-drop'); });
    t?.classList.add('is-drop');
}, true);
document.addEventListener('drop', async (e) => {
    if (!DRAG.ids.length && !e.dataTransfer?.types.includes(MIME)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const t = target(e); const tab = DRAG.tab; const ids = DRAG.ids.slice();
    DRAG.ids = []; DRAG.tab = '';
    document.querySelectorAll('#mundi-root .is-dragging, #mundi-root .is-drop').forEach(x => x.classList.remove('is-dragging', 'is-drop'));
    if (!t || !tab || tab !== listTab()) return;
    const to = t.dataset.drop ?? '', from = L.folder ?? '';
    if (to === from) return;
    if (from) await F.put(tab, from, ids, false);
    if (to) await F.put(tab, to, ids, true);
    const name = to ? F.list(tab).find(f => f.id === to)?.name ?? '' : '';
    toast(to ? `Moved to ${name}.` : 'Taken out of the folder.', 'success');
    clearPicks(); notify();
}, true);
