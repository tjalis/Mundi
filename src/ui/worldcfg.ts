// This world (the globe button, in game): the people who live here (job, home, routine), this save's notes,
// the lorebooks the world uses, and the world's rules. "Advanced" shows the finer settings.
import { state, notify, esc, game, toast, saveGame, cfg, type Save } from '../core/store.js';
import { DIFFICULTIES, difficultyOf } from '../sim/bills.js';
import { getWorld, activeStatuses, gameMode, GAME_MODES, type WorldDef } from '../core/world.js';
import { ctx, thumb, characters, charOf, personaThumb, personaName, lorebooks, chatLore, bindChatLore, createLorebook } from '../st/bridge.js';
import { homeAddress, placeOf } from '../sim/places.js';
import { resident, homeSpot, syncScene, currentEntry } from '../sim/game.js';
import { social, bondLabel } from '../sim/social.js';
import { romOf, romanceTier, setRomance, STATUS_TIER, type RomStatus } from '../sim/romance.js';
import { romanceBlocked } from '../sim/family.js';
import { tiesOf, setTie, removeTie, liveTogether, TIE_TYPES, TIE_TONES, type TieType, type TieTone } from '../sim/living.js';
import { freeSpots } from '../sim/work.js';
import { refreshPrompt } from '../sim/prompt.js';
import { facts } from '../sim/facts.js';
import { factUi, stamp } from './journal.js';
import { applyGameLore } from '../sim/lore.js';
import { icon } from './icons.js';
import { weekday } from '../sim/time.js';
import { tabHouseholds } from './households.js';
import { tabAiContext } from './aictx.js';
import { warningsBanner } from './warnings.js';
import { ACT, INPUT } from './reg.js';

type Tab = 'people' | 'homes' | 'save' | 'lore' | 'ai' | 'rules';
const TABS: [Tab, string][] = [['people', 'People'], ['homes', 'Households'], ['save', "Author's Note"], ['lore', 'Lorebooks'], ['ai', 'AI context'], ['rules', 'World']];
const WC = { tab: 'people' as Tab, adv: false, who: '', adding: false, q: '', lq: '', back: 'map' as string };

const opt = (v: string, label: string, sel: boolean) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
const sameRoutine = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// the real statuses only: No romance / Interest / Crush are just labels derived from the value, not states
const ROM_OPTS: [RomStatus, string][] = [['none', 'No relationship'], ...Object.entries(STATUS_TIER).map(([id, t]) => [id as RomStatus, t.name] as [RomStatus, string])];

/* ---------- people ---------- */

function personForm(g: Save, w: WorldDef): string {
    const r = g.cast[WC.who];
    if (!r) return '<p class="mu-muted mu-pad">Choose someone on the left.</p>';
    const tpl = Object.entries(w.cast.routineTemplates).find(([, t]) => sameRoutine(t, r.routine))?.[0] ?? '';
    const bond = social(g).bond[r.avatar] ?? 0;
    const rom = romOf(g, r.avatar);
    const rT = romanceTier(g, r.avatar, rom.value);
    const blocked = romanceBlocked(g, r.avatar);
    const leisure = w.places.filter(p => (p.tags ?? []).some(t => ['leisure', 'food', 'shop'].includes(t)));
    return `<header class="mu-wc-head"><img src="${esc(thumb(r.avatar))}" alt=""><div><h3 data-notr>${esc(r.name)}</h3><small>${esc(homeAddress(w, r.home))}</small></div></header>
        <label class="mu-field"><span>Job</span><select data-input="wc-job">${opt('', 'No job', !r.occupation)}${w.occupations.map(o => opt(o.id, `${o.name} · ${placeOf(g, w, o.place)?.name ?? ''}`, r.occupation === o.id)).join('')}</select></label>
        <label class="mu-field"><span>Lives in</span><select data-input="wc-zone">${w.homes.zones.map(z => opt(z.id, `${z.name} (${w.homes.kinds[z.kind]?.name ?? z.kind})`, r.home.zone === z.id)).join('')}</select></label>
        <label class="mu-check"><input type="checkbox" data-input="wc-met" ${r.met ? 'checked' : ''}><span>You know them<small>They show up by name, in People and in Messages.</small></span></label>
        ${tiesHtml(g, r.avatar)}
        ${WC.adv ? `<h4 class="mu-lib-advhead">Advanced settings</h4>
            <label class="mu-field"><span>Daily routine</span><select data-input="wc-routine">${tpl ? '' : opt('', 'Custom', true)}${Object.keys(w.cast.routineTemplates).map(k => opt(k, k, tpl === k)).join('')}</select></label>
            <div class="mu-field"><span>Where they go in their free time</span><div class="mu-chips">${leisure.map(p => `<button class="mu-chip ${r.leisure.includes(p.id) ? 'is-on' : ''}" data-act="wc-leisure" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>
                <small class="mu-muted">None chosen: any leisure place.</small></div>
            <label class="mu-field slider"><span>Bond with you · ${bond}/100 (${bondLabel(g, r.avatar)})</span><input type="range" min="0" max="100" value="${bond}" data-input="wc-bond"></label>
            <label class="mu-field slider"><span>Romance · ${rom.value}/100 (${rT.name})</span><input type="range" min="0" max="100" value="${rom.value}" data-input="wc-rom" ${blocked ? 'disabled' : ''}></label>
            <label class="mu-field"><span>Relationship</span><select data-input="wc-rom-tier" ${blocked ? 'disabled' : ''}>${ROM_OPTS.map(([id, n]) => opt(id, n, rom.status === id)).join('')}</select></label>
            <small class="mu-muted">${blocked ? 'Not possible with family or a child.' : 'The value is how strong the romance is (No romance, then Interest, then Crush); Dating, Engaged and Married come from asking them — or pick one here.'}</small>
            <button class="mu-danger" data-act="wc-remove">${icon('trash')}<span>Remove from this world</span></button>
            <small class="mu-muted">Their card stays in SillyTavern; they just stop living here.</small>` : ''}`;
}

function addPicker(g: Save): string {
    const q = WC.q.toLowerCase();
    const list = characters().filter(c => !g.cast[c.avatar] && (!q || String(c.name).toLowerCase().includes(q))).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return `<div class="mu-dlg-veil" data-act="wc-add-close"></div><div class="mu-panel mu-scpick" role="dialog"><header><h3>Add someone to this world</h3><button class="mu-ibtn mu-ghost" data-act="wc-add-close" aria-label="Close">${icon('x')}</button></header>
        <p class="mu-muted">Mundi gives them a home, a routine and a job. Their card is not changed.</p>
        <input class="mu-search" type="search" data-input="wc-q" data-focus="wcq" placeholder="Search your characters" value="${esc(WC.q)}">
        <div class="mu-scpick-grid" data-keep="wcpick">${list.map(c => `<button data-act="wc-add" data-avatar="${esc(c.avatar)}"><img src="${esc(thumb(c.avatar))}" alt="" loading="lazy"><span data-notr>${esc(c.name)}</span></button>`).join('') || '<p class="mu-muted">No characters found.</p>'}</div></div>`;
}

// Opens a person's page in People (from Households).
export function editPerson(avatar: string) { WC.tab = 'people'; WC.who = avatar; notify(); }

function tabPeople(g: Save, w: WorldDef): string {
    const list = Object.values(g.cast).sort((a, b) => a.name.localeCompare(b.name));
    if (!g.cast[WC.who]) WC.who = list[0]?.avatar ?? '';
    // grouped by address: people who live together are listed together
    const key = (r: typeof list[number]) => `${r.home.zone}:${r.home.x},${r.home.y}`;
    const mine = `${g.player.home.zone}:${g.player.home.x},${g.player.home.y}`;
    const groups = new Map<string, typeof list>();
    for (const r of list) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
    const ordered = [...groups.entries()].sort(([a, x], [b, y]) => Number(b === mine) - Number(a === mine) || x[0].name.localeCompare(y[0].name));
    return `<div class="mu-wc-people">
        <aside class="mu-wc-list" data-keep="wc-list">
            <button class="mu-primary" data-act="wc-add-open">${icon('plus')}<span>Add someone</span></button>
            <div class="mu-wc-row is-you"><img src="${esc(personaThumb())}" alt=""><span><b data-notr>${esc(personaName())}</b><small>You · ${esc(homeAddress(w, g.player.home))}</small></span></div>
            ${ordered.map(([k, rs]) => `<h5 class="mu-wc-addr">${k === mine ? `${icon('home')} ` : ''}${esc(homeAddress(w, rs[0].home))}${k === mine ? ' · with you' : ''}</h5>
                ${rs.map(r => `<button class="mu-wc-row ${WC.who === r.avatar ? 'is-on' : ''}" data-act="wc-who" data-who="${esc(r.avatar)}"><img src="${esc(thumb(r.avatar))}" alt="">
                <span><b data-notr>${esc(r.name)}</b><small>${esc(w.occupations.find(o => o.id === r.occupation)?.name ?? 'No job')}</small></span></button>`).join('')}`).join('')}
        </aside>
        <section class="mu-wc-form" data-keep="wc-form">${personForm(g, w)}</section>
    </div>${WC.adding ? addPicker(g) : ''}`;
}

/* ---------- this save: Author's Note ---------- */

const AN_POS: [number, string][] = [[1, 'In the chat, at a depth'], [0, 'After the story string'], [2, 'Before the story string']];
function tabSave(): string {
    const m = ctx().chatMetadata ?? {};
    return `<section class="mu-wc-sec"><h4>Author's Note</h4>
        <label class="mu-field"><span>A standing instruction for this save only: tone, pacing, what to focus on.</span><textarea rows="6" data-input="wc-note" data-focus="wcnote">${esc(m.note_prompt ?? '')}</textarea></label>
        ${WC.adv ? `<div class="mu-row2"><label class="mu-field"><span>Every how many messages</span><input type="number" min="0" value="${esc(m.note_interval ?? 1)}" data-input="wc-note-num" data-k="note_interval"></label>
            <label class="mu-field"><span>Depth</span><input type="number" min="0" value="${esc(m.note_depth ?? 4)}" data-input="wc-note-num" data-k="note_depth"></label></div>
            <label class="mu-field"><span>Position</span><select data-input="wc-note-num" data-k="note_position">${AN_POS.map(([v, l]) => opt(String(v), l, Number(m.note_position ?? 1) === v)).join('')}</select></label>` : ''}
        <small class="mu-muted">The same Author's Note as in SillyTavern; it is saved with this chat.</small></section>
        ${WC.adv ? `
        <section class="mu-wc-sec"><h4>Story memory</h4><p class="mu-muted">Facts the game noted as you played. The AI only gets those about the people in the scene and this place.</p>
            ${memoryByDay()}</section>` : ''}`;
}

// Story memory, a day at a time (newest day first), like the diary. MEMDAYS: days opened or closed by hand.
const MEMDAYS = new Map<number, boolean>();
function memoryByDay(): string {
    const g = game()!; const w = getWorld(g.world)!;
    const list = facts(g).slice(-120);
    if (!list.length) return '<p class="mu-muted">Nothing yet.</p>';
    const days = [...new Set(list.map(f => Math.floor(f.at / 1440)))].sort((a, b) => b - a);
    const open = (d: number) => (MEMDAYS.has(d) ? MEMDAYS.get(d)! : d === days[0]);
    return days.map(d => `<div class="mu-wc-day"><button class="mu-ghost mu-wc-dayhead" data-act="wc-memday" data-d="${d}">${icon(open(d) ? 'up' : 'down')}<span>${esc(weekday(d))} · Day ${d}</span><small>${list.filter(f => Math.floor(f.at / 1440) === d).length}</small></button>
        ${open(d) ? list.filter(f => Math.floor(f.at / 1440) === d).reverse().map(f => `<div class="mu-wc-recap"><span><small>${esc(stamp(g, w, f))}</small><p data-notr>${esc(factUi(f))}</p></span><button class="mu-ghost mu-ibtn" data-act="wc-fact-del" data-id="${esc(f.id)}" title="Forget this">${icon('trash')}</button></div>`).join('') : ''}</div>`).join('');
}

/* ---------- lorebooks ---------- */

function tabLore(g: Save): string {
    const own = chatLore();
    const extra = cfg(g).lore ?? [];
    const on = (n: string) => n === own || extra.includes(n);
    const q = WC.lq.toLowerCase();
    const books = lorebooks().filter(n => !q || n.toLowerCase().includes(q)).sort((a, b) => Number(on(b)) - Number(on(a)) || a.localeCompare(b));
    const count = lorebooks().filter(on).length;
    return `<section class="mu-wc-sec"><h4>Lorebooks of this world · ${count}</h4>
            <p class="mu-muted">Tick as many as you want: all of them are used while you play this world. The main one is saved with the chat (SillyTavern's chat lorebook); the others are switched on when you enter this game and off when you leave it.</p>
            <div class="mu-row"><input class="mu-search" type="search" data-input="wc-lq" data-focus="wclq" placeholder="Search lorebooks" value="${esc(WC.lq)}">
                <button data-act="wc-lore-new">${icon('plus')}<span>New lorebook</span></button></div>
            <div class="mu-wc-books">${books.map(n => `<div class="mu-wc-book ${on(n) ? 'is-on' : ''}">
                <label class="mu-check"><input type="checkbox" data-input="wc-lore" data-name="${esc(n)}" ${on(n) ? 'checked' : ''}><span data-notr>${esc(n)}</span></label>
                ${n === own ? '<b class="mu-wc-main">Main</b>' : on(n) ? `<button class="mu-ghost" data-act="wc-lore-main" data-name="${esc(n)}" title="Save it with the chat">Make main</button>` : ''}</div>`).join('') || '<p class="mu-muted">No lorebooks found.</p>'}</div>
            <button class="mu-ghost" data-act="wc-lib">${icon('book')}<span>Edit lorebooks in the Library</span></button></section>`;
}

/* ---------- the world's rules ---------- */

function tabRules(g: Save, w: WorldDef): string {
    const c = cfg(g);
    const list = (items: string[]) => `<div class="mu-chips">${items.map(x => `<span class="mu-chip">${esc(x)}</span>`).join('')}</div>`;
    const slider = (label: string, key: keyof typeof c, v: number, min: number, max: number, step: number, unit: string) =>
        `<label class="mu-field slider"><span>${label} · ${v}${unit}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-input="wc-cfg" data-k="${key}"></label>`;
    const live = (c.clock ?? 'action') === 'live';
    return `<section class="mu-wc-sec"><h4>${esc(w.name)}</h4><p>${esc(w.description)}</p><p class="mu-muted">Game mode: <b>${GAME_MODES.find(m => m.id === gameMode(w))!.name}</b> (change it in the world creator).</p></section>
        <section class="mu-wc-sec"><h4>Time</h4>
            <div class="mu-heropick is-start">
                <button class="mu-herocard ${live ? '' : 'is-on'}" data-act="wc-clock" data-v="action"><b>Only with actions</b><p>The clock moves only when you do something: eat, drink, sleep, work, travel, or let time pass. Talking does not spend time.</p></button>
                <button class="mu-herocard ${live ? 'is-on' : ''}" data-act="wc-clock" data-v="live"><b>Running clock</b><p>Time also passes by itself while you play (1 real second = 1 game minute at ×1). For testing.</p></button></div></section>
        <section class="mu-wc-sec"><h4>Difficulty</h4><p class="mu-muted">Changes the economy: what work pays, what things cost and what bills are.</p>
            <div class="mu-heropick is-start mu-diff">${DIFFICULTIES.map(d => `<button class="mu-herocard ${difficultyOf(g).id === d.id ? 'is-on' : ''}" data-act="wc-diff" data-v="${d.id}"><b>${d.name}</b><p>${d.desc}</p></button>`).join('')}</div></section>
        <section class="mu-wc-sec"><h4>Needs</h4>${list(activeStatuses(w).map(s => `${s.icon} ${s.name}`))}</section>
        <section class="mu-wc-sec"><h4>Places</h4>${list(w.places.map(p => p.name))}</section>
        <section class="mu-wc-sec"><h4>Jobs</h4><ul class="mu-lib-jobs">${w.occupations.map(o => `<li><b>${esc(o.name)}</b> <small>${o.ranks.map(r => esc(r.name)).join(' → ')}</small></li>`).join('')}</ul></section>
        ${WC.adv ? `<section class="mu-wc-sec"><h4>Advanced settings</h4>
            ${slider('Travel time', 'travel', c.travel ?? 1, 0.25, 3, 0.25, '×')}
            ${slider('How fast needs drop', 'decay', c.decay ?? 1, 0, 3, 0.25, '×')}
            ${slider('Days in each season', 'seasonDays', c.seasonDays ?? 14, 3, 60, 1, ' days')}
            ${slider('Most bond you can gain with someone in a day', 'bondCap', c.bondCap ?? 15, 5, 50, 5, '')}
            <button class="mu-ghost" data-act="wc-cfg-reset">${icon('undo')}<span>Back to the world's defaults</span></button></section>`
            : '<p class="mu-muted">Turn on "Advanced" for travel time, how fast needs drop and more.</p>'}`;
}

export function worldCfgHtml(): string {
    const g = game(); const w = g && getWorld(g.world);
    if (!g || !w) return '';
    const body = WC.tab === 'people' ? tabPeople(g, w) : WC.tab === 'homes' ? tabHouseholds(g, w) : WC.tab === 'ai' ? tabAiContext() : WC.tab === 'save' ? tabSave() : WC.tab === 'lore' ? tabLore(g) : tabRules(g, w);
    return `<div class="mu-settings mu-worldcfg">
        <div class="mu-subhead"><button data-act="wc-back" data-sfx="back">← Back</button><h2>This world</h2><small data-notr>${esc(currentEntry()?.title ?? w.name)}</small>
            <label class="mu-switch-row"><span>Advanced</span><input type="checkbox" class="mu-toggle" data-input="wc-adv" ${WC.adv ? 'checked' : ''}></label></div>
        ${warningsBanner()}
        <div class="mu-settings-layout">
            <nav class="mu-tabs">${TABS.map(([id, l]) => `<button class="${WC.tab === id ? 'is-on' : ''}" data-act="wc-tab" data-tab="${id}">${l}</button>`).join('')}</nav>
            <div class="mu-settings-body mu-panel" data-keep="worldcfg">${body}</div>
        </div></div>`;
}

/* ---------- actions ---------- */

const ctxGW = () => { const g = game(); const w = g && getWorld(g.world); return g && w ? { g, w } : null; };
const changed = async () => { saveGame(); await syncScene(); refreshPrompt(); notify(); };
const noteSave = () => { ctx().saveMetadataDebounced(); };

// Family and ties (like The Sims): who is whose mother, sibling, spouse… and how they get along. '__you' is you.
const TIE = { other: '', type: 'sibling' as TieType, tone: 'good' as TieTone, together: false };
// a tie told from this person's side ("Sadie is sibling of Aishah" on Sadie's page; parent and child swap)
function viewTie(t: { a: string; b: string; type: TieType }, avatar: string) {
    if (t.a === avatar) return t;
    const flip: Partial<Record<TieType, TieType>> = { parent: 'child', child: 'parent' };
    return { a: t.b, b: t.a, type: flip[t.type] ?? t.type };
}
function tiesHtml(g: Save, avatar: string) {
    const nm = (id: string) => (id === '__you' ? 'You' : g.cast[id]?.name ?? id);
    const others = [['__you', 'You'] as [string, string], ...Object.values(g.cast).filter(x => x.avatar !== avatar).map(x => [x.avatar, x.name] as [string, string])];
    const list = tiesOf(g, avatar);
    return `<section class="mu-ties"><h4>Family and ties</h4>
        ${list.length ? `<ul>${list.map(t => { const v = viewTie(t, avatar); return `<li><span data-notr>${esc(nm(v.a))} · ${esc(TIE_TYPES.find(x => x[0] === v.type)?.[1] ?? v.type)} · ${esc(nm(v.b))}</span><em class="is-${t.tone}">${t.tone}</em><button class="mu-ibtn mu-ghost" data-act="wc-tie-del" data-a="${esc(t.a)}" data-b="${esc(t.b)}" title="Remove">${icon('x')}</button></li>`; }).join('')}</ul>` : '<p class="mu-muted">No family or ties yet.</p>'}
        <div class="mu-ties-add"><span data-notr>${esc(g.cast[avatar]?.name ?? '')} is</span>
            <select data-input="wc-tie" data-k="type">${TIE_TYPES.map(([id, l]) => `<option value="${id}" ${TIE.type === id ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <select data-input="wc-tie" data-k="other"><option value="">who?</option>${others.map(([id, n]) => `<option value="${esc(id)}" ${TIE.other === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
            <select data-input="wc-tie" data-k="tone">${TIE_TONES.map(([id, l]) => `<option value="${id}" ${TIE.tone === id ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <label class="mu-check"><input type="checkbox" data-input="wc-tie-together" ${TIE.together ? 'checked' : ''}><span>Lives with them</span></label>
            <button class="mu-primary" data-act="wc-tie-add" ${TIE.other ? '' : 'aria-disabled="true"'}>${icon('plus')}<span>Add</span></button></div>
    </section>`;
}

Object.assign(ACT, {
    'open-world': () => { WC.back = state.view; state.view = 'worldcfg' as any; notify(); },
    'wc-back': () => { state.view = (WC.back === 'scene' ? 'scene' : 'map') as any; notify(); },
    'wc-memday': (el) => { const d = Number(el.dataset.d); const g = game(); const newest = g ? Math.max(...facts(g).map(f => Math.floor(f.at / 1440))) : d; const cur = MEMDAYS.has(d) ? MEMDAYS.get(d)! : d === newest; MEMDAYS.set(d, !cur); notify(); },
    'wc-tab': (el) => { WC.tab = el.dataset.tab as Tab; notify(); },
    'wc-who': (el) => { WC.who = el.dataset.who!; notify(); },
    'wc-add-open': () => { WC.adding = true; WC.q = ''; notify(); },
    'wc-add-close': () => { WC.adding = false; notify(); },
    'wc-add': async (el) => {
        const c = ctxGW(); if (!c) return;
        const a = el.dataset.avatar!;
        const taken = new Set(Object.values(c.g.cast).map(r => `${r.home.x},${r.home.y}`));
        taken.add(`${c.g.player.home.x},${c.g.player.home.y}`);
        c.g.cast[a] = resident(c.w, a, taken);
        WC.adding = false; WC.who = a;
        toast(`${charOf(a)?.name ?? ''} now lives in ${c.w.name}.`, 'success');
        await changed();
    },
    'wc-remove': async () => {
        const c = ctxGW(); if (!c || !c.g.cast[WC.who]) return;
        if (Object.keys(c.g.cast).length <= 1) { toast('A world needs at least one person.', 'info'); return; }
        const name = c.g.cast[WC.who].name;
        delete c.g.cast[WC.who];
        const s = social(c.g); s.with = s.with.filter(x => x.avatar !== WC.who); s.appts = s.appts.filter(x => x.avatar !== WC.who);
        WC.who = '';
        toast(`${name} left this world.`, 'info');
        await changed();
    },
    'wc-leisure': async (el) => {
        const c = ctxGW(); const r = c?.g.cast[WC.who]; if (!c || !r) return;
        const id = el.dataset.id!; const i = r.leisure.indexOf(id);
        i >= 0 ? r.leisure.splice(i, 1) : r.leisure.push(id);
        await changed();
    },
    'wc-fact-del': (el) => { const g = game(); if (!g) return; const l = facts(g); const i = l.findIndex(f => f.id === el.dataset.id); if (i >= 0) l.splice(i, 1); saveGame(); refreshPrompt(); notify(); },
    'wc-lore-main': async (el) => {
        const g = game(); if (!g) return;
        const n = el.dataset.name!; const l = (cfg(g).lore ??= []);
        const old = chatLore();
        l.splice(l.indexOf(n), 1);
        if (old) l.push(old);
        await bindChatLore(n);
        saveGame(); await applyGameLore(); notify();
    },
    'wc-lore-new': async () => {
        const g = game(); if (!g) return;
        const base = `${getWorld(g.world)?.name ?? 'World'} - notes`;
        let n = base, k = 2; while (lorebooks().includes(n)) n = `${base} ${k++}`;
        try {
            const made = await createLorebook(n);
            if (chatLore()) (cfg(g).lore ??= []).push(made); else await bindChatLore(made);
            saveGame(); await applyGameLore();
            toast(`Lorebook “${made}” created and added to this world. Rename or fill it in the Library.`, 'success');
        } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        notify();
    },
    'wc-lib': async () => { const { openLibrary } = await import('./library.js'); openLibrary('lorebooks'); },
    'wc-clock': (el) => { const g = game(); if (!g) return; cfg(g).clock = el.dataset.v === 'live' ? 'live' : 'action'; if (cfg(g).clock === 'live' && !g.speed) g.speed = 60; saveGame(); notify(); },
    'wc-tie-add': async () => {
        const g = game(); if (!g || !TIE.other) return;
        setTie(g, { a: WC.who, b: TIE.other, type: TIE.type, tone: TIE.tone });
        if (TIE.together) liveTogether(g, TIE.other, WC.who);
        TIE.other = ''; TIE.together = false; await changed();
    },
    'wc-tie-del': async (el) => { const g = game(); if (!g) return; removeTie(g, el.dataset.a!, el.dataset.b!); await changed(); },
    'wc-diff': (el) => { const g = game(); if (!g) return; (cfg(g) as any).difficulty = el.dataset.v; saveGame(); notify(); },
    'wc-cfg-reset': () => { const g = game(); if (!g) return; const c = cfg(g); delete c.travel; delete c.decay; delete c.bondCap; delete c.seasonDays; saveGame(); notify(); },
});
Object.assign(INPUT, {
    'wc-tie': (el) => { (TIE as any)[el.dataset.k!] = el.value; notify(); },
    'wc-tie-together': (el) => { TIE.together = el.checked; },
    'wc-adv': (el) => { WC.adv = el.checked; notify(); },
    'wc-q': (el) => { WC.q = el.value; notify(); },
    'wc-job': async (el) => { const c = ctxGW(); const r = c?.g.cast[WC.who]; if (!r) return; r.occupation = el.value || null; await changed(); },
    'wc-zone': async (el) => {
        const c = ctxGW(); const r = c?.g.cast[WC.who]; if (!c || !r) return;
        if (!freeSpots(c.g, c.w, el.value).length) { toast('There is no free home there.', 'info'); notify(); return; }
        const taken = new Set([...Object.values(c.g.cast).filter(x => x !== r).map(x => `${x.home.x},${x.home.y}`), `${c.g.player.home.x},${c.g.player.home.y}`]);
        r.home = homeSpot(c.w, el.value, taken);
        await changed();
    },
    'wc-met': async (el) => { const c = ctxGW(); const r = c?.g.cast[WC.who]; if (!r) return; r.met = el.checked; await changed(); },
    'wc-routine': async (el) => { const c = ctxGW(); const r = c?.g.cast[WC.who]; if (!c || !r || !el.value) return; r.routine = structuredClone(c.w.cast.routineTemplates[el.value]); await changed(); },
    'wc-bond': (el) => { const g = game(); if (!g) return; social(g).bond[WC.who] = Number(el.value); saveGame(); const s = el.previousElementSibling; if (s) s.textContent = `Bond with you · ${el.value}/100 (${bondLabel(g, WC.who)})`; },
    'wc-rom': (el) => {
        const g = game(); if (!g) return;
        const v = Number(el.value);
        setRomance(g, WC.who, v);
        saveGame(); refreshPrompt();
        const s = el.previousElementSibling; if (s) s.textContent = `Romance · ${v}/100 (${romanceTier(g, WC.who, v).name})`;
    },
    'wc-rom-tier': (el) => {
        const g = game(); if (!g) return;
        const v = el.value as RomStatus;
        if (v !== 'none' && romanceBlocked(g, WC.who)) { toast('Not possible with family or a child.', 'info'); notify(); return; }
        setRomance(g, WC.who, undefined, v);
        saveGame(); refreshPrompt(); notify();
    },
    'wc-note': (el) => { ctx().chatMetadata.note_prompt = el.value; noteSave(); const t = document.getElementById('extension_floating_prompt') as HTMLTextAreaElement | null; if (t) t.value = el.value; },
    'wc-note-num': (el) => { ctx().chatMetadata[el.dataset.k!] = Number(el.value); noteSave(); },
    'wc-lq': (el) => { WC.lq = el.value; notify(); },
    'wc-lore': async (el) => {
        const g = game(); if (!g) return;
        const n = el.dataset.name!;
        const c = cfg(g); const l = (c.lore ??= []);
        if (el.checked) {
            if (!chatLore()) await bindChatLore(n);          // the first one becomes the main (chat) lorebook
            else if (!l.includes(n) && n !== chatLore()) l.push(n);
        } else if (n === chatLore()) {
            const next = l.shift();                          // another ticked one takes its place
            if (next) await bindChatLore(next); else { delete ctx().chatMetadata.world_info; ctx().saveMetadataDebounced(); }
        } else l.splice(l.indexOf(n), 1);
        saveGame(); await applyGameLore(); notify();
    },
    'wc-cfg': (el) => { const g = game(); if (!g) return; (cfg(g) as any)[el.dataset.k!] = Number(el.value); saveGame(); notify(); },
});
