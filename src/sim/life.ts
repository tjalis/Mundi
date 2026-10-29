// Life-Sim systems: needs in words, aspirations, feelings that fade, the lifestyle shop (vehicles, furniture,
// gear for working at home), quick gigs, the gym, college, things at home that break, scene lock, NPCs who
// invite you, and who lets you into their home. All decided by the engine; the AI only narrates.
import { nowAbs, type Save, type Resident } from '../core/store.js';
import { courseOf, learning, canStudyHere, studiedToday, studySession, countUp, countOf, gainTrait } from './skills.js';
import { priceOf } from './bills.js';
import type { WorldDef, ActionDef, StatusDef } from '../core/world.js';
import { systemOn, isScenario } from '../core/world.js';
import { careerOf } from './work.js';
import { priceHere } from './worldstate.js';
import { lex } from '../core/lexicon.js';
import { onDay, onHour } from './hooks.js';
import { addStatus, money, usualPay } from './needs.js';
import type { ShopItem, Breakable } from '../core/presets.js';
import { book } from './ledger.js';
import { social, bondOf, isPartner, type PlanKind } from './social.js';
import { note } from './facts.js';
import { placeOf, playerHomeId, lockedNow, floorName } from './places.js';
import { whereNow, residents } from './people.js';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rnd = (g: Save, salt: string) => { let h = 2166136261; const s = `${g.world}|${g.day}|${g.minutes}|${salt}`; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const life = (g: Save) => {
    const p = g.player as any;
    p.items ??= []; p.broken ??= []; p.fitness ??= 0; p.study ??= { enrolled: false, classes: 0, passed: 0, degree: false };
    return p as { items: string[]; broken: string[]; fitness: number; study: { enrolled: boolean; classes: number; passed: number; degree: boolean }; aspiration?: string; aspDone?: string[] };
};
export const lifeOf = life;

/* ---------- needs in words (46) ---------- */

const WORDS: Record<string, [string, string, string, string]> = {
    energy: ['Exhausted', 'Tired', 'Rested', 'Full of energy'],
    hunger: ['Starving', 'Hungry', 'Satisfied', 'Full'],
    thirst: ['Parched', 'Thirsty', 'Fine', 'Hydrated'],
    mood: ['Miserable', 'Down', 'Good', 'Great'],
    hygiene: ['Filthy', 'Grubby', 'Clean', 'Fresh'],
    life: ['Badly hurt', 'Hurt', 'Healthy', 'In great shape'],
    health: ['Badly hurt', 'Hurt', 'Healthy', 'In great shape'],
};
export function needWord(s: StatusDef, v: number) {
    const w = WORDS[s.id] ?? ['Very low', 'Low', 'Good', 'Very good'];
    const pct = (v / (s.max || 100)) * 100;
    return pct <= 15 ? w[0] : pct <= 45 ? w[1] : pct <= 80 ? w[2] : w[3];
}

/* ---------- feelings that fade ---------- */

export interface Feeling { avatar: string; tag: string; until: number }
export const feelingsOf = (g: Save) => (((social(g) as any).feel ??= []) as Feeling[]);
export function feel(g: Save, avatar: string, tag: string, days: number) {
    const list = feelingsOf(g).filter(f => !(f.avatar === avatar && f.tag === tag));
    list.push({ avatar, tag, until: nowAbs(g) + days * 1440 });
    (social(g) as any).feel = list.slice(-80);
}
export const activeFeelings = (g: Save, avatar: string) => feelingsOf(g).filter(f => f.avatar === avatar && f.until > nowAbs(g));
export function feelingLine(g: Save, present: Resident[]) {
    const parts = present.map(r => { const f = activeFeelings(g, r.avatar); return f.length ? `${r.name}: ${f.map(x => `${x.tag} (for ${Math.max(1, Math.ceil((x.until - nowAbs(g)) / 1440))} more day${Math.ceil((x.until - nowAbs(g)) / 1440) > 1 ? 's' : ''})`).join(', ')}` : ''; }).filter(Boolean);
    return parts.length ? `Current feelings toward {{user}} — ${parts.join('; ')}. Let them color the tone, whatever the overall bond.` : '';
}

/* ---------- aspirations ---------- */

export interface Aspiration { id: string; name: string; icon: string; desc: string; reward?: string; check: (g: Save, w: WorldDef) => [number, number] }
export const ASPIRATIONS: Aspiration[] = [
    { id: 'rich', name: 'Get rich', icon: '💰', desc: 'Save up a fortune.', reward: 'Good with numbers', check: (g, w) => [g.player.money, usualPay(w) * 3125] },
    { id: 'romance', name: 'Find love', icon: '💞', desc: 'Be in a relationship.', reward: 'Romantic', check: g => [social(g).partner.length ? 1 : 0, 1] },
    { id: 'career', name: 'Top of the career', icon: '🏆', desc: 'Reach the highest rank of a job.', reward: 'Ambitious', check: (g, w) => { const j = g.player.job; const o = j && w.occupations.find(x => x.id === j.id); const c = o && careerOf(g, o); return [o ? j!.rank + 1 : 0, c ? (c.open ? c.ranks.length + 1 : c.ranks.length) : 1]; } },
    { id: 'worker', name: 'Hard worker', icon: '💼', desc: 'Work 20 shifts.', reward: 'Serious', check: g => [countOf(g, 'shifts'), 20] },
    { id: 'social', name: 'Social butterfly', icon: '🦋', desc: 'Have five good friends.', reward: 'Charming', check: g => [Object.values(social(g).bond).filter(b => b >= 60).length, 5] },
    { id: 'host', name: 'Party host', icon: '🎉', desc: 'Throw three parties.', reward: 'Outgoing', check: g => [countOf(g, 'parties'), 3] },
    { id: 'home', name: 'A home of your own', icon: '🏡', desc: 'Live in a house of your own, not in a small rented place.', reward: 'Calm', check: g => [['house', 'manor'].includes(g.player.home.kind) ? 1 : 0, 1] },
    { id: 'scholar', name: 'Lifelong learner', icon: '🎓', desc: 'Finish three courses.', reward: 'Smart', check: g => [learning(g).done.length, 3] },
    { id: 'chef', name: 'Home chef', icon: '🍳', desc: 'Cook 15 meals at home.', reward: 'Good cook', check: g => [countOf(g, 'meals'), 15] },
    { id: 'athlete', name: 'Athlete', icon: '🏃', desc: 'Have 15 good workouts.', reward: 'Athletic', check: g => [countOf(g, 'workouts'), 15] },
    { id: 'fit', name: 'In top shape', icon: '💪', desc: 'Get really fit.', reward: 'Strong', check: g => [life(g).fitness, 80] },
    { id: 'artist', name: 'Artist', icon: '🎨', desc: 'Sell five paintings.', reward: 'Creative', check: g => [countOf(g, 'paintings'), 5] },
];
export const aspirationOf = (g: Save) => ASPIRATIONS.find(a => a.id === life(g).aspiration) ?? null;
export function setAspiration(g: Save, id: string) { life(g).aspiration = id; note(g, '{u} set a life goal: {0}.', [ASPIRATIONS.find(a => a.id === id)?.name ?? id], [], g.player.loc, 'goal'); }
function checkAspiration(g: Save, w: WorldDef): string[] {
    const a = aspirationOf(g); const l = life(g);
    if (!a || !systemOn(w, 'goals') || (l.aspDone ??= []).includes(a.id)) return [];
    const [have, need] = a.check(g, w);
    if (have < need) return [];
    l.aspDone.push(a.id);
    addStatus(g, w, 'mood', 30);
    note(g, '{u} reached a life goal: {0}!', [a.name], [], g.player.loc, 'goal');
    const got = a.reward && gainTrait(g, a.reward, 'goal');
    return [`Life goal reached: ${a.name}!${got ? ` You are now ${a.reward}.` : ''}`];
}

/* ---------- the lifestyle shop ---------- */

// The world's shop (catalogs.shop): vehicles shorten trips, a good bed lifts your mood each morning, and some items
// unlock things to do at home (an action with `needsItem`).
export type Item = ShopItem;
export const shopItems = (w: WorldDef): Item[] => (systemOn(w, 'shop') ? (w.catalogs as any).shop ?? [] : []) as Item[];
export const hasItem = (g: Save, id: string) => life(g).items.includes(id);
// What an item costs now: the difficulty, then the prices where you live (the living world).
export const shopPrice = (g: Save, w: WorldDef, it: Item) => Math.round(priceOf(g, it.price) * priceHere(g, w, playerHomeId));
const owned = (g: Save, w: WorldDef) => shopItems(w).filter(it => hasItem(g, it.id));
export function buy(g: Save, w: WorldDef, id: string): string {
    const it = shopItems(w).find(x => x.id === id);
    if (!it) return '';
    if (hasItem(g, id)) return 'You already have it.';
    const price = shopPrice(g, w, it);
    if (g.player.money < price) return 'Not enough money.';
    g.player.money -= price; book(g, it.name, -price);
    life(g).items.push(id);
    note(g, '{u} bought: {0}.', [it.name], [], g.player.loc, 'shop');
    return '';
}
// Vehicles shorten every trip (the best one you own).
// (a mount you keep well fed counts too)
export const travelFactor = (g: Save, w?: WorldDef | null) => (w ? Math.min(1, ...owned(g, w).map(it => (Number(it.travel) > 0 ? Number(it.travel) : 1)), ...mountSpeeds(g, w)) : 1);
const mountSpeeds = (g: Save, w: WorldDef) => ((w.features as any)?.mounts === false ? [] : ((g as any).pets ?? []).map((p: any) => { const d = (w.pets ?? []).find(x => x.id === p.kind); return d?.mount && p.hunger > 20 ? Math.max(0.3, (d.speed ?? 0.6) - (p.bound ? Math.min(0.2, (p.level ?? 1) * 0.02) : 0)) : 1; }));
// Mood gained when you wake up at home (a good bed…).
export const sleepMood = (g: Save, w: WorldDef) => owned(g, w).reduce((a, it) => a + (it.sleepMood ?? 0), 0);

/* ---------- things at home that break ---------- */

const breakables = (w: WorldDef | null | undefined): Breakable[] => ((w?.homes as any)?.breakables ?? []) as Breakable[];
const thing = (w: WorldDef | null | undefined, id: string) => breakables(w).find(b => b.id === id)?.name ?? id;
export const brokenThings = (g: Save, w?: WorldDef | null) => (systemOn(w, 'breakdowns') ? life(g).broken : []).map(id => thing(w, id));
const blocked = (g: Save, w?: WorldDef | null) => new Set(!systemOn(w, 'breakdowns') ? [] : life(g).broken.flatMap(id => breakables(w).find(b => b.id === id)?.blocks ?? []));

/* ---------- actions the engine adds ---------- */

const x = (a: Partial<ActionDef> & { id: string; label: string }): ActionDef => ({ name: a.label, cost: 0, minutes: 60, effects: {}, ...a } as ActionDef);
// Only what comes from the game's own state: paying to fix what broke, and studying the course you take.
export function extraActions(g: Save, w: WorldDef): ActionDef[] {
    const out: ActionDef[] = [];
    if (g.player.loc === playerHomeId) for (const b of life(g).broken) out.push(x({ id: `x-repair-${b}`, label: `Pay someone to fix ${thing(w, b)}`, icon: '🧰', minutes: 60, cost: Number((w.homes as any).repairCost ?? 0), effects: {} }));
    const cur = courseOf(w, learning(g).current);
    if (cur && canStudyHere(g, w) && !studiedToday(g, cur.id)) out.push(x({ id: 'x-study', label: `Study: ${cur.name}`, icon: cur.icon || '📚', minutes: 120, effects: { energy: -12, mood: -2, hunger: -6 } }));
    return out;
}
// Which world actions are blocked by something broken at home.
export const isBlocked = (g: Save, a: ActionDef, w?: WorldDef | null) => !!a.home && blocked(g, w).has(a.id);

// After an action (the engine's own and the world's): its special results.
export function afterAction(g: Save, w: WorldDef, a: ActionDef, success: boolean | null): string[] {
    const l = life(g); const out: string[] = [];
    if (a.id === 'x-workout' || a.id === 'x-treadmill' || a.id === 'x-run') l.fitness = Math.min(100, l.fitness + (a.id === 'x-run' ? 3 : 5));
    if (a.id.startsWith('x-repair-')) { const b = a.id.slice(9); l.broken = l.broken.filter(x => x !== b); out.push(`${cap(thing(w, b))} works again.`); }
    if (a.id === 'fix' && success && l.broken.length) { const b = l.broken.shift()!; out.push(`You fixed ${thing(w, b)}.`); }
    if (a.id === 'x-study') out.push(...studySession(g, w));
    if (a.id === 'cook') countUp(g, 'meals');
    if ((a.id === 'x-workout' || a.id === 'x-treadmill') && success) countUp(g, 'workouts');
    if (a.id === 'x-paint' && success) countUp(g, 'paintings');
    if (a.id === 'x-enroll') { l.study.enrolled = true; note(g, '{u} enrolled in classes.', [], [], g.player.loc, 'study'); }
    if (a.id === 'x-class') l.study.classes++;
    if (a.id === 'x-exam') {
        l.study.classes = 0;
        if (success) {
            l.study.passed++;
            if (l.study.passed >= 3 && !l.study.degree) {
                l.study.degree = true; l.study.enrolled = false;
                (g.player.traits.education ??= []).push('Degree');
                note(g, '{u} graduated!', [], [], g.player.loc, 'study'); out.push('You graduated!');
            }
        }
    }
    return out;
}

/* ---------- who lets you in ---------- */

export function doorAnswer(g: Save, w: WorldDef, loc: string): { ok: boolean; text: string } {
    // a restricted place (or a floor of one) turns you away until the story, its rules or you open it
    { const p = !loc.startsWith('home:') ? placeOf(g, w, loc) : null; const why = p && loc !== g.player.loc ? lockedNow(g, w, p) : ''; if (why) return { ok: false, text: `${floorName(p!)}: ${why}.` }; }
    if (!loc.startsWith('home:') || loc === playerHomeId) return { ok: true, text: '' };
    const r = g.cast[loc.slice(5)];
    if (!r) return { ok: true, text: '' };
    // a guest's room is a room of your house: you can always go in (whoever is staying there, however close you are)
    if ((r as any).guest) return { ok: true, text: '' };
    const home = whereNow(g, w, r) === loc;
    if (isScenario(w)) {   // Home: a bedroom down the hall, not a house across town
        if (isPartner(g, r.avatar) || bondOf(g, r.avatar) >= 50) return { ok: true, text: home ? '' : `${r.name} is not in, but the door is not locked.` };
        if (!home) return { ok: false, text: `${r.name}'s room is locked, and you don't know where the key is.` };
        if (bondOf(g, r.avatar) >= 15) return { ok: true, text: `You knock on ${r.name}'s door and they let you in.` };
        return { ok: false, text: `You knock on ${r.name}'s door. They talk to you through it, but don't let you in.` };
    }
    if (isPartner(g, r.avatar) || bondOf(g, r.avatar) >= 50) return { ok: true, text: home ? '' : `${r.name} is out, but you know where the key is.` };
    if (!home) return { ok: false, text: lex(w, 'doorNobody', r.name) };
    if (bondOf(g, r.avatar) >= 15) return { ok: true, text: lex(w, 'doorIn', r.name) };
    return { ok: false, text: lex(w, 'doorOut', r.name) };
}

/* ---------- scene lock: people do not walk out in the middle of a conversation ---------- */

export function lockScene(g: Save, w: WorldDef) {
    const here = residents(g).filter(r => whereNow(g, w, r) === g.player.loc).map(r => r.avatar);
    (social(g) as any).lock = { loc: g.player.loc, who: here, until: nowAbs(g) + 60 };
}
export function lockedHere(g: Save, avatar: string): string | null {
    const l = (social(g) as any).lock as { loc: string; who: string[]; until: number } | undefined;
    if (!l || l.loc !== g.player.loc || nowAbs(g) >= l.until || !l.who.includes(avatar)) return null;
    return l.loc;
}

/* ---------- people who invite you ---------- */

export interface Invite { avatar: string; place: string; from: number; kind: PlanKind }
export const pendingInvite = (g: Save): Invite | null => ((social(g) as any).invite ?? null);
export const clearInvite = (g: Save) => { (social(g) as any).invite = null; };
function maybeInvite(g: Save, w: WorldDef): string[] {
    const h = Math.floor(g.minutes / 60);
    if (!systemOn(w, 'plans') || pendingInvite(g) || h < 9 || h > 20 || rnd(g, 'invite') > 0.05) return [];
    const pool = residents(g).filter(r => r.met && (bondOf(g, r.avatar) >= 25 || isPartner(g, r.avatar)) && r.leisure.length);
    if (!pool.length) return [];
    const r = pool[Math.floor(rnd(g, 'who') * pool.length)];
    const from = nowAbs(g) + 120 - (nowAbs(g) % 30);
    const place = r.leisure[Math.floor(rnd(g, 'where') * r.leisure.length)];
    const inv: Invite = { avatar: r.avatar, place, from, kind: isPartner(g, r.avatar) && systemOn(w, 'romance') ? 'date' : 'hangout' };
    (social(g) as any).invite = inv;
    const s = social(g);
    const text = lex(w, 'inviteText', placeOf(g, w, place)?.name ?? 'the usual place', `${String(Math.floor((from % 1440) / 60)).padStart(2, '0')}:${String(from % 60).padStart(2, '0')}`);
    (s.threads[r.avatar] ??= []).push({ me: false, text, at: nowAbs(g) });
    s.unread[r.avatar] = (s.unread[r.avatar] ?? 0) + 1;
    return [];
}

/* ---------- the daily and hourly rules ---------- */

onDay.push((g, w) => {
    const out: string[] = [];
    const l = life(g);
    // something at home may break (not everything at once)
    const free = (systemOn(w, 'breakdowns') ? breakables(w) : []).map(b => b.id).filter(b => !l.broken.includes(b));
    if (free.length && rnd(g, 'break') < 0.05) {   // a small chance each day
        const b = free[Math.floor(rnd(g, 'which') * free.length)];
        l.broken.push(b);
        note(g, '{0} broke at home.', [cap(thing(w, b))], [], playerHomeId, 'home');
        out.push(lex(w, 'brokeHome', thing(w, b)));
    }
    // fitness fades a little if you never train
    l.fitness = Math.max(0, l.fitness - 1);
    out.push(...checkAspiration(g, w));
    // feelings that ran out are forgotten
    (social(g) as any).feel = feelingsOf(g).filter(f => f.until > nowAbs(g));
    return out;
});
onHour.push((g, w) => [...maybeInvite(g, w), ...checkAspiration(g, w)]);

// How the player looks, for the AI.
export const physiqueLine = (g: Save) => { const f = life(g).fitness; return f >= 70 ? '{{user}} is visibly fit and athletic.' : f >= 40 ? '{{user}} is in good shape.' : ''; };
export const moneyText = money;
