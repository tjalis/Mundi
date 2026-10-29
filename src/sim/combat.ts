// Combat (RPG mode). Two ways to fight the same fight: turn by turn (tactical: initiative, actions, rows, reactions)
// or all at once (narrative: the engine plays every turn and the AI tells the story). The engine rolls everything.
//   Rows: a melee blow reaches only the front row while anyone stands there; bows and spells reach anyone.
//   Synergy: a bard in the party quickens everyone (+2 initiative); people close to you (bond 60+ or your partner)
//   hit harder together (+1 to hit on the same foe in a round); a heavily armored front row covers the back (+1 armor).
//   Reactions: someone defending in the front row steps in front of a blow aimed at the back row; a heavily armored
//   or defending fighter answers a clumsy melee miss with a riposte.
//   Sellswords who fall in a fight are dead and gone; companions only wounded.
import { lex } from '../core/lexicon.js';
import { esc, type Save } from '../core/store.js';
import { getWorld, type WorldDef } from '../core/world.js';
import { rpgOf, roleAttr, type Ability, type Foe, type RpgClass, type Weapon, type Element } from '../core/rpgdef.js';
import { talentSum, isRpg, sheetOf, classOf, mod, prof, attr, hpMax, changeHp, addXp, addRenown, count, rollCheck, checkWon, weaponOf, type Sheet } from './rpg.js';
import { partyOf, memberName, memberKey, dismissMerc, type Member, type Row } from './party.js';
import { bondOf, isPartner, bump } from './social.js';
import { note } from './facts.js';
import { book } from './ledger.js';
import { advance } from './time.js';
import { placeOf } from './places.js';
import { afterFight } from './hooks.js';
export { afterFight };
import { addRep } from './standing.js';
import { graduated } from './mentors.js';
import { xpMul, faithOf } from './realm.js';
import { elementMul } from './elements.js';
import { weatherAt } from './worldstate.js';
import { ailOf, carryDebuff, injure, injuryPenalty, spellFails, addStress, DEBUFF_WORD } from './afflictions.js';
import { gemBonus, bladeBonus, familiarFighter } from './artifacts.js';

export type Side = 'us' | 'them';
export interface Fighter {
    id: string; name: string; side: Side; who: 'you' | 'friend' | 'merc' | 'foe' | 'pet'; ref: string;
    row: Row; hp: number; max: number; ac: number; atk: number; dice: number; sides: number; dmg: number; ranged: boolean;
    weapon: string; init: number; heavy?: boolean; ability?: Ability; used?: boolean;
    defend?: boolean; guarded?: boolean; riposted?: boolean; shield?: number; hidden?: boolean; inspired?: number; rage?: number; down?: boolean;
    level: number; tags?: string[];
    /** afflictions with the turns left (poison, burn, blind, silence, curse, slow); an element; soaked this round */
    effects?: Record<string, number>; element?: Element; inflict?: Foe['inflict']; wet?: number; wetBy?: string; ticked?: number; icon?: string;
}
export interface Combat {
    id: string; where: string; why: string; quest?: string; mode?: 'tactical' | 'quick';
    list: Fighter[]; order: string[]; turn: number; round: number; log: string[];
    mark?: { on: string; bonus: number }; hits: Record<string, string[]>;
    over?: 'won' | 'lost' | 'fled'; summary?: string; msgs?: string[];
    /** what happened, one line at a time, with everyone's hit points right after it (the screen plays them back) */
    frames?: Frame[]; fn?: number;
}
export interface Frame { n: number; text: string; hp: Record<string, number> }
function snap(c: Combat, lines: string[]) {
    const hp = Object.fromEntries(c.list.map(f => [f.id, f.hp]));
    for (const text of lines) { c.fn = (c.fn ?? 0) + 1; (c.frames ??= []).push({ n: c.fn, text, hp }); }
    c.frames = (c.frames ?? []).slice(-150);
}
export const combatOf = (g: Save | null | undefined): Combat | null => ((g as any)?.combat ?? null);
export const inCombat = (g: Save | null | undefined) => !!combatOf(g) && !combatOf(g)!.over;

const roll = (n: number, sides: number) => { let t = 0; for (let i = 0; i < n; i++) t += 1 + Math.floor(Math.random() * sides); return t; };
const d20 = () => roll(1, 20);
const V = (a: Fighter, he: string, you: string) => (a.who === 'you' ? you : he);
const FISTS: Weapon = { name: 'fists', dice: 1, sides: 4, attr: 'str' };
// Bare hands use the RPG's strength-like attribute (a system may have no STR).
const fists = (w: WorldDef): Weapon => ({ ...FISTS, attr: roleAttr(rpgOf(w), 'melee') });
const acOf = (armor: number, dex: number) => 10 + armor + (armor >= 5 ? 0 : armor >= 3 ? Math.min(2, dex) : dex);

/* ---------- who fights ---------- */

function youFighter(w: WorldDef, g: Save, s: Sheet): Fighter {
    const c = classOf(w, s); const own = weaponOf(w, s); const wp = own ?? fists(w); const m = mod(attr(s, wp.attr));
    const r = rpgOf(w); const def = roleAttr(r, 'defense'), ini = roleAttr(r, 'initiative');
    return {
        id: 'you', name: 'You', side: 'us', who: 'you', ref: 'you', row: wp.ranged ? 'back' : 'front',
        hp: s.hp, max: hpMax(w, s), ac: acOf(c?.armor ?? 0, mod(attr(s, def))) + talentSum(w, s, 'armor'), atk: (own && !own.trained ? 0 : prof(s.level)) + m + talentSum(w, s, 'attack'), dice: wp.dice, sides: wp.sides, dmg: m + talentSum(w, s, 'damage'),
        ranged: !!wp.ranged, weapon: wp.name, init: mod(attr(s, ini)) + talentSum(w, s, 'initiative'), heavy: (c?.armor ?? 0) >= 5, ability: c?.ability, level: s.level,
        element: wp.element, effects: Object.fromEntries(ailOf(g).debuffs.filter(d => d.until > g.day && ['curse', 'blind', 'silence', 'poison'].includes(d.kind)).map(d => [d.kind, 3])),
    };
}
// Gems, a sentient weapon's mood and injuries change your numbers in a fight.
function gear(g: Save, w: WorldDef, f: Fighter): Fighter {
    f.atk += gemBonus(g, w, 'attack') + bladeBonus(g, w) - injuryPenalty(g, w);
    f.dmg += gemBonus(g, w, 'damage'); f.ac += gemBonus(g, w, 'armor');
    return f;
}
// A companion or sellsword: a fighter of their class, at a level, with sensible scores (their key score high).
export function npcFighter(w: WorldDef, c: RpgClass | null, level: number, base: Pick<Fighter, 'id' | 'name' | 'who' | 'ref' | 'row'>, hp?: number): Fighter {
    const r = rpgOf(w); const def = roleAttr(r, 'defense');
    const attrs: Record<string, number> = { str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 10 };
    for (const a of r?.attributes ?? []) attrs[a.id] ??= 10;
    attrs[def] = Math.max(attrs[def] ?? 10, 14); if (r?.hpAttr) attrs[r.hpAttr] = Math.max(attrs[r.hpAttr] ?? 10, 14);
    const wp = c?.weapon ?? fists(w);
    if (wp.attr !== c?.key) attrs[wp.attr] = Math.max(attrs[wp.attr] ?? 10, 14);
    attrs[c?.key ?? 'str'] = 16;
    const s = { cls: c?.id ?? '', level, attrs } as unknown as Sheet;
    const max = hpMax(w, s); const m = mod(attrs[wp.attr] ?? 10);
    return {
        ...base, side: 'us', hp: Math.max(1, Math.min(max, hp ?? max)), max, ac: acOf(c?.armor ?? 0, mod(attrs[def])), atk: prof(level) + m,
        dice: wp.dice, sides: wp.sides, dmg: m, ranged: !!wp.ranged, weapon: wp.name, init: mod(attrs[roleAttr(r, 'initiative')] ?? 10), heavy: (c?.armor ?? 0) >= 5, ability: c?.ability, level, element: wp.element,
    };
}
function memberFighter(g: Save, w: WorldDef, m: Member, lvl: number): Fighter {
    const c = rpgOf(w)?.classes.find(x => x.id === m.cls) ?? null;
    return npcFighter(w, c, m.merc ? m.merc.level : lvl + (m.avatar && graduated(g, m.avatar) ? 1 : 0), { id: memberKey(m), name: memberName(g, m), who: m.merc ? 'merc' : 'friend', ref: memberKey(m), row: m.row }, m.hp);
}
function foeFighter(f: Foe, n: number): Fighter {
    return {
        id: `${f.id}#${n}`, name: n > 1 ? `${f.name} ${n}` : f.name, side: 'them', who: 'foe', ref: f.id, row: f.row ?? (f.ranged ? 'back' : 'front'),
        hp: f.hp, max: f.hp, ac: f.ac, atk: f.atk, dice: f.dice, sides: f.sides, dmg: f.bonus ?? 0, ranged: !!f.ranged, weapon: f.ranged ? 'shot' : 'attack',
        init: Math.floor((f.ac - 10) / 2), level: f.level, tags: f.tags, element: f.element, inflict: f.inflict, icon: f.icon,
    };
}
// Foes for a fight: from the bestiary, by place (road, wild, town…), as many as the party can take on (total level).
export function pickFoes(g: Save, w: WorldDef, tags: string[], budget: number): Foe[] {
    const all = rpgOf(w)?.bestiary ?? [];
    const pool = all.filter(f => !tags.length || (f.tags ?? []).some(t => tags.includes(t)));
    const list = pool.length ? pool : all;
    const out: Foe[] = [];
    let left = Math.max(1, budget);
    for (let i = 0; i < 6 && left > 0; i++) {
        const fit = list.filter(f => f.level <= left);
        if (!fit.length) break;
        const f = fit[Math.floor(Math.random() * fit.length)];
        out.push(f); left -= f.level;
        if (out.length >= 2 && Math.random() < 0.35) break;
    }
    if (!out.length && list.length) out.push([...list].sort((a, b) => a.level - b.level)[0]);
    return out;
}

export interface StartOpts { why: string; tags?: string[]; foes?: string[]; quest?: string; where?: string }
export function startCombat(g: Save, w: WorldDef, o: StartOpts): Combat | null {
    const s = sheetOf(g); const r = rpgOf(w);
    if (!s || !r || !isRpg(w) || !(r.bestiary ?? []).length || inCombat(g)) return null;
    const party = partyOf(g).members.filter(m => !m.avatar || g.cast[m.avatar]);
    const us = [gear(g, w, youFighter(w, g, s)), ...party.map(m => memberFighter(g, w, m, s.level))];
    // a soul-bound familiar, awakened, fights at your side
    const fam = familiarFighter(g, w);
    if (fam) us.push({ id: `pet:${fam.ref}`, name: fam.name, side: 'us', who: 'pet', ref: fam.ref, row: 'front', hp: fam.hp, max: fam.hp, ac: 12 + Math.floor(fam.level / 3), atk: fam.atk, dice: 1, sides: 6, dmg: fam.dmg, ranged: false, weapon: 'claws', init: 2, level: fam.level, icon: fam.icon });
    const foes = o.foes?.length ? o.foes.map(id => r.bestiary!.find(f => f.id === id)).filter(Boolean) as Foe[]
        : pickFoes(g, w, o.tags ?? [], us.reduce((a, f) => a + f.level, 0));
    const seen: Record<string, number> = {};
    const total: Record<string, number> = {};
    foes.forEach(f => (total[f.id] = (total[f.id] ?? 0) + 1));
    const them = foes.map(f => { seen[f.id] = (seen[f.id] ?? 0) + 1; return foeFighter(f, total[f.id] > 1 ? seen[f.id] : 1); });
    const c: Combat = { id: `fight${g.day}_${g.minutes}`, where: o.where ?? g.player.loc, why: o.why, quest: o.quest, list: [...us, ...them], order: [], turn: 0, round: 1, log: [], hits: {} };
    // initiative: d20 + quickness (+2 for everyone on your side if a bard-like inspirer is with you)
    const quick = us.some(f => f.ability?.kind === 'inspire') ? 2 : 0;
    const ini = new Map(c.list.map(f => [f.id, d20() + f.init + (f.side === 'us' ? quick : 0)]));
    c.order = [...c.list].sort((a, b) => ini.get(b.id)! - ini.get(a.id)! || (a.side === 'us' ? -1 : 1)).map(f => f.id);
    c.log.push(`${o.why} ${them.map(f => f.name).join(', ')}!${quick ? ' (Inspired by your bard, your side moves first.)' : ''}`);
    snap(c, [c.log[0]]);
    (g as any).combat = c;
    note(g, '{u} got into a fight: {0}.', [them.map(f => f.name).join(', ')], party.filter(m => m.avatar).map(m => m.avatar!), g.player.loc, 'event');
    return c;
}

/* ---------- the rules of a turn ---------- */

const F = (c: Combat, id: string) => c.list.find(f => f.id === id)!;
export const standing = (c: Combat, side: Side) => c.list.filter(f => f.side === side && !f.down);
export const current = (c: Combat): Fighter | null => (c.over ? null : F(c, c.order[c.turn]) ?? null);
export const yourTurn = (c: Combat | null) => !!c && !c.over && c.mode === 'tactical' && current(c)?.id === 'you';

// Who an attacker can reach: melee reaches only the front row while it stands.
export function targetsFor(c: Combat, a: Fighter, ranged = a.ranged): Fighter[] {
    const foes = standing(c, a.side === 'us' ? 'them' : 'us');
    if (ranged) return foes;
    const front = foes.filter(f => f.row === 'front');
    return front.length ? front : foes;
}
const bonded = (g: Save, a: Fighter, b: Fighter) => {
    const pair = [a, b]; const you = pair.find(f => f.who === 'you'); const fr = pair.find(f => f.who === 'friend');
    return !!you && !!fr && (bondOf(g, fr.ref) >= 60 || isPartner(g, fr.ref));
};
function armorOf(c: Combat, t: Fighter): number {
    let ac = t.ac + (t.shield ?? 0) + (t.defend ? 2 : 0) - (t.rage ? 2 : 0);
    if (t.row === 'back' && standing(c, t.side).some(f => f.row === 'front' && f.heavy)) ac += 1;   // cover
    return ac;
}

function hit(g: Save, c: Combat, a: Fighter, target: Fighter, react = true, spell?: { name: string; dice: number; sides: number; dmg: number; element?: Element }): string[] {
    const out: string[] = [];
    let t = target;
    // guardian: someone defending in the front row takes a blow aimed at the back row (once a round)
    if (react && a.side === 'them' && t.row === 'back') {
        const g2 = standing(c, t.side).find(f => f.row === 'front' && f.defend && !f.guarded && f.id !== t.id);
        if (g2) { g2.guarded = true; out.push(`🛡️ ${g2.name} steps in front of ${t.name}!`); t = g2; }
    }
    const melee = !spell && !a.ranged;
    if (melee && a.row === 'back') { a.row = 'front'; out.push(`${a.name} ${V(a, 'steps', 'step')} forward.`); }
    const r1 = d20(), r2 = a.hidden ? d20() : 0, die = Math.max(r1, r2);
    let bonus = a.atk + (a.inspired ?? 0) - (a.effects?.blind ? 4 : 0) - (a.effects?.curse ? 2 : 0);
    const mates = c.hits[t.id] ?? [];
    const together = a.side === 'us' && mates.some(id => id !== a.id && bonded(g, a, F(c, id)));
    if (together) bonus += 1;
    const ac = armorOf(c, t);
    const total = die + bonus;
    const crit = die === 20, miss = die === 1 || (!crit && total < ac);
    const wname = spell?.name ?? a.weapon;
    a.inspired = 0;
    if (miss) {
        out.push(`${a.name} ${spell ? V(a, 'casts', 'cast') : V(a, 'attacks', 'attack')} ${t.name} with ${wname}: ${die}${bonus >= 0 ? '+' : ''}${bonus} = ${total} vs ${ac}, miss.`);
        // riposte: a heavily armored or defending fighter answers a clumsy melee miss
        if (react && melee && !t.down && !t.riposted && t.side === 'us' && (t.heavy || t.defend) && ac - total >= 3) {
            t.riposted = true;
            out.push(`⚔️ ${t.name} ${V(t, 'ripostes', 'riposte')}!`); out.push(...hit(g, c, t, a, false));
        }
        a.hidden = false;
        return out;
    }
    let dmg = roll((spell?.dice ?? a.dice) * (crit ? 2 : 1), spell?.sides ?? a.sides) + (spell?.dmg ?? a.dmg) + (a.rage ?? 0);
    if (a.hidden) dmg += roll(2, 6);
    if (c.mark?.on === t.id && a.side === 'us') dmg += c.mark.bonus;
    // elements: the weather, and a soaked foe struck by lightning
    const w = getWorld(g.world); const el = spell?.element ?? a.element;
    let combo = false;
    if (w && el) {
        dmg = Math.round(dmg * elementMul(w, el, weatherAt(g, w, c.where)));
        if (el === 'lightning' && t.wet === c.round && t.wetBy !== a.id) { dmg *= 2; combo = true; }
        if (el === 'water') { t.wet = c.round; t.wetBy = a.id; }
    }
    dmg = Math.max(1, dmg);
    t.hp = Math.max(0, t.hp - dmg);
    (c.hits[t.id] ??= []).push(a.id);
    out.push(`${a.name} ${spell ? V(a, 'casts', 'cast') : V(a, 'attacks', 'attack')} ${t.name} with ${wname}: ${die}${bonus >= 0 ? '+' : ''}${bonus} = ${total} vs ${ac}, ${crit ? 'CRITICAL hit' : 'hit'} for ${dmg}${together ? ' (fighting as one)' : ''}${a.hidden ? ' (from the shadows)' : ''}${el === 'water' ? ' (soaked)' : ''}.`);
    a.hidden = false;
    if (combo) {   // the lightning arcs through the water to every other foe
        out.push(`⚡ Elemental combo! The lightning arcs through the water.`);
        for (const o of standing(c, t.side).filter(x => x.id !== t.id)) { const d = Math.max(1, Math.floor(dmg / 4)); o.hp = Math.max(0, o.hp - d); out.push(`${o.name} is struck for ${d}.`); if (o.hp <= 0) { o.down = true; out.push(o.who === 'foe' ? `💀 ${o.name} falls.` : `${o.name} is down!`); } }
    }
    // a bite, a hex, a burn: an affliction that lasts a few turns
    if (a.inflict && t.hp > 0 && Math.random() < a.inflict.chance) { (t.effects ??= {})[a.inflict.kind] = a.inflict.turns; out.push(`${t.name} ${V(t, 'is', 'are')} ${DEBUFF_WORD[a.inflict.kind] ?? a.inflict.kind}!`); }
    if (t.hp <= 0) { t.down = true; out.push(t.who === 'foe' ? `💀 ${t.name} falls.` : t.who === 'merc' ? `💀 ${t.name} falls and does not get up.` : `${t.name} ${V(t, 'is', 'are')} down!`); }
    return out;
}
function heal(c: Combat, a: Fighter, pct: number, who?: Fighter): string[] {
    const t = who ?? [...standing(c, a.side)].sort((x, y) => x.hp / x.max - y.hp / y.max)[0] ?? a;
    const n = Math.max(1, Math.round(t.max * pct / 100));
    t.hp = Math.min(t.max, t.hp + n);
    return [`💚 ${a.name} ${V(a, 'heals', 'heal')} ${t.id === a.id ? V(a, 'themself', 'yourself') : t.name} for ${n}.`];
}
function useAbility(c: Combat, a: Fighter, target?: Fighter): string[] {
    const ab = a.ability; if (!ab || a.used) return [];
    a.used = true;
    const name = `✨ ${a.name} ${V(a, 'uses', 'use')} ${ab.name}`;
    switch (ab.kind) {
        case 'heal': return [`${name}.`, ...heal(c, a, ab.amount ?? 30, ab.name.toLowerCase().includes('second') ? a : undefined)];
        case 'guard': a.defend = true; return [`${name}: guarding the back row.`];
        case 'shield': a.shield = ab.amount ?? 5; return [`${name}: +${ab.amount ?? 5} armor until their next turn.`];
        case 'hide': a.hidden = true; return [`${name}: gone from sight.`];
        case 'inspire': standing(c, a.side).forEach(f => { if (f.id !== a.id) f.inspired = ab.amount ?? 2; }); return [`${name}: everyone's next blow lands truer (+${ab.amount ?? 2}).`];
        case 'mark': { const t = target ?? targetsFor(c, a, true)[0]; if (!t) return []; c.mark = { on: t.id, bonus: ab.amount ?? 4 }; return [`${name} on ${t.name}: +${ab.amount ?? 4} damage against it.`]; }
        case 'rage': a.rage = ab.amount ?? 2; return [`${name}: +${ab.amount ?? 2} damage, but guard dropped.`];
    }
    return [];
}

// What someone does on their own (foes, companions, sellswords; you too in a narrative fight).
function auto(g: Save, c: Combat, a: Fighter): string[] {
    if (a.side === 'us' && a.ability && !a.used) {
        const k = a.ability.kind;
        const hurt = standing(c, 'us').some(f => f.hp / f.max <= 0.4);
        const back = standing(c, 'us').some(f => f.row === 'back' && f.id !== a.id);
        if ((k === 'heal' && hurt) || (k === 'guard' && a.row === 'front' && back) || k === 'mark' || k === 'inspire' || k === 'hide' || k === 'rage' || (k === 'shield' && a.hp / a.max <= 0.6))
            return useAbility(c, a);
    }
    const list = targetsFor(c, a);
    if (!list.length) return [];
    const pickT = a.side === 'us'
        ? ([...list].find(f => c.mark?.on === f.id) ?? [...list].sort((x, y) => x.hp - y.hp)[0])
        : [...list].sort((x, y) => x.hp / x.max - y.hp / y.max + (Math.random() - 0.5) * 0.6)[0];
    return hit(g, c, a, pickT);
}

/* ---------- running the fight ---------- */

function nextTurn(c: Combat) {
    for (let i = 0; i < c.order.length; i++) {
        c.turn++;
        if (c.turn >= c.order.length) { c.turn = 0; c.round++; c.hits = {}; c.list.forEach(f => { f.guarded = false; f.riposted = false; }); }
        const f = F(c, c.order[c.turn]);
        if (!f.down) { f.defend = false; f.shield = 0; return; }
    }
}
// The start of someone's turn: poison and burns hurt, afflictions run down; a sluggish fighter may lose the turn.
function tick(c: Combat, f: Fighter): { lines: string[]; skip: boolean } {
    const lines: string[] = []; let skip = false;
    if (!f.effects || f.ticked === c.round) return { lines, skip };
    f.ticked = c.round;
    for (const [k, n] of Object.entries(f.effects)) {
        if (n <= 0) { delete f.effects[k]; continue; }
        if (k === 'poison' || k === 'burn') { const d = roll(1, k === 'burn' ? 6 : 4); f.hp = Math.max(0, f.hp - d); lines.push(`${k === 'burn' ? '🔥' : '🤢'} ${f.name} ${V(f, 'takes', 'take')} ${d} from ${k === 'burn' ? 'the burns' : 'the poison'}.`); if (f.hp <= 0) { f.down = true; lines.push(f.who === 'foe' ? `💀 ${f.name} falls.` : `${f.name} ${V(f, 'is', 'are')} down!`); } }
        if (k === 'slow' && Math.random() < 0.5) { skip = true; lines.push(`${f.name} ${V(f, 'is', 'are')} too sluggish to act.`); }
        f.effects[k] = n - 1; if (f.effects[k] <= 0) delete f.effects[k];
    }
    return { lines, skip };
}
function decided(c: Combat): boolean { return !standing(c, 'us').length || !standing(c, 'them').length; }

// Plays the turns that are not yours, until it is your turn (tactical) or the fight is over.
export function runAI(g: Save, w: WorldDef): string[] {
    const c = combatOf(g); if (!c || c.over) return [];
    const out: string[] = [];
    let guard = 0;
    while (!c.over && guard++ < 400) {
        if (decided(c)) { const fl = finish(g, w); snap(c, fl); out.push(...fl); break; }
        const f = current(c)!;
        if (f.down) { nextTurn(c); continue; }
        const tk = tick(c, f); if (tk.lines.length) { snap(c, tk.lines); out.push(...tk.lines); }
        if (f.down || tk.skip) { if (decided(c)) continue; nextTurn(c); continue; }
        if (c.mode === 'tactical' && f.id === 'you') break;
        const lines = auto(g, c, f); snap(c, lines); out.push(...lines);
        if (decided(c)) { const fl = finish(g, w); snap(c, fl); out.push(...fl); break; }
        nextTurn(c);
    }
    c.log.push(...out); c.log = c.log.slice(-60);
    return out;
}
// How you want to fight: turn by turn, or let it play out and hear the story.
export function chooseMode(g: Save, w: WorldDef, mode: 'tactical' | 'quick'): string[] {
    const c = combatOf(g); if (!c || c.over) return [];
    c.mode = mode;
    if (current(c)?.down) nextTurn(c);
    return runAI(g, w);
}

export type Action = { kind: 'attack'; target: string } | { kind: 'defend' } | { kind: 'ability'; target?: string } | { kind: 'cast'; spell: string; target?: string } | { kind: 'flee' };
// Your move (tactical). Returns what happened, then everyone else's turns until yours again.
export function act(g: Save, w: WorldDef, a: Action): string[] {
    const c = combatOf(g); if (!yourTurn(c)) return [];
    const me = F(c!, 'you'); const out: string[] = [];
    if (a.kind === 'attack') {
        const t = targetsFor(c!, me).find(f => f.id === a.target); if (!t) return ['You cannot reach that one (melee hits only the front row while it stands).'];
        out.push(...hit(g, c!, me, t));
    } else if (a.kind === 'defend') { me.defend = true; out.push(`🛡️ You raise your guard (+2 armor${me.row === 'front' ? ', protecting the back row' : ''}).`); }
    else if (a.kind === 'ability') { if (!me.ability || me.used) return ['Already used in this fight.']; out.push(...useAbility(c!, me, a.target ? F(c!, a.target) : undefined)); }
    else if (a.kind === 'cast') { const r = castIn(g, w, c!, me, a.spell, a.target); if (!r.length) return [lex(w, 'cannotCast')]; out.push(...r); }
    else if (a.kind === 'flee') {
        const foes = standing(c!, 'them');
        const ck = rollCheck(g, w, 'acrobatics', 10 + Math.min(8, foes.length * 2));
        if (checkWon(ck)) { out.push(`🏃 You break away (Acrobatics ${ck.total})!`); snap(c!, out); const fl = finish(g, w, 'fled'); snap(c!, fl); c!.log.push(...out, ...fl); return [...out, ...fl]; }
        out.push(`🏃 You try to break away (Acrobatics ${ck.total}) but they cut you off.`);
    }
    c!.log.push(...out); snap(c!, out);
    if (decided(c!)) { const fl = finish(g, w); snap(c!, fl); c!.log.push(...fl); return [...out, ...fl]; }
    nextTurn(c!);
    return [...out, ...runAI(g, w)];
}

/* ---------- spells in a fight ---------- */

export function combatSpells(g: Save, w: WorldDef) {
    const s = sheetOf(g); const r = rpgOf(w); if (!s || !r) return [];
    return r.spells.filter(sp => s.prepared.includes(sp.id) && (sp.effect.kind === 'heal' || !!sp.combat || sp.school === 'evocation' || sp.school === 'abjuration'));
}
function castIn(g: Save, w: WorldDef, c: Combat, me: Fighter, id: string, target?: string): string[] {
    const s = sheetOf(g)!; const sp = combatSpells(g, w).find(x => x.id === id);
    if (!sp || s.focus < sp.cost) return [];
    if (me.effects?.silence) return ['You cannot speak the words: you are silenced!'];
    const fail = spellFails(g, w);
    if (/too frayed/.test(fail)) return [fail];
    s.focus -= sp.cost; addStress(g, w, sp.cost);
    if (fail) return [fail];
    const key = classOf(w, s)?.key ?? 'int'; const m = mod(attr(s, key));
    if (sp.effect.kind === 'heal') {
        const t = target ? c.list.find(f => f.id === target && f.side === 'us' && !f.down) : undefined;
        return [lex(w, 'youCast', sp.name), ...heal(c, me, sp.effect.amount ?? 20, t)];
    }
    if (sp.combat === 'shield' || (!sp.combat && sp.school === 'abjuration')) {
        const t = (target && c.list.find(f => f.id === target && f.side === 'us' && !f.down)) || me;
        t.shield = (t.shield ?? 0) + 2 + sp.level;
        return [`${lex(w, 'youCast', sp.name).replace(/\.$/, '')} on ${t.id === me.id ? 'yourself' : t.name}: +${2 + sp.level} armor.`];
    }
    const t = targetsFor(c, me, true).find(f => f.id === target) ?? targetsFor(c, me, true)[0];
    if (!t) return [];
    const saved = me.atk; me.atk = prof(s.level) + m;
    const out = hit(g, c, me, t, true, { name: sp.name, dice: sp.level + 1, sides: 8, dmg: m, element: sp.element });
    me.atk = saved;
    return out;
}

/* ---------- the end ---------- */

function finish(g: Save, w: WorldDef, how?: 'fled'): string[] {
    const c = combatOf(g)!; const s = sheetOf(g)!;
    if (c.over) return [];
    c.over = how ?? (standing(c, 'us').length ? 'won' : 'lost');
    let warded = false;
    if (c.over === 'lost' && faithOf(g).ward) { faithOf(g).ward = false; warded = true; c.over = 'fled'; F(c, 'you').hp = Math.max(1, F(c, 'you').hp); }   // a god's ward turns a defeat aside
    const out: string[] = [];
    const msgs: string[] = [];
    const me = F(c, 'you');
    const foes = c.list.filter(f => f.side === 'them');
    const party = partyOf(g);
    // wounds carry over: your hit points, your companions'; fallen sellswords are gone
    for (const f of c.list.filter(x => x.side === 'us' && x.who !== 'you')) {
        if (f.who === 'merc' && f.down) { dismissMerc(g, f.ref); msgs.push(`${f.name} died in the fight.`); note(g, '{0} died fighting at {u}\'s side.', [f.name], [], g.player.loc, 'event'); continue; }
        const m = party.members.find(x => memberKey(x) === f.ref);
        if (m) m.hp = Math.max(1, f.hp);
        if (f.who === 'friend' && c.over !== 'fled') bump(g, f.ref, 3);
    }
    const friends = c.list.filter(f => f.who === 'friend').map(f => f.ref);
    if (c.over === 'won') {
        changeHp(g, w, Math.max(1, me.hp) - s.hp);
        const xp = Math.round(foes.reduce((a, f) => a + 25 * f.level, 0) * xpMul(w));
        const coins = foes.filter(f => (f.tags ?? []).some(t => t === 'road' || t === 'town')).reduce((a, f) => a + f.level * (3 + Math.floor(Math.random() * 8)), 0);
        if (coins) { g.player.money += coins; book(g, 'Spoils of a fight', coins); }
        msgs.push(...addXp(g, w, xp, 'fight'), ...addRenown(g, w, Math.max(1, Math.round(foes.reduce((a, f) => a + f.level, 0) / 2))), ...count(g, w, 'fights'));
        out.push(`🏆 Victory! +${xp} XP${coins ? `, ${coins} in coins` : ''}.`);
        { const m = addRep(g, w, Math.max(1, Math.round(foes.reduce((a, f) => a + f.level, 0) / 2)), 'fight', c.where); if (m) msgs.push(m); }
        note(g, '{u} won a fight against {0}.', [foes.map(f => f.name).join(', ')], friends, g.player.loc, 'event');
        c.summary = `{{user}}'s side won the fight against ${foes.map(f => f.name).join(', ')}${friends.length ? ` (with ${friends.map(a => g.cast[a]?.name).join(', ')})` : ''}. ${me.down ? '{{user}} was knocked down but is back on their feet, badly hurt.' : me.hp < me.max / 3 ? '{{user}} is badly hurt.' : ''}`.trim();
    } else if (c.over === 'fled') {
        changeHp(g, w, Math.max(1, me.hp) - s.hp);
        note(g, '{u} fled from a fight with {0}.', [foes.map(f => f.name).join(', ')], friends, g.player.loc, 'event');
        c.summary = warded ? `{{user}} was about to fall against ${foes.map(f => f.name).join(', ')}, but a divine ward turned the blow aside and {{user}} escaped.` : `{{user}} fled from a fight with ${foes.map(f => f.name).join(', ')}.`;
        if (warded) msgs.push('A divine ward saved you from defeat!');
    } else {
        changeHp(g, w, -s.hp);
        const lose = Math.round(g.player.money * 0.15);
        if (lose > 0 && foes.some(f => (f.tags ?? []).includes('road') || (f.tags ?? []).includes('town'))) { g.player.money -= lose; book(g, 'Robbed after a lost fight', -lose); msgs.push('They took some of your coins.'); }
        out.push('☠️ Defeat. Everything goes dark…');
        note(g, '{u} was beaten in a fight by {0}.', [foes.map(f => f.name).join(', ')], friends, g.player.loc, 'event');
        c.summary = `{{user}} lost the fight against ${foes.map(f => f.name).join(', ')} and was knocked out.`;
        msgs.push(...advance(g, w, 30));   // the world's "at zero" rule (the healer) takes over
    }
    // afflictions that outlast the fight, and injuries from going down
    for (const [k, n] of Object.entries(me.effects ?? {})) if (n > 0) carryDebuff(g, w, k, n);
    if (me.down || c.over === 'lost') { const m = injure(g, w, c.where); if (m) msgs.push(m); }
    for (const f of afterFight) msgs.push(...f(g, w, c));
    c.msgs = msgs;
    return out;
}
export function closeCombat(g: Save): string { const c = combatOf(g); if (!c?.over) return ''; delete (g as any).combat; return c.summary ?? ''; }

/* ---------- for the AI ---------- */

const state = (f: Fighter) => (f.down ? 'down' : f.hp / f.max > 0.66 ? 'unhurt' : f.hp / f.max > 0.33 ? 'hurt' : 'badly hurt');
export function combatLine(g: Save, w: WorldDef): string {
    const c = combatOf(g); if (!c || !isRpg(w)) return '';
    if (c.over) return '';
    const side = (s: Side) => c.list.filter(f => f.side === s).map(f => `${f.who === 'you' ? '{{user}}' : f.name} (${f.row} row, ${state(f)})`).join(', ');
    return `{{user}} is in a fight at ${placeOf(g, w, c.where)?.name ?? 'this place'}, round ${c.round}. {{user}}'s side: ${side('us')}. Enemies: ${side('them')}. The engine decides every blow; narrate only what it reports: ${c.log.slice(-4).join(' ')}`;
}
export const fightLogHtml = (c: Combat) => c.log.slice(-12).map(l => `<li>${esc(l)}</li>`).join('');
