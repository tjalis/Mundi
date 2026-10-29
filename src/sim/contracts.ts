// Hunting contracts: a board (at a guild or a hunters' lodge) offers targets: a fugitive beast, an outlaw, sometimes a
// legendary creature (stronger, worth more). Take one, gather clues (ask around at taverns: an Investigation check,
// or people who saw it), then track it (a Survival check where it roams) and spring the ambush: a fight. The reward
// is bigger the faster you are.
import type { Save } from '../core/store.js';
import { systemOn, placeIs, type WorldDef } from '../core/world.js';
import { rpgOf } from '../core/rpgdef.js';
import { onDay, afterFight } from './hooks.js';
import { isRpg, sheetOf, rollCheck, checkWon, addXp, addRenown, tooHurt } from './rpg.js';
import { startCombat, inCombat } from './combat.js';
import { placeOf } from './places.js';
import { book } from './ledger.js';
import { note } from './facts.js';
import { addRep } from './standing.js';

export interface Contract { id: string; foe: string; name: string; region: string; legendary: boolean; reward: number; clues: number; taken?: number; state: 'offered' | 'active' | 'done' | 'failed'; asked?: number; tracked?: number }
const on = (w: WorldDef) => systemOn(w, 'contracts') && isRpg(w) && !!rpgOf(w)?.bestiary?.length;
export const contractsOf = (g: Save): Contract[] => ((g as any).contracts ??= []);
const H = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
export const isBoard = (g: Save, w: WorldDef, place = g.player.loc) => placeIs(placeOf(g, w, place), 'contracts');
const isTavern = (g: Save, w: WorldDef) => placeIs(placeOf(g, w, g.player.loc), 'tavern');
export const CLUES = 3;

// Two offers on the board at a time, refreshed now and then.
onDay.push((g, w) => {
    if (!on(w)) return [];
    const list = contractsOf(g);
    for (const c of list) if (c.state === 'active' && g.day - (c.taken ?? g.day) > 10) c.state = 'failed';
    (g as any).contracts = list.filter(c => c.state === 'active' || c.state === 'offered' || g.day - (c.taken ?? 0) < 7).slice(-12);
    const offered = contractsOf(g).filter(c => c.state === 'offered');
    if (offered.length >= 2) return [];
    const beasts = rpgOf(w)!.bestiary!.filter(f => (f.tags ?? []).some(t => ['wild', 'road'].includes(t)));
    if (!beasts.length) return [];
    const f = beasts[Math.floor(H(`${g.world}|${g.day}|ct`) * beasts.length)];
    const legendary = H(`${g.day}|leg`) < 0.2;
    const towns = w.maps.filter(m => !w.maps.some(x => x.parent === m.id));
    const region = towns[Math.floor(H(`${g.day}|reg`) * towns.length)]?.id ?? w.maps[0].id;
    const name = legendary ? `the legendary ${f.name.toLowerCase()} of ${w.maps.find(m => m.id === region)?.name}` : `a ${f.name.toLowerCase()} terrorizing ${w.maps.find(m => m.id === region)?.name}`;
    contractsOf(g).push({ id: `ct${g.day}`, foe: f.id, name, region, legendary, reward: (legendary ? 3 : 1) * (20 + f.level * 25), clues: 0, state: 'offered' });
    return [];
});
export function takeContract(g: Save, w: WorldDef, id: string): string {
    const c = contractsOf(g).find(x => x.id === id && x.state === 'offered'); if (!c) return '';
    if (!isBoard(g, w)) return 'Contracts are taken at the board (a guild, a hunters\' lodge, or wherever the world puts it).';
    c.state = 'active'; c.taken = g.day;
    return `Contract taken: ${c.name}. Gather ${CLUES} clues (ask at taverns in ${w.maps.find(m => m.id === c.region)?.name}), then track it down.`;
}
export function askAround(g: Save, w: WorldDef, id: string): string {
    const c = contractsOf(g).find(x => x.id === id && x.state === 'active'); if (!c) return '';
    if (placeOf(g, w, g.player.loc)?.map !== c.region || !isTavern(g, w)) return `Ask at a tavern in ${w.maps.find(m => m.id === c.region)?.name}.`;
    if (c.asked === g.day) return 'Nobody here knows more today.';
    c.asked = g.day;
    const ck = rollCheck(g, w, 'investigation', 11);
    if (!checkWon(ck)) return `Nobody will talk (Investigation ${ck.total}).`;
    c.clues = Math.min(CLUES, c.clues + (ck.grade === 'critical-success' ? 2 : 1));
    return `A clue (${c.clues}/${CLUES}): someone saw it near the edge of town${c.clues >= CLUES ? '. You know where it hides now.' : '.'}`;
}
export function track(g: Save, w: WorldDef, id: string): string {
    const c = contractsOf(g).find(x => x.id === id && x.state === 'active'); if (!c || !sheetOf(g)) return '';
    if (c.clues < CLUES) return `You need ${CLUES - c.clues} more clue(s).`;
    if (placeOf(g, w, g.player.loc)?.map !== c.region && w.maps.find(m => m.id === c.region)?.parent !== placeOf(g, w, g.player.loc)?.map) return `It roams around ${w.maps.find(m => m.id === c.region)?.name}.`;
    if (inCombat(g)) return '';
    { const hurt = tooHurt(g, w); if (hurt) return hurt; }
    if (c.tracked === g.day) return 'The trail went cold today. Try tomorrow.';
    c.tracked = g.day;
    const ck = rollCheck(g, w, 'survival', c.legendary ? 15 : 12);
    if (!checkWon(ck)) return `You lose the trail (Survival ${ck.total}).`;
    const fight = startCombat(g, w, { why: `You spring the ambush on ${c.name}:`, foes: [c.foe] });
    if (!fight) return '';
    (fight as any).contract = c.id;
    if (c.legendary) for (const f of fight.list.filter(x => x.side === 'them')) { f.hp = f.max = Math.round(f.max * 1.8); f.atk += 2; f.name = `Legendary ${f.name}`; }
    return 'You found it!';
}
afterFight.push((g, w, fight) => {
    const id = fight.contract as string | undefined; if (!id) return [];
    const c = contractsOf(g).find(x => x.id === id); if (!c) return [];
    if (fight.over !== 'won') return [`${c.name} got away. You can track it again.`];
    const days = g.day - (c.taken ?? g.day);
    const reward = Math.round(c.reward * (days <= 2 ? 1.5 : days <= 5 ? 1.2 : 1));
    c.state = 'done'; g.player.money += reward; book(g, `Contract: ${c.name}`, reward);
    note(g, '{u} hunted down {0}.', [c.name], [], g.player.loc, 'goal');
    return [`Contract fulfilled: ${c.name}. +${reward}${days <= 2 ? ' (a bonus for speed)' : ''}.`, ...addXp(g, w, c.legendary ? 150 : 60, 'contract'), ...addRenown(g, w, c.legendary ? 10 : 3), addRep(g, w, c.legendary ? 6 : 2, 'hunt')].filter(Boolean);
});
export function contractLines(g: Save, w: WorldDef): string[] {
    return contractsOf(g).filter(c => c.state === 'active').map(c => `{{user}} is hunting ${c.name} (a contract; ${c.clues}/${CLUES} clues).`);
}
