// More things to do on screen (the rules are in sim/moreacts.ts): wound care, a locked place's door, asking and
// looking around for hidden places, a breather in a gate, selling what you found, a room at an inn, waiting, and
// where the people you know are. Rows for the "Things to do" list, and the small dialogs some of them open.
import { esc, game, notify, saveGame, toast, state, type Save } from '../core/store.js';
import { getWorld, systemOn, type WorldDef } from '../core/world.js';
import { ACT } from './reg.js';
import { icon } from './icons.js';
import { setPrompt } from '../st/bridge.js';
import { doing, isDoing } from './doing.js';
import { runPlans } from './plans.js';
import { syncScene } from '../sim/game.js';
import { advance } from '../sim/time.js';
import { money } from '../sim/needs.js';
import { social } from '../sim/social.js';
import { stayOf } from './events.js';
import { placeOf, lockedNow, hiddenNow, floorName, travelMinutes, buildingOf } from '../sim/places.js';
import { waiting } from '../sim/discovery.js';
import { isMarket, carried } from '../sim/economy.js';
import { inCombat } from '../sim/combat.js';
import {
    triedToday, hurtNow, supplies, healerHere, medicWithYou, treatCost, bandageChance, bandage, treatment,
    doorsNear, passFor, knockTry, sneakTry, chance, knock, showPass, sneak,
    canAsk, canLook, askTry, lookTry, askAround, lookAround, breathHere, catchBreath,
    innHere, roomPrice, rentRoom, waitHere, whereabouts,
} from '../sim/moreacts.js';

const S = () => { const g = game(); const w = g && getWorld(g.world); return g && w ? { g, w } : null; };
const MO = { door: '', wait: false, look: false };
const row = (act: string, ic: string, title: string, small: string, extra = '') => `<button class="mh-act mh-glass" data-act="${esc(act)}" ${extra}><i>${ic}</i><b>${title}</b><small>${small}</small></button>`;

/* ---------- rows ---------- */

/** Wounds: dress them (with supplies you carry), get treated (a healer here, or a trained companion with you). */
export function careActs(g: Save, w: WorldDef): string {
    if (!hurtNow(g, w)) return '';
    const out: string[] = [];
    const sup = supplies(g, w)[0];
    if (sup && !triedToday(g, 'bandage')) out.push(row('mo-bandage', '🩹', 'Dress your wounds', `${esc(sup.name)} · 20 min · 🎲 ${bandageChance(g, w)}%`));
    if (!triedToday(g, 'treated')) {
        if (healerHere(g, w)) out.push(row('mo-treat', '⚕️', 'Get treated', `${money(w, treatCost(g, w))} · 2 h`, g.player.money < treatCost(g, w) ? 'aria-disabled="true" title="Not enough money"' : ''));
        else { const m = medicWithYou(g, w); if (m) out.push(row('mo-treat', '⚕️', 'Get treated', `by ${esc(m.name)} · 45 min`)); }
    }
    return out.join('');
}
/** The locked doors near you (this building's locked floors, locked places next door). */
export function doorActs(g: Save, w: WorldDef): string {
    if (inCombat(g)) return '';
    const bid = buildingOf(g, w, g.player.loc);
    return doorsNear(g, w).map(p => row('mo-door', '🚪', `At the door: <span data-notr>${esc(floorName(p))}</span>`,
        `${esc(lockedNow(g, w, p))} · ${bid && (p.in === bid || p.id === bid) ? 'in this building' : 'next door'}`, `data-id="${esc(p.id)}"`)).join('');
}
/** Hidden places (only in a world that still keeps some from you): ask the people here, or look around. */
export function findActs(g: Save, w: WorldDef): string {
    if (inCombat(g) || !waiting(g, w).some(p => hiddenNow(g, w, p))) return '';
    const out: string[] = [];
    if (canAsk(g, w) && !triedToday(g, `ask:${g.player.loc}`)) out.push(row('mo-ask', '🗣️', 'Ask around', `Places people know of · 30 min · 🎲 ${chance(g, w, askTry(g, w))}%`));
    if (canLook(g, w) && !triedToday(g, `look:${g.player.loc}`)) out.push(row('mo-look', '🔎', 'Look around', `What is close by · 20 min · 🎲 ${chance(g, w, lookTry(g, w))}%`));
    return out.join('');
}
/** A gate between floors: a breather; a market: sell what you carry. */
export function gearActs(g: Save, w: WorldDef): string {
    const out: string[] = [];
    if (!inCombat(g) && breathHere(g, w)) out.push(row('mo-breath', '😮‍💨', 'Catch your breath', 'Energy only · 15 min'));
    if (systemOn(w, 'trade') && isMarket(g, w) && carried(g) > 0) out.push(row('hd-open-app', '💰', 'Sell what you found', `${carried(g)} in your bag`));
    return out.join('');
}
/** An inn or a hotel: a room for the night (then "Sleep until morning" shows here). */
export function roomActs(g: Save, w: WorldDef): string {
    if (!innHere(g, w)) return '';
    const s = stayOf(g); if (s && s.where === g.player.loc && s.day >= g.day - 1) return '';
    return row('mo-room', '🛏️', 'Rent a room', `${money(w, roomPrice(g, w))} · for the night`, g.player.money < roomPrice(g, w) ? 'aria-disabled="true" title="Not enough money"' : '');
}
/** Wait here; where someone you know usually is now. */
export function waitActs(g: Save, w: WorldDef): string {
    if (inCombat(g)) return '';
    const out = [row('mo-wait', '⏳', 'Wait here', 'A while, or until someone comes')];
    if (Object.values(g.cast).some(r => r.met)) out.push(row('mo-find', '🧭', 'Look for someone', 'Where they usually are now'));
    void w;
    return out.join('');
}

/* ---------- dialogs ---------- */

function doorHtml(g: Save, w: WorldDef): string {
    const p = MO.door ? placeOf(g, w, MO.door) : null;
    if (!p || !lockedNow(g, w, p)) return '';
    const pass = passFor(g, w, p);
    const kt = triedToday(g, `knock:${p.id}`), st = triedToday(g, `sneak:${p.id}`);
    return `<div class="mu-recap-veil" data-act="mo-close-veil"><section class="mu-recap mh-glass mu-audience" role="dialog" aria-label="${esc(floorName(p))}">
        <header><small>At the door</small><h3 data-notr>${esc(floorName(p))}</h3></header><p>${icon('lock')} ${esc(lockedNow(g, w, p))}</p>
        <div class="mu-work-modes">
            <button class="mu-work-mode" data-act="mo-knock" ${kt ? 'aria-disabled="true"' : ''}><b>Knock and ask to be let in</b><small>${kt ? 'They turned you away today' : `For this visit · 🎲 ${chance(g, w, knockTry(g, w, p))}%`}</small></button>
            ${pass ? `<button class="mu-work-mode" data-act="mo-pass"><b>Show your ${esc(pass.name.toLowerCase())}</b><small>Open to you from now on</small></button>` : ''}
            <button class="mu-work-mode" data-act="mo-sneak" ${st ? 'aria-disabled="true"' : ''}><b>Sneak in</b><small>${st ? 'They are watching too closely today' : `If you are caught: trespassing · 🎲 ${chance(g, w, sneakTry(g, w, p))}%`}</small></button>
            <button class="mu-work-mode" data-act="mo-close"><b>Leave it</b></button></div></section></div>`;
}
function waitHtml(): string {
    if (!MO.wait) return '';
    return `<div class="mu-recap-veil" data-act="mo-close-veil"><section class="mu-recap mh-glass mu-audience" role="dialog" aria-label="Wait here">
        <header><small>Things to do</small><h3>Wait here</h3></header>
        <div class="mu-work-modes">
            <button class="mu-work-mode" data-act="mo-wait-go" data-v="30"><b>Half an hour</b></button>
            <button class="mu-work-mode" data-act="mo-wait-go" data-v="60"><b>An hour</b></button>
            <button class="mu-work-mode" data-act="mo-wait-go" data-v="someone"><b>Until someone comes</b><small>Three hours at most</small></button>
            <button class="mu-work-mode" data-act="mo-close"><b>Never mind</b></button></div></section></div>`;
}
function findHtml(g: Save, w: WorldDef): string {
    if (!MO.look) return '';
    const list = whereabouts(g, w);
    return `<div class="mu-recap-veil" data-act="mo-close-veil"><section class="mu-recap mh-glass mu-audience" role="dialog" aria-label="Look for someone">
        <header><small>About now</small><h3>Where they usually are</h3></header>
        <div class="mu-floors" data-keep="whereabouts">${list.map(x => `<div class="mu-lp-row"><b data-notr>${esc(x.name)}</b><small data-notr>${esc(x.where)}</small>${x.go ? `<button class="mu-primary" data-act="mo-find-go" data-loc="${esc(x.place)}">Go · ${travelMinutes(g, w, g.player.loc, x.place)} min</button>` : ''}</div>`).join('') || '<p class="mu-muted">Nobody you know yet.</p>'}</div>
        <div class="mu-row"><button class="mu-ghost" data-act="mo-close">Close</button></div></section></div>`;
}
export function moreHtml(): string {
    const c = S(); if (!c) return '';
    return `${doorHtml(c.g, c.w)}${waitHtml()}${findHtml(c.g, c.w)}`;
}

/* ---------- doing it ---------- */

const close = () => { MO.door = ''; MO.wait = false; MO.look = false; };
// Time passes on screen, then the result; the AI hears what happened (`story`), to tell it if it comes up.
async function finish(label: string, ic: string, minutes: number, text: string, ok: boolean, story = '', more: string[] = []) {
    const c = S(); if (!c) return;
    if (minutes > 0) { await doing(label, ic, minutes); advance(c.g, c.w, minutes).forEach(m => toast(m, 'warn')); }
    if (text) toast(text, ok ? 'success' : 'info');
    more.forEach(m => toast(m, 'warn'));
    runPlans(); saveGame(); await syncScene();
    if (story && state.view === 'scene') setPrompt('mundi_roll', `[Just now: ${story} Narrate it in that light if it comes up.]`);
    notify();
}
const goIn = (loc: string) => { const el = document.createElement('button'); el.dataset.loc = loc; return ACT.go?.(el, new Event('click')); };
Object.assign(ACT, {
    'mo-bandage': async () => { const c = S(); if (!c || isDoing()) return; const r = bandage(c.g, c.w); await finish('Dressing your wounds', '🩹', r.minutes, r.text, r.ok, r.minutes ? `{{user}} dressed their own wounds. ${r.text}` : ''); },
    'mo-treat': async () => { const c = S(); if (!c || isDoing()) return; const r = treatment(c.g, c.w); await finish('Being treated', '⚕️', r.minutes, r.text, r.ok, r.minutes ? `{{user}} had their wounds treated. ${r.text}` : ''); },
    'mo-door': (el) => { MO.door = el.dataset.id ?? ''; notify(); },
    'mo-close': () => { close(); notify(); },
    'mo-close-veil': (el, e) => { if (e && (e.target as HTMLElement) === el) { close(); notify(); } },
    'mo-knock': async () => {
        const c = S(); const id = MO.door; if (!c || !id || isDoing()) return; close();
        const r = knock(c.g, c.w, id); await finish('Knocking', '🚪', r.minutes, r.text, r.inside, r.story);
        if (r.inside) await goIn(id);
    },
    'mo-pass': async () => {
        const c = S(); const id = MO.door; if (!c || !id || isDoing()) return; close();
        const r = showPass(c.g, c.w, id); await finish('Showing your pass', '🎫', r.minutes, r.text, r.inside, r.story);
        if (r.inside) await goIn(id);
    },
    'mo-sneak': async () => {
        const c = S(); const id = MO.door; if (!c || !id || isDoing()) return; close();
        const r = sneak(c.g, c.w, id); await finish('Sneaking', '🤫', r.minutes, r.text, r.inside, r.story, r.caught ?? []);
        if (r.inside) await goIn(id);
    },
    'mo-ask': async () => { const c = S(); if (!c || isDoing()) return; const r = askAround(c.g, c.w); await finish('Asking around', '🗣️', r.minutes, r.text, !!r.found, r.story); },
    'mo-look': async () => { const c = S(); if (!c || isDoing()) return; const r = lookAround(c.g, c.w); await finish('Looking around', '🔎', r.minutes, r.text, !!r.found, r.story); },
    'mo-breath': async () => { const c = S(); if (!c || isDoing()) return; const r = catchBreath(c.g, c.w); await finish('Catching your breath', '😮‍💨', r.minutes, r.text, true); },
    'mo-room': () => { const c = S(); if (!c) return; const m = rentRoom(c.g, c.w, social(c.g)); if (m) toast(m, /You take/.test(m) ? 'success' : 'warn'); saveGame(); notify(); },
    'mo-wait': () => { MO.wait = true; notify(); },
    'mo-wait-go': async (el) => {
        const c = S(); if (!c || isDoing()) return; close(); notify();
        const v = el.dataset.v === 'someone' ? 'someone' : Number(el.dataset.v) || 30;
        const r = waitHere(c.g, c.w, v);
        await doing('Waiting', '⏳', r.minutes);
        r.msgs.forEach(m => toast(m, 'warn'));
        toast(v === 'someone' ? (r.who ? `${r.who} comes by.` : 'Nobody comes.') : 'Time passes.', 'info');
        runPlans(); saveGame(); await syncScene(); notify();
    },
    'mo-find': () => { MO.look = true; notify(); },
    'mo-find-go': async (el) => { const loc = el.dataset.loc ?? ''; close(); notify(); if (loc) await goIn(loc); },
});
