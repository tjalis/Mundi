// The RPG character sheet (RPG mode): level and experience, hit points, focus, attributes, a class and its subclass
// (chosen at level 3 or 5), trained skills, titles and renown. The engine rolls every d20; the AI only narrates.
// The sheet lives in the save (save.rpg). Hit points and the world's "life" need are the same thing: the need shows
// the share of hit points left, so everything that hurt or healed "life" before still does.
import { nowAbs, type Save } from '../core/store.js';
import { gameMode, type WorldDef } from '../core/world.js';
import { rpgOf, setRpgGame, type RpgDef, type RpgClass, type RpgSpell, type TalentKind, type Weapon } from '../core/rpgdef.js';
import { note } from './facts.js';
import { checkMods, onRoll } from './hooks.js';
export { checkMods };
import { SAVE, game } from '../core/store.js';
setRpgGame(() => game() as any);
import { getWorld } from '../core/world.js';

export interface Sheet {
    cls: string; sub?: string; level: number; xp: number;
    attrs: Record<string, number>; skills: string[];
    hp: number; focus: number;
    /** attribute points to spend (2 at levels 4, 8, 12) and spells to learn */
    points: number; learn: number;
    known: string[]; prepared: string[];
    /** spells can be prepared again after a long rest, until you leave */
    prepOpen: boolean;
    titles: string[]; renown: number; counts: Record<string, number>;
    /** unlimited: made with every option open (no skill budget, attributes set freely) */
    free?: boolean;
    /** the weapon you carry (an id of the RPG's weapons; none: your class's) */
    weapon?: string;
    /** skills you can still learn (one at levels 3, 5, 7…) */
    skillPicks?: number;
    /** a boost for the next check (a spell): roll twice, or add */
    next?: { advantage?: string[]; bonus?: { amount: number; skills?: string[] } };
}

export const isRpg = (w: WorldDef | null | undefined) => !!w && gameMode(w) === 'rpg' && !!rpgOf(w);
export const sheetOf = (g: Save | null | undefined): Sheet | null => ((g as any)?.rpg ?? null);
export const classOf = (w: WorldDef, s: Sheet): RpgClass | null => rpgOf(w)?.classes.find(c => c.id === s.cls) ?? null;

/* ---------- numbers ---------- */

export const mod = (score: number) => Math.floor((score - 10) / 2);
export const prof = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
export const attr = (s: Sheet, id: string) => s.attrs[id] ?? 10;
// Talents: what the chosen ones add (hit points, focus, a skill, attack, armor, damage, initiative, camp).
export function talentSum(w: WorldDef, s: Sheet, kind: TalentKind, skill?: string): number {
    if ((w.features as any)?.talents === false) return 0;
    const list = rpgOf(w)?.talents ?? [];
    return ((s as any).talents as string[] | undefined ?? []).reduce((t, id) => { const d = list.find(x => x.id === id); return t + (d && d.effect.kind === kind && (!skill || d.effect.skill === skill) ? d.effect.amount : 0); }, 0);
}
export function hpMax(w: WorldDef, s: Sheet): number {
    const r = rpgOf(w); const c = classOf(w, s);
    const hit = c?.hit ?? 8, con = mod(attr(s, r?.hpAttr ?? 'con'));
    return Math.max(1, hit + con + (s.level - 1) * Math.max(1, Math.floor(hit / 2) + 1 + con) + talentSum(w, s, 'hp'));
}
export const isCaster = (w: WorldDef, s: Sheet) => !!classOf(w, s)?.schools?.length;
export function focusMax(w: WorldDef, s: Sheet): number {
    const c = classOf(w, s); const k = Math.max(0, mod(attr(s, c?.key ?? 'str')));
    return (isCaster(w, s) ? 2 + s.level + k : 1 + Math.floor(s.level / 2)) + talentSum(w, s, 'focus');
}
export const maxPrepared = (w: WorldDef, s: Sheet) => Math.max(1, s.level + mod(attr(s, classOf(w, s)?.key ?? 'int')));
export const skillOf = (w: WorldDef, id: string) => rpgOf(w)?.skills.find(x => x.id === id) ?? null;
export function skillBonus(w: WorldDef, s: Sheet, id: string): number {
    const sk = skillOf(w, id);
    return mod(attr(s, sk?.attr ?? 'cha')) + (trained(w, s).includes(id) ? prof(s.level) : 0) + talentSum(w, s, 'skill', id);
}
// Trained skills: the ones picked, the background's, and the subclass's.
export function trained(w: WorldDef, s: Sheet): string[] {
    const sub = classOf(w, s)?.subclasses.find(x => x.id === s.sub);
    return [...new Set([...s.skills, ...(sub?.skill ? [sub.skill] : [])])];
}
export const xpFor = (w: WorldDef, level: number) => (rpgOf(w)?.xp ?? [])[level - 1] ?? Infinity;   // to reach level+1
export const maxLevel = (w: WorldDef) => (rpgOf(w)?.xp.length ?? 0) + 1;

/* ---------- making a character ---------- */

// Point buy (27 points, every attribute 8..15, like D&D): what a score costs. A system can buy flat instead (each
// point +1 from its minimum: Solo-Leveling-like stats), with its own points and range.
export const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINTS = 27;
export const buyOf = (r: RpgDef | null | undefined) => r?.pointBuy ?? { points: POINTS, min: 8, max: 15, flat: false };
export const scoreCost = (r: RpgDef | null | undefined, v: number) => { const b = buyOf(r); return b.flat ? Math.max(0, v - b.min) : (POINT_COST[v] ?? 0); };
export const pointsUsed = (attrs: Record<string, number>, r?: RpgDef | null) => Object.values(attrs).reduce((a, v) => a + scoreCost(r, v), 0);
// Unlimited: any score from 3 to 18 (or the system's own wider range), no budget.
export const freeRange = (r: RpgDef | null | undefined) => { const b = buyOf(r); return { min: Math.min(3, b.min), max: Math.max(18, b.max) }; };
export function defaultAttrs(r: RpgDef, cls?: RpgClass): Record<string, number> {
    const order = [cls?.key, r.hpAttr, ...r.attributes.map(a => a.id)].filter((x, i, l): x is string => !!x && l.indexOf(x) === i);
    const b = buyOf(r);
    if (b.flat) {   // the points go to the class's key attribute and to hit points, half each
        const out = Object.fromEntries(r.attributes.map(a => [a.id, b.min]));
        let left = b.points;
        for (const id of order) { if (left <= 0) break; const add = Math.min(b.max - b.min, id === order[0] ? Math.ceil(b.points / 2) : left); out[id] += add; left -= add; }
        return out;
    }
    const array = [15, 14, 13, 12, 10, 8];
    const out: Record<string, number> = Object.fromEntries(r.attributes.map(a => [a.id, Math.max(b.min, Math.min(b.max, array[order.indexOf(a.id)] ?? 10))]));
    // a system with fewer points (or more attributes): take back from the least important first
    for (let guard = 0; pointsUsed(out, r) > b.points && guard < 200; guard++) {
        const id = [...order].reverse().find(k => out[k] > b.min); if (!id) break; out[id]--;
    }
    return out;
}

// Starting skills: any skill of the RPG, from a budget (a class skill costs 1, any other 2). Unlimited: no budget.
export const SKILL_POINTS = 6;
export const skillBudget = (r: RpgDef | null | undefined) => r?.skillPoints ?? SKILL_POINTS;
export const skillCost = (c: RpgClass | null | undefined, id: string) => (c?.skills.includes(id) ? 1 : 2);
export const skillsUsed = (c: RpgClass | null | undefined, skills: string[]) => skills.reduce((a, id) => a + skillCost(c, id), 0);
// The skills that fit the budget, in the order picked (what does not fit is dropped).
export function fitSkills(r: RpgDef, c: RpgClass, skills: string[], free = false): string[] {
    const ok = [...new Set(skills)].filter(x => r.skills.some(k => k.id === x));
    if (free) return ok;
    const out: string[] = []; let left = skillBudget(r);
    for (const id of ok) { const cost = skillCost(c, id); if (cost <= left) { out.push(id); left -= cost; } }
    return out;
}
// The class skills a new sheet starts with when none were picked (as many as the budget pays for).
export const defaultSkills = (r: RpgDef, c: RpgClass) => fitSkills(r, c, c.skills);

// The weapon you fight with: the one you chose, or your class's. You add your proficiency with your class's weapon,
// and with any other one whose weapon skill you are trained in.
export function weaponOf(w: WorldDef, s: Sheet): (Weapon & { trained: boolean }) | null {
    const c = classOf(w, s); const r = rpgOf(w);
    const own = s.weapon ? r?.weapons?.find(x => x.id === s.weapon) : null;
    if (own && !(c?.weapon && c.weapon.name === own.name)) return { ...own, trained: !own.skill || trained(w, s).includes(own.skill) };
    return c?.weapon ? { ...c.weapon, trained: true } : null;
}

export interface NewSheet { cls: string; attrs?: Record<string, number>; skills?: string[]; free?: boolean; weapon?: string; origin?: { skills?: string[]; attributes?: Record<string, number> } }
export function makeSheet(w: WorldDef, o: NewSheet): Sheet {
    const r = rpgOf(w)!;
    const c = r.classes.find(x => x.id === o.cls) ?? r.classes[0];
    const attrs = { ...(o.attrs ?? defaultAttrs(r, c)) };
    for (const [k, v] of Object.entries(o.origin?.attributes ?? {})) attrs[k] = Math.min(20, (attrs[k] ?? 10) + v);
    const given = new Set(o.origin?.skills ?? []);   // the background's skills are free
    const picked = o.skills ? fitSkills(r, c, o.skills.filter(x => !given.has(x)), o.free) : defaultSkills(r, c);
    const s: Sheet = { cls: c.id, level: 1, xp: 0, attrs, skills: [...new Set([...picked, ...(o.origin?.skills ?? [])])], hp: 0, focus: 0, points: 0, learn: 0,
        known: [], prepared: [], prepOpen: true, titles: [], renown: 0, counts: {} };
    if (o.free) s.free = true;
    if (o.weapon && r.weapons?.some(x => x.id === o.weapon)) s.weapon = o.weapon;
    s.hp = hpMax(w, s); s.focus = focusMax(w, s);
    if (isCaster(w, s)) {   // a caster starts with two first-level spells of the class's schools, prepared
        const first = spellsFor(w, s).filter(x => x.level <= 1).slice(0, 2);
        s.known = first.map(x => x.id); s.prepared = [...s.known];
    }
    return s;
}
// A save that had no sheet (the world became RPG later): one is made with the first class and the usual scores.
export function ensureSheet(g: Save, w: WorldDef): Sheet | null {
    if (!isRpg(w)) return null;
    const origin = w.catalogs.origins?.find(o => o.id === g.player.origin);
    return ((g as any).rpg ??= makeSheet(w, { cls: rpgOf(w)!.classes[0].id, origin }));
}

/* ---------- growing ---------- */

// Spells you could learn now: of your class's schools (and your subclass's), up to half your level (rounded up).
export function spellsFor(w: WorldDef, s: Sheet): RpgSpell[] {
    const c = classOf(w, s); const sub = c?.subclasses.find(x => x.id === s.sub);
    const schools = new Set([...(c?.schools ?? []), ...(sub?.school ? [sub.school] : [])]);
    const top = Math.ceil(s.level / 2);
    return (rpgOf(w)?.spells ?? []).filter(x => schools.has(x.school) && x.level <= top);
}
export const pendingSubclass = (w: WorldDef, s: Sheet) => { const c = classOf(w, s); return !!c && !s.sub && s.level >= c.subAt && c.subclasses.length > 0; };

export function addXp(g: Save, w: WorldDef, n: number, why: string): string[] {
    const s = sheetOf(g); if (!s || !isRpg(w) || n <= 0) return [];
    s.xp += Math.round(n);
    const out: string[] = [];
    while (s.level < maxLevel(w) && s.xp >= xpFor(w, s.level)) {
        const before = hpMax(w, s);
        s.level++;
        s.hp += hpMax(w, s) - before; s.focus = focusMax(w, s);
        const r = rpgOf(w); const pts = r?.levelPoints ? r.levelPoints : s.level % 4 === 0 ? 2 : 0;
        s.points += pts;
        if (isCaster(w, s)) s.learn += 1;
        const skill = s.level % 2 === 1 && (r?.skills.length ?? 0) > trained(w, s).length;
        if (skill) s.skillPicks = (s.skillPicks ?? 0) + 1;
        note(g, '{u} reached level {0}.', [String(s.level)], [], g.player.loc, 'goal');
        out.push(`Level ${s.level}!${pendingSubclass(w, s) ? ' Choose your subclass on your character sheet.' : ''}${pts ? ` You have ${pts} attribute point${pts === 1 ? '' : 's'} to spend.` : ''}${isCaster(w, s) ? ' You can learn a new spell.' : ''}${skill ? ' You can learn a new skill.' : ''}`);
    }
    out.push(...checkTitles(g, w));
    void why;
    return out;
}
export function chooseSubclass(g: Save, w: WorldDef, id: string): string {
    const s = sheetOf(g); const c = s && classOf(w, s); const sub = c?.subclasses.find(x => x.id === id);
    if (!s || !sub || !pendingSubclass(w, s)) return '';
    s.sub = sub.id;
    note(g, '{u} became a {0}.', [sub.name], [], g.player.loc, 'goal');
    return `You are now a ${sub.name}.`;
}
export function spendPoint(g: Save, w: WorldDef, a: string): boolean {
    const s = sheetOf(g); if (!s || s.points <= 0 || attr(s, a) >= attrCap(w) || !rpgOf(w)?.attributes.some(x => x.id === a)) return false;
    const before = hpMax(w, s);
    s.attrs[a] = attr(s, a) + 1; s.points--;
    s.hp += Math.max(0, hpMax(w, s) - before);
    return true;
}
export const attrCap = (w: WorldDef) => rpgOf(w)?.attrCap ?? 20;
// A skill learned with a pick from levelling up (any skill of the RPG).
export function learnSkill(g: Save, w: WorldDef, id: string): boolean {
    const s = sheetOf(g); if (!s || (s.skillPicks ?? 0) <= 0 || trained(w, s).includes(id) || !skillOf(w, id)) return false;
    s.skills.push(id); s.skillPicks = (s.skillPicks ?? 0) - 1;
    return true;
}
export function learnSpell(g: Save, w: WorldDef, id: string): boolean {
    const s = sheetOf(g); if (!s || s.learn <= 0 || s.known.includes(id) || !spellsFor(w, s).some(x => x.id === id)) return false;
    s.known.push(id); s.learn--;
    if (s.prepared.length < maxPrepared(w, s)) s.prepared.push(id);
    return true;
}

/* ---------- hit points and rest ---------- */

// Hit points move the "life" need too (as a share of the maximum), and the other way round.
export function changeHp(g: Save, w: WorldDef, delta: number) {
    const s = sheetOf(g); if (!s) return;
    s.hp = Math.max(0, Math.min(hpMax(w, s), Math.round(s.hp + delta)));
    syncLife(g, w);
}
export function syncLife(g: Save, w: WorldDef) {
    const s = sheetOf(g); if (!s) return;
    const life = w.statuses.find(x => x.id === 'life' || x.id === 'health');
    if (life) g.player.stats[life.id] = Math.round((s.hp / hpMax(w, s)) * life.max);
}
// A long rest (a night's sleep, at home or at camp): hit points and focus back, spells can be prepared again.
export function longRest(g: Save, w: WorldDef, share = 1) {
    const s = sheetOf(g); if (!s) return;
    s.hp = Math.min(hpMax(w, s), s.hp + Math.ceil(hpMax(w, s) * share)); s.focus = Math.min(focusMax(w, s), s.focus + Math.ceil(focusMax(w, s) * share)); s.prepOpen = true;
    syncLife(g, w);
}

/* ---------- checks ---------- */

export type CheckGrade = 'critical-fail' | 'fail' | 'success' | 'critical-success';
export interface Check { skill: string; d20: number; other?: number; bonus: number; total: number; dc: number; grade: CheckGrade; adv: boolean }
// A d20 + the skill's bonus (+ a spell's boost, used up) against a DC. A natural 20 always works, a 1 always fails.
export function rollCheck(g: Save, w: WorldDef, skill: string, dc: number, extra = 0, rnd = Math.random): Check {
    const s = sheetOf(g)!;
    const nx = s.next ?? {};
    const adv = !!nx.advantage?.includes(skill);
    const boost = nx.bonus && (!nx.bonus.skills?.length || nx.bonus.skills.includes(skill)) ? nx.bonus.amount : 0;
    if (adv) delete nx.advantage; if (boost) delete nx.bonus;
    if (!nx.advantage && !nx.bonus) delete s.next;
    const a = 1 + Math.floor(rnd() * 20), b = adv ? 1 + Math.floor(rnd() * 20) : undefined;
    const d20 = b !== undefined ? Math.max(a, b) : a;
    const bonus = skillBonus(w, s, skill) + extra + boost + checkMods.reduce((t, f) => t + f(g, w, skill), 0);
    const total = d20 + bonus;
    const grade: CheckGrade = d20 === 20 ? 'critical-success' : d20 === 1 ? 'critical-fail' : total >= dc ? 'success' : 'fail';
    for (const f of onRoll) f({ skill, d20, other: b !== undefined ? Math.min(a, b) : undefined, total, dc, grade });
    return { skill, d20, ...(b !== undefined ? { other: Math.min(a, b) } : {}), bonus, total, dc, grade, adv };
}
export const checkWon = (c: Check) => c.grade === 'success' || c.grade === 'critical-success';
export const gradeWord = (c: Check) => ({ 'critical-fail': 'CRITICAL FAILURE', fail: 'FAILURE', success: 'SUCCESS', 'critical-success': 'CRITICAL SUCCESS' })[c.grade];
export const DCS: Record<string, number> = { easy: 10, medium: 13, hard: 16, 'very hard': 19 };

/* ---------- titles and renown ---------- */

export function count(g: Save, w: WorldDef, key: string, n = 1): string[] {
    const s = sheetOf(g); if (!s) return [];
    s.counts[key] = (s.counts[key] ?? 0) + n;
    return checkTitles(g, w);
}
export function addRenown(g: Save, w: WorldDef, n: number): string[] {
    const s = sheetOf(g); if (!s) return [];
    s.renown = Math.max(0, s.renown + n);
    return checkTitles(g, w);
}
export function checkTitles(g: Save, w: WorldDef): string[] {
    const s = sheetOf(g); const r = rpgOf(w); if (!s || !r) return [];
    const out: string[] = [];
    for (const t of r.titles) {
        if (s.titles.includes(t.id)) continue;
        const c = t.when;
        const ok = (c.level === undefined || s.level >= c.level) && (c.renown === undefined || s.renown >= c.renown) && (!c.count || (s.counts[c.count] ?? 0) >= (c.n ?? 1));
        if (!ok) continue;
        s.titles.push(t.id);
        note(g, '{u} earned a title: {0}.', [t.name], [], g.player.loc, 'goal');
        out.push(`New title: ${t.name}!`);
    }
    return out;
}
export const titleNames = (w: WorldDef, s: Sheet) => s.titles.map(id => rpgOf(w)?.titles.find(t => t.id === id)?.name).filter(Boolean) as string[];

// For the AI: who {{user}} is in the RPG.
export function sheetLine(g: Save, w: WorldDef): string {
    const s = sheetOf(g); if (!s || !isRpg(w)) return '';
    const c = classOf(w, s); const sub = c?.subclasses.find(x => x.id === s.sub);
    const t = titleNames(w, s);
    const renown = s.renown >= 60 ? 'famous across the land' : s.renown >= 25 ? 'known in these parts' : s.renown >= 8 ? 'getting a name' : '';
    const sys = rpgOf(w)?.name;
    return `${sys ? `RPG system: ${sys}. ` : ''}{{user}} is a level ${s.level} ${sub ? `${sub.name} ` : ''}${c?.name.toLowerCase() ?? 'adventurer'}${t.length ? `, known as ${t.join(', ')}` : ''}${renown ? `; ${renown}` : ''}. Hit points ${s.hp}/${hpMax(w, s)}${s.hp <= hpMax(w, s) / 4 ? ' (badly hurt)' : ''}.`;
}
void nowAbs;
// a save of a world played as RPG that has no sheet yet gets one (with the first class), the first time it opens
SAVE.hooks.push(g => { const w = getWorld(g.world); if (w && !(g as any).rpg && isRpg(w)) ensureSheet(g, w); });

/* ---------- talents ---------- */

// A point per level after the first; spent in the tree (a tier opens every 3 levels; some need the one before).
export const talentsOf = (s: Sheet): string[] => ((s as any).talents ??= []);
export const talentPoints = (s: Sheet) => Math.max(0, s.level - 1 - talentsOf(s).length);
export const tierOpen = (s: Sheet, tier: number) => s.level >= (tier - 1) * 3 + 1;
export function talentTree(w: WorldDef, s: Sheet) { return (rpgOf(w)?.talents ?? []).filter(t => !t.cls || t.cls === s.cls); }
export function canTake(w: WorldDef, s: Sheet, id: string): string {
    const t = talentTree(w, s).find(x => x.id === id); if (!t) return 'Not for your class.';
    if (talentsOf(s).includes(id)) return 'Already yours.';
    if (talentPoints(s) <= 0) return 'No talent points left.';
    if (!tierOpen(s, t.tier)) return `Opens at level ${(t.tier - 1) * 3 + 1}.`;
    if ((t.requires ?? []).some(r => !talentsOf(s).includes(r))) return 'Needs the talent before it.';
    return '';
}
export function takeTalent(g: Save, w: WorldDef, id: string): string {
    const s = sheetOf(g); if (!s) return '';
    const why = canTake(w, s, id); if (why) return why;
    const before = hpMax(w, s);
    talentsOf(s).push(id);
    s.hp += Math.max(0, hpMax(w, s) - before); s.focus = Math.min(focusMax(w, s), s.focus); syncLife(g, w);
    return '';
}
// Respec: every point back, any time.
export function respec(g: Save, w: WorldDef): string {
    const s = sheetOf(g); if (!s || !talentsOf(s).length) return '';
    (s as any).talents = [];
    s.hp = Math.min(s.hp, hpMax(w, s)); s.focus = Math.min(s.focus, focusMax(w, s)); syncLife(g, w);
    return 'Your talents are reset: spend the points again as you like.';
}
