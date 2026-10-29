// The adventuring party (RPG mode): up to three of the world's people (cards) travel with you, plus up to two hired
// sellswords (not cards: hired hands with a name and a wage, who can die in a fight or walk away unpaid). Everyone
// has a place in the formation: the front row takes the blows, the back row shoots and casts.
import { nowAbs, type Save } from '../core/store.js';
import { placeIs, type WorldDef } from '../core/world.js';
import { rpgOf, type RpgClass } from '../core/rpgdef.js';
import { onDay } from './hooks.js';
import { social, bondOf } from './social.js';
import { note } from './facts.js';
import { book } from './ledger.js';
import { isRpg, sheetOf, mortalOn } from './rpg.js';

export type Row = 'front' | 'back';
export interface Merc { id: string; name: string; cls: string; level: number; wage: number }
export interface Member { avatar?: string; merc?: Merc; row: Row; cls: string; hp?: number; /** their hit points at full (kept while they are wounded) */ max?: number }
export interface Party { members: Member[] }
export const MAX_FRIENDS = 3, MAX_MERCS = 2, JOIN_BOND = 40;
const FOREVER = 10 ** 9;

const H = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
export const partyOf = (g: Save): Party => (((g as any).party ??= { members: [] }) as Party);
export const friends = (g: Save) => partyOf(g).members.filter(m => m.avatar && g.cast[m.avatar]);
export const mercs = (g: Save) => partyOf(g).members.filter(m => m.merc);
export const inParty = (g: Save, avatar: string) => partyOf(g).members.some(m => m.avatar === avatar);
const isKid = (g: Save, a: string) => ((g as any).family?.kids ?? []).some((k: any) => k.avatar === a);
const housemate = (g: Save, a: string) => (g.cast[a] as any)?.homeWith === '__you';

// The class someone fights as: the same for the same person (a card does not say it).
export function classFor(w: WorldDef, key: string): RpgClass | null {
    const list = rpgOf(w)?.classes ?? [];
    return list.length ? list[Math.floor(H(`class|${key}`) * list.length)] : null;
}
const rowFor = (c: RpgClass | null): Row => (c?.weapon?.ranged ? 'back' : 'front');

export function canJoin(g: Save, w: WorldDef, avatar: string): string {
    const r = g.cast[avatar];
    if (!isRpg(w) || !sheetOf(g)) return 'Only in the RPG.';
    if (!r || isKid(g, avatar)) return 'They cannot come.';
    if (inParty(g, avatar)) return 'Already in your party.';
    if (friends(g).length >= MAX_FRIENDS) return `Your party is full (${MAX_FRIENDS} companions).`;
    if (!r.met || (bondOf(g, avatar) < JOIN_BOND && !housemate(g, avatar))) return 'They do not trust you enough to follow you yet.';
    return '';
}
// Joining: they follow you wherever you go (until you part ways).
export function join(g: Save, w: WorldDef, avatar: string): string {
    const why = canJoin(g, w, avatar); if (why) return why;
    const c = classFor(w, avatar);
    partyOf(g).members.push({ avatar, row: rowFor(c), cls: c?.id ?? '' });
    follow(g, avatar);
    note(g, '{0} joined {u}\'s party.', [g.cast[avatar].name], [avatar], g.player.loc, 'meet');
    return '';
}
export function follow(g: Save, avatar: string) {
    const s = social(g);
    const c = s.with.find(x => x.avatar === avatar);
    if (c) c.until = nowAbs(g) + FOREVER; else s.with.push({ avatar, until: nowAbs(g) + FOREVER });
}
export function leave(g: Save, avatar: string) {
    partyOf(g).members = partyOf(g).members.filter(m => m.avatar !== avatar);
    const s = social(g); s.with = s.with.filter(c => c.avatar !== avatar);
}
export function setRow(g: Save, key: string, row: Row) {
    const m = partyOf(g).members.find(x => (x.avatar ?? x.merc?.id) === key);
    if (m) m.row = row;
}
export const memberKey = (m: Member) => m.avatar ?? m.merc!.id;
export const memberName = (g: Save, m: Member) => (m.avatar ? g.cast[m.avatar]?.name ?? '?' : `${m.merc!.name} the sellsword`);

/* ---------- sellswords ---------- */

// Who is for hire today (at a tavern, an inn or barracks): three of them, the same all day.
export const hiringHere = (w: WorldDef, place: string) => placeIs(w.places.find(x => x.id === place), 'hire');
export function forHire(g: Save, w: WorldDef): Merc[] {
    const r = rpgOf(w); const s = sheetOf(g); if (!r || !s) return [];
    const names = r.mercNames?.length ? r.mercNames : ['Brann', 'Hilde', 'Rook'];
    return [0, 1, 2].map(i => {
        const k = `${g.world}|${g.day}|merc${i}`;
        const c = r.classes.filter(x => !x.schools?.length)[Math.floor(H(`${k}c`) * r.classes.filter(x => !x.schools?.length).length)] ?? r.classes[0];
        const level = Math.max(1, s.level + Math.floor(H(`${k}l`) * 3) - 1);
        return { id: `merc_${g.day}_${i}`, name: names[Math.floor(H(`${k}n`) * names.length)], cls: c.id, level, wage: (r.mercWage ?? 6) * level };
    }).filter(m => !mercs(g).some(x => x.merc!.id === m.id));
}
export function hire(g: Save, w: WorldDef, id: string): string {
    const m = forHire(g, w).find(x => x.id === id); if (!m) return '';
    if (mercs(g).length >= MAX_MERCS) return `You can keep ${MAX_MERCS} sellswords at a time.`;
    if (g.player.money < m.wage) return 'Not enough money for the first day\'s wage.';
    g.player.money -= m.wage; book(g, `${m.name}, sellsword`, -m.wage);
    partyOf(g).members.push({ merc: m, row: rowFor(rpgOf(w)!.classes.find(c => c.id === m.cls) ?? null), cls: m.cls });
    note(g, '{u} hired a sellsword: {0}.', [m.name], [], g.player.loc, 'work');
    return `${m.name} joins you for ${m.wage} a day.`;
}
export function dismissMerc(g: Save, id: string) { partyOf(g).members = partyOf(g).members.filter(m => m.merc?.id !== id); }

// Each day: sellswords want their wage, or they walk away. Companions stay at your side (a new day, same road).
onDay.push((g, w) => {
    if (!isRpg(w)) return [];
    const out: string[] = [];
    for (const m of mercs(g)) {
        const wage = m.merc!.wage;
        if (g.player.money >= wage) { g.player.money -= wage; book(g, `${m.merc!.name}, sellsword`, -wage); }
        else { dismissMerc(g, m.merc!.id); out.push(`${m.merc!.name} the sellsword leaves: you could not pay today.`); }
    }
    if (!mortalOn(g, w)) for (const m of partyOf(g).members) delete m.hp;   // a night's rest heals their wounds (when death is real, only some: sim/mortal.ts)
    for (const m of friends(g)) follow(g, m.avatar!);
    return out;
});

// For the AI: who is in the party (the sellswords too: they are not cards, so the AI plays them as extras).
export function partyLine(g: Save, w: WorldDef): string {
    const list = partyOf(g).members.filter(m => !m.avatar || g.cast[m.avatar]);
    if (!list.length || !isRpg(w)) return '';
    const cls = (id: string) => rpgOf(w)?.classes.find(c => c.id === id)?.name.toLowerCase() ?? 'fighter';
    return `{{user}}'s adventuring party: ${list.map(m => `${memberName(g, m)} (${cls(m.cls)}, ${m.row} row)`).join(', ')}.${mercs(g).length ? ' The sellswords are hired hands who follow orders and say little.' : ''}`;
}
