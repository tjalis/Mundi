// Gates (RPG): portals that open at random places of the map every few days, each with a rank (E to S), a few
// floors of foes and a boss at the end, scaled to the rank. Clearing the boss closes the gate (and pays well). Left
// alone, a gate breaks on its day: its monsters spill into the streets around it, the region gets tense, and they
// stay there (a fight at that place) until someone deals with them. The world can name them ("Rift", "Dungeon")
// and say how often one opens. A gate is a place of this game (on the map, next to where it opened).
import type { Save } from '../core/store.js';
import { systemOn, placeIs, type WorldDef, type Place } from '../core/world.js';
import { rpgOf, type Foe } from '../core/rpgdef.js';
import { onDay, afterFight } from './hooks.js';
import { isRpg, sheetOf, addXp } from './rpg.js';
import { startCombat, inCombat } from './combat.js';
import { book } from './ledger.js';
import { note } from './facts.js';
import { addGood } from './economy.js';
import { regionState } from './worldstate.js';
import { placeOf, hiddenNow, lockedNow, isHome } from './places.js';
import { discovery } from './discovery.js';

export const RANKS = ['E', 'D', 'C', 'B', 'A', 'S'] as const;
const FLOORS = [3, 4, 5, 6, 8, 10];          // floors to clear, by rank (the last one is the boss)
const BASE = [0, 4, 9, 15, 22, 30];          // how tough its first floor is (as a tower floor)
export interface Gate { id: string; place: string; host: string; rank: number; floors: number; floor: number; opened: number; breaks: number; in?: boolean }
interface Loose { place: string; rank: number; foes: string[]; since: number }
const st = (g: Save) => { const d = discovery(g) as any; d.gates ??= []; d.loose ??= []; return d as { gates: Gate[]; loose: Loose[]; added: Place[]; n?: number }; };
export const gatesOf = (g: Save): Gate[] => st(g).gates;
export const looseOf = (g: Save): Loose[] => st(g).loose;
export const gatesOn = (w: WorldDef) => systemOn(w, 'gates') && isRpg(w) && !!rpgOf(w)?.bestiary?.length;
export const gateWord = (w: WorldDef) => w.gates?.name?.trim() || 'Gate';
export const gateAt = (g: Save, place: string) => gatesOf(g).find(x => x.place === place) ?? null;
export const looseAt = (g: Save, place: string) => looseOf(g).find(x => x.place === place) ?? null;
const H = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const rnd = (g: Save, salt: string) => H(`${g.world}|${g.day}|${salt}`);

// The foes of a floor: from the bestiary, a budget that grows with how deep it is; the last floor has a boss.
export function gateFoes(w: WorldDef, gt: Gate, floor: number): string[] {
    const all = rpgOf(w)?.bestiary ?? [];
    const plain = all.filter(f => !(f.tags ?? []).includes('boss')), bosses = all.filter(f => (f.tags ?? []).includes('boss'));
    const depth = BASE[gt.rank] + floor;
    const out: Foe[] = [];
    if (floor >= gt.floors) {   // the boss: the strongest one that fits, or the toughest foe there is
        const fit = (bosses.length ? bosses : plain).filter(f => f.level <= 3 + depth).sort((a, b) => b.level - a.level);
        const b = fit[Math.floor(H(`${gt.id}|boss`) * Math.min(2, fit.length))] ?? [...(bosses.length ? bosses : plain)].sort((a, b) => a.level - b.level)[0];
        if (b) out.push(b);
    }
    let budget = 2 + Math.floor(depth * 0.8) - out.reduce((a, f) => a + f.level, 0);
    for (let i = 0; i < 5 && budget > 0; i++) {
        const fit = plain.filter(f => f.level <= budget); if (!fit.length) break;
        const f = fit[Math.floor(H(`${gt.id}|${floor}|${i}`) * fit.length)]; out.push(f); budget -= f.level;
    }
    if (!out.length && plain.length) out.push([...plain].sort((a, b) => a.level - b.level)[0]);
    return out.map(f => f.id);
}

// Where a gate can open: a public place of the map (not a home, a link, a floor, a hidden or locked place, a jail).
function spots(g: Save, w: WorldDef): Place[] {
    return w.places.filter(p => !p.link && !p.in && !isHome(p.id) && !hiddenNow(g, w, p) && !lockedNow(g, w, p) && !placeIs(p, 'jail') && !gatesOf(g).some(x => x.host === p.id) && !looseAt(g, p.id));
}
/** Opens a gate (at a random place, of a rank near your level). Returns what to tell the player. */
export function openGate(g: Save, w: WorldDef, at?: string, rank?: number): string {
    const list = spots(g, w); const host = (at && placeOf(g, w, at)) || list[Math.floor(rnd(g, 'gate-at') * list.length)];
    if (!host) return '';
    const lvl = sheetOf(g)?.level ?? 1;
    const roll = rnd(g, 'gate-rank');   // mostly your rank (a level of 1-4 is E, 5-8 D…), sometimes one above or below
    const r = rank ?? Math.max(0, Math.min(5, Math.floor((lvl - 1) / 4) + (roll < 0.2 ? 1 : roll > 0.8 ? -1 : 0)));
    const s = st(g); s.n = (s.n ?? 0) + 1;
    const word = gateWord(w);
    const id = `gate:${s.n}`;
    const days = 3 + r;
    const p: Place = { id, name: `${RANKS[r]}-rank ${word}`, map: host.map, x: Math.max(3, Math.min(97, host.x + 4)), y: Math.max(3, Math.min(97, host.y - 4)), tags: ['gate'],
        desc: `A ${RANKS[r]}-rank ${word.toLowerCase()} that opened by ${host.name}: ${FLOORS[r]} floors of monsters and a boss at the end.`, closed: [], ...(host.bg ? { bg: host.bg } : {}) };
    s.added.push(p);
    s.gates.push({ id, place: id, host: host.id, rank: r, floors: FLOORS[r], floor: 0, opened: g.day, breaks: g.day + days });
    note(g, 'A {0} opened by {1}.', [p.name, host.name], [], host.id, 'event');
    return `🌀 A ${p.name} opened by ${host.name}. It breaks on day ${g.day + days} if nobody clears it.`;
}
function closeGate(g: Save, gt: Gate) {
    const s = st(g);
    s.gates = s.gates.filter(x => x.id !== gt.id);
    s.added = s.added.filter(p => p.id !== gt.place);
    if (g.player.loc === gt.place) g.player.loc = gt.host;   // the portal is gone: you are back outside
}
function breakGate(g: Save, w: WorldDef, gt: Gate): string {
    const host = placeOf(g, w, gt.host); const name = placeOf(g, w, gt.place)?.name ?? gateWord(w);
    closeGate(g, gt);
    if (!host) return '';
    const r = regionState(g, w, host.map); r.tension = Math.min(100, r.tension + 15 + 5 * gt.rank); r.mood = Math.max(-100, r.mood - 10 - 3 * gt.rank);
    looseOf(g).push({ place: host.id, rank: gt.rank, foes: gateFoes(w, gt, gt.floors), since: g.day });
    note(g, 'The {0} broke: monsters poured out around {1}.', [name, host.name], [], host.id, 'event');
    return `💥 The ${name} broke! Monsters are loose around ${host.name}.`;
}
onDay.push((g, w) => {
    if (!gatesOn(w)) return [];
    const out: string[] = [];
    for (const gt of [...gatesOf(g)]) if (g.day >= gt.breaks && !gt.in) { const m = breakGate(g, w, gt); if (m) out.push(m); }
    // monsters left loose for a long time leave on their own (the hunters, the army); the region stays shaken
    st(g).loose = looseOf(g).filter(l => g.day - l.since < 7);
    const every = Math.max(1, w.gates?.every ?? 3);
    if (gatesOf(g).length < 3 && rnd(g, 'gate-open') < 1 / every) { const m = openGate(g, w); if (m) out.push(m); }
    return out;
});

/** Into the next floor of the gate you are at (a fight). */
export function enterGate(g: Save, w: WorldDef, id: string): string {
    const gt = gatesOf(g).find(x => x.id === id); if (!gt || !gatesOn(w) || !sheetOf(g)) return '';
    if (g.player.loc !== gt.place) return 'The gate is elsewhere.';
    if (inCombat(g)) return 'You are already fighting.';
    const next = gt.floor + 1;
    const fight = startCombat(g, w, { why: next >= gt.floors ? `The boss of the ${placeOf(g, w, gt.place)?.name}:` : `Floor ${next} of the ${placeOf(g, w, gt.place)?.name}:`, foes: gateFoes(w, gt, next) });
    if (!fight) return 'Nothing stirs.';
    (fight as any).gate = { id, floor: next };
    gt.in = true;
    return next >= gt.floors ? 'The boss room.' : `Floor ${next}.`;
}
/** Leaves the gate between floors (you start again from the first floor next time). */
export function leaveGate(g: Save, id: string) { const gt = gatesOf(g).find(x => x.id === id); if (gt) { gt.in = false; gt.floor = 0; } }
/** Fights the monsters loose at this place (a broken gate). */
export function fightLoose(g: Save, w: WorldDef): string {
    const l = looseAt(g, g.player.loc); if (!l || !gatesOn(w) || !sheetOf(g)) return '';
    if (inCombat(g)) return 'You are already fighting.';
    const fight = startCombat(g, w, { why: 'Monsters from a broken gate:', foes: l.foes });
    if (!fight) return 'Nothing stirs.';
    (fight as any).loose = l.place;
    return 'You go after them.';
}
afterFight.push((g, w, fight) => {
    if (fight.loose) {
        if (fight.over !== 'won') return [];
        st(g).loose = looseOf(g).filter(l => l.place !== fight.loose);
        const r = regionState(g, w, placeOf(g, w, fight.loose)?.map ?? ''); r.tension = Math.max(0, r.tension - 15);
        note(g, '{u} cleared the monsters from a broken gate.', [], [], g.player.loc, 'goal');
        return ['The streets are safe again.'];
    }
    const at = fight.gate as { id: string; floor: number } | undefined;
    if (!at) return [];
    const gt = gatesOf(g).find(x => x.id === at.id); if (!gt) return [];
    const name = placeOf(g, w, gt.place)?.name ?? gateWord(w);
    if (fight.over !== 'won') { gt.in = false; gt.floor = 0; return [`You were driven out of the ${name}. You can go in again from the first floor.`]; }
    gt.floor = at.floor;
    if (gt.floor < gt.floors) return [`Floor ${gt.floor} of ${gt.floors} cleared.`];
    // the boss is down: the gate closes, with its reward
    const coins = Math.round(40 * (gt.rank + 1) ** 2 + Math.random() * 20 * (gt.rank + 1));
    g.player.money += coins; book(g, `${name} cleared`, coins);
    const out = [`🌀 The ${name} is cleared and closes behind you: ${coins} in coins.`, ...addXp(g, w, 50 * (gt.rank + 1), 'gate')];
    if (gt.rank >= 3) { const rare = (w.goods ?? []).filter(x => x.kind === 'rare' || x.socket); if (rare.length) { const r = rare[Math.floor(Math.random() * rare.length)]; addGood(g, r.id, 1); out.push(`Treasure: ${r.name}.`); } }
    note(g, '{u} cleared the {0}.', [name], [], g.player.loc, 'goal');
    closeGate(g, gt);
    return out;
});

/* ---------- for the AI ---------- */
export function gateLines(g: Save, w: WorldDef): string[] {
    if (!gatesOn(w)) return [];
    const out: string[] = [];
    const gt = gateAt(g, g.player.loc);
    if (gt) out.push(`{{user}} is at the ${placeOf(g, w, gt.place)?.name}, a portal to a dungeon: ${gt.floors} floors of monsters and a boss at the end${gt.floor ? `; {{user}} has cleared ${gt.floor} of them` : ''}. It breaks on day ${gt.breaks} if nobody clears it (today is day ${g.day}).`);
    const l = looseAt(g, g.player.loc);
    if (l) out.push(`Monsters from a broken gate are loose around here (since day ${l.since}): people are scared or hiding.`);
    const here = placeOf(g, w, g.player.loc)?.map;
    const near = gatesOf(g).filter(x => x !== gt && placeOf(g, w, x.place)?.map === here).map(x => `${placeOf(g, w, x.place)?.name} by ${placeOf(g, w, x.host)?.name}`);
    if (near.length) out.push(`Open gates nearby: ${near.join(', ')}.`);
    return out;
}
