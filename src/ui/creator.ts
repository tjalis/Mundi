// The world creator: everything a world is made of, editable (Porto Alto itself could be built with it).
// A world starts from a base (a copy of Porto Alto, or the Modern rules with an empty map) and is saved as a
// JSON file in SillyTavern's user files. Inputs bind to the draft by path: data-path="statuses.2.name".
import { TIME_SLOTS } from '../sim/daynight.js';
import { safeUrl } from '../core/safe.js';
import { money } from '../sim/needs.js';
import { DEFAULT_EXPENSES } from '../sim/bills.js';
import { lex, lexGroups, lexDefault } from '../core/lexicon.js';
import { slidesHtml, toneTag } from './slides.js';
import { houseMapsHtml } from './planedit.js';
import { RPG_SYSTEMS } from '../core/systems.js';
import { TIE_TYPES, TIE_TONES } from '../sim/living.js';
import { GOVERNMENTS, POWERS } from '../sim/realm.js';
import { state, notify, esc, toast, busy, settings, saveSettings } from '../core/store.js';
import { getWorld, shortDesc, WORLD_DESC_MAX, worldFile, worlds, styleOf, isCustom, gameMode, GAME_MODES, SYSTEMS, systemOn, appSystem, isScenario, worldTags, allTags, WORLD_TAGS, RPG_LOCKED, RPG_NOTE, worldLocked, madeFor, type WorldDef, type GameMode } from '../core/world.js';
import { STYLES, inWorld } from './styles.js';
import { SKINS } from './skins.js';

import { tr, setWorldDicts } from '../core/tr.js';
import { lorebooks } from '../st/bridge.js';
import { hm, WEEKDAYS } from '../sim/time.js';
import { newWorldFrom, saveWorld, deleteWorld, exportWorld, importWorld, uploadWorldPicture, appsOf, slug, newId } from '../sim/creator.js';
import { mapEditorHtml, ME } from './mapedit.js';
import { pickFile } from './cropper.js';
import { icon, ICON_NAMES } from './icons.js';
import { ACT, INPUT } from './reg.js';
import { FL, fromLoreHtml, openFromLore, redoHtml } from './fromlore.js';
import { paintHtml } from './worldpaint.js';

type Tab = 'economy' | 'realm' | 'customs' | 'rpg' | 'general' | 'features' | 'needs' | 'maps' | 'homes' | 'actions' | 'jobs' | 'courses' | 'shop' | 'words' | 'character' | 'people' | 'lore' | 'books';
const TABS: [Tab, string][] = [['general', 'General'], ['features', 'Features'], ['needs', 'Needs'], ['maps', 'Maps & places'], ['homes', 'Homes & rent'],
    ['actions', 'Things to do'], ['jobs', 'Jobs'], ['courses', 'Courses'], ['shop', 'Shop'], ['words', 'Words (lexicon)'], ['character', 'Character creation'], ['rpg', 'RPG'], ['customs', 'Customs & calendar'], ['realm', 'Realm & factions'], ['economy', 'Economy & skies'], ['people', 'People & routines'], ['lore', 'Lore'], ['books', 'Lorebooks & notes']];
// A scenario (one house, its residents) leaves out the tabs about towns, careers and kingdoms (a switch shows them).
const SCENARIO_HIDES: Tab[] = ['realm', 'economy', 'rpg'];
export const CW = {
    w: null as WorldDef | null, tab: 'general' as Tab, dirty: false, saving: false, confirmDel: false, leaveAsk: false, nameMiss: false,
    sel: { courses: 0, needs: 0, actions: 0, jobs: 0, zones: 0, kinds: '', traits: 0, origins: 0, people: 0, routine: '', lore: 0 } as Record<string, any>,
    start: null as null | { name: string; style: string; base: string; mode: 'copy' | 'empty' | 'lore'; game: GameMode; scenario?: boolean },
    allTabs: false,
    /** RPG tab: the system about to replace the world's RPG (asked first) */
    rpgSwap: '' as string,
};
export const W = () => CW.w!;

/* ---------- binding by path ---------- */

export function getPath(path: string): any { return path.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), CW.w); }
export function setPath(path: string, v: any) {
    const keys = path.split('.'); const last = keys.pop()!;
    if ([...keys, last].some(k => k === '__proto__' || k === 'constructor' || k === 'prototype')) return;   // (an id from a file can't reach the built-in objects)
    let o: any = CW.w;
    for (const k of keys) { o[k] ??= /^\d+$/.test(last) ? [] : {}; o = o[k]; }
    if (v === undefined) delete o[last]; else o[last] = v;
    CW.dirty = true;
}
const val = (p: string) => esc(getPath(p) ?? '');
export const txt = (label: string, p: string, ph = '') => `<label class="mu-field"><span>${label}</span><input data-input="cw" data-path="${esc(p)}" data-focus="${esc(p)}" value="${val(p)}" placeholder="${esc(ph)}"></label>`;
export const area = (label: string, p: string, rows = 3, ph = '') => `<label class="mu-field"><span>${label}</span><textarea rows="${rows}" data-input="cw" data-path="${esc(p)}" data-focus="${esc(p)}" placeholder="${esc(ph)}">${val(p)}</textarea></label>`;
export const num = (label: string, p: string, min = 0, step = 1) => `<label class="mu-field"><span>${label}</span><input type="number" min="${min}" step="${step}" data-input="cw" data-type="num" data-path="${esc(p)}" data-focus="${esc(p)}" value="${val(p)}"></label>`;
export const chk = (label: string, p: string, hint = '', inverse = false) => `<label class="mu-check"><input type="checkbox" data-input="cw" data-type="${inverse ? 'nbool' : 'bool'}" data-path="${esc(p)}" ${(inverse ? getPath(p) !== false : !!getPath(p)) ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
export const sel = (label: string, p: string, opts: [string, string][], type = '', cur: unknown = getPath(p)) => `<label class="mu-field"><span>${label}</span><select data-input="cw" data-path="${esc(p)}" ${type ? `data-type="${esc(type)}"` : ''}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur ?? '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
const time = (label: string, p: string) => `<label class="mu-field"><span>${label}</span><input type="time" data-input="cw" data-type="time" data-path="${esc(p)}" value="${hm(Number(getPath(p) ?? 0))}"></label>`;
const csv = (label: string, p: string, hint = '') => `<label class="mu-field"><span>${label}</span><input data-input="cw" data-type="csv" data-path="${esc(p)}" data-focus="${esc(p)}" value="${esc((getPath(p) ?? []).join(', '))}">${hint ? `<small class="mu-muted">${hint}</small>` : ''}</label>`;
const color = (label: string, p: string) => `<label class="mu-field mu-cw-color"><span>${label}</span><input type="color" data-input="cw" data-path="${esc(p)}" value="${val(p) || '#888888'}"></label>`;
const chips = (list: string[], p: string) => { const on: string[] = getPath(p) ?? []; return `<div class="mu-chips">${list.map(x => `<button class="mu-chip ${on.includes(x) ? 'is-on' : ''}" data-act="cw-chip" data-path="${esc(p)}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>`; };

// A list on the left (pick, add, remove) and the picked item's form on the right.
function master(key: string, path: string, label: (x: any, i: number) => string, form: (i: number) => string, add: string, empty = 'Nothing here yet.') {
    const list: any[] = getPath(path) ?? [];
    const i = Math.min(CW.sel[key] ?? 0, Math.max(0, list.length - 1)); CW.sel[key] = i;
    return `<div class="mu-cw-master">
        <aside class="mu-cw-list" data-keep="cw-${key}">${list.map((x, k) => `<button class="mu-cw-row ${k === i ? 'is-on' : ''}" data-act="cw-pick" data-k="${esc(key)}" data-i="${esc(k)}">${label(x, k)}</button>`).join('') || `<p class="mu-muted">${empty}</p>`}
            <button class="mu-primary" data-act="cw-add" data-what="${esc(add)}">${icon('plus')}<span>Add</span></button></aside>
        <section class="mu-cw-form">${list.length ? `${form(i)}<button class="mu-danger mu-cw-del" data-act="cw-del" data-path="${path}.${i}">${icon('trash')}<span>Remove</span></button>` : ''}</section></div>`;
}
const placeOpts = (w: WorldDef, none = ''): [string, string][] => [...(none ? [['', none] as [string, string]] : []), ...w.places.filter(p => !p.link).map(p => [p.id, p.name] as [string, string])];
const statusOpts = (w: WorldDef): [string, string][] => w.statuses.map(s => [s.id, `${s.icon} ${s.name}`]);
const zoneOpts = (w: WorldDef, none = ''): [string, string][] => [...(none ? [['', none] as [string, string]] : []), ...w.homes.zones.map(z => [z.id, z.name] as [string, string])];
const traitOptions = (w: WorldDef) => (w.sheet.traits ?? []).flatMap(t => t.options);

/* ---------- tabs ---------- */

function tabGeneral(w: WorldDef) {
    return `<div class="mu-cw-grid">
        <section class="mu-cw-sec"><h4>About this ${isScenario(w) ? 'Home' : 'world'}</h4>${txt('Name', 'name')}${sel('Made for (the tag on its card)', 'madeFor', RPG_LOCKED ? [['lifesim', 'Life-Sim']] : [['lifesim', 'Life-Sim'], ['rpg', 'RPG']], '', w.madeFor ?? madeFor(w))}<label class="mu-field"><span>Short description (shown when choosing a world)</span><textarea rows="3" maxlength="${WORLD_DESC_MAX}" data-input="cw" data-path="description" data-focus="description">${val('description')}</textarea><small class="mu-muted">Up to ${WORLD_DESC_MAX} characters. Only you see it: it is not sent to the AI (the setting below is).</small></label>
            ${area('Setting (what the AI always knows about this world)', 'setting', 5)}
            ${isScenario(w) ? `${area('Premise (how the story starts: shown when the game begins, and told to the AI)', 'scenario.premise', 5)}
                <label class="mu-check"><input type="checkbox" data-input="cw-alltabs" ${CW.allTabs ? 'checked' : ''}><span>Show every tab<small>A Home hides Realm, Economy and RPG (a Home is always Life-Sim). Jobs and courses happen off-screen.</small></span></label>` : ''}</section>
        <section class="mu-cw-sec"><h4>Cover</h4><div class="mu-cw-cover" style="${w.cover ? `background-image:url('${safeUrl(worldFile(w, w.cover))}')` : ''}">${w.cover ? '' : '<span>No cover</span>'}</div>
            <div class="mu-row"><button data-act="cw-cover">${icon('upload')}<span>Choose a picture</span></button>${!isScenario(w) && w.maps[0] ? `<button class="mu-ghost" data-act="cw-cover-map">Use the first map</button>` : ''}${w.cover ? `<button class="mu-ghost" data-act="cw-cover-clear">${icon('x')}<span>Remove</span></button>` : ''}</div>
            <small class="mu-muted">The picture on the ${isScenario(w) ? 'Home' : 'world'}'s card. Best at 16:9 (1400 × 782).</small>
            ${isScenario(w) ? (() => { const pics = [...new Set(w.places.filter(p => !p.link && p.bg).map(p => p.bg!))]; return pics.length ? `<span class="mu-cw-sub">Or use a room's picture</span><div class="mu-cw-coverpick">${pics.map(f => `<button class="${w.cover === f ? 'is-on' : ''}" data-act="cw-cover-room" data-file="${esc(f)}" title="${esc(w.places.find(p => p.bg === f)?.name ?? '')}" style="background-image:url('${safeUrl(worldFile(w, f))}')"></button>`).join('')}</div>` : ''; })() : ''}</section>
        <section class="mu-cw-sec"><h4>Look: style and skin</h4>
            ${sel('Style (the words of the game and the device)', 'style', STYLES.filter(x => x.ready).map(x => [x.id, x.name] as [string, string]))}
            ${sel('Skin (colors of the HUD)', 'skin', (SKINS[styleOf(w)] ?? []).map(k => [k.id, k.name] as [string, string]))}
            <small class="mu-muted">Mix them as you like: the rules and the people stay the same. Players can still pick another skin in their settings.</small></section>
        <section class="mu-cw-sec"><h4>Money</h4><div class="mu-row2">${txt('Currency name', 'currency.name', 'Gold')}${txt('Symbol', 'currency.symbol', 'g')}</div>${chk('The symbol goes after the amount ("40 g")', 'currency.after')}</section>
        <section class="mu-cw-sec"><h4>Time</h4><div class="mu-row2">
            ${sel('The game starts on', 'time.startDay', WEEKDAYS.map((d, k) => [String(k + 1), d] as [string, string]), 'num')}${time('at', 'time.startMinutes')}</div>
            ${sel('Clock speed', 'time.speed', [['0', 'Paused'], ['30', '×0.5'], ['60', '×1 (1 real second = 1 game minute)'], ['120', '×2']], 'num')}
            <div class="mu-row2">${time('Sleeping ends at', 'sleep.until')}<p class="mu-muted">Travel: 30 minutes inside a town, 2 hours between towns.</p></div>
            ${chk('Sleep only at home', 'sleep.homeOnly')}
            <h4>Periods of the day</h4>
            ${w.time.periods.map((_p, k) => `<div class="mu-row mu-cw-inline">${txt('Name', `time.periods.${k}.name`)}${time('From', `time.periods.${k}.from`)}${num('Prices ×', `time.periods.${k}.prices`, 0.1, 0.05)}<button class="mu-ghost mu-ibtn" data-act="cw-del" data-path="time.periods.${k}" title="Remove">${icon('x')}</button></div>`).join('')}
            <button class="mu-ghost" data-act="cw-add" data-what="period">${icon('plus')}<span>Add a period</span></button>
            <small class="mu-muted">Each part of the day can change what is open (Maps: a place's "Closed at"), what things cost out and about (Prices ×, empty = as listed) and how places, homes and maps look (a picture for each part of the day).</small></section>
    </div>`;
}

function tabFeatures(w: WorldDef) {
    const apps = appsOf(w);
    w.features ??= {}; w.features.apps = apps;
    w.tags = [...allTags(w)];   // the RPG tag stays in the world while the RPG mode is locked
    return `<div class="mu-cw-grid">
        <section class="mu-cw-sec mu-cw-wide"><h4>What kind of world</h4><p class="mu-muted">${RPG_LOCKED ? `Realistic or fantasy: what it holds (magic, gods, familiars and weapons with a soul only in fantasy). ${RPG_NOTE}` : 'Life-Sim and RPG: the ways it can be played (with both, the player chooses when starting). Realistic or fantasy: what it holds (magic, gods, familiars and weapons with a soul only in fantasy).'}</p>
            ${pairChips(WORLD_TAGS.filter(t => !RPG_LOCKED || t.id !== 'rpg').map(t => [t.id, `${t.name}: ${t.desc}`] as [string, string]), 'tags')}</section>
        ${isScenario(w) ? '' : `<section class="mu-cw-sec mu-cw-wide"><h4>Game mode</h4><p class="mu-muted">How a new game starts (the player can pick another way the tags allow).</p>${modeCards(gameMode(w), 'cw-mode')}
            ${gameMode(w) === 'custom' ? '<small class="mu-muted">Custom: turn each need on or off in the Needs tab, and the systems below here.</small>' : ''}</section>`}
        <section class="mu-cw-sec"><h4>Phone</h4>${chk('The player has a phone', 'features.phone')}${txt('What it is called', 'features.device', 'Phone')}
            <div class="mu-cw-apps">${apps.map((a, k) => `<div class="mu-cw-app ${a.on && (!appSystem(a.id) || systemOn(w, appSystem(a.id)!)) ? '' : 'is-off'}" ${appSystem(a.id) && !systemOn(w, appSystem(a.id)!) ? `title="Its system is off (Systems, below)"` : ''}><i style="--c:${esc(a.color)}">${icon(a.icon)}</i>
                <input type="checkbox" data-input="cw" data-type="bool" data-path="features.apps.${k}.on" ${a.on ? 'checked' : ''} title="On">
                <input data-input="cw" data-path="features.apps.${k}.name" data-focus="app${k}" value="${esc(a.name)}">
                <select data-input="cw" data-path="features.apps.${k}.icon">${ICON_NAMES().map(n => `<option ${n === a.icon ? 'selected' : ''}>${n}</option>`).join('')}</select>
                <input type="color" data-input="cw" data-path="features.apps.${k}.color" value="${esc(a.color)}"></div>`).join('')}</div>
            <small class="mu-muted">Rename an app, change its icon and color, or turn it off.</small></section>
        <section class="mu-cw-sec"><h4>How things work here</h4>
            ${sel('The device looks like', 'features.deviceLook', [['phone', 'A phone (apps on a screen)'], ['book', 'A journal (an open book with pages)']])}
            ${sel('The social app is', 'features.socialKind', [['feed', 'A social network (posts, likes and replies)'], ['board', 'A notice board (notices; whoever answers writes you a letter)']])}
            ${sel('Messages are', 'features.messageKind', [['texts', 'Text messages'], ['letters', 'Letters carried by a courier']])}
            ${txt('How people write (what the AI is told for messages and posts)', 'ai.voice', 'casual; emoji and hashtags are fine')}</section>
        <section class="mu-cw-sec"><h4>Systems</h4>
            <small class="mu-muted">A system turned off is gone from the HUD, the ${esc(w.features?.device ?? 'phone').toLowerCase()} and what the AI is told, and the game stops running it. Saves keep its data: turn it back on and it picks up where it was.</small>
            <div class="mu-cw-systems">${SYSTEMS.map(sy => {
                const named = sy.apps.map(id => apps.find(a => a.id === id)?.name).filter(n => n && n !== sy.name);   // the world's name for its app
                const blocked = sy.needs && !systemOn(w, sy.needs) ? SYSTEMS.find(x => x.id === sy.needs)!.name : '';
                const label = `${esc(sy.name)}${named.length ? ` <em class="mu-muted">(${esc(named.join(', '))})</em>` : ''}`;
                const hint = blocked ? `Needs ${esc(blocked)} on.` : `Off: ${esc(sy.desc)}`;
                // a system made for another kind of world (fantasy, RPG) starts off here, but any world can turn it on
                if (sy.tag) { const tagName = WORLD_TAGS.find(t => t.id === sy.tag)?.name ?? sy.tag;
                    return `<div class="${blocked ? 'is-off' : ''}"><label class="mu-check"><input type="checkbox" data-input="cw" data-type="bool" data-path="features.${sy.id}" ${systemOn(w, sy.id) ? 'checked' : ''}><span>${label}<small>${hint}${worldTags(w).includes(sy.tag) ? '' : ` Made for ${esc(tagName)} worlds: off unless you turn it on.`}</small></span></label></div>`; }
                return `<div class="${blocked ? 'is-off' : ''}">${chk(label, `features.${sy.id}`, hint, true)}</div>`;
            }).join('')}</div>
            ${systemOn(w, 'bills') ? chk('Rent', 'rent', 'Off: homes are free (the other bills stay).') : ''}
            ${w.rent && systemOn(w, 'bills') ? `<div class="mu-row2">${num('Rent is paid every … days', 'rent.everyDays', 1)}${txt('Message when it is paid', 'rent.text')}</div>` : ''}</section>
    </div>`;
}

function tabNeeds(w: WorldDef) {
    return master('needs', 'statuses', s => `<b>${esc(s.icon)} ${esc(s.name)}</b><small>${s.hud ? 'On the HUD' : ''}</small>`, i => {
        const p = `statuses.${i}`; const s = w.statuses[i];
        return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Icon (an emoji)', `${p}.icon`)}</div>
            <div class="mu-row2">${color('Color', `${p}.color`)}${chk('Show on the HUD', `${p}.hud`)}</div>
            <div class="mu-row2">${RPG_LOCKED ? '' : chk('Only in the RPG mode', `${p}.rpg`, 'Like health: out of Life-Sim worlds.')}${gameMode(w) === 'custom' ? chk('Turned off in this world', `${p}.off`) : ''}</div>
            <div class="mu-row2">${num('Starts at', `${p}.start`)}${num('Maximum', `${p}.max`, 1)}</div>
            <h4>Drops over time</h4>${chk('It drops by itself', `${p}.decay`)}
            ${s.decay ? `<div class="mu-row2">${num('By', `${p}.decay.amount`, 0, 0.5)}${num('Every … game minutes', `${p}.decay.everyMinutes`, 1)}</div>${chk('Only while awake', `${p}.decay.awakeOnly`)}` : ''}
            ${num('Sleeping restores', `sleep.restore.${s.id}`)}
            <h4>At zero</h4>${/^(life|health)$/.test(s.id) && (s.rpg || gameMode(w) === 'rpg') ? `<p class="mu-muted">Death is real in the RPG: at 0 hit points a person is dead. Under a tenth they are unconscious and bleed out unless someone gets them treated in time (first aid, a passer-by, an ambulance or a healer). Nobody wakes up at the hospital by default.</p>
            ${s.zero ? num('A stay at the hospital or healer costs', `${p}.zero.cost`) : ''}` : `${chk('Something happens at zero', `${p}.zero`)}
            ${s.zero ? `${area('Message', `${p}.zero.text`, 2, 'You pass out… The bill is {cost}.')}
                <div class="mu-row2">${sel('You wake up at', `${p}.zero.place`, [['', '(stay where you are)'], ['home', 'Your home'], ...placeOpts(w)])}${num('It costs', `${p}.zero.cost`)}</div>
                <div class="mu-row2">${num('Comes back to', `${p}.zero.restore`)}${sel('While at zero, it drains', `${p}.zero.drain.status`, [['', '(nothing)'], ...statusOpts(w)])}</div>
                ${s.zero.drain?.status ? `<div class="mu-row2">${num('By', `${p}.zero.drain.amount`)}${num('Every … minutes', `${p}.zero.drain.everyMinutes`, 1)}</div>` : ''}
                ${chk('A crisis after a while at zero', `${p}.zero.crisis`, 'Once each time it hits zero: you faint, you break down… People who see it remember it.')}
                ${s.zero.crisis ? `<div class="mu-row2">${num('After … minutes at zero', `${p}.zero.crisis.after`)}${sel('You end up at', `${p}.zero.crisis.place`, [['', '(stay where you are)'], ['home', 'Your home'], ...placeOpts(w)])}</div>
                    ${area('What happens (message)', `${p}.zero.crisis.text`, 2, 'You feel faint and nearly collapse…')}
                    <div class="mu-row2">${num('It costs', `${p}.zero.crisis.cost`)}${num('Comes back to', `${p}.zero.crisis.restore`)}</div>
                    <div class="mu-row2">${num('Your mood changes by', `${p}.zero.crisis.mood`, -100)}${num('People who saw it think less of you by', `${p}.zero.crisis.shame`)}</div>
                    ${txt('What the people who saw it remember ({u} = you, {0} = the place)', `${p}.zero.crisis.seen`, '{u} nearly fainted at {0}.')}` : ''}` : ''}`}`;
    }, 'need');
}

const WHERE: [string, string][] = [['tags', 'At places with a tag'], ['place', 'At one place'], ['home', 'At home'], ['anywhere', 'Anywhere']];
function tabActions(w: WorldDef) {
    const tags = [...new Set(w.places.flatMap(p => p.tags ?? []))];
    return master('actions', 'actions', a => `<b>${esc(a.icon ?? '')} ${esc(a.label || a.name)}</b><small>${a.cost ? `${esc(money(w, a.cost))} · ` : ''}${a.minutes} min</small>`, i => {
        const p = `actions.${i}`; const a = w.actions[i];
        const where = a.anywhere ? 'anywhere' : a.home ? 'home' : a.place ? 'place' : 'tags';
        return `<div class="mu-row2">${txt('Button text', `${p}.label`, 'Have a coffee')}${txt('Short name', `${p}.name`, 'Coffee')}</div>
            <div class="mu-row2">${txt('Icon (an emoji)', `${p}.icon`)}${num('Takes … minutes', `${p}.minutes`, 0)}</div>
            ${num(`Costs (${esc(w.currency.symbol)})`, `${p}.cost`)}
            <label class="mu-field"><span>Where</span><select data-act-input="cw-where" data-input="cw-where" data-i="${esc(i)}">${WHERE.map(([v, l]) => `<option value="${v}" ${where === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            ${where === 'tags' ? chips(tags, `${p}.tags`) : where === 'place' ? sel('Place', `${p}.place`, placeOpts(w)) : ''}
            ${where === 'tags' ? `<h4>But not in places tagged</h4>${chips(tags, `${p}.notTags`)}` : ''}
            ${chk('An outing (off-screen)', `${p}.outing`, 'You leave for a while (work, errands, a night out) and come back: offered even when needs are off. Made for Homes.')}
            ${sel('Only if the player owns', `${p}.needsItem`, [['', 'Nothing (always offered)'] as [string, string], ...(((w.catalogs as any).shop ?? []) as any[]).map(it => [it.id, `${it.icon ?? ''} ${it.name}`] as [string, string])])}
            <h4>Effects</h4><div class="mu-cw-effects">${w.statuses.map(s => num(esc(`${s.icon} ${s.name}`), `${p}.effects.${s.id}`, -1000)).join('')}</div>`;
    }, 'action');
}

function tabJobs(w: WorldDef) {
    return master('jobs', 'occupations', o => `<b>${esc(o.name)}</b><small>${esc(w.places.find(p => p.id === o.place)?.name ?? '—')}</small>`, i => {
        const p = `occupations.${i}`; const o = w.occupations[i];
        return `${txt('Name', `${p}.name`)}<button class="mu-ghost" data-act="cw-rnd-job" data-i="${esc(i)}">${icon('redo')}<span>Randomize hours, pay and promotions</span></button>
            ${sel('Works at', `${p}.place`, placeOpts(w, '(choose a place)'))}
            <div class="mu-row2">${num('Shift length (hours)', `${p}.shift`, 1)}${num('Energy per shift', `${p}.cost.energy`)}</div>
            <div class="mu-row2">${num('Opens at (hour)', `${p}.hours.0`, 0)}${num('Closes at (hour)', `${p}.hours.1`, 0)}</div>
            <h4>Ranks and pay per hour</h4>
            ${o.ranks.map((_r, k) => `<div class="mu-row mu-cw-inline">${txt('Rank', `${p}.ranks.${k}.name`)}${num(`Pay (${esc(w.currency.symbol)}/h)`, `${p}.ranks.${k}.pay`)}
                ${k < o.ranks.length - 1 ? num('Shifts to be promoted', `${p}.promote.${k}`, 1) : '<span class="mu-cw-spacer"></span>'}
                <button class="mu-ghost mu-ibtn" data-act="cw-del" data-path="${p}.ranks.${k}" title="Remove">${icon('x')}</button></div>`).join('')}
            <button class="mu-ghost" data-act="cw-add" data-what="rank" data-path="${p}.ranks">${icon('plus')}<span>Add a rank</span></button>
            ${branchEditor(w, o, p)}
            <h4>Traits that help (faster promotions)</h4>${chips(traitOptions(w), `${p}.likes`)}
            <h4>Required traits (one of them)</h4>${chips(traitOptions(w), `${p}.needs`)}
            ${(w.hobbies ?? []).length ? `<div class="mu-row2">${sel('Hobby it asks for', `${p}.hobby.id`, [['', '(none)'], ...(w.hobbies ?? []).map(h => [h.id, h.name] as [string, string])])}${num('Level', `${p}.hobby.level`, 0)}</div>` : ''}`;
    }, 'job');
}

const ELEMENTS: [string, string][] = [['', '(none)'], ['fire', 'Fire'], ['water', 'Water'], ['lightning', 'Lightning'], ['ice', 'Ice'], ['earth', 'Earth'], ['light', 'Light'], ['dark', 'Dark']];
// Goods and their markets, crops, businesses, celestial events and extreme weather.
function tabEconomy(w: WorldDef) {
    const goods = (w.goods ?? []).map(x => [x.id, x.name] as [string, string]);
    const where = [...w.maps.map(m => [m.id, `${m.name} (map)`] as [string, string]), ...[...new Set(w.places.flatMap(p => p.tags ?? []))].map(t => [t, `${t} (tag)`] as [string, string]), ...w.places.filter(p => !p.link).map(p => [p.id, p.name] as [string, string])];
    const tags = [...new Set(w.places.flatMap(p => p.tags ?? []))].map(t => [t, t] as [string, string]);
    const seasons: [string, string][] = [['', '(any season)'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']];
    const climates: [string, string][] = [['temperate', 'Temperate'], ['cold', 'Cold'], ['hot', 'Hot'], ['coastal', 'Coastal']];
    return `<div class="mu-cw-grid">
        <section class="mu-cw-sec mu-cw-wide"><h4>Goods</h4><p class="mu-muted">Bought and sold at markets (places tagged shop). Cheap where they are made, dear where they are scarce; illegal ones can be found by guards. A good with id camping_gear lets you rest at camp in a storm.</p>
        ${master('good', 'goods', x => `<b>${esc(x.icon)} ${esc(x.name)}</b><small>${x.price}${x.illegal ? ' · illegal' : ''}</small>`, i => {
            const p = `goods.${i}`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Icon', `${p}.icon`, '🌾')}</div>
                <div class="mu-row2">${num('Price', `${p}.price`, 1)}${sel('Type', `${p}.kind`, [['food', 'Food'], ['drink', 'Drink'], ['meat', 'Meat (ecology)'], ['fur', 'Fur (ecology)'], ['ore', 'Ore'], ['cloth', 'Cloth'], ['spice', 'Spice'], ['herb', 'Herb'], ['potion', 'Potion (dearer in tense towns)'], ['arms', 'Arms (dearer in tense towns)'], ['goods', 'Goods'], ['gear', 'Gear'], ['contraband', 'Contraband'], ['relic', 'Relic (auctions)'], ['rare', 'Rare (auctions)'], ['sentient', 'A weapon with a will (wakes in your hands)']])}</div>
                <div class="mu-field"><span>Cheap at</span>${pairChips(where, `${p}.cheap`)}</div><div class="mu-field"><span>Dear at</span>${pairChips(where, `${p}.dear`)}</div>
                ${chk('Illegal (contraband)', `${p}.illegal`)}${chk('Cures afflictions when used (poison, curses…)', `${p}.cures`)}
                <div class="mu-row2">${sel('Set into gear (a gem, a mod)', `${p}.socket.slot`, [['', '(no)'], ['weapon', 'Weapon'], ['armor', 'Armor']])}${sel('Gives', `${p}.socket.kind`, [['attack', '+ to hit'], ['damage', '+ damage'], ['armor', '+ armor']])}</div>
                ${num('By (+)', `${p}.socket.amount`, 0)}`;
        }, 'good')}</section>
        <section class="mu-cw-sec mu-cw-wide"><h4>Crafting</h4><p class="mu-muted">Recipes turn goods into goods at the right place (an id, a tag, part of a name, or home). Legendary ones make a named artifact.</p>
        ${master('recipe', 'recipes', x => `<b>${esc(x.name)}</b><small>${esc(w.goods?.find(g => g.id === x.makes)?.name ?? '')}${x.legendary ? ' · legendary' : ''}</small>`, i => {
            const p = `recipes.${i}`; const skills = (w.rpg?.skills ?? []).map(k => [k.id, k.name] as [string, string]);
            return `${txt('Name', `${p}.name`)}<div class="mu-row2">${sel('Makes', `${p}.makes`, goods)}${num('How many', `${p}.count`, 1)}</div>
                <h4>Needs</h4><div class="mu-row2">${(w.goods ?? []).map(g => num(`${esc(g.icon)} ${esc(g.name)}`, `${p}.needs.${g.id}`, 0)).join('')}</div>
                ${csv('Made at (comma separated)', `${p}.at`)}
                <div class="mu-row2">${RPG_LOCKED ? '' : sel('Check (RPG)', `${p}.skill`, [['', '(none)'], ...skills])}${num('Difficulty', `${p}.dc`, 1)}</div>
                ${chk('Risky (a bad roll hurts)', `${p}.risky`)}${chk('Legendary (you name what you make)', `${p}.legendary`)}`;
        }, 'recipe')}</section>
        ${RPG_LOCKED ? '' : `<section class="mu-cw-sec"><h4>Towers</h4><p class="mu-muted">RPG: floor after floor of fights, a boss and a checkpoint every 10.</p>
        ${master('tower', 'towers', x => `<b>${esc(x.name)}</b><small>${x.floors} floors</small>`, i => {
            const p = `towers.${i}`;
            return `${txt('Name', `${p}.name`)}${txt('What it is like', `${p}.desc`)}<div class="mu-row2">${sel('At', `${p}.place`, placeOpts(w))}${num('Floors', `${p}.floors`, 1)}</div>
                ${csv('Foes with these tags (comma separated; empty: any)', `${p}.tags`)}`;
        }, 'tower')}</section>`}
        <section class="mu-cw-sec"><h4>Sentient weapons</h4><p class="mu-muted">Found deep in towers or won at auctions (a good of the kind "a weapon with a will").</p>
        ${master('blade', 'blades', x => `<b>${esc(x.name)}</b><small>likes ${esc(x.likes)}</small>`, i => {
            const p = `blades.${i}`;
            return `${txt('Name', `${p}.name`)}${txt('Personality (told to the AI)', `${p}.personality`)}${txt('What it is', `${p}.desc`)}
                <div class="mu-row2">${sel('It likes', `${p}.likes`, [['fights', 'Fights'], ['quests', 'Quests'], ['gold', 'Gold'], ['mercy', 'Mercy']])}${num('Bonus when content', `${p}.bonus`, 0)}</div>`;
        }, 'blade')}</section>
        <section class="mu-cw-sec"><h4>Crops</h4>${master('crop', 'crops', x => `<b>${esc(x.icon)} ${esc(x.name)}</b><small>${x.days} days</small>`, i => {
            const p = `crops.${i}`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Icon', `${p}.icon`)}</div><div class="mu-row2">${num('Days to grow', `${p}.days`, 1)}${num('Seed price', `${p}.seed`, 0)}</div>
                <div class="mu-row2">${sel('Gives', `${p}.good`, goods)}${num('How many', `${p}.yield`, 1)}</div>`;
        }, 'crop')}</section>
        <section class="mu-cw-sec"><h4>Businesses</h4>${master('biz', 'businesses', x => `<b>${esc(x.icon)} ${esc(x.name)}</b><small>${x.cost}</small>`, i => {
            const p = `businesses.${i}`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Icon', `${p}.icon`)}</div><div class="mu-row2">${num('Cost to open', `${p}.cost`, 0)}${num('Profit a day (about)', `${p}.profit`, 0)}</div>
                ${num('Staff (most)', `${p}.staff`, 0)}<div class="mu-field"><span>At places tagged</span>${pairChips(tags, `${p}.tags`)}</div>`;
        }, 'biz')}</section>
        <section class="mu-cw-sec"><h4>Celestial events</h4>${master('sky', 'skies.events', x => `<b>${esc(x.name)}</b><small>every ${x.every} days</small>`, i => {
            const p = `skies.events.${i}`;
            return `${txt('Name', `${p}.name`)}${txt('What it is like', `${p}.desc`)}<div class="mu-row2">${num('Comes back every (days)', `${p}.every`, 2)}${num('Lasts (days)', `${p}.days`, 1)}</div>
                <div class="mu-row2">${sel('Effect', `${p}.effect`, [['mana', 'Mana storm: focus back every morning'], ['monsters', 'Blood moon: roads twice as dangerous, shops shut'], ['omen', 'Omen: moods drop']])}${num('Amount (omen: mood)', `${p}.amount`, -50)}</div>`;
        }, 'sky')}</section>
        <section class="mu-cw-sec"><h4>Extreme weather</h4><p class="mu-muted">Each map has a climate (Maps & places → Life in this region).</p>${master('hazard', 'skies.hazards', x => `<b>${esc(x.name)}</b><small>${esc(x.climate)}</small>`, i => {
            const p = `skies.hazards.${i}`;
            return `${txt('Name', `${p}.name`)}${txt('What it is like', `${p}.desc`)}<div class="mu-row2">${sel('Climate', `${p}.climate`, climates)}${sel('Season', `${p}.season`, seasons)}</div>
                ${num('Chance on a day (0 … 1)', `${p}.chance`, 0, 0.01)}<h4>Needs drop faster (×)</h4><div class="mu-row2">${w.statuses.map(st => num(esc(st.name), `${p}.drain.${st.id}`, 0, 0.1)).join('')}</div>
                ${chk('No rest at camp without camping gear', `${p}.blocksCamp`)}${chk('Shuts the shops', `${p}.closes`)}`;
        }, 'hazard')}</section>
    </div>`;
}

// The realm (government, leadership, power, taxes, gods) and its factions.
function tabRealm(w: WorldDef) {
    const places = w.places.filter(p => !p.link).map(p => [p.id, p.name] as [string, string]);
    const maps = w.maps.map(m => [m.id, m.name] as [string, string]);
    const facs = (w.factions ?? []).map(f => [f.id, f.name] as [string, string]);
    const jobs = w.occupations.map(o => [o.id, o.name] as [string, string]);
    const ex = w.cast.examples.map(e => [e.name, e.name] as [string, string]);
    return `<div class="mu-cw-grid">
        <section class="mu-cw-sec mu-cw-wide"><h4>The realm</h4>
            ${txt('The country (or kingdom) its cities belong to', 'realm.name', 'Costa Serena')}
            <div class="mu-row2">${sel('Government', 'realm.government', GOVERNMENTS.map(([id, n]) => [id, n] as [string, string]))}${txt('Leadership', 'realm.leadership', 'A single emperor, regional kings, elected leaders…')}</div>
            <div class="mu-row2">${sel('Power affinity', 'realm.power', POWERS.map(([id, n, d]) => [id, `${n}: ${d}`] as [string, string]))}${num('Tax rate (0.1 = 10%; empty: by government)', 'realm.tax', 0, 0.01)}</div></section>
        <section class="mu-cw-sec"><h4>Pantheon</h4><p class="mu-muted">Optional. With no gods, altars are monuments, faith classes use their secular name and faith attributes are hidden.</p>
        ${master('god', 'realm.pantheon', x => `<b>${esc(x.symbol ?? '')} ${esc(x.name)}</b><small>${esc(x.domain)}</small>`, i => {
            const p = `realm.pantheon.${i}`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Symbol', `${p}.symbol`, '☀️')}</div>${txt('Domain', `${p}.domain`, 'war, the sun, the sea…')}
                ${sel('Played by (a character of the world)', `${p}.card`, [['', '(nobody: a distant god)'], ...ex])}`;
        }, 'god', 'No gods: the realm is secular.')}</section>
        <section class="mu-cw-sec mu-cw-wide"><h4>Factions</h4>${master('faction', 'factions', f => `<b>${esc(f.name)}</b><small>${esc(f.kind)}</small>`, i => {
            const p = `factions.${i}`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Type', `${p}.kind`, 'guild, order, house, gang, kingdom…')}</div>${area('What it is (told to the AI)', `${p}.desc`, 2)}
                <div class="mu-row2">${sel('Headquarters', `${p}.hq`, [['', '(none)'], ...places])}${sel('Region', `${p}.region`, [['', '(none)'], ...maps])}</div>
                ${csv('Ranks, lowest to highest (the last one leads it)', `${p}.ranks`)}
                <div class="mu-row2">${num('Weekly dues', `${p}.dues`, 0)}${num('Duties a week', `${p}.quota`, 0)}</div>
                <div class="mu-row2">${num('Standing needed to join', `${p}.joinRep`, -100)}${sel('Beats (gains ground on)', `${p}.beats`, [['', '(nobody)'], ...facs])}</div>
                <div class="mu-field"><span>Rivals</span>${pairChips(facs, `${p}.rivals`)}</div><div class="mu-field"><span>Allies</span>${pairChips(facs, `${p}.allies`)}</div>
                <div class="mu-field"><span>Its members (people with these jobs)</span>${pairChips(jobs, `${p}.jobs`)}</div>
                ${chk('Secret (only shown once you have dealings with it)', `${p}.secret`)}`;
        }, 'faction')}</section>
    </div>`;
}

const DAYS: [string, string][] = [['0', 'Monday'], ['1', 'Tuesday'], ['2', 'Wednesday'], ['3', 'Thursday'], ['4', 'Friday'], ['5', 'Saturday'], ['6', 'Sunday']];
// Habits that become traits, festivals of the calendar, pets and familiars.
function tabCustoms(w: WorldDef) {
    const acts = w.actions.map(a => [a.id, a.name] as [string, string]);
    const tags = [...new Set(w.places.flatMap(p => p.tags ?? []))].map(t => [t, t] as [string, string]);
    const seasons: [string, string][] = [['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']];
    const places = w.places.filter(p => !p.link).map(p => [p.id, p.name] as [string, string]);
    const skills = (w.rpg?.skills ?? []).map(k => [k.id, k.name] as [string, string]);
    return `<div class="mu-cw-grid">
        <section class="mu-cw-sec mu-cw-wide"><h4>Habits that become traits</h4><p class="mu-muted">Do something often enough in a few days and it becomes a trait (jobs like it, the AI knows it); stop for long and it fades.</p>
        ${master('habit', 'habits', h => `<b>${esc(h.trait)}</b><small>${h.count}× in ${h.days} days</small>`, i => {
            const p = `habits.${i}`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Trait it gives', `${p}.trait`, 'Early riser')}</div>${txt('How to get it', `${p}.desc`)}
                <div class="mu-field"><span>Actions that count</span>${pairChips(acts, `${p}.actions`)}</div>
                <div class="mu-field"><span>Or any action at places tagged</span>${pairChips(tags, `${p}.tags`)}</div>
                <div class="mu-row2">${num('Only between (hour)', `${p}.hours.0`, 0)}${num('and (hour)', `${p}.hours.1`, 0)}</div>
                <div class="mu-row2">${num('Times', `${p}.count`, 1)}${num('In how many days', `${p}.days`, 1)}</div>
                ${num('Fades after days without it (empty: twice the days above)', `${p}.lose`, 1)}
                <h4>Every morning while you have it</h4><div class="mu-row2">${w.statuses.map(st => num(esc(st.name), `${p}.daily.${st.id}`, -50)).join('')}</div>`;
        }, 'habit')}</section>
        <section class="mu-cw-sec"><h4>Festivals</h4>${master('festival', 'festivals', f => `<b>${esc(f.name)}</b><small>${esc(f.season)} ${f.day}</small>`, i => {
            const p = `festivals.${i}`;
            return `${txt('Name', `${p}.name`)}${txt('What it is like (told to the AI)', `${p}.desc`)}
                <div class="mu-row2">${sel('Season', `${p}.season`, seasons)}${num('Day of the season', `${p}.day`, 1)}</div>
                <div class="mu-row2">${num('Lasts (days)', `${p}.days`, 1)}${sel('People gather at', `${p}.place`, [['', '(nowhere in particular)'], ...places])}</div>
                <div class="mu-row2">${num('Prices ×', `${p}.prices`, 0, 0.05)}${num('Mood when you celebrate', `${p}.mood`, 0)}</div>`;
        }, 'festival')}</section>
        <section class="mu-cw-sec"><h4>City events</h4><p class="mu-muted">Shows, matches, fairs: on a weekday, every few weeks, at a place. They are in the calendar and you go if you want.</p>
        ${master('cevent', 'cityEvents', e => `<b>${esc(e.icon ?? '')} ${esc(e.name)}</b><small>${esc(DAYS[e.weekday]?.[1] ?? '')} ${e.from}h</small>`, i => {
            const p = `cityEvents.${i}`;
            const hob: [string, string][] = [['', '(no stage)'], ...(w.hobbies ?? []).map(h => [h.id, h.name] as [string, string])];
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Icon', `${p}.icon`, '🎉')}</div>${txt('What it is like (told to the AI)', `${p}.desc`)}
                <div class="mu-row2">${sel('Place', `${p}.place`, places)}${sel('Weekday', `${p}.weekday`, DAYS, 'num')}</div>
                <div class="mu-row2">${num('Every (weeks)', `${p}.every`, 1)}${num('Starting on week (0 = the first)', `${p}.week`, 0)}</div>
                <div class="mu-row2">${num('Starts at (hour)', `${p}.from`, 0)}${num('Lasts (hours)', `${p}.hours`, 1)}</div>
                <div class="mu-row2">${num('Ticket (0: free)', `${p}.price`, 0)}${num('Mood when you go', `${p}.mood`, 0)}</div>
                <div class="mu-row2">${num('You stay (minutes)', `${p}.minutes`, 10)}${txt('Button', `${p}.action`, 'Watch the show')}</div>
                <div class="mu-row2">${num('Crowd (of 100 people with free time)', `${p}.crowd`, 0)}${chk('Outdoors (called off when it rains)', `${p}.outdoor`)}</div>
                <h4>Perform there (a hobby)</h4>
                <div class="mu-row2">${sel('Hobby', `${p}.stage.hobby`, hob)}${num('Level needed', `${p}.stage.level`, 0)}</div>
                <div class="mu-row2">${txt('Button', `${p}.stage.label`, 'Play at the open mic')}${num('Pay', `${p}.stage.pay`, 0)}</div>`;
        }, 'cevent')}</section>
        <section class="mu-cw-sec"><h4>Hobbies</h4><p class="mu-muted">Practice levels them up (to 10): +1 on their rolls every 2 levels, more money each level, and jobs can ask for a level.</p>
        ${master('hobby', 'hobbies', h => `<b>${esc(h.icon ?? '')} ${esc(h.name)}</b><small>${(h.actions ?? []).length} actions</small>`, i => {
            const p = `hobbies.${i}`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Icon', `${p}.icon`, '🎸')}</div>${txt('Description', `${p}.desc`)}
                <div class="mu-field"><span>Actions that train it</span>${pairChips(acts, `${p}.actions`)}</div>
                ${num('Extra pay per level (%)', `${p}.pay`, 0)}`;
        }, 'hobby')}</section>
        <section class="mu-cw-sec mu-cw-wide"><h4>Schools and academies</h4><p class="mu-muted">A ladder of ranks (students first, the head last), tuition, lessons, exams and clubs. Its staff (the people who work at the place) are its faculty.</p>
        ${master('inst', 'institutions', x => `<b>${esc(x.name)}</b><small>${esc(w.places.find(p => p.id === x.place)?.name ?? '')}</small>`, i => {
            const p = `institutions.${i}`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${sel('Place', `${p}.place`, places)}</div>${txt('What it is like', `${p}.desc`)}
                ${csv('Ranks, students first, the head last', `${p}.ranks`)}
                <div class="mu-row2">${num('Tuition a week', `${p}.tuition`, 0)}${num('An exam every (days)', `${p}.examEvery`, 1)}</div>
                <div class="mu-row2">${RPG_LOCKED ? '' : sel('Skill it teaches (RPG)', `${p}.skill`, [['', '(none)'], ...skills])}${txt('Trait it teaches (Life-Sim)', `${p}.trait`, 'Smart')}</div>
                ${csv('Clubs (comma separated)', `${p}.clubs`)}`;
        }, 'inst')}</section>
        <section class="mu-cw-sec"><h4>Animals (pets and familiars)</h4>${master('pet', 'pets', a => `<b>${esc(a.icon)} ${esc(a.name)}</b><small>${a.price}${a.familiar ? ' · familiar' : ''}</small>`, i => {
            const p = `pets.${i}`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Icon', `${p}.icon`, '🐕')}</div>${txt('Description', `${p}.desc`)}
                <div class="mu-row2">${num('Price', `${p}.price`, 0)}${num('Mood each morning when happy', `${p}.mood`, 0)}</div>
                ${csv('Sold at places whose id, name or tag has (comma separated; empty: any shop)', `${p}.where`)}
                ${chk('Follows you everywhere (else waits at home)', `${p}.follows`)}${RPG_LOCKED ? '' : chk('Familiar (RPG only): helps a skill', `${p}.familiar`)}
                <div class="mu-row2">${sel('Skill it helps', `${p}.skill`, [['', '(none)'], ...skills])}${num('Bonus', `${p}.bonus`, 0)}</div>
                ${chk('A mount (you ride it)', `${p}.mount`)}<div class="mu-row2">${num('Trips take (× the time)', `${p}.speed`, 0.1, 0.05)}${num('Carries (more goods)', `${p}.carry`, 0)}</div>`;
        }, 'pet')}</section>
    </div>`;
}

// The world's RPG: attributes, skills, classes and subclasses, schools of magic, spells, titles.
const rpgSystemList = () => [...RPG_SYSTEMS, ...(settings().rpgSystems ?? [])];
const rpgSystemButtons = (act = 'cw-rpg-preset') => rpgSystemList().map(x => `<button class="${act === 'cw-rpg-preset' ? 'mu-primary' : 'mu-ghost'}" data-act="${esc(act)}" data-v="${esc(x.id)}" title="${esc(x.desc)}">${icon('sparkles')}<span>${esc(x.name)}</span></button>`).join('');
function tabRpg(w: WorldDef) {
    const r = w.rpg;
    if (!r) return `<div class="mu-cw-grid"><section class="mu-cw-sec mu-cw-wide"><h4>RPG</h4>
        <p class="mu-muted">The RPG mode needs the world's RPG: attributes, skills, classes (with a subclass at level 3 or 5), magic and titles. Start from one of these systems and change what you like, or from nothing.</p>
        <div class="mu-row">${rpgSystemButtons()}<button class="mu-ghost" data-act="cw-rpg-empty">${icon('plus')}<span>Start an empty one</span></button></div></section></div>`;
    const attrs = r.attributes.map(a => [a.id, `${a.short} · ${a.name}`] as [string, string]);
    const skills = r.skills.map(k => [k.id, k.name] as [string, string]);
    const schools = r.schools.map(s => [s.id, s.name] as [string, string]);
    return `<div class="mu-cw-grid">
        <section class="mu-cw-sec mu-cw-wide"><h4>System</h4>
            <p class="mu-muted">Players can also choose another system when starting a game. Save this one to offer it in every world, or start over from a system.</p>
            ${txt('Name of this system (told to the AI)', 'rpg.name', 'Classic fantasy')}
            <div class="mu-row"><button class="mu-ghost" data-act="cw-rpg-keep">${icon('save')}<span>Save as one of my systems</span></button></div>
            ${CW.rpgSwap ? `<div class="mu-row"><span class="mu-warn">Replace this world's RPG with ${esc(rpgSystemList().find(x => x.id === CW.rpgSwap)?.name ?? '')}? Your changes to it are lost.</span><button data-act="cw-rpg-swap-no">Cancel</button><button class="mu-danger" data-act="cw-rpg-preset" data-v="${esc(CW.rpgSwap)}">Replace</button></div>`
                : `<details><summary>Start over from a system</summary><div class="mu-row">${rpgSystemButtons('cw-rpg-swap')}</div></details>`}</section>
        <section class="mu-cw-sec mu-cw-wide"><h4>Numbers</h4>
            <div class="mu-row2">${sel('Hit points grow with', 'rpg.hpAttr', attrs)}${txt(`The resource for ${esc(lexDefault(w, 'spellsNoun'))} is called`, 'rpg.focusName', 'Focus')}</div>
            <div class="mu-row2">${csv('Experience for level 2, 3, 4… (comma separated)', 'rpg.xp')}${num('Hours on the road before making camp', 'rpg.campEvery', 1)}</div>
            <div class="mu-row2">${num('Points for starting skills (class skills cost 1, others 2; empty: 6)', 'rpg.skillPoints', 1)}${num('Attribute points every level (empty: 2 every 4 levels)', 'rpg.levelPoints', 0)}</div></section>
        <section class="mu-cw-sec"><h4>Attributes</h4>${master('rattr', 'rpg.attributes', a => `<b>${esc(a.short)}</b><small>${esc(a.name)}</small>`, i => `<div class="mu-row2">${txt('Name', `rpg.attributes.${i}.name`)}${txt('Short', `rpg.attributes.${i}.short`)}</div>${txt('What it is for', `rpg.attributes.${i}.desc`)}${chk('Faith (hidden while the realm has no gods)', `rpg.attributes.${i}.faith`)}`, 'rattr')}</section>
        <section class="mu-cw-sec"><h4>Skills</h4>${master('rskill', 'rpg.skills', k => `<b>${esc(k.name)}</b><small>${esc(r.attributes.find(a => a.id === k.attr)?.short ?? '')}</small>`, i => `${txt('Name', `rpg.skills.${i}.name`)}${sel('Uses', `rpg.skills.${i}.attr`, attrs)}`, 'rskill')}</section>
        <section class="mu-cw-sec"><h4>Weapons to choose</h4><p class="mu-muted">A new character can carry one of these instead of their class's weapon. With its weapon skill, it adds their proficiency.</p>${master('rweapon', 'rpg.weapons', k => `<b>${esc(k.name)}</b><small>${k.dice}d${k.sides}${k.ranged ? ' · ranged' : ''}</small>`, i => `<div class="mu-row2">${txt('Name', `rpg.weapons.${i}.name`)}${sel('Uses', `rpg.weapons.${i}.attr`, attrs)}</div>
            <div class="mu-row2">${num('Damage dice', `rpg.weapons.${i}.dice`, 1)}${num('Sides of each die', `rpg.weapons.${i}.sides`, 2)}</div>
            <div class="mu-row2">${sel('Weapon skill', `rpg.weapons.${i}.skill`, [['', '(none: anyone is trained)'], ...r.skills.map(k => [k.id, k.name] as [string, string])])}${chk('Ranged', `rpg.weapons.${i}.ranged`)}</div>`, 'rweapon')}</section>
        <section class="mu-cw-sec mu-cw-wide"><h4>Classes</h4>${master('rclass', 'rpg.classes', c => `<b>${esc(c.name)}</b><small>d${c.hit}${c.schools?.length ? ' · spells' : ''}</small>`, i => {
            const p = `rpg.classes.${i}`; const c = r.classes[i];
            return `${txt('Name', `${p}.name`)}${area('What it is', `${p}.desc`, 2)}
                <div class="mu-row2">${chk('Faith class', `${p}.faith`)}${txt('Its name with no gods in the realm', `${p}.secular`, 'Healer')}</div>
                <div class="mu-row2">${num('Hit points at level 1', `${p}.hit`, 1)}${sel('Key attribute', `${p}.key`, attrs)}</div>
                <div class="mu-field"><span>Class skills (cost 1 point at the start; any other skill costs 2)</span>${pairChips(skills, `${p}.skills`)}</div>
                <div class="mu-field"><span>${esc(lexDefault(w, 'schoolsWord'))} (none: no ${esc(lexDefault(w, 'spellsNoun'))})</span>${pairChips(schools, `${p}.schools`)}</div>
                ${sel('Subclass at level', `${p}.subAt`, [['3', '3'], ['5', '5']], 'num')}
                <h4>In a fight</h4>
                <div class="mu-row2">${num('Armor (added to 10; 5 or more: heavy, covers the back row)', `${p}.armor`, 0)}${txt('Weapon', `${p}.weapon.name`, 'longsword')}</div>
                <div class="mu-row2">${num('Damage dice', `${p}.weapon.dice`, 1)}${num('Sides of each die', `${p}.weapon.sides`, 2)}</div>
                <div class="mu-row2">${sel('Weapon uses', `${p}.weapon.attr`, attrs)}${chk('Ranged (bow, spell): fights from the back row', `${p}.weapon.ranged`)}</div>
                ${sel('Weapon element', `${p}.weapon.element`, ELEMENTS)}
                <div class="mu-row2">${txt('Ability (once a fight)', `${p}.ability.name`, 'Second wind')}${sel('What it does', `${p}.ability.kind`, [['heal', 'Heals (% of hit points)'], ['guard', 'Guards the back row'], ['shield', 'More armor until the next turn'], ['hide', 'Hides: next attack with advantage and extra damage'], ['mark', 'Marks a foe: more damage against it'], ['inspire', 'Inspires allies: bonus to hit (and +2 initiative for the party)'], ['rage', 'Rage: more damage, less armor']])}</div>
                <div class="mu-row2">${num('Amount', `${p}.ability.amount`, 0)}${txt('Ability description', `${p}.ability.desc`)}</div>
                <h4>Subclasses</h4>${c.subclasses.map((s, k) => `<div class="mu-cw-path"><div class="mu-row2">${txt('Name', `${p}.subclasses.${k}.name`)}${txt('What it is', `${p}.subclasses.${k}.desc`)}</div>
                    <div class="mu-row2">${sel('Trained in', `${p}.subclasses.${k}.skill`, [['', '(nothing more)'], ...skills])}${sel('Adds the school', `${p}.subclasses.${k}.school`, [['', '(none)'], ...schools])}</div>
                    <button class="mu-ghost mu-danger-text" data-act="cw-del" data-path="${p}.subclasses.${k}">${icon('x')}<span>Remove</span></button></div>`).join('')}
                <button class="mu-ghost" data-act="cw-add" data-what="rsub" data-path="${p}.subclasses">${icon('plus')}<span>Add a subclass</span></button>`;
        }, 'rclass')}</section>
        <section class="mu-cw-sec"><h4>${esc(lexDefault(w, 'schoolsWord'))}</h4>${master('rschool', 'rpg.schools', s => `<b>${esc(s.name)}</b>`, i => `${txt('Name', `rpg.schools.${i}.name`)}${txt('What it is', `rpg.schools.${i}.desc`)}`, 'rschool')}</section>
        <section class="mu-cw-sec"><h4>${esc(lexDefault(w, 'spellsNoun').replace(/^./, c => c.toUpperCase()))}</h4>${master('rspell', 'rpg.spells', s => `<b>${esc(s.name)}</b><small>${esc(r.schools.find(x => x.id === s.school)?.name ?? '')} · ${s.level}</small>`, i => {
            const p = `rpg.spells.${i}`; const sp = r.spells[i];
            return `${txt('Name', `${p}.name`)}${area('What it does (told to the AI)', `${p}.desc`, 2)}
                <div class="mu-row2">${sel('School', `${p}.school`, schools)}${num('Level (1 at level 1-2, 2 at 3-4…)', `${p}.level`, 1)}</div>
                ${num(`Cost (${esc(r.focusName ?? 'focus')})`, `${p}.cost`, 0)}
                ${sel('Effect', `${p}.effect.kind`, [['heal', 'Heals (% of hit points)'], ['advantage', 'Advantage on the next check of…'], ['bonus', 'A bonus on the next check'], ['calm', 'Calms the town (tension down)'], ['rumor', 'Reveals a rumor'], ['weather', 'Changes the weather'], ['cleanse', 'Cures afflictions'], ['scene', 'Only told to the AI (or a fight move)']])}
                ${['heal', 'bonus', 'calm'].includes(sp.effect.kind) ? num('Amount', `${p}.effect.amount`, 0) : ''}
                ${['advantage', 'bonus'].includes(sp.effect.kind) ? `<div class="mu-field"><span>Skills (none: any, for a bonus)</span>${pairChips(skills, `${p}.effect.skills`)}</div>` : ''}
                ${sp.effect.kind === 'weather' ? sel('Weather', `${p}.effect.to`, [['rain', 'Rain'], ['clear', 'Clear skies']]) : ''}
                <div class="mu-row2">${sel('In a fight', `${p}.combat`, [['', '(by its school)'], ['damage', 'A blow (damage)'], ['shield', 'A guard (+3 armor)']])}${sel('Element', `${p}.element`, ELEMENTS)}</div>`;
        }, 'rspell')}</section>
        <section class="mu-cw-sec"><h4>Titles</h4>${master('rtitle', 'rpg.titles', t => `<b>${esc(t.name)}</b><small>${esc(t.desc)}</small>`, i => {
            const p = `rpg.titles.${i}`;
            return `${txt('Title', `${p}.name`, 'the Brave')}${txt('How to earn it', `${p}.desc`)}
                <div class="mu-row2">${num('At level', `${p}.when.level`, 1)}${num('With renown', `${p}.when.renown`, 0)}</div>
                <div class="mu-row2">${sel('Or after', `${p}.when.count`, [['', '(nothing)'], ['socialWins', 'social checks won'], ['quests', 'quests finished'], ['camps', 'nights at camp'], ['casts', 'spells cast']])}${num('How many', `${p}.when.n`, 1)}</div>`;
        }, 'rtitle')}</section>
        <section class="mu-cw-sec mu-cw-wide"><h4>Bestiary (foes in fights)</h4>${master('rfoe', 'rpg.bestiary', f => `<b>${esc(f.icon ?? '')} ${esc(f.name)}</b><small>level ${f.level} · ${f.hp} HP${f.ranged ? ' · ranged' : ''}</small>`, i => {
            const p = `rpg.bestiary.${i}`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Icon (an emoji, shown in fights)', `${p}.icon`, '🐺')}</div>${num('Level (the party takes on foes up to its total level)', `${p}.level`, 1)}${txt('What it is (told to the AI)', `${p}.desc`)}
                <div class="mu-row2">${num('Hit points', `${p}.hp`, 1)}${num('Armor class', `${p}.ac`, 1)}</div>
                <div class="mu-row2">${num('To hit (+)', `${p}.atk`, 0)}${num('Damage bonus', `${p}.bonus`, 0)}</div>
                <div class="mu-row2">${num('Damage dice', `${p}.dice`, 1)}${num('Sides of each die', `${p}.sides`, 2)}</div>
                <div class="mu-row2">${sel('Row', `${p}.row`, [['front', 'Front'], ['back', 'Back']])}${chk('Ranged (reaches the back row)', `${p}.ranged`)}</div>
                ${csv('Where it is met (road, wild, town, tower; boss for bosses… comma separated)', `${p}.tags`)}
                <div class="mu-row2">${sel('Element', `${p}.element`, ELEMENTS)}${sel('Its blows can cause', `${p}.inflict.kind`, [['', '(nothing)'], ['poison', 'Poison'], ['burn', 'Burn'], ['blind', 'Blindness'], ['silence', 'Silence'], ['curse', 'Curse'], ['slow', 'Slow']])}</div>
                <div class="mu-row2">${num('Chance (0 … 1)', `${p}.inflict.chance`, 0, 0.05)}${num('For (turns)', `${p}.inflict.turns`, 1)}</div>`;
        }, 'rfoe')}</section>
        <section class="mu-cw-sec mu-cw-wide"><h4>Talent trees</h4><p class="mu-muted">A point per level after the first. A tier opens every 3 levels (tier 2 at level 4, tier 3 at 7…). Players can respec any time.</p>
        ${master('rtal', 'rpg.talents', t => `<b>${esc(t.name)}</b><small>tier ${t.tier}${t.cls ? ` · ${esc(r.classes.find(c => c.id === t.cls)?.name ?? '')}` : ''}</small>`, i => {
            const p = `rpg.talents.${i}`; const t = r.talents![i];
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('What it does', `${p}.desc`)}</div>
                <div class="mu-row2">${sel('Class', `${p}.cls`, [['', '(any class)'], ...r.classes.map(c => [c.id, c.name] as [string, string])])}${num('Tier', `${p}.tier`, 1)}</div>
                <div class="mu-field"><span>Needs first</span>${pairChips((r.talents ?? []).filter(x => x.id !== t.id).map(x => [x.id, x.name] as [string, string]), `${p}.requires`)}</div>
                <div class="mu-row2">${sel('Effect', `${p}.effect.kind`, [['hp', 'Hit points'], ['focus', 'Focus'], ['skill', 'A skill'], ['attack', 'To hit'], ['armor', 'Armor'], ['damage', 'Damage'], ['initiative', 'Initiative'], ['camp', 'Nights at camp']])}${num('Amount', `${p}.effect.amount`, 0)}</div>
                ${t.effect.kind === 'skill' ? sel('Skill', `${p}.effect.skill`, skills) : ''}`;
        }, 'rtal')}</section>
        <section class="mu-cw-sec"><h4>Sellswords</h4>${csv('Names (comma separated)', 'rpg.mercNames')}${num('Daily wage per level', 'rpg.mercWage', 0)}
            <small class="mu-muted">Hired at a tavern, an inn or barracks. Not people of the world (no card): paid daily, they leave unpaid and die if they fall.</small></section>
    </div>`;
}

// Career branches: at a rank (3, 6, 9…) the player chooses a path, and its ranks come next.
function branchEditor(w: WorldDef, o: WorldDef['occupations'][number], p: string) {
    const list = o.branches ?? [];
    const first = [...list].sort((a, b) => a.at - b.at)[0];
    const earlier = (at: number) => list.filter(b => b.at < at).flatMap(b => b.options.map(x => [x.id, x.name] as [string, string]));
    return `<h4>Career paths</h4>
        <p class="mu-muted">At some ranks (3, 6, 9 in the built-in careers) the player chooses a path; its ranks come next.${first && o.ranks.length > first.at ? ` Ranks after rank ${first.at} above are not used: the paths replace them.` : ''}</p>
        ${list.map((b, bi) => `<section class="mu-cw-branch"><div class="mu-row mu-cw-inline">${num('Choose at rank', `${p}.branches.${bi}.at`, 1)}<span class="mu-cw-spacer"></span>
            <button class="mu-ghost mu-ibtn" data-act="cw-del" data-path="${p}.branches.${bi}" title="Remove these paths">${icon('trash')}</button></div>
            ${b.options.map((x, k) => { const q = `${p}.branches.${bi}.options.${k}`; return `<div class="mu-cw-path">
                <div class="mu-row2">${txt('Path', `${q}.name`)}${txt('What it is', `${q}.desc`)}</div>
                ${x.ranks.map((_r, ri) => `<div class="mu-row mu-cw-inline">${txt('Rank', `${q}.ranks.${ri}.name`)}${num(`Pay (${esc(w.currency.symbol)}/h)`, `${q}.ranks.${ri}.pay`)}${num('Shifts to reach it', `${q}.promote.${ri}`, 1)}
                    <button class="mu-ghost mu-ibtn" data-act="cw-del" data-path="${q}.ranks.${ri}" title="Remove">${icon('x')}</button></div>`).join('')}
                <button class="mu-ghost" data-act="cw-add" data-what="rank" data-path="${q}.ranks">${icon('plus')}<span>Add a rank</span></button>
                <div class="mu-field"><span>Traits that help on this path</span>${chips(traitOptions(w), `${q}.likes`)}</div>
                ${earlier(b.at).length ? `<div class="mu-field"><span>Only after (empty: after any)</span>${pairChips(earlier(b.at), `${q}.after`)}</div>` : ''}
                <button class="mu-ghost mu-danger-text" data-act="cw-del" data-path="${esc(q)}">${icon('x')}<span>Remove this path</span></button></div>`; }).join('')}
            <button class="mu-ghost" data-act="cw-add" data-what="boption" data-path="${p}.branches.${bi}.options">${icon('plus')}<span>Add a path</span></button></section>`).join('')}
        <button class="mu-ghost" data-act="cw-add" data-what="branch" data-path="${p}.branches">${icon('plus')}<span>Add a choice of paths</span></button>`;
}

// What a bill or a broken thing can stop at home: the world's home actions.
const homeActionOpts = (w: WorldDef): [string, string][] => w.actions.filter(a => a.home).map(a => [a.id, a.label || a.name] as [string, string]);
const pairChips = (opts: [string, string][], p: string) => { const on: string[] = getPath(p) ?? []; return `<div class="mu-chips">${opts.map(([v, l]) => `<button class="mu-chip ${on.includes(v) ? 'is-on' : ''}" data-act="cw-chip" data-path="${esc(p)}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`; };
// A world made before free expenses gets its water and power written out, so they can be edited like any other.
function ensureExpenses(w: WorldDef) {
    if (w.homes.expenses) return;
    w.homes.expenses = DEFAULT_EXPENSES.map(e => ({ ...e, blocks: [...(e.blocks ?? [])], name: lex(w, `bill_${e.id}`) }));
    for (const k of Object.values(w.homes.kinds)) { const b = k.bills as Record<string, number> | undefined; if (b && b.firewood !== undefined && b.power === undefined) { b.power = b.firewood; delete b.firewood; } }
}

// Courses: what each teaches (traits), and where that helps. Traits drive every bonus in the engine, so the links are
// written where the engine reads them: a job that requires the course (occupation.courses), a job it favors (the
// course's traits in occupation.likes: faster promotions), a skill it improves (its traits in the action's roll).
function tabCourses(w: WorldDef) {
    const list = ((w.catalogs as any).courses ?? []) as any[];
    const rolls = w.actions.filter(a => a.roll);
    return `<section class="mu-cw-sec"><h4>Courses</h4>
        <p class="mu-muted">Players pay once, then study a little each day (at home or where a place is tagged "study"). When they finish, they learn the course's traits for good.</p>
        ${master('courses', 'catalogs.courses', c => `<b>${esc(c.icon ?? '')} ${esc(c.name)}</b><small>${c.days} days · ${esc(money(w, c.cost ?? 0))}</small>`, i => {
            const p = `catalogs.courses.${i}`; const c = list[i]; const g: string[] = c.grants ?? [];
            const has = (l: string[] | undefined) => g.length > 0 && g.every(t => (l ?? []).includes(t));
            const rel = (kind: string, id: string, on: boolean, label: string) => `<button class="mu-chip ${on ? 'is-on' : ''}" data-act="cw-crel" data-kind="${esc(kind)}" data-id="${esc(id)}" data-i="${esc(i)}" ${kind !== 'req' && !g.length ? 'aria-disabled="true" title="Give the course a trait to teach first"' : ''}>${esc(label)}</button>`;
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Icon (an emoji)', `${p}.icon`, '📚')}</div>
                <div class="mu-row2">${txt('Area', `${p}.area`, 'Health')}${num('Days of study', `${p}.days`, 1)}</div>
                <div class="mu-row2">${num(`Price (${esc(w.currency.symbol)})`, `${p}.cost`)}</div>
                ${area('Description', `${p}.desc`, 2)}
                ${csv('Teaches these traits', `${p}.grants`, 'Separated by commas. A trait can be new; it helps wherever it is asked for.')}
                ${traitOptions(w).length ? `<small class="mu-muted">Traits of this world: ${esc(traitOptions(w).join(', '))}</small>` : ''}
                <h4>Required for these jobs</h4><div class="mu-chips">${w.occupations.map(o => rel('req', o.id, ((o as any).courses ?? []).includes(c.id), o.name)).join('') || '<small class="mu-muted">No jobs yet.</small>'}</div>
                <h4>Helps in these jobs (faster promotions)</h4><div class="mu-chips">${w.occupations.map(o => rel('job', o.id, has(o.likes), o.name)).join('') || '<small class="mu-muted">No jobs yet.</small>'}</div>
                <h4>Improves these skills (+2 on their roll)</h4><div class="mu-chips">${rolls.map(a => rel('act', a.id, has(a.roll?.traits), a.label || a.name)).join('') || '<small class="mu-muted">No things to do with a roll yet (Things to do → a roll).</small>'}</div>`;
        }, 'course', 'No courses yet.')}</section>`;
}

// The shop: things to buy once. A vehicle shortens trips, a good bed lifts the mood each morning, and an item can
// unlock things to do at home (Things to do → "Only if the player owns").
function tabShop(w: WorldDef) {
    const list = ((w.catalogs as any).shop ?? []) as any[];
    return `<section class="mu-cw-sec"><h4>Shop</h4>
        ${master('shop', 'catalogs.shop', it => `<b>${esc(it.icon ?? '')} ${esc(it.name)}</b><small>${esc(money(w, it.price ?? 0))}</small>`, i => {
            const p = `catalogs.shop.${i}`; const it = list[i];
            const unlocks = w.actions.filter(a => a.needsItem === it.id).map(a => a.label || a.name);
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${txt('Icon (an emoji)', `${p}.icon`, '🛏️')}</div>
                ${area('Description', `${p}.desc`, 2)}
                <div class="mu-row2">${num(`Price (${esc(w.currency.symbol)})`, `${p}.price`)}${num('Mood when you wake up at home (+)', `${p}.sleepMood`)}</div>
                <div class="mu-row2">${num('Trips take this share of the time (0.5 = half; empty = not a vehicle)', `${p}.travel`, 0, 0.05)}</div>
                <p class="mu-muted">${unlocks.length ? `Unlocks: ${esc(unlocks.join(', '))}.` : 'Unlocks nothing to do yet: in Things to do, pick this item under "Only if the player owns".'}</p>`;
        }, 'item', 'Nothing for sale.')}</section>`;
}

// The words of the game: every term with the style's word as a hint; what you write replaces it in this world.
const WORDS = { q: '' };
function tabWords(w: WorldDef) {
    const own = ((w as any).lexicon ?? {}) as Record<string, string>;
    const q = WORDS.q.trim().toLowerCase();
    const groups = lexGroups().map(g => ({ ...g, keys: g.keys.filter(k => !q || lexDefault(w, k).toLowerCase().includes(q) || String(own[k] ?? '').toLowerCase().includes(q)) })).filter(g => g.keys.length);
    const changed = Object.values(own).filter(Boolean).length;
    return `<section class="mu-cw-sec"><h4>Words of the game</h4>
        <p class="mu-muted">Every term the game shows or tells the AI, as the ${esc(styleOf(w))} style says it. Write your world's own word to replace it (a phone can be a "Den Den Mushi", a course "training"…); leave it empty to keep the style's. {0}, {1}… are filled in by the game (a name, a price…). Apps, places, jobs and needs are named in their own tabs.</p>
        <div class="mu-row2"><label class="mu-field"><span>Search</span><input data-input="cw-words-q" data-focus="cw-words-q" value="${esc(WORDS.q)}" placeholder="phone, rent, course…"></label><p class="mu-muted">${changed} term${changed === 1 ? '' : 's'} changed in this world.</p></div>
        ${groups.map(g => `<h4>${esc(g.title)}</h4><div class="mu-cw-words">${g.keys.map(k => `<label class="mu-field"><span>${esc(lexDefault(w, k))}</span><input data-input="cw" data-path="lexicon.${k}" data-focus="lexicon.${k}" value="${esc(own[k] ?? '')}" placeholder="${esc(lexDefault(w, k))}"></label>`).join('')}</div>`).join('') || '<p class="mu-muted">Nothing matches.</p>'}
    </section>`;
}

function tabHomes(w: WorldDef) {
    ensureExpenses(w);
    const kinds = Object.entries(w.homes.kinds);
    const exps = w.homes.expenses ?? [];
    return `<div class="mu-cw-grid">
        <section class="mu-cw-sec"><h4>Housing areas</h4>
            ${master('zones', 'homes.zones', z => `<b>${esc(z.name)}</b><small>${z.spots.length} homes · ${esc(money(w, z.rent))}</small>`, i => {
                const p = `homes.zones.${i}`; const z = w.homes.zones[i];
                return `${txt('Name', `${p}.name`)}${area('Description', `${p}.desc`, 2)}
                    <div class="mu-row2">${sel('Kind of home', `${p}.kind`, kinds.map(([id, k]) => [id, k.name] as [string, string]))}${num(`Rent (${esc(w.currency.symbol)})`, `${p}.rent`)}</div>
                    ${sel('On the map', `${p}.map`, w.maps.map(m => [m.id, m.name] as [string, string]))}
                    <p class="mu-muted">${z.spots.length} homes placed. They are numbered (House 1, House 2…).</p>
                    <button data-act="cw-homes-map" data-i="${esc(i)}">${icon('map')}<span>Place the homes on the map</span></button>`;
            }, 'zone', 'No housing areas yet.')}</section>
        <section class="mu-cw-sec"><h4>Kinds of home</h4>
            ${kinds.map(([id, k]) => `<div class="mu-cw-kind"><div class="mu-cw-cover is-small" style="${k.image ? `background-image:url('${safeUrl(worldFile(w, k.image))}')` : ''}"></div>
                <div>${txt('Name', `homes.kinds.${id}.name`)}${area('Description', `homes.kinds.${id}.desc`, 2)}
                ${exps.length ? `<div class="mu-row2">${exps.map(e => num(`${esc(e.name)} a week (${esc(w.currency.symbol)})`, `homes.kinds.${id}.bills.${e.id}`)).join('')}</div>` : ''}
                <details class="mu-me-times" ${Object.keys(k.images ?? {}).length ? 'open' : ''}><summary>Inside at other times of the day</summary>
                    ${TIME_SLOTS.map(per => { const b = k.images?.[per.id] ? worldFile(w, k.images[per.id]) : ''; return `<div class="mu-me-time"><div class="mu-cw-cover is-mini" style="${b ? `background-image:url('${safeUrl(b)}')` : ''}">${b ? '' : '<span>usual</span>'}</div><b>${esc(per.name)}</b>
                        <button class="mu-ghost mu-ibtn" data-act="cw-kind-img" data-id="${esc(id)}" data-period="${esc(per.id)}" title="Upload">${icon('upload')}</button>${b ? `<button class="mu-ghost mu-ibtn" data-act="cw-kind-img-clear" data-id="${esc(id)}" data-period="${esc(per.id)}" title="Use the usual one">${icon('x')}</button>` : ''}</div>`; }).join('')}</details>
                <div class="mu-row"><button class="mu-ghost" data-act="cw-kind-img" data-id="${esc(id)}">${icon('image')}<span>Inside picture (scene)</span></button>
                ${kinds.length > 1 ? `<button class="mu-ghost" data-act="cw-del" data-path="homes.kinds.${id}">${icon('trash')}</button>` : ''}</div></div></div>`).join('')}
            <button class="mu-ghost" data-act="cw-add" data-what="kind">${icon('plus')}<span>Add a kind of home</span></button></section>
        <section class="mu-cw-sec"><h4>Expenses (besides the rent)</h4>
            <p class="mu-muted">Bills every home pays each week with the rent: water, power, firewood, servants, taxes… as many as you like, or none. Each kind of home sets its own amount above. One left unpaid for a week stops the things you pick here.</p>
            ${master('expenses', 'homes.expenses', e => `<b>${esc(e.name || lexDefault(w, `bill_${e.id}`))}${e.rpg ? ' <small>(RPG)</small>' : ''}</b><small>${(e.blocks ?? []).length ? `stops ${(e.blocks ?? []).length} thing${(e.blocks ?? []).length === 1 ? '' : 's'}` : 'stops nothing'}</small>`, i => {
                const p = `homes.expenses.${i}`; const e = exps[i];
                return `${RPG_LOCKED ? '' : chk('Only in the RPG mode', `${p}.rpg`, 'Like the upkeep of arms and gear: not billed in Life-Sim.')}<div class="mu-row2">${txt('Name (empty: the Words tab\'s word)', `${p}.name`, lexDefault(w, `bill_${e.id}`))}<label class="mu-field"><span>Icon</span><select data-input="cw" data-path="${p}.icon">${ICON_NAMES().map(n => `<option ${n === (e.icon ?? 'wallet') ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
                    <h4>When it is a week unpaid, it stops</h4>${pairChips(homeActionOpts(w), `${p}.blocks`)}
                    ${area('Message when it stops (optional; {app} = where to pay)', `${p}.cut`, 2, `${e.name} was not paid for a week: it stopped until you pay it.`)}
                    ${txt('Message when it is paid again (optional)', `${p}.back`, `${e.name} is back.`)}`;
            }, 'expense', 'No expenses: homes only pay the rent.')}</section>
        <section class="mu-cw-sec"><h4>Things that break at home</h4>
            <p class="mu-muted">Now and then one of these breaks and stops some things until it is fixed (by the player, or paying someone).</p>
            ${num(`Paying someone to fix it costs (${esc(w.currency.symbol)})`, 'homes.repairCost')}
            ${master('breakables', 'homes.breakables', b => `<b>${esc(b.name)}</b><small>stops ${(b.blocks ?? []).length}</small>`, i => {
                const p = `homes.breakables.${i}`;
                return `${txt('Name (as in "Oh no: … broke at home")', `${p}.name`, 'the stove')}<h4>While broken, it stops</h4>${pairChips(homeActionOpts(w), `${p}.blocks`)}`;
            }, 'breakable', 'Nothing breaks.')}</section>
    </div>`;
}

function tabCharacter(w: WorldDef) {
    const s = w.sheet;
    return `<div class="mu-cw-grid">
        <section class="mu-cw-sec mu-cw-wide"><h4>What the player chooses</h4><p class="mu-muted">The parts of making a character this world asks for (a new character or a persona). Turned off, it is not asked: the first origin is used, and no traits or words about you.</p>
            <div class="mu-cw-asks">${chk('A picture', 'sheet.ask.portrait', 'New characters only.', true)}${chk('Age', 'sheet.ask.age', '', true)}${chk('Appearance', 'sheet.ask.appearance', '', true)}${chk('Origin', 'sheet.ask.origin', 'Money, home and (RPG) skills.', true)}${chk('Traits', 'sheet.ask.traits', 'The groups below.', true)}${chk('About you', 'sheet.ask.bio', 'A few words of their own.', true)}</div></section>
        <section class="mu-cw-sec"><h4>Age</h4><div class="mu-row2">${num('From', 'sheet.age.min', 1)}${num('To', 'sheet.age.max', 1)}</div>${num('Default', 'sheet.age.default', 1)}
            <h4>Appearance</h4>
            ${(s.appearance ?? []).map((_a, k) => `<div class="mu-row mu-cw-inline">${txt('Trait', `sheet.appearance.${k}.label`)}${csv('Options (comma separated)', `sheet.appearance.${k}.options`)}<button class="mu-ghost mu-ibtn" data-act="cw-del" data-path="sheet.appearance.${k}">${icon('x')}</button></div>`).join('')}
            <button class="mu-ghost" data-act="cw-add" data-what="look">${icon('plus')}<span>Add</span></button></section>
        <section class="mu-cw-sec"><h4>Traits the player picks</h4>
            ${(s.traits ?? []).map((_t, k) => `<div class="mu-cw-trait"><div class="mu-row2">${txt('Group', `sheet.traits.${k}.label`)}${num('Pick up to (0: no limit)', `sheet.traits.${k}.max`, 0)}</div>${csv('Options (comma separated)', `sheet.traits.${k}.options`)}<button class="mu-ghost" data-act="cw-del" data-path="sheet.traits.${k}">${icon('trash')}<span>Remove</span></button></div>`).join('')}
            <button class="mu-ghost" data-act="cw-add" data-what="trait">${icon('plus')}<span>Add a group</span></button></section>
        <section class="mu-cw-sec mu-cw-wide"><h4>Origins (how you start)</h4>
            ${master('origins', 'catalogs.origins', o => `<b>${esc(o.name)}</b><small>${esc(money(w, o.money))}</small>`, i => {
                const p = `catalogs.origins.${i}`;
                return `${txt('Name', `${p}.name`)}${area('Description', `${p}.desc`, 2)}
                    <div class="mu-row2">${num(`Money (${esc(w.currency.symbol)})`, `${p}.money`)}${num('People you already know', `${p}.knows`)}</div>
                    ${sel('You live in', `${p}.home`, zoneOpts(w, '(first area)'))}
                    ${w.rpg && !RPG_LOCKED ? `<h4>In the RPG</h4><div class="mu-field"><span>Trained skills</span>${pairChips(w.rpg.skills.map(k => [k.id, k.name] as [string, string]), `${p}.skills`)}</div>
                        ${txt('What it gives you', `${p}.feature`, 'Folk hero: common folk take you in.')}
                        <div class="mu-row2">${w.rpg.attributes.map(a => num(`+ ${esc(a.short)}`, `${p}.attributes.${a.id}`, 0)).join('')}</div>` : ''}`;
            }, 'origin')}</section>
    </div>`;
}

const TARGETS = (w: WorldDef): [string, string][] => [['home', 'Home'], ['work', 'Work'], ['leisure', 'Free time'], ...placeOpts(w)];
function routineEditor(w: WorldDef) {
    const ids = Object.keys(w.cast.routineTemplates);
    if (!ids.includes(CW.sel.routine)) CW.sel.routine = ids[0] ?? '';
    const id = CW.sel.routine; const r = w.cast.routineTemplates[id];
    const days = (k: 'weekday' | 'weekend', label: string) => `<h4>${label}</h4>${r[k].map((_s, j) => `<div class="mu-row mu-cw-inline">
        ${num('From hour', `cast.routineTemplates.${id}.${k}.${j}.0`, 0)}${sel('Goes to', `cast.routineTemplates.${id}.${k}.${j}.1`, TARGETS(w))}
        <button class="mu-ghost mu-ibtn" data-act="cw-del" data-path="cast.routineTemplates.${id}.${k}.${j}">${icon('x')}</button></div>`).join('')}
        <button class="mu-ghost" data-act="cw-add" data-what="step" data-path="cast.routineTemplates.${id}.${k}">${icon('plus')}<span>Add a step</span></button>`;
    return `<section class="mu-cw-sec"><h4>Routines</h4><div class="mu-chips">${ids.map(x => `<button class="mu-chip ${x === id ? 'is-on' : ''}" data-act="cw-routine" data-id="${esc(x)}">${esc(x)}</button>`).join('')}
            <button class="mu-chip" data-act="cw-add" data-what="routine" title="New routine">${icon('plus')}</button><button class="mu-chip" data-act="cw-rnd-routine" title="New random routine">${icon('redo')}</button></div>
        ${r ? `${days('weekday', 'Weekdays')}${days('weekend', 'Weekends')}${ids.length > 1 ? `<button class="mu-ghost" data-act="cw-del" data-path="cast.routineTemplates.${id}">${icon('trash')}<span>Remove this routine</span></button>` : ''}` : ''}</section>`;
}
// The world's own people: a character card is made from each when a game of this world starts (or reused).
function peopleEditor(w: WorldDef) {
    const jobs: [string, string][] = [['', 'No job'], ...w.occupations.map(o => [o.id, o.name] as [string, string])];
    const routines = Object.keys(w.cast.routineTemplates).map(id => [id, id] as [string, string]);
    const spots = w.places.filter(p => !p.link).map(p => p.name).length;
    return `<section class="mu-cw-sec mu-cw-wide"><h4>People of this world</h4>
        <p class="mu-muted">Each becomes a character card when a game of this world starts. Their job, home and routine say where they are each hour.</p>
        ${master('people', 'cast.examples', e => `<b>${esc(e.name)}</b><small>${esc(w.occupations.find(o => o.id === e.occupation)?.name ?? 'No job')} · ${e.age}</small>`, i => {
            const p = `cast.examples.${i}`; const e = w.cast.examples[i];
            return `<div class="mu-row2">${txt('Name', `${p}.name`)}${num('Age', `${p}.age`, 18)}</div>
                <div class="mu-row2">${sel('Job', `${p}.occupation`, jobs, 'nullable')}${sel('Lives in', `${p}.home`, zoneOpts(w))}</div>
                ${sel('Routine', `${p}.routine`, routines)}
                <h4>Goes out to (free time)</h4>${pairChips(w.places.filter(x => !x.link).map(x => [x.id, x.name] as [string, string]), `${p}.leisure`)}
                ${area('Description (who they are; becomes the card\'s description)', `${p}.description`, 5)}
                ${area('Personality (optional)', `${p}.personality`, 2)}
                ${area('First message (optional; the card\'s greeting)', `${p}.first_mes`, 3)}
                <h4>Relations</h4><p class="mu-muted">How ${esc(e.name)} relates to the world's other people (any of them, wherever they live), from the start of every game.</p>
                ${(e.ties ?? []).map((t, k) => `<div class="mu-row mu-cw-inline">${sel('Is', `${p}.ties.${k}.type`, TIE_TYPES.map(([id, l]) => [id, l] as [string, string]))}${sel('Of', `${p}.ties.${k}.to`, w.cast.examples.filter(x => x.name !== e.name).map(x => [x.name, x.name] as [string, string]))}${sel('Feeling', `${p}.ties.${k}.tone`, TIE_TONES.map(([id, l]) => [id, l] as [string, string]))}
                    <button class="mu-ghost mu-ibtn" data-act="cw-del" data-path="${p}.ties.${k}" title="Remove">${icon('x')}</button></div>`).join('')}
                ${w.cast.examples.length > 1 ? `<button class="mu-ghost" data-act="cw-add" data-what="etie" data-path="${p}.ties" data-i="${esc(i)}">${icon('plus')}<span>Add a relation</span></button>` : ''}
                <div class="mu-row"><button class="mu-ghost" data-act="cw-rnd-person" data-i="${esc(i)}">${icon('redo')}<span>New job, home and routine</span></button></div>
                ${spots ? '' : '<small class="mu-muted">Add places on the map first.</small>'}${e ? '' : ''}`;
        }, 'person', 'Nobody lives here yet.')}
        <button class="mu-ghost" data-act="cw-rnd-all">${icon('redo')}<span>Shuffle everyone's job, home and routine</span></button></section>`;
}
function tabPeople(w: WorldDef) {
    return `<div class="mu-cw-grid">
        ${peopleEditor(w)}
        ${routineEditor(w)}
    </div>`;
}

function tabLore(w: WorldDef) {
    return master('lore', 'lore', (l, k) => `<b>${esc((l.keys ?? []).join(', ') || `#${k + 1}`)}</b><small>${l.constant ? 'Always on' : ''}</small>`, i => {
        const p = `lore.${i}`;
        return `${csv('Keywords (comma separated)', `${p}.keys`, 'The entry is used when one of these comes up in the chat.')}${chk('Always on', `${p}.constant`)}
            <h4>Only when… (optional: the entry switches on by itself when the world is like this)</h4>
            <div class="mu-row2">${sel('Weather', `${p}.when.weather`, [['', 'Any'], ['Sunny', 'Sunny'], ['Fair', 'Fair'], ['Partly cloudy', 'Partly cloudy'], ['Cloudy', 'Cloudy'], ['Rain', 'Rain']])}${sel('Part of the day', `${p}.when.period`, [['', 'Any'], ...w.time.periods.map(x => [x.name, x.name] as [string, string])])}</div>
            <div class="mu-row2">${sel('Place', `${p}.when.place`, [['', 'Anywhere'], ...placeOpts(w)])}${sel('Days', `${p}.when.weekend`, [['', 'Any day'], ['true', 'Weekends'], ['false', 'Weekdays']], 'tri')}</div>
            <div class="mu-row2">${sel('Region (map)', `${p}.when.region`, [['', 'Anywhere'], ...w.maps.map(m => [m.id, m.name] as [string, string])])}${sel('Season', `${p}.when.season`, [['', 'Any'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']])}</div>
            <div class="mu-row2">${num('Tension above (0 … 100)', `${p}.when.tensionAbove`)}${num('Chance each day (0 … 1)', `${p}.when.chance`, 0, 0.05)}</div>
            <div class="mu-row2">${num('Public mood above (−100 … 100)', `${p}.when.moodAbove`, -100)}${num('Public mood below', `${p}.when.moodBelow`, -100)}</div>
            <div class="mu-row2">${num('From day', `${p}.when.fromDay`, 1)}${num('Until day', `${p}.when.toDay`, 1)}</div>
            ${chk('It is a rumor', `${p}.rumor`, 'Instead of telling the AI, people pass it around (from two people in its region, when the conditions hold); you may overhear it.')}
            ${area('Content', `${p}.content`, 8)}`;
    }, 'lore', 'No entries yet.') + `<p class="mu-muted">These entries, the setting and every place become the world's lorebook when a game starts.</p>`;
}

const AN_POS: [string, string][] = [['1', 'In the chat, at a depth'], ['0', 'After the story string'], ['2', 'Before the story string']];
function tabBooks(w: WorldDef) {
    const on = w.lorebooks ?? [];
    const books = lorebooks().sort((a, b) => Number(on.includes(b)) - Number(on.includes(a)) || a.localeCompare(b));
    return `<div class="mu-cw-grid">
        <section class="mu-cw-sec"><h4>Lorebooks of this world · ${on.length}</h4>
            <p class="mu-muted">SillyTavern lorebooks this world uses, like lorebooks linked to the game's group: they are switched on while you play one of its games (besides the lorebook Mundi writes from the Lore tab).</p>
            <div class="mu-wc-books">${books.map(n => `<label class="mu-check mu-wc-book ${on.includes(n) ? 'is-on' : ''}"><input type="checkbox" data-act="cw-book" data-name="${esc(n)}" ${on.includes(n) ? 'checked' : ''}><span data-notr>${esc(n)}</span></label>`).join('') || '<p class="mu-muted">You have no lorebooks yet.</p>'}</div></section>
        <section class="mu-cw-sec"><h4>Author's Note</h4>
            ${area('Every new game of this world starts with this note (you can change it in each save later, in the globe).', 'note.text', 6, 'Tone, pacing, what to focus on.')}
            <div class="mu-row2">${num('Every how many messages', 'note.interval', 0)}${num('Depth', 'note.depth', 0)}</div>
            ${sel('Position', 'note.position', AN_POS, 'num')}</section>
    </div>`;
}

/* ---------- random fill (jobs, routines, where people live and work) ---------- */

const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T>(l: T[]): T | undefined => l[Math.floor(Math.random() * l.length)];
function randomRoutine(w: WorldDef): string {
    const id = `random${Object.keys(w.cast.routineTemplates).length + 1}`;
    const start = rnd(6, 11), end = Math.min(20, start + rnd(6, 9)), night = rnd(21, 23);
    w.cast.routineTemplates[id] = {
        weekday: [[0, 'home'], [start, 'work'], [end, 'leisure'], [night, 'home']],
        weekend: [[0, 'home'], [rnd(9, 12), 'leisure'], [rnd(15, 18), 'leisure'], [rnd(21, 23), 'home']],
    };
    return id;
}
function randomizeJob(w: WorldDef, o: WorldDef['occupations'][number]) {
    const hours = pick<[number, number]>([[7, 19], [8, 18], [9, 17], [10, 22], [6, 14], [14, 23]])!;
    o.hours = hours; o.shift = rnd(4, 8);
    const work = w.places.filter(p => !p.link && (p.tags ?? []).includes('work'));
    if (!o.place && work.length) o.place = pick(work)!.id;
    let pay = rnd(12, 30);
    o.ranks = o.ranks.map(r => { const x = { ...r, pay }; pay += rnd(4, 10); return x; });
    o.promote = o.ranks.slice(0, -1).map((_r, k) => rnd(3, 6) * (k + 1));
    const opts = traitOptions(w);
    o.likes = [...new Set([pick(opts), pick(opts)].filter(Boolean) as string[])];
}
function randomizePerson(w: WorldDef, e: WorldDef['cast']['examples'][number]) {
    e.occupation = Math.random() < 0.85 ? pick(w.occupations)?.id ?? null : null;
    e.home = pick(w.homes.zones)?.id ?? e.home;
    const tpls = Object.keys(w.cast.routineTemplates);
    e.routine = pick(tpls) ?? randomRoutine(w);
    const leisure = w.places.filter(p => !p.link && (p.tags ?? []).some(t => ['leisure', 'food', 'shop'].includes(t))).map(p => p.id);
    e.leisure = [...new Set([pick(leisure), pick(leisure), pick(leisure)].filter(Boolean) as string[])];
}

/* ---------- the screen ---------- */

// A new world: its style (what the game is like), then where it starts from: a ready world (a preset) to change, or nothing.
// Life-Sim / RPG / Custom, as three cards.
const modeCards = (on: GameMode, act: string) => `<div class="mu-heropick is-start mu-modes">${GAME_MODES.map(m => `<button class="mu-herocard ${m.id === on ? 'is-on' : ''} ${m.soon ? 'is-soon' : ''}" data-act="${esc(act)}" data-v="${esc(m.id)}" ${m.soon ? 'aria-disabled="true"' : ''}><b>${m.name}${m.soon ? ' <em class="mu-soon-tag">Soon</em>' : ''}</b><p>${m.desc}</p></button>`).join('')}</div>`;
const presetsOf = (style: string, scenario = false) => worlds().filter(w => !worldLocked(w) && isScenario(w) === scenario && (scenario || styleOf(w) === style)).sort((a, b) => Number(isCustom(a.id)) - Number(isCustom(b.id)));
function startPage(): string {
    const s = CW.start!;
    const st = STYLES.find(x => x.id === s.style) ?? STYLES[0];
    const presets = presetsOf(st.id, !!s.scenario);
    const base = getWorld(s.base);
    return `<div class="mu-settings mu-cw-new">
        <div class="mu-subhead"><button data-act="cw-start-cancel" data-sfx="back">← Back</button><h2>${s.scenario ? 'New Home' : 'New world'}</h2></div>
        <div class="mu-cw-new-body mu-panel"><div class="mu-cw-new-grid"><section class="mu-cw-new-a">
            <!-- world or scenario: already chosen on the New game screen -->
            <label class="mu-field mu-cw-new-name ${CW.nameMiss ? 'is-missing' : ''}"><span>Name of your ${s.scenario ? 'Home' : 'world'}</span><input data-input="cw-start-name" data-focus="cwname" value="${esc(s.name)}" placeholder="${s.scenario ? 'My Home' : 'My world'}">${CW.nameMiss ? `<small class="mu-miss-note">Give your ${s.scenario ? 'Home' : 'world'} a name first.</small>` : ''}</label>
            <h3>Style</h3>
            <p class="mu-muted">Every style has the same parts (needs, a device to talk to people, trades, homes, people with routines), dressed for its time. The style decides how they look and what they are called.</p>
            <div class="mu-styles">${STYLES.map(x => `<button class="mu-style ${x.id === st.id ? 'is-on' : ''} ${x.ready ? '' : 'is-soon'}" data-act="cw-start-style" data-id="${esc(x.id)}" ${x.ready ? '' : 'aria-disabled="true"'}>
                <b>${x.name}</b><small>${x.ready ? x.tagline : x.soon ?? 'Coming later.'}</small></button>`).join('')}</div>
            <section class="mu-panel mu-style-info"><h4>What this style brings</h4><ul>${st.changes.map(c => `<li>${c}</li>`).join('')}</ul></section></section>
            <section class="mu-cw-new-b">${s.scenario ? '<p class="mu-muted">A Home is always Life-Sim (realistic or fantasy), made for role-play: no work, money or courses.</p>' : `<h3>Game mode</h3>
            <p class="mu-muted">What the game is about. Any style works with any mode.</p>
            ${modeCards(s.game, 'cw-start-game')}`}
            <h3>Start from</h3>
            <p class="mu-muted">A preset is a ready world: you get a copy of it to change as you like (the original stays as it is).</p>
            <div class="mu-cards">${presets.map(w => `<button class="mu-worldcard ${s.mode === 'copy' && s.base === w.id ? 'is-on' : ''}" data-act="cw-start-preset" data-id="${esc(w.id)}">
                    <span class="mu-worldart" style="${w.cover ? `background-image:url('${worldFile(w, w.cover)}')` : ''}">${slidesHtml(w)}<span class="mu-style-tags"><em class="mu-style-tag is-${esc(styleOf(w))}">${esc(STYLES.find(x => x.id === styleOf(w))?.name ?? st.name)}</em>${toneTag(w)}</span></span>
                    <b data-notr>${esc(inWorld(w, w.name))}</b><small>${isCustom(w.id) ? 'Made by you' : 'Ready world'}</small><p data-notr>${esc(shortDesc(inWorld(w, w.description)))}</p></button>`).join('')}
                <div class="mu-cw-startnew"><button class="mu-worldcard is-new ${s.mode === 'empty' ? 'is-on' : ''}" data-act="cw-start-empty"><span class="mu-worldart">${icon('map')}</span><b>Start from nothing</b><small>Only the ${esc(st.name)} rules</small><p>Needs, things to do, the device and the character sheet of this style; you draw the maps, places and people.</p></button>
                ${s.scenario ? '' : `<button class="mu-worldcard is-new ${s.mode === 'lore' ? 'is-on' : ''}" data-act="cw-start-lore"><span class="mu-worldart">${icon('book')}</span><b>From lorebooks</b><small>Your AI builds it</small><p>Your AI reads lorebooks you choose and builds the world from them: maps, places, people, groups and jobs.</p></button>`}</div></div></section></div>
            <div class="mu-row mu-cw-new-go"><span class="mu-muted">${s.mode === 'copy' ? `A copy of ${esc(base?.name ?? '')}` : s.mode === 'lore' ? `A ${esc(st.name)} world built from lorebooks` : `An empty ${esc(st.name)} world`}</span>
                <button class="mu-primary mu-big ${s.name.trim() ? '' : 'is-dim'}" data-act="cw-start-go" ${base ? '' : 'aria-disabled="true"'}>${s.scenario ? 'Create the Home' : 'Create the world'} ▶</button></div>
        </div></div>`;
}

export function creatorHtml(): string {
    if (FL.on && !CW.w) return fromLoreHtml();
    if (CW.start && !CW.w) return startPage();
    const w = CW.w; if (!w) return '';
    const body = CW.tab === 'general' ? tabGeneral(w) : CW.tab === 'features' ? tabFeatures(w) : CW.tab === 'needs' ? tabNeeds(w) : CW.tab === 'maps' ? (isScenario(w) ? houseMapsHtml(w) : mapEditorHtml(w))
        : CW.tab === 'homes' ? tabHomes(w) : CW.tab === 'actions' ? tabActions(w) : CW.tab === 'jobs' ? tabJobs(w) : CW.tab === 'courses' ? tabCourses(w) : CW.tab === 'shop' ? tabShop(w) : CW.tab === 'words' ? tabWords(w) : CW.tab === 'character' ? tabCharacter(w) : CW.tab === 'rpg' ? tabRpg(w) : CW.tab === 'customs' ? tabCustoms(w) : CW.tab === 'realm' ? tabRealm(w) : CW.tab === 'economy' ? tabEconomy(w)
        : CW.tab === 'people' ? tabPeople(w) : CW.tab === 'books' ? tabBooks(w) : tabLore(w);
    return `<div class="mu-settings mu-creator-ed">
        <div class="mu-subhead"><button data-act="cw-close" data-sfx="back">← Back</button><h2>${isScenario(w) ? 'Home creator' : 'World creator'}</h2><small data-notr>${esc(w.name)}${CW.dirty ? ' •' : ''}</small>
</div>
        <div class="mu-settings-layout mu-cw-layout">
            <nav class="mu-tabs">${TABS.filter(([id]) => !(RPG_LOCKED && id === 'rpg')).filter(([id]) => CW.allTabs || !isScenario(W()) || !SCENARIO_HIDES.includes(id)).map(([id, l]) => `<button class="${CW.tab === id ? 'is-on' : ''}" data-act="cw-tab" data-tab="${esc(id)}">${l}</button>`).join('')}</nav>
            <div class="mu-settings-body mu-panel ${CW.tab === 'maps' ? 'is-maps' : ''}" data-keep="cw-body">${redoHtml(w, CW.tab)}${body}</div>
        </div>
        <div class="mu-row mu-cw-new-go mu-cw-foot">
            ${CW.confirmDel ? `<span class="mu-warn">Delete "${esc(w.name)}"? This cannot be undone.</span><button data-act="cw-delete-no">Cancel</button><button class="mu-danger" data-act="cw-delete-yes">${icon('trash')}<span>Delete</span></button>`
            : `<button class="mu-danger" data-act="cw-delete" title="Delete this ${isScenario(w) ? 'Home' : 'world'}">${icon('trash')}<span>Delete</span></button>
               <button class="mu-ghost" data-act="cw-dup" title="Make a copy of it">${icon('copy')}<span>Duplicate</span></button>
               <button class="mu-ghost" data-act="cw-export" title="Export to a file">${icon('upload')}<span>Export</span></button>
               <button class="mu-ghost" data-act="wp-open" title="Paint the maps, places and cover with your ComfyUI">${icon('image')}<span>Paint</span></button>
               <span class="mu-grow"></span>${CW.dirty ? '<span class="mu-muted">Not saved</span>' : ''}
               <button class="mu-primary mu-big" data-act="cw-save" ${CW.saving ? 'disabled' : ''}>${icon('save')}<span>${CW.saving ? 'Saving…' : 'Save'}</span></button>`}</div>
        ${CW.leaveAsk ? leaveHtml('cw') : ''}${paintHtml()}</div>`;
}

/* ---------- opening ---------- */

let backTo = 'newgame';
export function openCreatorNew(style = 'modern', scenario = false) {
    if (!STYLES.find(x => x.id === style)?.ready) style = 'modern';
    backTo = state.view; CW.w = null; CW.confirmDel = false; CW.leaveAsk = false; CW.dirty = false; FL.on = false;
    CW.nameMiss = false; CW.start = { name: '', style, base: presetsOf(style, scenario)[0]?.id ?? 'modern', mode: 'copy', game: 'lifesim', scenario };
    state.view = 'creator' as any; notify();
}
export function openCreatorEdit(id: string) {
    const w = getWorld(id); if (!w) return;
    backTo = state.view; CW.w = structuredClone(w); CW.w.base = w.base; CW.tab = 'general'; CW.dirty = false; CW.confirmDel = false; CW.leaveAsk = false; CW.start = null;
    state.view = 'creator' as any; notify();
}
// Leaving with changes not saved: save them, leave without them, or stay.
export const leaveHtml = (k: string) => `<div class="mu-dlg-veil" data-act="${k}-leave-stay"><div class="mu-dlg mu-panel mu-leave" role="dialog" data-act="lib-stay">
    <h3>Unsaved changes</h3><p>You have changes that are not saved. Leave anyway?</p>
    <div class="mu-row mu-dlg-btns"><button data-act="${k}-leave-stay">Stay</button><button class="mu-danger" data-act="${k}-leave-go">Leave without saving</button><button class="mu-primary" data-act="${k}-leave-save">${icon('save')}<span>Save and leave</span></button></div></div></div>`;
function close() { FL.on = false; CW.leaveAsk = false; CW.confirmDel = false; CW.dirty = false; CW.w = null; CW.start = null; state.view = (backTo === 'creator' ? 'newgame' : backTo) as any; notify(); }

const NEW: Record<string, () => [string, any]> = {
    rweapon: () => ['rpg.weapons', { id: newId('weapon'), name: 'New weapon', dice: 1, sides: 6, attr: W().rpg?.attributes[0]?.id ?? 'str' }],
    rattr: () => ['rpg.attributes', { id: newId('attr'), name: 'New attribute', short: 'NEW' }],
    rskill: () => ['rpg.skills', { id: newId('skill'), name: 'New skill', attr: W().rpg?.attributes[0]?.id ?? 'str' }],
    rclass: () => ['rpg.classes', { id: newId('class'), name: 'New class', hit: 8, key: W().rpg?.attributes[0]?.id ?? 'str', skills: [], subAt: 3, subclasses: [] }],
    rschool: () => ['rpg.schools', { id: newId('school'), name: 'New school' }],
    rspell: () => ['rpg.spells', { id: newId('spell'), name: 'New spell', school: W().rpg?.schools[0]?.id ?? '', level: 1, cost: 1, desc: '', effect: { kind: 'scene' } }],
    rtitle: () => ['rpg.titles', { id: newId('title'), name: 'the New', desc: '', when: { level: 5 } }],
    good: () => ['goods', { id: newId('good'), name: 'New good', icon: '📦', price: 10, kind: 'goods' }],
    crop: () => ['crops', { id: newId('crop'), name: 'New crop', icon: '🌱', days: 3, seed: 3, good: W().goods?.[0]?.id ?? '', yield: 3 }],
    biz: () => ['businesses', { id: newId('biz'), name: 'New business', icon: '🏪', cost: 300, profit: 15, staff: 2, tags: ['shop'] }],
    sky: () => ['skies.events', { id: newId('sky'), name: 'New event', every: 30, days: 1, effect: 'omen' }],
    hazard: () => ['skies.hazards', { id: newId('hz'), name: 'New hazard', climate: 'temperate', chance: 0.1 }],
    god: () => ['realm.pantheon', { id: newId('god'), name: 'New god', domain: '' }],
    faction: () => ['factions', { id: newId('fac'), name: 'New faction', kind: 'guild', ranks: ['Member', 'Officer', 'Leader'], quota: 1 }],
    inst: () => ['institutions', { id: newId('school'), name: 'New school', place: W().places.find(p => !p.link)?.id ?? '', ranks: ['Student', 'Prefect', 'Teacher', 'Head'], tuition: 10, examEvery: 7 }],
    rtal: () => ['rpg.talents', { id: newId('talent'), name: 'New talent', tier: 1, effect: { kind: 'hp', amount: 5 } }],
    habit: () => ['habits', { id: newId('habit'), name: 'New habit', trait: 'New trait', actions: [], count: 5, days: 7 }],
    festival: () => ['festivals', { id: newId('fest'), name: 'New festival', season: 'spring', day: 1, days: 1, mood: 15 }],
    cevent: () => ['cityEvents', { id: newId('event'), name: 'New event', icon: '🎉', place: W().places.find(p => !p.link)?.id ?? '', weekday: 5, every: 1, from: 18, hours: 3, mood: 12 }],
    hobby: () => ['hobbies', { id: newId('hobby'), name: 'New hobby', icon: '⭐', actions: [] }],
    recipe: () => ['recipes', { id: newId('recipe'), name: 'New recipe', needs: {}, makes: W().goods?.[0]?.id ?? '' }],
    tower: () => ['towers', { id: newId('tower'), name: 'New tower', place: W().places.find(p => !p.link)?.id ?? '', floors: 20 }],
    blade: () => ['blades', { id: newId('blade'), name: 'New blade', personality: '', likes: 'fights', bonus: 1 }],
    pet: () => ['pets', { id: newId('pet'), name: 'New animal', icon: '🐾', price: 50, mood: 3 }],
    rfoe: () => ['rpg.bestiary', { id: newId('foe'), name: 'New foe', level: 1, hp: 10, ac: 12, atk: 3, dice: 1, sides: 6, bonus: 1, row: 'front', tags: ['road'], desc: '' }],
    item: () => ['catalogs.shop', { id: newId('item'), name: 'New item', desc: '', icon: '🎁', price: 100 }],
    breakable: () => ['homes.breakables', { id: newId('thing'), name: 'the new thing', blocks: [] }],
    course: () => ['catalogs.courses', { id: newId('course'), name: 'New course', area: 'General', days: 3, cost: 100, grants: [], icon: '📚', desc: '' }],
    expense: () => ['homes.expenses', { id: newId('expense'), name: 'New expense', icon: 'wallet', blocks: [] }],
    need: () => ['statuses', { id: newId('need'), name: 'New need', icon: '⭐', color: '#4fb0ff', start: 80, max: 100, hud: true, decay: { amount: 1, everyMinutes: 60, awakeOnly: true } }],
    action: () => ['actions', { id: newId('act'), name: 'Thing', label: 'Do something', icon: '✨', cost: 0, minutes: 30, tags: ['leisure'], effects: {} }],
    job: () => ['occupations', { id: newId('job'), name: 'New job', place: W().places.find(p => !p.link)?.id ?? '', shift: 6, hours: [8, 18], cost: { energy: 25 }, ranks: [{ name: 'Junior', pay: 15 }, { name: 'Senior', pay: 22 }], promote: [6], likes: [], needs: [] }],
    zone: () => ['homes.zones', { id: newId('zone'), name: 'New area', map: W().maps[0]?.id ?? '', kind: Object.keys(W().homes.kinds)[0] ?? 'apartment', rent: 300, desc: '', spots: [] }],
    origin: () => ['catalogs.origins', { id: newId('origin'), name: 'New origin', desc: '', money: 1000, knows: 0 }],
    person: () => ['cast.examples', { name: 'New person', age: 25, occupation: null, home: W().homes.zones[0]?.id ?? '', routine: Object.keys(W().cast.routineTemplates)[0] ?? '', leisure: [], description: '', first_mes: '', personality: '' }],
    lore: () => ['lore', { keys: [], content: '', constant: false }],
    period: () => ['time.periods', { id: newId('p'), name: 'New period', from: 720 }],
    look: () => ['sheet.appearance', { id: newId('look'), label: 'New trait', options: [] }],
    trait: () => ['sheet.traits', { id: newId('trait'), label: 'New group', options: [] }],
};
const listKey: Record<string, string> = { 'rpg.attributes': 'rattr', 'rpg.skills': 'rskill', 'rpg.classes': 'rclass', 'rpg.schools': 'rschool', 'rpg.spells': 'rspell', 'rpg.titles': 'rtitle', 'rpg.bestiary': 'rfoe', habits: 'habit', festivals: 'festival', cityEvents: 'cevent', hobbies: 'hobby', pets: 'pet', 'realm.pantheon': 'god', factions: 'faction', institutions: 'inst', 'rpg.talents': 'rtal', goods: 'good', recipes: 'recipe', towers: 'tower', blades: 'blade', crops: 'crop', businesses: 'biz', 'skies.events': 'sky', 'skies.hazards': 'hazard', 'catalogs.shop': 'shop', 'homes.breakables': 'breakables', 'catalogs.courses': 'courses', 'homes.expenses': 'expenses', statuses: 'needs', actions: 'actions', occupations: 'jobs', 'homes.zones': 'zones', 'catalogs.origins': 'origins', 'cast.examples': 'people', lore: 'lore' };

Object.assign(ACT, {
    'cw-rpg-preset': (el) => {
        const id = el.dataset.v === 'medieval' ? 'classic' : el.dataset.v === 'modern' ? 'martial' : el.dataset.v;
        const x = rpgSystemList().find(k => k.id === id); if (!x) return;
        W().rpg = structuredClone(x.def); CW.rpgSwap = ''; CW.dirty = true; notify();
    },
    'cw-rpg-swap': (el) => { CW.rpgSwap = el.dataset.v ?? ''; notify(); },
    'cw-rpg-swap-no': () => { CW.rpgSwap = ''; notify(); },
    'cw-rpg-keep': () => {
        const r = W().rpg; if (!r) return;
        const name = (r.name || `${W().name} RPG`).trim();
        const list = (settings().rpgSystems ??= []);
        const id = `mine_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
        const row = { id, name, desc: `Saved from ${W().name}: ${r.classes.map(c => c.name).join(', ')}.`, def: structuredClone({ ...r, name }) };
        const i = list.findIndex(x => x.id === id); if (i >= 0) list[i] = row; else list.push(row);
        saveSettings(); toast(`Saved "${name}": you can choose it when starting a game in any world.`, 'success');
    },
    'cw-rpg-empty': () => { W().rpg = { attributes: [], hpAttr: '', skills: [], classes: [], xp: [100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500, 5500, 6600], schools: [], spells: [], titles: [] }; CW.dirty = true; notify(); },
});
Object.assign(ACT, {
    'cw-start-style': (el) => {
        const st = STYLES.find(x => x.id === el.dataset.id); if (!st?.ready || !CW.start) return;
        const p = presetsOf(st.id, !!CW.start.scenario)[0] ?? presetsOf(st.id)[0]; if (!p) return;
        Object.assign(CW.start, { style: st.id, base: p.id, mode: 'copy' }); setWorldDicts(p.id, p.i18n ?? {}); notify();
    },
    'cw-start-preset': (el) => { const w = getWorld(el.dataset.id!); if (!w || !CW.start) return; Object.assign(CW.start, { base: w.id, mode: 'copy' }); setWorldDicts(w.id, w.i18n ?? {}); notify(); },
    'cw-start-type': (el) => { const s = CW.start; if (!s) return; s.scenario = !!el.dataset.v; s.base = presetsOf(s.style, s.scenario)[0]?.id ?? s.base; s.mode = 'copy'; notify(); },
    'cw-start-game': (el) => { if (!CW.start || GAME_MODES.find(m => m.id === el.dataset.v)?.soon) return; CW.start.game = el.dataset.v as GameMode; notify(); },
    'cw-mode': (el) => { const w = CW.w; if (!w || GAME_MODES.find(m => m.id === el.dataset.v)?.soon) return; const auto = (m?: GameMode): 'lifesim' | 'rpg' => (m === 'rpg' ? 'rpg' : 'lifesim'); const next = el.dataset.v as GameMode; if (w.madeFor === undefined || w.madeFor === auto(w.mode)) w.madeFor = auto(next); w.mode = next; CW.dirty = true; notify(); },
    'cw-start-empty': () => { if (!CW.start) return; CW.start.mode = 'empty'; CW.start.base = presetsOf(CW.start.style, !!CW.start.scenario).find(w => !isCustom(w.id))?.id ?? CW.start.base; notify(); },
    'cw-start-lore': () => { if (!CW.start) return; CW.start.mode = 'lore'; CW.start.base = presetsOf(CW.start.style, false).find(w => !isCustom(w.id))?.id ?? CW.start.base; notify(); },
    'cw-start-cancel': () => close(),
    'cw-start-go': async () => {
        const s = CW.start!;
        // no name yet: point at the name field instead of doing nothing
        if (!s.name.trim()) { CW.nameMiss = true; notify(); setTimeout(() => { const i = document.querySelector<HTMLInputElement>('[data-input="cw-start-name"]'); i?.focus(); i?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 30); return; }
        if (s.mode === 'lore') { openFromLore(s); return; }
        try {
            CW.w = await busy('Creating the world', () => newWorldFrom(s.base, s.mode as 'copy' | 'empty', s.name));
            CW.w.mode = s.scenario ? 'lifesim' : s.game;
            if (s.scenario && !CW.w.scenario) CW.w.scenario = { premise: '' };
            CW.start = null; CW.tab = 'general'; CW.dirty = true; CW.confirmDel = false;
            await saveDraft();
        } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        notify();
    },
    'cw-dup': async () => {
        const w = CW.w; if (!w) return;
        if (CW.dirty) { toast('Save your changes first, then duplicate.', 'warn'); return; }
        try {
            const copy = await busy('Duplicating', () => newWorldFrom(w.id, 'copy', `${w.name} (copy)`));
            copy.mode = w.mode; copy.madeFor = w.madeFor;
            await saveWorld(copy);
            CW.w = copy; CW.tab = 'general'; CW.dirty = false; CW.confirmDel = false;
            toast(`"${copy.name}" created. You are editing the copy now.`, 'success');
        } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        notify();
    },
    'cw-close': () => { if (CW.dirty) { CW.leaveAsk = true; notify(); return; } close(); },
    'cw-leave-stay': (el, e) => { if (e && el.classList.contains('mu-dlg-veil') && e.target !== el) return; CW.leaveAsk = false; notify(); },
    'cw-leave-go': () => { CW.dirty = false; close(); },
    'cw-leave-save': async () => { CW.leaveAsk = false; await saveDraft(); if (!CW.dirty) close(); else notify(); },
    'cw-tab': (el) => { CW.tab = el.dataset.tab as Tab; notify(); },
    'cw-pick': (el) => { CW.sel[el.dataset.k!] = Number(el.dataset.i); notify(); },
    'cw-routine': (el) => { CW.sel.routine = el.dataset.id; notify(); },
    'cw-add': (el) => {
        const what = el.dataset.what!; const w = W();
        if (what === 'rank') { (getPath(el.dataset.path!) as any[]).push({ name: 'New rank', pay: 20 }); CW.dirty = true; notify(); return; }
        if (what === 'etie') { const e = w.cast.examples[Number(el.dataset.i)]; const other = w.cast.examples.find(x => x.name !== e?.name); if (!e || !other) return; (e.ties ??= []).push({ to: other.name, type: 'friend', tone: 'good' }); CW.dirty = true; notify(); return; }
        if (what === 'rsub') { (getPath(el.dataset.path!) as any[]).push({ id: newId('sub'), name: 'New subclass', desc: '' }); CW.dirty = true; notify(); return; }
        if (what === 'boption') { (getPath(el.dataset.path!) as any[]).push({ id: newId('path'), name: 'New path', ranks: [{ name: 'New rank', pay: 30 }] }); CW.dirty = true; notify(); return; }
        if (what === 'branch') {
            const list = (getPath(el.dataset.path!) ?? (setPath(el.dataset.path!, []), getPath(el.dataset.path!))) as any[];
            const at = list.length ? Math.max(...list.map((b: any) => b.at)) + 3 : 3;
            list.push({ at, options: [{ id: newId('path'), name: 'Path A', ranks: [{ name: 'New rank', pay: 30 }] }, { id: newId('path'), name: 'Path B', ranks: [{ name: 'New rank', pay: 30 }] }] });
            CW.dirty = true; notify(); return;
        }
        if (what === 'step') { (getPath(el.dataset.path!) as any[]).push([12, 'leisure']); CW.dirty = true; notify(); return; }
        if (what === 'routine') { const id = `routine${Object.keys(w.cast.routineTemplates).length + 1}`; w.cast.routineTemplates[id] = { weekday: [[0, 'home'], [9, 'work'], [18, 'leisure'], [22, 'home']], weekend: [[0, 'home'], [11, 'leisure'], [22, 'home']] }; CW.sel.routine = id; CW.dirty = true; notify(); return; }
        if (what === 'kind') { w.homes.kinds[newId('kind')] = { name: 'New kind', desc: '' }; CW.dirty = true; notify(); return; }
        const [path, item] = NEW[what]();
        const list = (getPath(path) ?? (setPath(path, []), getPath(path))) as any[];
        list.push(item);
        if (listKey[path]) CW.sel[listKey[path]] = list.length - 1;
        CW.dirty = true; notify();
    },
    'cw-del': (el) => {
        const path = el.dataset.path!; const keys = path.split('.'); const last = keys.pop()!;
        const parent = getPath(keys.join('.'));
        if (Array.isArray(parent)) parent.splice(Number(last), 1); else if (parent) delete parent[last];
        CW.dirty = true; notify();
    },
    // a link between a course and a job or a skill (see tabCourses)
    'cw-crel': (el) => {
        const w = W(); const c = ((w.catalogs as any).courses ?? [])[Number(el.dataset.i)]; if (!c) return;
        const id = el.dataset.id!; const g: string[] = c.grants ?? [];
        const toggle = (l: string[], items: string[], on: boolean) => { const out = l.filter(x => !items.includes(x)); return on ? [...out, ...items] : out; };
        if (el.dataset.kind === 'req') { const o: any = w.occupations.find(x => x.id === id); if (!o) return; const l: string[] = o.courses ?? []; o.courses = l.includes(c.id) ? l.filter(x => x !== c.id) : [...l, c.id]; }
        else if (!g.length) return;
        else if (el.dataset.kind === 'job') { const o = w.occupations.find(x => x.id === id); if (!o) return; const on = !g.every(t => (o.likes ?? []).includes(t)); o.likes = toggle(o.likes ?? [], g, on); }
        else { const a = w.actions.find(x => x.id === id); if (!a?.roll) return; const on = !g.every(t => (a.roll!.traits ?? []).includes(t)); a.roll.traits = toggle(a.roll.traits ?? [], g, on); }
        CW.dirty = true; notify();
    },
    'cw-chip': (el) => {
        const l: string[] = getPath(el.dataset.path!) ?? []; const v = el.dataset.v!; const i = l.indexOf(v);
        i >= 0 ? l.splice(i, 1) : l.push(v);
        setPath(el.dataset.path!, l); notify();
    },
    'cw-cover': async () => { const f = await pickFile('image/*'); if (!f) return; try { W().cover = await uploadWorldPicture(W(), f, 'cover'); CW.dirty = true; } catch (e: any) { toast(String(e?.message ?? e), 'error'); } notify(); },
    'cw-cover-map': () => { W().cover = W().maps[0]?.image; CW.dirty = true; notify(); },
    'cw-cover-room': (el) => { W().cover = el.dataset.file || undefined; CW.dirty = true; notify(); },
    'cw-cover-clear': () => { W().cover = undefined; CW.dirty = true; notify(); },
    'cw-kind-img': async (el) => {
        const f = await pickFile('image/*'); if (!f) return;
        const k = W().homes.kinds[el.dataset.id!], per = el.dataset.period;
        try { const url = await uploadWorldPicture(W(), f, `home-${el.dataset.id}${per ? `-${per}` : ''}`); if (per) (k.images ??= {})[per] = url; else k.image = url; CW.dirty = true; } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        notify();
    },
    'cw-kind-img-clear': (el) => { const k = W().homes.kinds[el.dataset.id!]; if (!k?.images) return; delete k.images[el.dataset.period!]; if (!Object.keys(k.images).length) delete k.images; CW.dirty = true; notify(); },
    'cw-homes-map': (el) => { const z = W().homes.zones[Number(el.dataset.i)]; if (!z) return; CW.tab = 'maps'; ME.map = z.map || W().maps[0]?.id || ''; ME.mode = 'homes'; ME.zone = z.id; notify(); },
    'cw-rnd-all': () => { const w = W(); w.cast.examples.forEach(e => randomizePerson(w, e)); CW.dirty = true; toast('Everyone got a new job, home and routine.', 'success'); notify(); },
    'cw-rnd-person': (el) => { const w = W(); const e = w.cast.examples[Number(el.dataset.i)]; if (e) randomizePerson(w, e); CW.dirty = true; notify(); },
    'cw-rnd-routine': () => { CW.sel.routine = randomRoutine(W()); CW.dirty = true; notify(); },
    'cw-rnd-job': (el) => { const w = W(); const o = w.occupations[Number(el.dataset.i)]; if (o) randomizeJob(w, o); CW.dirty = true; notify(); },
    'cw-book': (el) => { const w = W(); const l = (w.lorebooks ??= []); const n = el.dataset.name!; const i = l.indexOf(n); i >= 0 ? l.splice(i, 1) : l.push(n); CW.dirty = true; notify(); },
    'cw-save': () => saveDraft(),
    'cw-export': async () => {
        const w = W();
        try {
            const blob = await busy('Exporting', () => exportWorld(w));
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${slug(w.name)}.mundi-world.json`; a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
    },
    'cw-delete': () => { CW.confirmDel = true; notify(); },
    'cw-delete-no': () => { CW.confirmDel = false; notify(); },
    'cw-delete-yes': async () => { const id = W().id; await busy('Deleting', () => deleteWorld(id)); toast('World deleted. Games made with it can no longer be opened.', 'info'); CW.dirty = false; close(); },
});

async function saveDraft() {
    const w = CW.w; if (!w || CW.saving) return;
    CW.saving = true; notify();
    try { await saveWorld(w); CW.dirty = false; toast('World saved.', 'success'); }
    catch (e: any) { toast(String(e?.message ?? e), 'error'); }
    CW.saving = false; notify();
}

// Import: a world exported from Mundi (pictures included).
export async function importWorldFile() {
    const f = await pickFile('.json,application/json'); if (!f) return null;
    try { const w = await busy('Importing the world', async () => importWorld(await f.text())); toast(`“${w.name}” imported.`, 'success'); return w; }
    catch (e: any) { toast(String(e?.message ?? e), 'error'); return null; }
}

Object.assign(INPUT, {
    'cw-words-q': (el) => { WORDS.q = el.value; notify(); },
    'cw-alltabs': (el) => { CW.allTabs = (el as HTMLInputElement).checked; notify(); },
    cw: (el) => {
        const t = el.dataset.type; const p = el.dataset.path!;
        let v: any = el.value;
        if (t === 'num') v = el.value === '' ? undefined : Number(el.value);
        else if (t === 'bool') v = el.checked;
        else if (t === 'nbool') v = el.checked ? undefined : false;
        else if (t === 'tri') v = el.value === '' ? undefined : el.value === 'true';
        else if (t === 'nullable') v = el.value === '' ? null : el.value;   // a choice where empty means none (no job)
        else if (p.includes('.when.') && el.value === '') v = undefined;
        else if (t === 'time') { const [h, m] = el.value.split(':').map(Number); v = (h || 0) * 60 + (m || 0); }
        else if (t === 'csv') v = el.value.split(',').map((x: string) => x.trim()).filter(Boolean);
        // switching a block on or off (decay, zero, rent)
        if (t === 'bool' && /(\.decay|\.zero|\.crisis|^rent)$/.test(p)) v = el.checked ? (p === 'rent' ? { everyDays: 7, text: 'Rent: {cost}.' } : p.endsWith('crisis') ? { after: 120, text: '', restore: 25 } : p.endsWith('decay') ? { amount: 1, everyMinutes: 60, awakeOnly: true } : { text: '', restore: 30 }) : undefined;
        // optional parts: empty removes them; picking one fills the rest
        if (/\.(socket\.slot|inflict\.kind)$/.test(p)) {
            const base = p.replace(/\.(slot|kind)$/, '');
            if (v === '') { setPath(base, undefined); notify(); return; }
            if (!getPath(base)) setPath(base, p.endsWith('slot') ? { slot: v, kind: v === 'armor' ? 'armor' : 'attack', amount: 1 } : { kind: v, chance: 0.3, turns: 3 });
        }
        if (/\.(element|combat)$/.test(p) && v === '') v = undefined;
        setPath(p, v);
        if (el.tagName !== 'INPUT' || ['checkbox', 'color', 'time'].includes(el.type)) notify();
        else { const top = document.querySelector('.mu-creator-ed .mu-subhead small'); if (top && !top.textContent?.endsWith('•')) top.textContent = `${W().name} •`; }
    },
    'cw-where': (el) => {
        const a = W().actions[Number(el.dataset.i)]; if (!a) return;
        delete a.anywhere; delete a.home; delete a.place;
        if (el.value === 'anywhere') { a.anywhere = true; a.tags = []; } else if (el.value === 'home') { a.home = true; a.tags = []; } else if (el.value === 'place') { a.place = W().places.find(p => !p.link)?.id; a.tags = []; } else a.tags ??= [];
        CW.dirty = true; notify();
    },
    'cw-start-name': (el) => { CW.start!.name = el.value; document.querySelector('[data-act="cw-start-go"]')?.classList.toggle('is-dim', !el.value.trim()); if (CW.nameMiss && el.value.trim()) { CW.nameMiss = false; el.closest('.mu-cw-new-name')?.classList.remove('is-missing'); el.parentElement?.querySelector('.mu-miss-note')?.remove(); } },
});
export const _tr = tr;
