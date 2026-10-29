// Places that open up as the story goes, on screen: a building's floors (one pin on the map; its floors stacked,
// the top one first, like the buttons of a lift), "Add a place we just found", and the HUD buttons of gates.
import { esc, game, notify, saveGame, toast, state } from '../core/store.js';
import { getWorld, type WorldDef, type Place } from '../core/world.js';
import type { Save } from '../core/store.js';
import { ACT, INPUT } from './reg.js';
import { icon } from './icons.js';
import { thumb, setPrompt } from '../st/bridge.js';
import { refreshPrompt } from '../sim/prompt.js';
import { presentAt } from '../sim/people.js';
import { placeOf, floorsOf, buildingOf, floorName, lockedNow, hiddenNow, travelMinutes } from '../sim/places.js';
import { addFound, describeFound, unlock, waiting, rulesText } from '../sim/discovery.js';
import { gatesOn, gateAt, looseAt, enterGate, leaveGate, fightLoose, RANKS } from '../sim/gates.js';
import { sheetOf } from '../sim/rpg.js';

const S = () => { const g = game(); const w = g && getWorld(g.world); return g && w ? { g, w } : null; };
export const BLD = { id: '' };
const ADD = { open: false, name: '', floor: '', inside: false, spoil: false };

const faces = (g: Save, w: WorldDef, loc: string) => { const here = presentAt(g, w, loc); return here.length ? `<span class="faces">${here.slice(0, 4).map(r => `<img src="${esc(thumb(r.avatar))}" alt="" title="${esc(r.met ? r.name : 'Someone')}">`).join('')}${here.length > 4 ? `<i>+${here.length - 4}</i>` : ''}</span>` : ''; };

/** Opens a building's floors (on the map, or from its scene). */
export function openBuilding(id: string) { BLD.id = id; notify(); }

// The floors of a building: the top one first, the building itself (its entrance) at the bottom.
function buildingHtml(g: Save, w: WorldDef): string {
    const b = BLD.id ? placeOf(g, w, BLD.id) : null;
    if (!b) return '';
    const rows = [...floorsOf(g, w, b.id)].reverse().concat([b]);
    const row = (p: Place) => {
        const you = p.id === g.player.loc; const lock = lockedNow(g, w, p);
        const label = p.id === b.id ? 'Entrance' : p.floor || 'Floor';
        return `<div class="mu-floor-row ${you ? 'is-you' : ''} ${lock ? 'is-locked' : ''}"><em data-notr>${esc(label)}</em>
            <span><b data-notr>${esc(p.name)}</b>${lock ? `<small>${icon('lock')} ${esc(lock)}${p.opens ? ` · opens with: ${esc(rulesText(g, w, p.opens))}` : ''}</small>` : p.desc ? `<small data-notr>${esc(p.desc)}</small>` : ''}</span>
            ${faces(g, w, p.id)}
            ${you ? `<i class="mu-badge">${icon('pin')} You</i>` : lock ? `<button class="mu-ghost" data-act="dv-open" data-id="${esc(p.id)}" title="When the story has let you in">Let me in</button>` : `<button class="mu-primary" data-act="dv-go" data-loc="${esc(p.id)}">Go · ${travelMinutes(g, w, g.player.loc, p.id)} min</button>`}</div>`;
    };
    return `<div class="mu-recap-veil" data-act="dv-bld-veil"><section class="mu-recap mh-glass mu-building" role="dialog" aria-label="${esc(b.name)}">
        <header><small>Floors</small><h3 data-notr>${esc(b.name)}</h3></header>
        <div class="mu-floors" data-keep="floors">${rows.map(row).join('')}</div>
        <div class="mu-row"><button class="mu-ghost" data-act="dv-add" data-inside="1">${icon('plus')}<span>Add a floor we just found</span></button><button class="mu-ghost" data-act="dv-bld-close">Close</button></div></section></div>`;
}

// "Add a place we just found": a name (and a floor, inside a building); the AI writes its line from the story.
function addHtml(g: Save, w: WorldDef): string {
    if (!ADD.open) return '';
    const here = placeOf(g, w, g.player.loc); const bid = buildingOf(g, w, g.player.loc) || (here && !here.home && !here.link ? here.id : '');
    const b = bid ? placeOf(g, w, bid) : null;
    const left = waiting(g, w);
    return `<div class="mu-recap-veil"><section class="mu-recap mh-glass mu-addplace" role="dialog" aria-label="Add a place">
        <header><small>Your map</small><h3>Add a place we just found</h3></header>
        <div class="mu-addplace-body" data-keep="addplace">
            <p class="mu-muted">A place the story just gave you (an address, a hideout, a room you were shown). It goes on the map ${b ? `next to ${esc(b.name)}` : 'next to where you are'}, in this game only; the AI writes what it is from the story.</p>
            <label class="mu-field"><span>Name</span><input data-input="dv-name" value="${esc(ADD.name)}" placeholder="Cha Hae-In's apartment" maxlength="60"></label>
            ${b ? `<label class="mu-check"><input type="checkbox" data-input="dv-inside" ${ADD.inside ? 'checked' : ''}><span>It is a floor of ${esc(b.name)}<small>One pin on the map; its floors open from it.</small></span></label>
                ${ADD.inside ? `<label class="mu-field"><span>Which floor</span><input data-input="dv-floor" value="${esc(ADD.floor)}" placeholder="Floor ${floorsOf(g, w, b.id).length + 2}" maxlength="30"></label>` : ''}` : ''}
            ${left.length ? `<details ${ADD.spoil ? 'open' : ''}><summary data-act="dv-spoil">Or is it one the world keeps hidden? (spoilers)</summary>
                ${left.map(p => `<div class="mu-lp-row"><b data-notr>${esc(floorName(p))}</b><small>${hiddenNow(g, w, p) ? 'not on your map' : ''}${hiddenNow(g, w, p) && lockedNow(g, w, p) ? ' · ' : ''}${lockedNow(g, w, p) ? esc(lockedNow(g, w, p)) : ''}</small>
                    ${hiddenNow(g, w, p) ? `<button class="mu-ghost" data-act="dv-find" data-id="${esc(p.id)}">Found it</button>` : ''}${lockedNow(g, w, p) ? `<button class="mu-ghost" data-act="dv-open" data-id="${esc(p.id)}">Let me in</button>` : ''}</div>`).join('')}</details>` : ''}
        </div>
        <div class="mu-row"><button class="mu-primary" data-act="dv-add-go" ${ADD.name.trim() ? '' : 'aria-disabled="true"'} data-inside="${ADD.inside && b ? esc(b.id) : ''}">${icon('pin')}<span>Add it to the map</span></button><button class="mu-ghost" data-act="dv-add-close">Cancel</button></div></section></div>`;
}

export function discoveryHtml(): string {
    const c = S(); if (!c) return '';
    return `${buildingHtml(c.g, c.w)}${addHtml(c.g, c.w)}`;
}

// HUD (inside a scene): the floors of the building you are in; the gate here; monsters loose here.
export function discoveryActs(g: Save, w: WorldDef): string {
    const out: string[] = [];
    const bid = buildingOf(g, w, g.player.loc);
    if (bid) out.push(`<button class="mh-act mh-glass" data-act="dv-bld" data-id="${esc(bid)}"><i>🛗</i><b>Other floors</b><small data-notr>${esc(placeOf(g, w, bid)?.name ?? '')}</small></button>`);
    if (gatesOn(w) && sheetOf(g)) {
        const gt = gateAt(g, g.player.loc);
        if (gt) out.push(`<button class="mh-act mh-glass is-quest" data-act="dv-gate" data-id="${esc(gt.id)}"><i>🌀</i><b>${gt.floor + 1 >= gt.floors ? 'The boss' : gt.floor ? `Floor ${gt.floor + 1}` : 'Go into the gate'}</b><small>${RANKS[gt.rank]}-rank · ${gt.floor}/${gt.floors} floors · breaks on day ${gt.breaks}</small></button>`,
            ...(gt.floor ? [`<button class="mh-act mh-glass" data-act="dv-gate-leave" data-id="${esc(gt.id)}"><i>🚪</i><b>Leave the gate</b><small>You start again from the first floor</small></button>`] : []));
        const l = looseAt(g, g.player.loc);
        if (l) out.push(`<button class="mh-act mh-glass is-warn" data-act="dv-loose"><i>👹</i><b>Fight the monsters</b><small>From a broken ${RANKS[l.rank]}-rank gate</small></button>`);
    }
    return out.join('');
}

const done = (m: string, kind: 'info' | 'success' | 'warn' = 'success') => { if (m) toast(m, kind); saveGame(); refreshPrompt(); notify(); };
Object.assign(ACT, {
    'dv-bld': (el) => openBuilding(el.dataset.id ?? ''),
    'dv-bld-close': () => { BLD.id = ''; notify(); },
    'dv-bld-veil': (el, e) => { if (e && (e.target as HTMLElement) === el) { BLD.id = ''; notify(); } },
    'dv-go': (el) => { BLD.id = ''; return ACT.go?.(el, new Event('click')); },
    'dv-open': (el) => { const c = S(); if (!c) return; const m = unlock(c.g, c.w, el.dataset.id!, { find: true, open: true }); done(m || 'It was open already.', m ? 'success' : 'info'); },
    'dv-find': (el) => { const c = S(); if (!c) return; done(unlock(c.g, c.w, el.dataset.id!, { find: true })); },
    'dv-spoil': () => { ADD.spoil = !ADD.spoil; },
    'dv-add': (el) => { Object.assign(ADD, { open: true, name: '', floor: '', inside: el.dataset.inside === '1', spoil: false }); BLD.id = ''; notify(); },
    'dv-add-close': () => { ADD.open = false; notify(); },
    'dv-add-go': async (el) => {
        const c = S(); if (!c || !ADD.name.trim() || state.busy) return;
        const name = ADD.name.trim(); const inside = el.dataset.inside || '';
        state.busy = 'Writing it down'; notify();
        let desc = '';
        try { desc = await describeFound(name); } catch { /* no AI: a place with no description */ }
        state.busy = '';
        const p = addFound(c.g, c.w, { name, desc, near: c.g.player.loc, inside, floor: ADD.floor });
        ADD.open = false;
        if (!p) { done('That place could not be added.', 'warn'); return; }
        if (state.view === 'scene') setPrompt('mundi_roll', `[{{user}} now knows the way to ${floorName(p)}.]`, 0);
        done(`New place on your map: ${floorName(p)}.`);
    },
    'dv-gate': (el) => { const c = S(); if (c) done(enterGate(c.g, c.w, el.dataset.id!), 'info'); },
    'dv-gate-leave': (el) => { const c = S(); if (c) { leaveGate(c.g, el.dataset.id!); done('You step back out of the gate.', 'info'); } },
    'dv-loose': () => { const c = S(); if (c) done(fightLoose(c.g, c.w), 'info'); },
});
Object.assign(INPUT, {
    'dv-name': (el) => { const had = !!ADD.name.trim(); ADD.name = el.value; if (had !== !!ADD.name.trim()) notify(); },
    'dv-floor': (el) => { ADD.floor = el.value; },
    'dv-inside': (el) => { ADD.inside = el.checked; notify(); },
});
