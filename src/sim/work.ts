// Jobs: getting hired, working shifts at the job's place, pay per hour, promotions after enough shifts.
// Moving home and the bank's ledger live here too (the money side of the world).
import { hobbyFits, hobbyNeed } from './hobbies.js';
import { addRep } from './standing.js';
import { lex } from '../core/lexicon.js';
import { bump, bondOf } from './social.js';
import { approvalOf } from './living.js';
import { npcRank } from './longlife.js';
import { missingCourses, triedToday, interview, countUp } from './skills.js';
import { payOf, priceOf, resetBills } from './bills.js';
import { note } from './facts.js';
import type { Save } from '../core/store.js';
import { career, systemOn, getWorld, type WorldDef, type Occupation, type Branch, type Career } from '../core/world.js';
import { advance, hour } from './time.js';
import { addStatus, money } from './needs.js';
import { book } from './ledger.js';
import { tooHurt } from './rpg.js';
export { ledger, book } from './ledger.js';

export const jobDef = (w: WorldDef, id?: string | null) => w.occupations.find(o => o.id === id) ?? null;
export const traitsOf = (g: Save) => Object.values(g.player.traits ?? {}).flat();
export const fits = (g: Save, o: Occupation, w?: WorldDef | null) => (!o.needs?.length || o.needs.some(t => traitsOf(g).includes(t))) && hobbyFits(g, w ?? getWorld(g.world), o);
export const likes = (g: Save, o: Occupation) => careerOf(g, o).likes.filter(t => traitsOf(g).includes(t));
export const isOpen = (g: Save, o: Occupation) => { const [a, b] = o.hours ?? [0, 24]; const h = hour(g); return a <= b ? h >= a && h < b : h >= a || h < b; };

/* ---------- a good word from someone high up (a referral) ---------- */

// Someone you know who holds a high rank (3 or more) at their job can recommend you there, if they like you enough.
export const REFER_RANK = 2, REFER_BOND = 40;
export function canRefer(g: Save, w: WorldDef, avatar: string): Occupation | null {
    const r = g.cast[avatar]; const o = r && jobDef(w, r.occupation);
    if (!r || !o || !r.met || !systemOn(w, 'jobs') || g.player.job?.id === o.id) return null;
    if (npcRank(g, avatar) < REFER_RANK || bondOf(g, avatar) < REFER_BOND) return null;
    return o;
}
const asked = (g: Save) => (((g as any).living ??= {}).refAsked ??= {}) as Record<string, number>;
export const askedThisWeek = (g: Save, avatar: string) => g.day - (asked(g)[avatar] ?? -99) < 7;
export function referralFor(g: Save, jobId: string): string | null {
    const ref = (g as any).referral;
    return ref && ref.job === jobId && g.day <= ref.until && g.cast[ref.avatar] ? ref.avatar : null;
}
export function askReferral(g: Save, w: WorldDef, avatar: string): { ok: boolean; text: string } {
    const o = canRefer(g, w, avatar); const r = g.cast[avatar];
    if (!o || !r) return { ok: false, text: '' };
    if (askedThisWeek(g, avatar)) return { ok: false, text: `You already asked ${r.name} this week.` };
    asked(g)[avatar] = g.day;
    const chance = 0.35 + bondOf(g, avatar) / 200 + approvalOf(g, avatar) / 200;
    if (Math.random() >= chance) { note(g, '{u} asked {0} for a good word at {1}; {0} could not promise anything.', [r.name, o.name], [avatar], g.player.loc, 'work'); return { ok: false, text: `${r.name} would rather not vouch for anyone at ${o.name} right now.` }; }
    (g as any).referral = { job: o.id, avatar, until: g.day + 14 };
    note(g, '{0} agreed to put in a good word for {u} at {1}.', [r.name, o.name], [avatar], g.player.loc, 'work');
    return { ok: true, text: `${r.name} will put in a good word for you at ${o.name}: apply within two weeks and you are in (if you have the courses it asks for).` };
}

/* ---------- careers and their branches ---------- */

export { career, type Career } from '../core/world.js';
const jobPath = (g: Save) => g.player.job?.path ?? [];
// Your career in this job (for someone else's: a path picked for them, the same every time).
export const careerOf = (g: Save, o: Occupation) => career(o, g.player.job?.id === o.id ? jobPath(g) : []);
export function npcCareer(o: Occupation, avatar: string): Career {
    const path: string[] = [];
    for (let n = 0; n < 4; n++) {
        const c = career(o, path);
        if (!c.open) return c;
        let h = 2166136261; const s = `${avatar}|${o.id}|${n}`; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        path.push(c.open.options[(h >>> 0) % c.open.options.length].id);
    }
    return career(o, path);
}
// The rank you hold (its name and pay), and the one after it.
export const rankOf = (g: Save, o: Occupation) => { const c = careerOf(g, o); return c.ranks[Math.min(g.player.job?.rank ?? 0, c.ranks.length - 1)]; };
export const nextRankOf = (g: Save, o: Occupation) => careerOf(g, o).ranks[(g.player.job?.rank ?? 0) + 1] ?? null;
// A branch waiting for you: you are at its rank.
export function pendingBranch(g: Save, o: Occupation): Branch | null {
    const j = g.player.job; if (!j || j.id !== o.id) return null;
    const c = careerOf(g, o);
    return c.open && j.rank >= c.ranks.length - 1 ? c.open : null;
}
// Choosing a path: it decides the ranks that come next.
export function choosePath(g: Save, w: WorldDef, optionId: string): string {
    const j = g.player.job; const o = jobDef(w, j?.id);
    if (!j || !o) return '';
    const b = pendingBranch(g, o); const opt = b?.options.find(x => x.id === optionId);
    if (!b || !opt) return '';
    (j.path ??= []).push(opt.id); delete (j as any).toldBranch;
    note(g, '{u} chose a path at work: {0} ({1}).', [opt.name, o.name], [], o.place, 'work');
    return `You chose ${opt.name}. Next: ${opt.ranks[0]?.name ?? ''}.`;
}

// Shifts still needed for the next rank (liked traits make it shorter). null: no next rank (or a path to choose).
export function shiftsToPromote(g: Save, o: Occupation, rank: number): number | null {
    const c = careerOf(g, o);
    const need = c.promote[rank];
    if (need === undefined || rank >= c.ranks.length - 1) return null;
    const liked = c.likes.filter(t => traitsOf(g).includes(t)).length;
    return Math.max(2, need - liked);
}

/* ---------- jobs ---------- */

// Applying is a job interview: a d20 where the traits the job looks for are your bonus. Some jobs need a course first.
export function hire(g: Save, w: WorldDef, id: string): { ok: boolean; text: string } {
    const o = jobDef(w, id);
    if (!o) return { ok: false, text: '' };
    const miss = missingCourses(g, w, o);
    if (miss.length) return { ok: false, text: lex(w, 'needCourse', miss.join('", "')) };
    if (!hobbyFits(g, w, o)) return { ok: false, text: `They are looking for someone better at it: ${hobbyNeed(g, w, o)}.` };
    if (triedToday(g, id)) return { ok: false, text: 'You already had an interview there today. Try again tomorrow.' };
    // a word from someone high up there gets you in without the interview
    const ref = referralFor(g, id);
    const r = ref ? { ok: true, crit: false, text: `${g.cast[ref]?.name ?? 'Someone'} put in a good word for you.` } : interview(g, o, traitsOf(g));
    if (ref) delete (g as any).referral;
    if (!r.ok) { note(g, '{u} had a job interview for {0}, but did not get it.', [o.name], [], o.place, 'work'); return { ok: false, text: r.text }; }
    g.player.job = { id, rank: 0, shifts: r.crit ? Math.floor((o.promote?.[0] ?? 4) / 2) : 0 };
    note(g, '{u} got hired: {0} at {1}.', [o.ranks[0].name, o.name], [], o.place, 'work');
    return { ok: true, text: `You got the job! ${r.text}` };
}
export function quitJob(g: Save, w?: WorldDef) { const o = w && jobDef(w, g.player.job?.id); if (o) note(g, '{u} quit the job ({0}).', [o.name], [], g.player.loc, 'work'); g.player.job = null; }

// One shift: time passes, energy goes down, pay comes in, maybe a promotion.
// How you spend the shift (chosen on the work screen, like The Sims): it changes how fast you get promoted, how
// tired you get, your mood, and your coworkers.
export type WorkMode = 'normal' | 'hard' | 'social' | 'easy';
export const WORK_MODES: { id: WorkMode; name: string; desc: string; icon: string }[] = [
    { id: 'normal', name: 'Do the job', desc: 'A normal shift.', icon: '💼' },
    { id: 'hard', name: 'Work hard', desc: 'Faster promotion and a chance of a bonus. More tiring, a bit stressful.', icon: '🔥' },
    { id: 'social', name: 'Chat with coworkers', desc: 'Better mood, closer to the people who work there. Slower promotion.', icon: '💬' },
    { id: 'easy', name: 'Take it easy', desc: 'Less tiring. Promotion barely moves, and the boss may notice.', icon: '😌' },
];
// `hours`: a shorter shift (leaving early for a date): pay, tiredness and progress are for the hours worked.
export function workShift(g: Save, w: WorldDef, mode: WorkMode = 'normal', hours?: number): string[] {
    const j = g.player.job; const o = jobDef(w, j?.id);
    if (!j || !o) return [];
    { const hurt = tooHurt(g, w); if (hurt) return [hurt]; }
    if ((g as any).mortal?.form === 'ghost') return ['You are a ghost: your hands pass through the work.'];
    const h = Math.max(1, Math.min(o.shift, Math.round(hours ?? o.shift)));
    const part = h / o.shift;
    const out = advance(g, w, h * 60);
    const k = mode === 'hard' ? 1.35 : mode === 'easy' ? 0.6 : 1;
    for (const [id, v] of Object.entries(o.cost ?? {})) addStatus(g, w, id, -v * part * (id === 'energy' ? k : 1));
    if (mode === 'hard') addStatus(g, w, 'mood', -5 * part);
    if (mode === 'social') addStatus(g, w, 'mood', 8 * part);
    const rk = rankOf(g, o);
    let pay = payOf(g, rk.pay * h);
    countUp(g, 'shifts', h / o.shift);
    const bonus = mode === 'hard' && Math.random() < 0.3 ? Math.round(pay * 0.25) : 0;
    pay += bonus;
    g.player.money += pay;
    book(g, `${rk.name}: ${h} h${bonus ? ' (+ bonus)' : ''}`, pay);
    // progress to the next rank, like experience: a part of a shift counts for its part
    j.shifts = Math.round((j.shifts + part * (mode === 'hard' ? 1.5 : mode === 'social' ? 0.75 : mode === 'easy' ? 0.4 : 1)) * 100) / 100;
    out.push(`You worked ${h} hour${h === 1 ? '' : 's'} and earned ${money(w, pay)}${bonus ? ` (a bonus of ${money(w, bonus)} for the hard work)` : ''}.`);
    if (mode === 'social') {
        const mates = Object.values(g.cast).filter(r => r.occupation && jobDef(w, r.occupation)?.place === o.place);
        for (const r of mates) bump(g, r.avatar, 3);
        if (mates.length) out.push(`You got closer to ${mates.map(r => r.name).join(', ')}.`);
    }
    if (mode === 'easy' && Math.random() < 0.25) out.push('Your boss noticed you were slacking.');
    const need = shiftsToPromote(g, o, j.rank);
    if (need !== null && j.shifts >= need) {
        j.rank++; j.shifts = Math.round((j.shifts - need) * 100) / 100;   // what was left over counts toward the next rank
        out.push(`Promotion! You are now ${rankOf(g, o).name}.`);
        note(g, '{u} got promoted to {0}.', [rankOf(g, o).name], [], o.place, 'work');
        addRep(g, w, 3, 'promotion', o.place);
    }
    if (pendingBranch(g, o) && !(j as any).toldBranch) { (j as any).toldBranch = j.rank; out.push(lex(w, 'choosePath', o.name)); }
    return out;
}

/* ---------- moving ---------- */

export function freeSpots(g: Save, w: WorldDef, zoneId: string): number[][] {
    const zone = w.homes.zones.find(z => z.id === zoneId);
    if (!zone) return [];
    const taken = new Set([g.player.home, ...Object.values(g.cast).map(r => r.home)].map(h => `${h.x},${h.y}`));
    return zone.spots.filter(s => !taken.has(`${s[0]},${s[1]}`));
}
// Moving costs one week of the new rent; rent then counts from today.
export function moveTo(g: Save, w: WorldDef, zoneId: string): string {
    const zone = w.homes.zones.find(z => z.id === zoneId);
    const spot = freeSpots(g, w, zoneId)[0];
    if (!zone || !spot) return 'There is no free home there.';
    const deposit = priceOf(g, zone.rent);
    if (g.player.money < deposit) return 'Not enough money.';
    g.player.money -= deposit;
    book(g, `${zone.name}: deposit`, -deposit);
    g.player.home = { zone: zone.id, kind: zone.kind, x: spot[0], y: spot[1], n: zone.spots.findIndex(s => s[0] === spot[0] && s[1] === spot[1]) + 1 };
    g.player.rentPaidDay = g.day; resetBills(g, w);
    note(g, '{u} moved to a new home: {0}.', [zone.name], [], g.player.loc, 'home');
    return '';
}
