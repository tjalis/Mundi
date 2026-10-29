// Difficulty and the bills of your home.
// Difficulty changes the economy: how much work pays, what things cost and the money you start with.
// Bills (rent, water, power) are due every week and paid by you, in the Homes app. A bill left unpaid for a week is
// cut off: no water (no shower, no tap, no cooking), no power (no stove, TV, computer, coffee machine…), or, for the
// rent, you are locked out of your home until you pay.
import { cfg, type Save } from '../core/store.js';
import type { WorldDef } from '../core/world.js';
import { systemOn, getWorld, gameMode } from '../core/world.js';
import { book } from './ledger.js';
import { money } from './needs.js';
import { lex, appRef } from '../core/lexicon.js';

/* ---------- difficulty ---------- */

export type Difficulty = 'easy' | 'normal' | 'hard';
// In a Home (no money) the difficulty is how fast relationships grow (`bond`).
export const DIFFICULTIES: { id: Difficulty; name: string; desc: string; homeDesc: string; pay: number; price: number; start: number; bond: number }[] = [
    { id: 'easy', name: 'Easy', desc: 'Work pays more, things cost less, and you start with more money.', homeDesc: 'Friendship and love grow fast.', pay: 1.25, price: 0.8, start: 1.5, bond: 1.5 },
    { id: 'normal', name: 'Normal', desc: 'The balance the world was made with.', homeDesc: 'Relationships grow at their usual pace.', pay: 1, price: 1, start: 1, bond: 1 },
    { id: 'hard', name: 'Hard', desc: 'Work pays less, everything costs more, and you start with little. Every bill counts.', homeDesc: 'Trust is earned slowly: friendship and love take time.', pay: 0.8, price: 1.25, start: 0.6, bond: 0.6 },
];
export const difficultyOf = (g: Save) => DIFFICULTIES.find(d => d.id === ((cfg(g) as any).difficulty ?? 'normal')) ?? DIFFICULTIES[1];
// A price (what you pay) and an income (what you get), after the difficulty.
export const priceOf = (g: Save, v: number) => (v > 0 ? Math.round(v * difficultyOf(g).price) : v < 0 ? Math.round(v * difficultyOf(g).pay) : 0);
export const payOf = (g: Save, v: number) => Math.round(v * difficultyOf(g).pay);

/* ---------- bills ---------- */

// The expenses of a home besides the rent: a free list in the world (homes.expenses: water, power, firewood,
// servants, 300 taxes…), each charged weekly by every kind of home at its own amount (homes.kinds.<kind>.bills),
// and each stopping some things at home while it is a week unpaid (`blocks`: action ids).
// `rpg`: only billed in the RPG mode (the upkeep of your arms and gear…). An empty name: the Lexicon's word (bill_<id>).
export interface ExpenseDef { id: string; name: string; icon?: string; blocks?: string[]; cut?: string; back?: string; rpg?: boolean }
// Worlds made before free expenses have water and power, as Porto Alto does.
export const DEFAULT_EXPENSES: ExpenseDef[] = [
    { id: 'water', name: 'Water', icon: 'drop', blocks: ['shower', 'basin', 'water', 'cook', 'x-coffee'] },
    { id: 'power', name: 'Power', icon: 'bolt', blocks: ['cook', 'x-coffee', 'x-freelance', 'x-treadmill', 'x-tv'] },
];
export const expensesOf = (w: WorldDef | null | undefined): ExpenseDef[] =>
    (((w as any)?.homes?.expenses as ExpenseDef[] | undefined) ?? DEFAULT_EXPENSES.map(e => ({ ...e, name: '' })))
        .filter(e => !e.rpg || (!!w && gameMode(w) === 'rpg')).map(e => (e.name ? e : { ...e, name: lex(w, `bill_${e.id}`) }));
export type BillId = string;
export interface BillDef { id: string; name: string; icon: string; blocks: string[]; cut?: string; back?: string }
// Every bill of a home: the rent, then the world's expenses (none when the world turned rent and bills off).
export const billList = (w: WorldDef | null | undefined): BillDef[] => (systemOn(w, 'bills') ? allBills(w) : []);
const allBills = (w: WorldDef | null | undefined): BillDef[] => [
    { id: 'rent', name: lex(w, 'bill_rent'), icon: 'home', blocks: [] },
    ...expensesOf(w).filter(e => e.id && e.id !== 'rent').map(e => ({ icon: 'wallet', ...e, blocks: e.blocks ?? [] })),
];
export const billName = (w: WorldDef | null | undefined, id: BillId) => allBills(w).find(b => b.id === id)?.name ?? id;
interface Bill { due: number; told?: number; cutTold?: number }
const EVERY = 7;
export function bills(g: Save): Record<BillId, Bill> {
    const x = g as any;
    if (!x.bills) {
        // older saves: the first bills are due a week after the last rent
        const first = (g.player.rentPaidDay ?? g.day) + EVERY;
        x.bills = { rent: { due: first }, water: { due: first }, power: { due: first } };
    }
    return x.bills;
}
// One bill's state; an expense the world added later starts a week from now.
const billOf = (g: Save, id: BillId): Bill => (bills(g)[id] ??= { due: g.day + EVERY });
const zoneOf = (g: Save, w: WorldDef) => w.homes.zones.find(z => z.id === g.player.home.zone);
export function billAmount(g: Save, w: WorldDef, id: BillId): number {
    const zone = zoneOf(g, w);
    const kind = g.player.home.kind ?? zone?.kind ?? '';
    const own = (w.homes.kinds[kind]?.bills ?? {}) as Record<string, number>;
    // older medieval worlds call their Power bill "firewood"
    const base = id === 'rent' ? (g.player.home.in ? 0 : zone?.rent ?? 0) : Number(own[id] ?? (id === 'power' ? own.firewood : undefined) ?? 0);
    return priceOf(g, base);
}
// How many weeks are owed (0 = paid up), whether it is due, and whether it was cut off (a week overdue).
export const owed = (g: Save, id: BillId) => { const b = billOf(g, id); return g.day >= b.due ? Math.floor((g.day - b.due) / EVERY) + 1 : 0; };
export const isDue = (g: Save, id: BillId) => owed(g, id) > 0;
export const isCut = (g: Save, id: BillId) => g.day >= billOf(g, id).due + EVERY;
export const daysLeft = (g: Save, id: BillId) => billOf(g, id).due - g.day;

const LEX_CUT: Record<string, string> = { rent: 'cutRent', water: 'cutWater', power: 'cutPower' };
const LEX_BACK: Record<string, string> = { rent: 'backRent', water: 'backWater', power: 'backPower' };
const LEX_NO: Record<string, string> = { water: 'noWater', power: 'noPower' };
export function payBill(g: Save, w: WorldDef, id: BillId): string {
    const n = owed(g, id); if (!n) return '';
    const amount = billAmount(g, w, id) * n;
    if (g.player.money < amount) return `Not enough money (${money(w, amount)}).`;
    const wasCut = isCut(g, id);
    const def = billList(w).find(b => b.id === id);
    g.player.money -= amount;
    book(g, `${billName(w, id)}${n > 1 ? ` (${n} weeks)` : ''}`, -amount);
    billOf(g, id).due += EVERY * n;
    if (!wasCut) return '';
    return def?.back || (LEX_BACK[id] && def && defaultName(w, def) ? lex(w, LEX_BACK[id]) : lex(w, 'backGeneric', billName(w, id)));
}
// Moving in: the first week is paid with the deposit, so everything starts fresh.
export function resetBills(g: Save, w?: WorldDef | null) {
    const ids = new Set([...Object.keys((g as any).bills ?? {}), ...allBills(w).map(b => b.id)]);
    (g as any).bills = Object.fromEntries([...ids].map(id => [id, { due: g.day + EVERY }]));
}

// Once a day (from the timed rules): the bill that became due, and the one that was cut off.
export function billNews(g: Save, w: WorldDef): string[] {
    const out: string[] = [];
    const on = systemOn(w, 'bills');   // off: every bill stays paid up, so turning it back on owes nothing old
    for (const def of allBills(w)) {
        const b = billOf(g, def.id);
        if (!on || !billAmount(g, w, def.id) || (def.id === 'rent' && !w.rent)) { while (b.due <= g.day) b.due += EVERY; continue; }   // nothing to pay: always paid up
        if (isCut(g, def.id) && b.cutTold !== b.due) {
            b.cutTold = b.due;
            out.push(def.cut ? def.cut.replace('{app}', appRef(w, 'homes')) : LEX_CUT[def.id] && defaultName(w, def) ? lex(w, LEX_CUT[def.id], appRef(w, 'homes')) : lex(w, 'cutGeneric', def.name, appRef(w, 'homes')));
        } else if (isDue(g, def.id) && b.told !== b.due) {
            b.told = b.due;
            out.push(lex(w, 'billDue', def.name, money(w, billAmount(g, w, def.id)), appRef(w, 'homes')));
        }
    }
    return out;
}
// Water and power keep their own messages while they keep the preset's name; a renamed or new expense gets a general one.
const defaultName = (w: WorldDef, def: BillDef) => def.id === 'rent' || def.name === lex(w, `bill_${def.id}`);

// What a cut-off bill stops at home.
export function cutReason(g: Save, id: string, w?: WorldDef | null): string {
    if (w && !systemOn(w, 'bills')) return '';
    if (isCut(g, 'rent')) return lex(w, 'lockedOut');
    for (const def of billList(w)) {
        if (def.id === 'rent' || !def.blocks.includes(id) || !isCut(g, def.id)) continue;
        if (w && !billAmount(g, w, def.id)) continue;
        return LEX_NO[def.id] && (!w || defaultName(w, def)) ? lex(w, LEX_NO[def.id]) : lex(w, 'noGeneric', def.name);
    }
    return '';
}
export const lockedOut = (g: Save) => systemOn(getWorld(g.world), 'bills') && isCut(g, 'rent');
