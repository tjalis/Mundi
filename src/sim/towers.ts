// Endless towers (RPG): a place with floors that go on and on. Each floor is a fight against foes chosen for that
// floor (stronger as you climb), with loot that grows too; every 10th floor is a checkpoint (you can start there
// again) guarded by a boss, and deep floors hide sentient weapons and rare treasures. Leave between floors to rest.
import type { Save } from '../core/store.js';
import { systemOn, type WorldDef, type TowerDef } from '../core/world.js';
import { rpgOf, type Foe } from '../core/rpgdef.js';
import { afterFight } from './hooks.js';
import { isRpg, sheetOf, tooHurt } from './rpg.js';
import { startCombat, inCombat } from './combat.js';
import { book } from './ledger.js';
import { note } from './facts.js';
import { addGood } from './economy.js';
import { gainBlade, bladeOf } from './artifacts.js';

interface Climb { floor: number; best: number; checkpoint: number; in?: boolean }
const climbs = (g: Save): Record<string, Climb> => ((g as any).towers ??= {});
export const climbOf = (g: Save, id: string): Climb => (climbs(g)[id] ??= { floor: 0, best: 0, checkpoint: 0 });
const on = (w: WorldDef) => systemOn(w, 'towers') && isRpg(w) && !!w.towers?.length;
export const towerAt = (w: WorldDef, place: string): TowerDef | null => (on(w) ? w.towers!.find(t => t.place === place) ?? null : null);

// The foes of a floor: from the bestiary (the tower's tags first), a budget that grows with the floor; a boss every 10.
export function floorFoes(w: WorldDef, t: TowerDef, floor: number): string[] {
    const all = rpgOf(w)?.bestiary ?? [];
    const pool = all.filter(f => !t.tags?.length || (f.tags ?? []).some(x => t.tags!.includes(x)));
    const list = (pool.length ? pool : all).filter(f => !(f.tags ?? []).includes('boss'));
    const bosses = (pool.length ? pool : all).filter(f => (f.tags ?? []).includes('boss'));
    const H = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
    const out: Foe[] = [];
    if (floor % 10 === 0 && bosses.length) out.push(bosses[Math.floor(H(`${t.id}|${floor}|boss`) * bosses.length)]);
    let budget = 2 + Math.floor(floor * 0.8) - out.reduce((a, f) => a + f.level, 0);
    for (let i = 0; i < 5 && budget > 0; i++) {
        const fit = list.filter(f => f.level <= budget); if (!fit.length) break;
        const f = fit[Math.floor(H(`${t.id}|${floor}|${i}`) * fit.length)]; out.push(f); budget -= f.level;
    }
    return out.map(f => f.id);
}
export function enterFloor(g: Save, w: WorldDef, id: string, fromCheckpoint = false): string {
    const t = w.towers?.find(x => x.id === id); if (!t || !on(w) || !sheetOf(g)) return '';
    if (g.player.loc !== t.place) return `${t.name} is elsewhere.`;
    if (inCombat(g)) return 'You are already fighting.';
    { const hurt = tooHurt(g, w); if (hurt) return hurt; }
    const c = climbOf(g, id);
    if (fromCheckpoint) c.floor = c.checkpoint;
    const next = c.floor + 1;
    if (next > t.floors) return `You stand at the top of ${t.name}.`;
    const fight = startCombat(g, w, { why: `Floor ${next} of ${t.name}:`, foes: floorFoes(w, t, next) });
    if (!fight) return 'Nothing stirs.';
    (fight as any).tower = { id, floor: next };
    c.in = true;
    return `Floor ${next}.`;
}
export function leaveTower(g: Save, id: string) { const c = climbOf(g, id); c.in = false; c.floor = c.checkpoint; }
// A floor cleared: loot, checkpoints every 10, treasures deep down.
afterFight.push((g, w, fight) => {
    const tw = fight.tower as { id: string; floor: number } | undefined;
    if (!tw) return [];
    const t = w.towers?.find(x => x.id === tw.id); const c = climbOf(g, tw.id);
    if (fight.over !== 'won' || !t) { c.in = false; c.floor = c.checkpoint; return [`You were driven out of ${t?.name ?? 'the tower'}. You can start again from floor ${c.checkpoint + 1}.`]; }
    c.floor = tw.floor; c.best = Math.max(c.best, tw.floor);
    const coins = 5 * tw.floor + Math.floor(Math.random() * 10 * tw.floor);
    g.player.money += coins; book(g, `${t.name}: floor ${tw.floor}`, coins);
    const out = [`Floor ${tw.floor} cleared: ${coins} in coins.`];
    if (tw.floor % 10 === 0) {
        c.checkpoint = tw.floor; out.push(`A checkpoint: you can start again from floor ${tw.floor + 1}.`);
        const rare = (w.goods ?? []).filter(x => x.kind === 'rare' || x.socket);
        if (rare.length) { const r = rare[Math.floor(Math.random() * rare.length)]; addGood(g, r.id, 1); out.push(`Treasure: ${r.name}.`); }
        if ([10, 25, 50].some(f => tw.floor === f || (tw.floor > f && c.best < f)) && !bladeOf(g)) { const m = gainBlade(g, w); if (m) out.push(m); }
        note(g, '{u} reached floor {0} of {1}.', [String(tw.floor), t.name], [], g.player.loc, 'goal');
    }
    return out;
});
export function towerLines(g: Save, w: WorldDef): string[] {
    const t = towerAt(w, g.player.loc); if (!t) return [];
    const c = climbOf(g, t.id);
    return [`${t.name} rises here${t.desc ? ` (${t.desc})` : ''}: ${t.floors} floors. {{user}} has climbed to floor ${c.best}${c.in ? ` and is on floor ${c.floor} now` : ''}.`];
}
