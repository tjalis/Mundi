// More things to do, for the places and systems that came later (no screens here; ui/moreacts.ts draws them):
//   - wounds (RPG): bandage them yourself, only with real supplies in your bag (a first aid kit, bandages, a salve);
//     get treated, only at a healer or hospital that is open, or by someone with you who has the training
//   - a locked place's door: knock and ask to be let in, show the pass you carry, or sneak in (caught: trespassing)
//   - hidden places: ask around (people who are here) or look around (only what is close by)
//   - a gate, between floors: catch your breath (energy only; wounds are for the healer)
//   - an inn or a hotel: rent a room for the night
//   - wait here; where someone you know usually is at this hour
// Every try at a door, a question or a search can be made once a day per place.
import { nowAbs, type Save } from '../core/store.js';
import { placeIs, isScenario, type WorldDef, type Place } from '../core/world.js';
import { rpgOf } from '../core/rpgdef.js';
import { sheetOf, isRpg, hpMax, changeHp, skillOf, skillBonus, mod, attr, prof } from './rpg.js';
import { checkMods, onHour } from './hooks.js';
import { formOf, modernish } from './mortal.js';
import { bagOf, addGood, goodDef } from './economy.js';
import { lifeOf as life, shopItems } from './life.js';
import { priceOf } from './bills.js';
import { book } from './ledger.js';
import { note } from './facts.js';
import { advance, hour } from './time.js';
import { addStatus } from './needs.js';
import { openNow } from './daynight.js';
import { presentAt, whereNow } from './people.js';
import { isWith, bondOf } from './social.js';
import { partyOf, memberKey, memberName } from './party.js';
import { traitsOf } from './work.js';
import { placeOf, lockedNow, hiddenNow, buildingOf, floorsOf, floorName, travelMinutes, playerHomeId, isHome } from './places.js';
import { discovery, unlock, waiting } from './discovery.js';
import { factionDef } from './factions.js';
import { addBounty } from './crime.js';
import { addRep } from './standing.js';
import { ailOf } from './afflictions.js';
import { gateAt, gatesOn } from './gates.js';

/* ---------- once a day ---------- */

const tries = (g: Save): Record<string, number> => ((g as any).tries ??= {});
export const triedToday = (g: Save, key: string) => tries(g)[key] === g.day;
const mark = (g: Save, key: string) => {
    const t = tries(g); t[key] = g.day;
    for (const k of Object.keys(t)) if (t[k] < g.day - 1) delete t[k];   // only today's and yesterday's are kept
};

/* ---------- a roll, in either game mode ---------- */

// RPG: a skill check (a d20 + the skill, every hurt and curse counting). Otherwise: a d20 + 2 for each trait that
// helps, −2 for very low energy or mood. `extra` moves it either way (someone you know is inside: easier).
export interface Try { skill: string; dc: number; traits: string[]; extra?: number }
function bonusOf(g: Save, w: WorldDef, t: Try): number {
    const s = sheetOf(g);
    if (isRpg(w) && s) {
        const b = skillOf(w, t.skill) ? skillBonus(w, s, t.skill) : mod(attr(s, t.skill === 'stealth' ? 'dex' : t.skill === 'persuasion' ? 'cha' : 'wis'));
        return b + checkMods.reduce((a, f) => a + f(g, w, t.skill), 0) + (t.extra ?? 0);
    }
    const mine = traitsOf(g).map(x => x.toLowerCase());
    let b = t.traits.filter(x => mine.includes(x.toLowerCase())).length * 2 + (t.extra ?? 0);
    if ((g.player.stats.energy ?? 100) <= 20) b -= 2;
    if ((g.player.stats.mood ?? 100) <= 20) b -= 2;
    return b;
}
/** The chance shown before trying (a natural 1 always fails, a natural 20 always works). */
export function chance(g: Save, w: WorldDef, t: Try): number {
    const b = bonusOf(g, w, t); let ok = 0;
    for (let d = 1; d <= 20; d++) if (d === 20 || (d > 1 && d + b >= t.dc)) ok++;
    return ok * 5;
}
export const DICE = { rnd: Math.random };
function roll(g: Save, w: WorldDef, t: Try): { ok: boolean; crit: boolean; total: number } {
    const d = 1 + Math.floor(DICE.rnd() * 20); const total = d + bonusOf(g, w, t);
    return { ok: d === 20 || (d > 1 && total >= t.dc), crit: d === 20, total };
}

/* ---------- wounds ---------- */

const MEDICAL = /bandage|first[- ]?aid|med ?kit|medkit|gauze|dressing|salve|poultice|ointment|herb|splint|suture|stitch|antiseptic|plaster|trauma kit/i;
const MAGIC = /potion|elixir|draught|tonic|philter|phial/i;
interface Supply { id: string; name: string; kind: 'good' | 'item' }
/** What you carry to dress a wound with: goods from your bag (used up) or a kit you own (kept). */
export function supplies(g: Save, w: WorldDef): Supply[] {
    const out: Supply[] = [];
    for (const [id, n] of Object.entries(bagOf(g).items)) {
        const d = goodDef(w, id); if (!d || n < 1) continue;
        if (MEDICAL.test(`${d.id} ${d.name}`) || (d.cures && d.kind === 'potion' && !MAGIC.test(d.name))) out.push({ id, name: d.name, kind: 'good' });
    }
    const items = (life(g).items ?? []) as string[];
    for (const id of items) { const name = shopItems(w).find(x => x.id === id)?.name ?? id; if (MEDICAL.test(`${id} ${name}`)) out.push({ id, name, kind: 'item' }); }
    return out;
}
/** Hurt (RPG), alive and in a body: what wound care is for. */
export function hurtNow(g: Save, w: WorldDef): boolean {
    const s = sheetOf(g);
    return isRpg(w) && !!s && s.hp > 0 && s.hp < hpMax(w, s) && !formOf(g) && !(g as any).mortal?.dead;
}
const medicTrait = /^(first aid|healer|herbalist|medic|doctor|nurse)$/i;
const medicJob = /doctor|nurse|medic|healer|paramedic|physician|surgeon|cleric|priest|apothecar|midwife/i;
/** Someone with you who can treat wounds: a companion trained in medicine, or a doctor, nurse or healer by trade. */
export function medicWithYou(g: Save, w: WorldDef): { key: string; name: string } | null {
    const r = rpgOf(w);
    for (const m of partyOf(g).members) {
        if (m.avatar && !g.cast[m.avatar]) continue;
        const c = r?.classes.find(x => x.id === m.cls);
        const trained = !!c?.skills.includes('medicine') || /heal|cleric|priest|medic|doctor|nurse/i.test(`${c?.id ?? ''} ${c?.name ?? ''}`);
        const job = m.avatar ? w.occupations.find(o => o.id === g.cast[m.avatar!]?.occupation)?.name ?? '' : '';
        if (trained || medicJob.test(job)) return { key: memberKey(m), name: memberName(g, m) };
    }
    for (const a of Object.keys(g.cast)) {
        if (!isWith(g, a)) continue;
        const job = w.occupations.find(o => o.id === g.cast[a].occupation)?.name ?? '';
        if (medicJob.test(job)) return { key: a, name: g.cast[a].name };
    }
    return null;
}
/** A healer, clinic or hospital here, open now. */
export const healerHere = (g: Save, w: WorldDef) => { const p = placeOf(g, w, g.player.loc); return !!p && !isHome(p.id) && placeIs(p, 'healer') && openNow(g, w, p.id); };
// What treatment costs: a share of a stay (the world's own price for waking up at the hospital), by how hurt you are.
export function treatCost(g: Save, w: WorldDef): number {
    const s = sheetOf(g); if (!s) return 0;
    const z = w.statuses.find(x => /^(life|health)$/.test(x.id))?.zero?.cost;
    const stay = priceOf(g, z ?? (modernish(w) ? 300 : 60));
    const missing = 1 - s.hp / hpMax(w, s);
    return Math.max(1, Math.round(stay * Math.max(0.15, missing * 0.6)));
}
const medTry = (g: Save, w: WorldDef): Try => ({ skill: 'medicine', dc: 10, traits: ['First aid', 'Healer', 'Herbalist'] });
export const bandageChance = (g: Save, w: WorldDef) => chance(g, w, medTry(g, w));
/** Dress your own wounds: a supply used up (a kit you own is kept), a Medicine roll, a little back. Once a day. */
export function bandage(g: Save, w: WorldDef): { text: string; minutes: number; ok: boolean } {
    const s = sheetOf(g); if (!s || !hurtNow(g, w)) return { text: 'You have no wounds to dress.', minutes: 0, ok: false };
    if (triedToday(g, 'bandage')) return { text: 'Your wounds are dressed already. Now they need time (a night\'s sleep) or a healer.', minutes: 0, ok: false };
    const sup = supplies(g, w)[0]; if (!sup) return { text: 'You have nothing to dress your wounds with.', minutes: 0, ok: false };
    if (sup.kind === 'good') addGood(g, sup.id, -1);
    mark(g, 'bandage');
    const r = roll(g, w, medTry(g, w)); const max = hpMax(w, s);
    const trained = traitsOf(g).some(t => medicTrait.test(t)) || (isRpg(w) && skillOf(w, 'medicine') ? skillBonus(w, s, 'medicine') >= prof(s.level) : false);
    const share = r.crit ? 0.15 : r.ok ? (trained ? 0.12 : 0.1) : 0.04;
    const before = s.hp; changeHp(g, w, Math.max(1, Math.round(max * share)));
    note(g, '{u} dressed their wounds with {0}.', [sup.name.toLowerCase()], [], g.player.loc, 'event');
    const gained = s.hp - before;
    return { ok: r.ok, minutes: 20, text: r.ok ? `You clean and dress your wounds with ${sup.name.toLowerCase()} (+${gained} HP).` : `You fumble the dressing with ${sup.name.toLowerCase()}; it helps a little (+${gained} HP).` };
}
/** Treatment: at an open healer or hospital (paid), or by a trained companion with you (free). Once a day. */
export function treatment(g: Save, w: WorldDef): { text: string; minutes: number; ok: boolean } {
    const s = sheetOf(g); if (!s || !hurtNow(g, w)) return { text: 'You have no wounds to treat.', minutes: 0, ok: false };
    if (triedToday(g, 'treated')) return { text: 'You were treated today already. The rest is time and sleep.', minutes: 0, ok: false };
    const max = hpMax(w, s); const before = s.hp;
    if (healerHere(g, w)) {
        const cost = treatCost(g, w);
        if (g.player.money < cost) return { text: `Treatment here costs ${cost}. You do not have enough.`, minutes: 0, ok: false };
        g.player.money -= cost; book(g, `Treatment at ${placeOf(g, w, g.player.loc)?.name ?? 'the healer'}`, -cost);
        mark(g, 'treated');
        changeHp(g, w, Math.round(max * 0.4));
        const a = ailOf(g); for (const i of a.injuries) i.until = Math.min(i.until, g.day + 1);   // set and stitched: mending fast now
        note(g, '{u} had their wounds treated at {0}.', [placeOf(g, w, g.player.loc)?.name ?? 'the healer'], [], g.player.loc, 'event');
        return { ok: true, minutes: 120, text: `Your wounds are cleaned, stitched and dressed (+${s.hp - before} HP; ${cost} paid).` };
    }
    const m = medicWithYou(g, w);
    if (!m) return { text: 'Nobody here can treat you. Find a healer or a hospital.', minutes: 0, ok: false };
    mark(g, 'treated');
    changeHp(g, w, Math.round(max * 0.25));
    note(g, '{0} treated {u}\'s wounds.', [m.name], g.cast[m.key] ? [m.key] : [], g.player.loc, 'event');
    return { ok: true, minutes: 45, text: `${m.name} sees to your wounds (+${s.hp - before} HP).` };
}

/* ---------- a locked place's door ---------- */

// Guests (let in, or sneaked in): the door stays open to you while you are inside, for a few hours at most
// (sim/places.ts lockedNow reads it).
interface Guest { id: string; until: number; sneaked?: boolean }
const guestOf = (g: Save): Guest | null => ((discovery(g) as any).guest ?? null);
function letIn(g: Save, id: string, hours: number, sneaked = false) { (discovery(g) as any).guest = { id, until: nowAbs(g) + hours * 60, ...(sneaked ? { sneaked } : {}) } as Guest; }
// Out again (or the time is up): the door shuts behind you.
onHour.push((g, w) => {
    const x = guestOf(g); if (!x) return [];
    const p = placeOf(g, w, g.player.loc);
    if (x.until <= nowAbs(g) || !(g.player.loc === x.id || p?.in === x.id)) delete (discovery(g) as any).guest;
    return [];
});
const dist = (a: Place, b: Place) => Math.hypot(a.x - b.x, a.y - b.y);
export const NEXT_DOOR = 8;   // (percent of the map)
/** The locked doors you can try from here: the locked floors of this building, and locked places next door. */
export function doorsNear(g: Save, w: WorldDef): Place[] {
    const here = g.player.loc; const bid = buildingOf(g, w, here);
    const inside = bid ? [placeOf(g, w, bid)!, ...floorsOf(g, w, bid)].filter(p => p && p.id !== here && !!lockedNow(g, w, p)) : [];
    const p = placeOf(g, w, here);
    // next door: a few steps away on the same map (a town's trips all take the same time, so the map decides)
    const near = p ? waiting(g, w).filter(x => !x.in && x.id !== here && x.id !== bid && x.map === p.map && !hiddenNow(g, w, x) && !!lockedNow(g, w, x) && !isHome(x.id) && dist(x, p) <= NEXT_DOOR)
        .sort((a, b) => dist(a, p) - dist(b, p)).slice(0, 2) : [];
    return [...inside, ...near];
}
const WORDS = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(x => !/^(the|with|from|only|that|this|have|need|needs|card|pass|members?|staff|room|floor|level|house|place|building|entrance)$/.test(x));
const PASSY = /pass|key ?card|keycard|\bkey\b|badge|card|ticket|permit|licen[cs]e|invitation|invite|seal|token|writ|warrant|credential|\bid\b|wristband|membership/i;
/** The pass, key or invitation you carry that fits this door (it shares a name with the place, or the place asks for it). */
export function passFor(g: Save, w: WorldDef, p: Place): Supply | null {
    const b = p.in ? placeOf(g, w, p.in) : null; const o: any = p.opens ?? b?.opens ?? {};
    const fac = o.faction ? factionDef(g, w, o.faction)?.name ?? '' : '';
    const want = new Set(WORDS(`${p.name} ${b?.name ?? ''} ${p.restricted ?? ''} ${b?.restricted ?? ''} ${fac}`));
    const carry: Supply[] = [
        ...Object.entries(bagOf(g).items).filter(([, n]) => n > 0).map(([id]) => ({ id, name: goodDef(w, id)?.name ?? id, kind: 'good' as const })),
        ...((life(g).items ?? []) as string[]).map(id => ({ id, name: shopItems(w).find(x => x.id === id)?.name ?? id, kind: 'item' as const })),
    ];
    return carry.find(x => o.item && (x.id === o.item || x.name.toLowerCase() === String(o.item).toLowerCase()))
        ?? carry.find(x => PASSY.test(x.name) && WORDS(x.name).some(wd => want.has(wd))) ?? null;
}
const night = (g: Save) => { const h = hour(g); return h < 7 || h >= 22; };
const knownInside = (g: Save, w: WorldDef, p: Place) => presentAt(g, w, p.id).some(r => r.met && bondOf(g, r.avatar) >= 30);
export const knockTry = (g: Save, w: WorldDef, p: Place): Try => ({ skill: 'persuasion', traits: ['Charming', 'Persuasive', 'Polite', 'Outgoing', 'Talkative', 'Confident', 'Negotiator'],
    dc: 15 + (openNow(g, w, p.id) ? 0 : 5) + (night(g) ? 3 : 0), extra: knownInside(g, w, p) ? 4 : 0 });
export const sneakTry = (g: Save, w: WorldDef, p: Place): Try => ({ skill: 'stealth', traits: ['Stealthy', 'Street-smart', 'Quick reflexes', 'Quick', 'Climber', 'Mischievous'],
    dc: 15 + (placeIs(p, 'guarded') ? 3 : 0) + (night(g) ? -2 : 0) });
export interface DoorResult { text: string; minutes: number; inside: boolean; story?: string }
// Going to the door (and back, when it stays shut): up the stairs, or next door.
const walk = (g: Save, w: WorldDef, p: Place) => Math.min(10, travelMinutes(g, w, g.player.loc, p.id));
/** Knock and ask: let in for this visit, or turned away (once a day). */
export function knock(g: Save, w: WorldDef, id: string): DoorResult {
    const p = placeOf(g, w, id); if (!p || !lockedNow(g, w, p)) return { text: '', minutes: 0, inside: false };
    if (triedToday(g, `knock:${id}`)) return { text: `They already turned you away at ${floorName(p)} today.`, minutes: 0, inside: false };
    mark(g, `knock:${id}`);
    const r = roll(g, w, knockTry(g, w, p)); const go = walk(g, w, p);
    if (r.ok) {
        letIn(g, id, 4);
        note(g, '{u} was let into {0}.', [floorName(p)], [], id, 'event');
        return { text: `They let you into ${floorName(p)}, for this visit.`, minutes: 5, inside: true, story: `{{user}} knocked at ${floorName(p)} (${p.restricted ?? lockedNow(g, w, p)}) and talked their way in for this visit.` };
    }
    return { text: `Nobody lets you into ${floorName(p)} (${lockedNow(g, w, p)}).`, minutes: go * 2 + 5, inside: false, story: `{{user}} knocked at ${floorName(p)} and was turned away (${lockedNow(g, w, p)}).` };
}
/** Show the pass you carry: the door opens to you from now on. */
export function showPass(g: Save, w: WorldDef, id: string): DoorResult {
    const p = placeOf(g, w, id); if (!p || !lockedNow(g, w, p)) return { text: '', minutes: 0, inside: false };
    const pass = passFor(g, w, p); if (!pass) return { text: 'You carry nothing that would get you in.', minutes: 0, inside: false };
    unlock(g, w, id, { open: true });
    return { text: `You show your ${pass.name.toLowerCase()}: ${floorName(p)} is open to you now.`, minutes: 2, inside: true, story: `{{user}} showed their ${pass.name.toLowerCase()} and was let into ${floorName(p)}.` };
}
/** Sneak in: inside for a while, or caught (trespassing: a bounty where guards keep watch, else a bad name). */
export function sneak(g: Save, w: WorldDef, id: string): DoorResult & { caught?: string[] } {
    const p = placeOf(g, w, id); if (!p || !lockedNow(g, w, p)) return { text: '', minutes: 0, inside: false };
    if (triedToday(g, `sneak:${id}`)) return { text: `They are watching ${floorName(p)} too closely after last time. Not today.`, minutes: 0, inside: false };
    mark(g, `sneak:${id}`);
    const r = roll(g, w, sneakTry(g, w, p)); const go = walk(g, w, p);
    if (r.ok) {
        letIn(g, id, 2, true);
        return { text: `You slip into ${floorName(p)} unseen.`, minutes: 10, inside: true, story: `{{user}} sneaked into ${floorName(p)} without permission (${lockedNow(g, w, p) || p.restricted}). Nobody has noticed yet.` };
    }
    const caught: string[] = [];
    if (isScenario(w)) caught.push('You are caught and sent back.');
    else if (placeIs(p, 'guarded') || placeIs(p, 'jail')) caught.push(...addBounty(g, w, 25, 'trespassing', id));
    else { const m = addRep(g, w, -3, 'caught trespassing', id); if (m) caught.push(m); }
    note(g, '{u} was caught sneaking into {0}.', [floorName(p)], [], id, 'event');
    return { text: `You are caught trying to sneak into ${floorName(p)} and thrown out.`, minutes: go * 2 + 10, inside: false, caught, story: `{{user}} was caught trying to sneak into ${floorName(p)} and thrown out.` };
}

/* ---------- hidden places ---------- */

export const askTry = (g: Save, w: WorldDef): Try => ({ skill: 'persuasion', dc: 14, traits: ['Charming', 'Persuasive', 'Street-smart', 'Outgoing', 'Talkative', 'Good listener', 'Storyteller'] });
export const lookTry = (g: Save, w: WorldDef): Try => ({ skill: 'perception', dc: 15, traits: ['Observant', 'Curious', 'Street-smart', 'Tracker', 'Nosy'] });
/** People to ask: someone is here, or it is a tavern or bar. */
export const canAsk = (g: Save, w: WorldDef) => { const p = placeOf(g, w, g.player.loc); return !!p && !isHome(p.id) && (presentAt(g, w, p.id).length > 0 || placeIs(p, 'tavern')); };
export const canLook = (g: Save, w: WorldDef) => { const p = placeOf(g, w, g.player.loc); return !!p && !isHome(p.id) && !p.link; };
function hiddenNear(g: Save, w: WorldDef, far: boolean): Place[] {
    const here = placeOf(g, w, g.player.loc); if (!here) return [];
    const bid = buildingOf(g, w, here.id);
    // (a place that opens through someone or a faction is a secret they keep: only harder to hear of)
    return waiting(g, w).filter(p => hiddenNow(g, w, p) && !isHome(p.id))
        .filter(p => (bid && (p.in === bid || p.id === bid)) || (p.map === here.map && (far || dist(p, here) <= 12)))
        .sort((a, b) => dist(a, here) - dist(b, here));
}
export interface FindResult { text: string; minutes: number; found: string; story?: string }
function search(g: Save, w: WorldDef, how: 'ask' | 'look'): FindResult {
    const key = `${how}:${g.player.loc}`;
    if (triedToday(g, key)) return { text: how === 'ask' ? 'You have asked everyone here today already.' : 'You have searched around here today already.', minutes: 0, found: '' };
    mark(g, key);
    const t = how === 'ask' ? askTry(g, w) : lookTry(g, w);
    const list = hiddenNear(g, w, how === 'ask');
    const pick = list[0] ? (how === 'ask' ? list[Math.floor(DICE.rnd() * Math.min(3, list.length))] : list[0]) : null;
    const r = roll(g, w, { ...t, dc: t.dc + ((pick?.opens as any)?.who || (pick?.opens as any)?.faction ? 4 : 0) });
    const minutes = how === 'ask' ? 30 : 20;
    if (!r.ok || !pick) return { text: how === 'ask' ? 'Nobody tells you anything new.' : 'You find nothing you did not know about.', minutes, found: '' };
    const msg = unlock(g, w, pick.id, { find: true }) || `New place on your map: ${floorName(pick)}.`;
    return { text: msg, minutes, found: pick.id, story: how === 'ask' ? `{{user}} asked around and found out where ${floorName(pick)} is.` : `Looking around, {{user}} found ${floorName(pick)}.` };
}
export const askAround = (g: Save, w: WorldDef) => search(g, w, 'ask');
export const lookAround = (g: Save, w: WorldDef) => search(g, w, 'look');

/* ---------- a gate, between floors ---------- */

/** In a gate with floors behind you and more ahead, energy below full: a breather (once a floor). */
export function breathHere(g: Save, w: WorldDef): string {
    if (!gatesOn(w)) return '';
    const gt = gateAt(g, g.player.loc); if (!gt || !gt.in || !gt.floor || gt.floor >= gt.floors) return '';
    const e = w.statuses.find(s => s.id === 'energy'); if (!e || (g.player.stats.energy ?? e.max) >= e.max) return '';
    return triedToday(g, `breath:${gt.id}:${gt.floor}`) ? '' : gt.id;
}
export function catchBreath(g: Save, w: WorldDef): { text: string; minutes: number } {
    const id = breathHere(g, w); if (!id) return { text: '', minutes: 0 };
    const gt = gateAt(g, g.player.loc)!; mark(g, `breath:${id}:${gt.floor}`);
    addStatus(g, w, 'energy', 20);
    return { text: 'You lean against the wall and get your breath back (energy). Your wounds stay as they are.', minutes: 15 };
}

/* ---------- an inn or a hotel ---------- */

const INN = /\binn\b|hotel|motel|hostel|lodg|guest ?house|b ?& ?b|bed and breakfast|ryokan|caravanserai|boarding/i;
export function innHere(g: Save, w: WorldDef): boolean {
    const p = placeOf(g, w, g.player.loc);
    return !!p && !isScenario(w) && !isHome(p.id) && p.id !== playerHomeId && (INN.test(`${p.id} ${p.name}`) || (p.tags ?? []).some(t => /^(inn|hotel|lodging|motel|hostel)$/.test(t)));
}
export const roomPrice = (g: Save, w: WorldDef) => priceOf(g, modernish(w) ? 80 : 5);
export function rentRoom(g: Save, w: WorldDef, social: any): string {
    if (!innHere(g, w)) return '';
    const cost = roomPrice(g, w);
    if (g.player.money < cost) return `A room costs ${cost}. You do not have enough.`;
    g.player.money -= cost; book(g, `A room at ${placeOf(g, w, g.player.loc)?.name ?? 'the inn'}`, -cost);
    social.stay = { avatar: '', where: g.player.loc, day: g.day };
    note(g, '{u} took a room for the night at {0}.', [placeOf(g, w, g.player.loc)?.name ?? 'the inn'], [], g.player.loc, 'event');
    return `You take a room for the night (${cost}). Sleep whenever you like.`;
}

/* ---------- wait; where someone is ---------- */

/** Waits: a set time, or (until someone comes) in steps of 15 minutes, 3 hours at most. Returns the messages. */
export function waitHere(g: Save, w: WorldDef, mins: number | 'someone'): { msgs: string[]; minutes: number; who: string } {
    if (mins !== 'someone') return { msgs: advance(g, w, mins), minutes: mins, who: '' };
    const before = new Set(presentAt(g, w, g.player.loc).map(r => r.avatar));
    const msgs: string[] = []; let t = 0;
    while (t < 180) {
        msgs.push(...advance(g, w, 15)); t += 15;
        const fresh = presentAt(g, w, g.player.loc).find(r => !before.has(r.avatar));
        if (fresh) return { msgs, minutes: t, who: fresh.met ? fresh.name : 'Someone' };
    }
    return { msgs, minutes: t, who: '' };
}
/** The people you know, and where each usually is at this hour (a place you do not know of stays unknown). */
export function whereabouts(g: Save, w: WorldDef): { avatar: string; name: string; where: string; place: string; go: boolean }[] {
    return Object.values(g.cast).filter(r => r.met && !isWith(g, r.avatar)).map(r => {
        const at = whereNow(g, w, r); const p = placeOf(g, w, at);
        const home = at.startsWith('home:');
        const unknown = !p || hiddenNow(g, w, p);
        const where = at === g.player.loc ? 'here' : home ? (at === playerHomeId ? 'at your place' : 'at home') : unknown ? 'somewhere you do not know' : floorName(p!);
        return { avatar: r.avatar, name: r.name, where, place: at, go: !home && !unknown && at !== g.player.loc && !lockedNow(g, w, p!) };
    }).sort((a, b) => a.name.localeCompare(b.name));
}
