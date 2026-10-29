// Skills: courses you take (at home, online, or at the university) that teach you traits; the job interview, a
// roll where the traits a job looks for are your bonus; and the counters some life goals are measured with.
// The traits you have are what the d20 rolls use (each matching trait is +2), so learning one helps everywhere.
import { nowAbs, type Save } from '../core/store.js';
import type { WorldDef, Occupation } from '../core/world.js';
import { systemOn, isScenario } from '../core/world.js';
import { note } from './facts.js';
import { book } from './ledger.js';
import { priceOf } from './bills.js';
import { playerHomeId, placeOf } from './places.js';
import { tooHurt } from './rpg.js';

export interface Course { id: string; name: string; area: string; days: number; cost: number; grants: string[]; icon: string; desc: string }
export const coursesOf = (w: WorldDef): Course[] => (systemOn(w, 'courses') ? (w.catalogs as any).courses ?? [] : []) as Course[];
interface Learning { current?: string; progress: Record<string, number>; lastDay: Record<string, number>; done: string[]; count: Record<string, number>; interviews: Record<string, number>; earned: string[] }
export function learning(g: Save): Learning {
    const p = g.player as any;
    const s = (p.learning ??= {});
    s.progress ??= {}; s.lastDay ??= {}; s.done ??= []; s.count ??= {}; s.interviews ??= {}; s.earned ??= [];
    return s as Learning;
}
// Counters for life goals (meals cooked, workouts, shifts…).
export const countUp = (g: Save, key: string, n = 1) => { const c = learning(g).count; c[key] = (c[key] ?? 0) + n; };
export const countOf = (g: Save, key: string) => learning(g).count[key] ?? 0;

/* ---------- traits you gain ---------- */

// A trait learned in a course or earned with a life goal: kept apart from the ones you chose, so the profile can say where it came from.
export function gainTrait(g: Save, trait: string, from: 'course' | 'goal'): boolean {
    const t = (g.player.traits ??= {}) as Record<string, string[]>;
    const key = from === 'course' ? 'learned' : 'earned';
    if (Object.values(t).flat().includes(trait)) return false;
    (t[key] ??= []).push(trait);
    return true;
}

/* ---------- courses ---------- */

export const courseOf = (w: WorldDef, id?: string) => coursesOf(w).find(c => c.id === id);
export const hasCourse = (g: Save, id: string) => learning(g).done.includes(id);
export const canStudyHere = (g: Save, w: WorldDef) => isScenario(w) || g.player.loc === playerHomeId || (placeOf(g, w, g.player.loc)?.tags ?? []).includes('study');
export const studiedToday = (g: Save, id: string) => learning(g).lastDay[id] === g.day;

export function enroll(g: Save, w: WorldDef, id: string): string {
    const c = courseOf(w, id); if (!c) return '';
    const l = learning(g);
    if (l.current) return 'Finish the course you are taking first.';
    if (l.done.includes(id)) return 'You already finished this course.';
    const price = priceOf(g, c.cost);
    if (g.player.money < price) return 'Not enough money.';
    g.player.money -= price; book(g, `Course: ${c.name}`, -price);
    l.current = id; l.progress[id] ??= 0;
    note(g, '{u} enrolled in a course: {0}.', [c.name], [], g.player.loc, 'study');
    return '';
}
export function dropCourse(g: Save) { learning(g).current = undefined; }
// One study session (once a day): a day of the course. The last one finishes it and teaches its traits.
export function studySession(g: Save, w: WorldDef): string[] {
    const l = learning(g); const c = courseOf(w, l.current); if (!c) return [];
    { const hurt = tooHurt(g, w); if (hurt) return [hurt]; }
    if (studiedToday(g, c.id)) return ['You already studied today. Come back tomorrow.'];
    l.lastDay[c.id] = g.day;
    l.progress[c.id] = (l.progress[c.id] ?? 0) + 1;
    if (l.progress[c.id] < c.days) return [`${c.name}: day ${l.progress[c.id]} of ${c.days} done.`];
    l.done.push(c.id); l.current = undefined;
    const got = c.grants.filter(t => gainTrait(g, t, 'course'));
    note(g, '{u} finished the course "{0}".', [c.name], [], g.player.loc, 'study');
    return [`You finished ${c.name}!${got.length ? ` You are now ${got.join(' and ')}.` : ''}`];
}

/* ---------- the job interview ---------- */

// (a course the world no longer offers is not asked for: the job would be out of reach forever)
export const missingCourses = (g: Save, w: WorldDef, o: Occupation) => ((o as any).courses ?? []).filter((id: string) => !!courseOf(w, id) && !hasCourse(g, id)).map((id: string) => courseOf(w, id)?.name ?? id);
export function interviewDc(o: Occupation) { const top = o.ranks.at(-1)?.pay ?? 0; return 9 + (o.needs?.length ? 3 : 0) + (top >= 50 ? 2 : 0); }
export function interviewBonus(g: Save, o: Occupation, traits: string[]) {
    let b = 0;
    if ((o.needs ?? []).some(t => traits.includes(t))) b += 4;
    b += Math.min(6, (o.likes ?? []).filter(t => traits.includes(t)).length * 2);
    if (((o as any).courses ?? []).length) b += 2;   // you have the course they ask for
    const s = g.player.stats;
    if ((s.hygiene ?? 100) < 30) b -= 3;   // nobody hires someone who smells
    if ((s.energy ?? 100) < 25) b -= 2;
    if ((s.mood ?? 100) < 25) b -= 2;
    return b;
}
export const interviewChance = (g: Save, o: Occupation, traits: string[]) => { const b = interviewBonus(g, o, traits), dc = interviewDc(o); let ok = 0; for (let d = 1; d <= 20; d++) if (d === 20 || (d > 1 && d + b >= dc)) ok++; return ok * 5; };
export const triedToday = (g: Save, id: string) => learning(g).interviews[id] === g.day;
export function interview(g: Save, o: Occupation, traits: string[], rnd = Math.random): { ok: boolean; crit: boolean; text: string } {
    learning(g).interviews[o.id] = g.day;
    const d20 = 1 + Math.floor(rnd() * 20), bonus = interviewBonus(g, o, traits), dc = interviewDc(o);
    const ok = d20 === 20 || (d20 > 1 && d20 + bonus >= dc);
    const crit = d20 === 20;
    void nowAbs;
    return { ok, crit, text: ok ? (crit ? 'They loved you: you start with a head start toward your first promotion.' : 'The interview went well.')
        : d20 === 1 ? 'The interview was a disaster.' : 'They chose someone else this time. Try again tomorrow.' };
}
