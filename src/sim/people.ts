// The people of the world: where each one is right now, following their routine (unless she is with you,
// or has plans with you).
import { homeJobOf, npcOut, onShift, SHIFTS } from './hometime.js';
import { festivalSpot } from './festivals.js';
import { eventSpot } from './cityevents.js';
import { lockedHere } from './life.js';
import { nowAbs, type Save, type Resident } from '../core/store.js';
import { systemOn, isScenario, type WorldDef } from '../core/world.js';
import { isWeekend } from './time.js';
import { appointmentNow, isWith } from './social.js';
import { weatherOn } from './weather.js';
import { weatherAt } from './worldstate.js';
import { breakNow } from './daylife.js';
import { isOpen } from './daynight.js';
import { placeOn, extraRooms } from './places.js';
import { partySpot } from './houseparty.js';
import { guestSpot } from './guests.js';

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// Outdoor places are the ones only for leisure (a park, a beach); a café or a mall has a roof.
export const outdoors = (w: WorldDef, id: string) => { const t = w.places.find(p => p.id === id)?.tags ?? []; return t.includes('leisure') && !t.some(x => ['food', 'shop', 'service', 'work', 'study'].includes(x)); };
// Her neighborhood: the map her home is on (the player's, for someone who lives with you).
export const homeMapOf = (g: Save, w: WorldDef, r: Resident) => {
    const h = (r as any).homeWith === '__you' ? g.player.home : r.home;
    return w.homes.zones.find(z => z.id === h?.zone)?.map ?? '';
};
// Where she spends her free time. On weekdays she stays in her own neighborhood (her favorite spots there, or any
// spot for leisure on her map); at the weekend her favorites anywhere, and now and then a day out in another town.
function leisurePool(g: Save, w: WorldDef, r: Resident, day: number) {
    const fun = (p: { tags?: string[]; link?: string }) => !p.link && !!p.tags?.includes('leisure');
    const all = r.leisure.length ? r.leisure : w.places.filter(fun).map(p => p.id);
    const on = all.filter(id => placeOn(g, w, id));   // a scenario: only the rooms of this game
    const mine = on.length ? on : isScenario(w) ? w.places.filter(p => fun(p) && placeOn(g, w, p.id)).map(p => p.id) : all;
    if (isScenario(w)) mine.push(...extraRooms(g).filter(fun).map(p => p.id));   // rooms added for this game are used too
    const homeMap = homeMapOf(g, w, r);
    if (!homeMap || w.maps.length < 2) return mine;
    const mapOf = (id: string) => w.places.find(p => p.id === id)?.map;
    const near = w.places.filter(p => fun(p) && p.map === homeMap).map(p => p.id);
    if (!isWeekend(day)) { const own = mine.filter(id => mapOf(id) === homeMap); return own.length ? own : near.length ? near : mine; }
    if (hash(`${r.avatar}|out|${day}`) % 3 === 0) { const away = w.places.filter(p => fun(p) && p.map !== homeMap).map(p => p.id); if (away.length) return [...mine, ...away]; }
    return mine;
}
function leisureSpot(g: Save, w: WorldDef, r: Resident, day: number, stepHour: number) {
    let list = leisurePool(g, w, r, day);
    // a place closed at that hour is out (the living world); with all of them closed, she stays home
    if (systemOn(w, 'living')) { list = list.filter(id => isOpen(w, id, stepHour * 60)); if (!list.length) return `home:${r.avatar}`; }
    // rain changes plans: outdoor spots are skipped for somewhere with a roof (or home)
    // (a region with a weather of its own may be dry while it rains elsewhere)
    const wet = (id: string) => weatherAt(g, w, id, day).rain;
    // it rains on her plans: an outdoor spot of hers is wet (or, with none, it rains in the world)
    const raining = list.some(id => outdoors(w, id)) ? list.some(id => outdoors(w, id) && wet(id)) : weatherOn(g.world, day).rain;
    if (raining) {
        const dry = list.filter(id => !outdoors(w, id) || !wet(id));
        list = dry.length ? dry : w.places.filter(p => (p.tags ?? []).some(t => t === 'food' || t === 'shop')).map(p => p.id);
        if (!list.length || hash(`${r.avatar}|rain|${day}`) % 3 === 0) return `home:${r.avatar}`;
    }
    return list[hash(`${r.avatar}|${day}|${stepHour}`) % list.length] ?? `home:${r.avatar}`;
}

// The step of her routine at a given moment (absolute minutes): [start hour, 'home' | 'work' | 'leisure' | place id].
export function routineStep(r: Resident, at: number): [number, string] {
    const day = Math.floor(at / 1440), h = Math.floor((at % 1440) / 60);
    const steps = isWeekend(day) ? r.routine.weekend : r.routine.weekday;
    let cur = steps[0];
    for (const s of steps) if (s[0] <= h) cur = s;
    return cur as [number, string];
}

/** Out of the house, off-screen (a scenario): not at any place. */
export const OUT = 'out';
// Where her routine puts her at a given moment (plans and company left aside).
export function routineAt(g: Save, w: WorldDef, r: Resident, at: number): string {
    const [start, target] = routineStep(r, at);
    const day = Math.floor(at / 1440);
    // someone who lives with you (or with someone else) is at that home
    const homeId = (r as any).homeWith === '__you' ? 'home:player' : (r as any).homeWith ? `home:${(r as any).homeWith}` : `home:${r.avatar}`;
    // Home: a job you wrote for them has its shift (out of the house while it lasts); without one, their routine
    if (isScenario(w)) {
        const j = homeJobOf(r), out = npcOut(g);
        if (out && onShift(j, at)) return OUT;
        const shifted = !!SHIFTS.find(x => x.id === j.shift && x.from !== undefined) || j.shift === 'off';
        if (target === 'work' && shifted) return leisureSpot(g, w, r, day, start);   // their own hours replace the routine's
        if (target === 'home') return homeId;
        // work, errands and nights out happen off-screen (`OUT`), and they come back later (or they stay in)
        if (target === 'work' || target === 'out') return out ? OUT : leisureSpot(g, w, r, day, start);
    }
    if (target === 'home') return homeId;
    if (target === 'work') {
        const job = systemOn(w, 'jobs') ? w.occupations.find(o => o.id === r.occupation) : null;
        return job ? job.place : leisureSpot(g, w, r, day, start);
    }
    if (target === 'leisure') return eventSpot(g, w, r.avatar, at) ?? festivalSpot(g, w, at, { map: homeMapOf(g, w, r) }) ?? leisureSpot(g, w, r, day, start);   // on a festival day, free time is spent there
    return w.places.some(p => p.id === target) && placeOn(g, w, target) ? target : isScenario(w) ? leisureSpot(g, w, r, day, start) : homeId;
}

export function whereNow(g: Save, w: WorldDef, r: Resident): string {
    if (isWith(g, r.avatar)) return g.player.loc;      // she came along with you
    const locked = lockedHere(g, r.avatar);            // in the middle of a conversation with you
    if (locked) return locked;
    const stay = stayingAt(g, r.avatar);               // stopped to talk with you somewhere: stays there a while
    if (stay) return stay;
    const appt = appointmentNow(g, r.avatar);          // plans with you win over the routine
    if (appt) return appt.place;
    const left = (g as any).swap?.left?.[r.avatar];    // the one you played until now stays where you left them for a while
    if (left && nowAbs(g) < left.until) return left.loc;
    const party = partySpot(g, w, r.avatar);         // a scenario's house party: everyone in the common rooms
    if (party) return party;
    const guest = guestSpot(g, w, r);                  // Home: a guest stays in the house (common rooms; at night, their bed)
    if (guest) return guest;
    const brk = breakNow(g, w, r);                     // something interrupted her routine today (an errand, a cold…)
    if (brk) return brk.place;
    return routineAt(g, w, r, nowAbs(g));
}

export const residents = (g: Save) => Object.values(g.cast);
// (someone you are playing as is not "here": you are them)
const selfOf = (g: Save) => { const s = (g as any).swap; return s ? (s.avatar || s.origCard || '') : ''; };
export const presentAt = (g: Save, w: WorldDef, loc: string) => residents(g).filter(r => r.avatar !== selfOf(g) && whereNow(g, w, r) === loc);

// Someone who stopped to talk with you (a chance encounter) stays where you met for a while, without following you.
export function stayingAt(g: Save, avatar: string): string | null {
    const list = ((g as any).social?.stays ?? []) as { avatar: string; loc: string; until: number }[];
    const now = nowAbs(g);
    const s = list.find(x => x.avatar === avatar && now < x.until);
    return s ? s.loc : null;
}
export function stayHere(g: Save, avatar: string, loc: string, minutes: number) {
    const soc = ((g as any).social ??= {});
    const now = nowAbs(g);
    soc.stays = ((soc.stays ?? []) as { avatar: string; loc: string; until: number }[]).filter(x => x.avatar !== avatar && now < x.until);
    soc.stays.push({ avatar, loc, until: now + minutes });
}
