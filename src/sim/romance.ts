// Relationships in two tracks, like The Sims: friendship (the bond, 0..100) and romance (0..100 plus a status).
// The engine owns the numbers. The AI only plays the scenes: when you ask someone out or propose, the engine tells the
// AI how ready that person is, the AI writes the reaction, and a tiny follow-up question ("did they accept?") lets
// the engine apply the result. At night, the diary call also gives a verdict on the day's relationships.
import { nowAbs, type Save } from '../core/store.js';
import { social, bondOf, bump } from './social.js';
import { approvalOf, approve } from './living.js';
import { note } from './facts.js';
import { romanceBlocked, canTryForBaby } from './family.js';

export type RomStatus = 'none' | 'dating' | 'engaged' | 'married';
export interface Rom { value: number; status: RomStatus; cooldown?: number }
const R = (g: Save): Record<string, Rom> => ((g as any).romance ??= {});
export function romOf(g: Save, avatar: string): Rom {
    const r = (R(g)[avatar] ??= { value: 0, status: social(g).partner.includes(avatar) ? 'dating' : 'none' });
    return r;
}
export const romValue = (g: Save, avatar: string) => romOf(g, avatar).value;
export function addRomance(g: Save, avatar: string, delta: number) { const r = romOf(g, avatar); r.value = Math.max(0, Math.min(100, r.value + delta)); }
// set by hand (the world config): the value and/or the status, keeping the partner list in step
export function setRomance(g: Save, avatar: string, value?: number, status?: RomStatus) {
    const r = romOf(g, avatar);
    if (value !== undefined) r.value = Math.max(0, Math.min(100, value));
    if (status !== undefined) r.status = status;
    syncPartner(g, avatar);
}
// keeps the older "partner" list (used by plans, the phone…) in step with the romance status
function syncPartner(g: Save, avatar: string) {
    const p = social(g).partner; const on = romOf(g, avatar).status !== 'none'; const i = p.indexOf(avatar);
    if (on && i < 0) p.push(avatar); if (!on && i >= 0) p.splice(i, 1);
}

/* ---------- tiers ---------- */

export interface Tier { id: string; name: string; lo: number; hi: number; color: string }
export const FRIEND_TIERS: Tier[] = [
    { id: 'stranger', name: 'Stranger', lo: 0, hi: 10, color: '#8a94a6' },
    { id: 'acquaintance', name: 'Acquaintance', lo: 10, hi: 30, color: '#5aa0e6' },
    { id: 'friend', name: 'Friend', lo: 30, hi: 55, color: '#43b51b' },
    { id: 'good', name: 'Good friend', lo: 55, hi: 80, color: '#16b3a5' },
    { id: 'best', name: 'Best friend', lo: 80, hi: 101, color: '#f0ad13' },
];
export const ROMANCE_TIERS: Tier[] = [
    { id: 'none', name: 'No romance', lo: 0, hi: 15, color: '#8a94a6' },
    { id: 'interest', name: 'Interest', lo: 15, hi: 40, color: '#f48fb1' },
    { id: 'crush', name: 'Crush', lo: 40, hi: 101, color: '#e7489a' },
];
export const STATUS_TIER: Record<Exclude<RomStatus, 'none'>, Tier> = {
    dating: { id: 'dating', name: 'Dating', lo: 0, hi: 101, color: '#e23b6e' },
    engaged: { id: 'engaged', name: 'Engaged', lo: 0, hi: 101, color: '#c2185b' },
    married: { id: 'married', name: 'Married', lo: 0, hi: 101, color: '#ad1457' },
};
export const friendTier = (v: number) => FRIEND_TIERS.find(t => v >= t.lo && v < t.hi) ?? FRIEND_TIERS[0];
export function romanceTier(g: Save, avatar: string, value = romValue(g, avatar)): Tier {
    const s = romOf(g, avatar).status;
    return s !== 'none' ? STATUS_TIER[s] : ROMANCE_TIERS.find(t => value >= t.lo && value < t.hi) ?? ROMANCE_TIERS[0];
}
// progress inside the tier (the bar fills up and starts again at each new tier, like The Sims)
export const tierPct = (t: Tier, v: number) => Math.round(Math.max(0, Math.min(1, (v - t.lo) / (Math.min(t.hi, 100) - t.lo))) * 100);

/* ---------- asking (the AI plays the scene, the engine reads the answer) ---------- */

export type AskKind = 'date' | 'propose' | 'marry' | 'baby';
export const ASKS: Record<AskKind, { label: string; line: (n: string) => string; to: RomStatus | null; from: RomStatus[] }> = {
    date: { label: 'Ask them out', line: n => `*asks ${n} to be a couple* "Will you be with me? As a couple, I mean."`, to: 'dating', from: ['none'] },
    propose: { label: 'Propose', line: n => `*proposes to ${n}*`, to: 'engaged', from: ['dating'] },
    marry: { label: 'Get married', line: n => `*asks ${n} to set the date and get married*`, to: 'married', from: ['engaged'] },
    baby: { label: 'Try for a baby', line: n => `*asks ${n} if they want to try for a baby together*`, to: null, from: ['dating', 'engaged', 'married'] },
};
export const canAsk = (g: Save, avatar: string, k: AskKind) => !romanceBlocked(g, avatar) && ASKS[k].from.includes(romOf(g, avatar).status) && (k !== 'baby' || canTryForBaby(g, avatar));
export const coolingDown = (g: Save, avatar: string) => (romOf(g, avatar).cooldown ?? 0) > nowAbs(g);

// How ready they are: told to the AI so it does not simply say yes (models like to please).
export function readiness(g: Save, avatar: string, name: string, k: AskKind): string {
    const b = bondOf(g, avatar), r = romValue(g, avatar), a = approvalOf(g, avatar);
    const ft = friendTier(b).name.toLowerCase(), rt = romanceTier(g, avatar).name.toLowerCase();
    const st = romOf(g, avatar).status;
    const need = k === 'date' ? 45 : k === 'propose' ? 70 : k === 'marry' ? 80 : st === 'married' ? 60 : st === 'engaged' ? 75 : 85;
    const score = r * 0.6 + b * 0.4 + a * 0.2;
    const lean = score >= need + 15 ? 'would very likely say yes' : score >= need ? 'would probably say yes, maybe with some nerves' : score >= need - 15 ? 'is unsure: it could go either way, and asking may feel too soon'
        : 'would most likely say no, or feel uncomfortable: it is too soon';
    return `[{{user}} is asking ${name} ${k === 'date' ? 'to be a couple' : k === 'propose' ? 'to marry them' : k === 'marry' ? 'to get married now' : 'to try for a baby together'}. Where they stand: ${ft}, romance: ${rt}${a <= -15 ? `, and ${name} disapproves of how {{user}} behaves` : ''}. Realistically ${name} ${lean}. ` +
        `Let ${name}'s personality decide within that; do not make ${name} agree just to please. Write ${name}'s honest reaction, and make the answer clear (yes, no, or that they need time to think).]`;
}

// After the reply: the engine applies the answer.
export function applyAnswer(g: Save, avatar: string, name: string, k: AskKind, answer: 'yes' | 'no' | 'maybe'): string {
    const r = romOf(g, avatar);
    if (answer === 'yes') {
        if (k === 'baby') { r.cooldown = 0; addRomance(g, avatar, 5); return ''; }   // the engine then decides (family.ts)
        r.status = ASKS[k].to!; r.cooldown = 0; addRomance(g, avatar, 15); bump(g, avatar, 5); syncPartner(g, avatar);
        note(g, k === 'date' ? '{u} and {0} started dating.' : k === 'propose' ? '{u} and {0} got engaged.' : '{u} and {0} got married.', [name], [avatar], g.player.loc, 'love');
        return k === 'date' ? `You and ${name} are now dating!` : k === 'propose' ? `You and ${name} are engaged!` : `You and ${name} are married!`;
    }
    const day = 1440;
    if (answer === 'maybe') { r.cooldown = nowAbs(g) + day; note(g, '{0} asked {u} for some time to think about it.', [name], [avatar], g.player.loc, 'love'); return `${name} wants some time to think.`; }
    // a no: a little awkward, and asking again too soon makes it worse
    if (k === 'baby') { r.cooldown = nowAbs(g) + 3 * day; note(g, '{0} is not ready to have a baby with {u}.', [name], [avatar], g.player.loc, 'family'); return `${name} is not ready for a baby.`; }
    r.cooldown = nowAbs(g) + 3 * day; addRomance(g, avatar, -8); bump(g, avatar, -4);
    note(g, '{0} turned {u} down.', [name], [avatar], g.player.loc, 'love');
    return `${name} said no.`;
}
// asking again while they still feel awkward
export function pushTooSoon(g: Save, avatar: string, name: string) { bump(g, avatar, -6); approve(g, avatar, -5); return `${name} is not ready to talk about that again so soon (bond −6).`; }

/* ---------- ending it ---------- */

export function endRelationship(g: Save, avatar: string, name: string): string {
    const r = romOf(g, avatar); const was = r.status;
    if (was === 'none') return '';
    r.status = 'none'; r.value = Math.max(0, r.value - 45); syncPartner(g, avatar);
    bump(g, avatar, was === 'married' ? -30 : -20); approve(g, avatar, -10);
    note(g, was === 'married' ? '{u} and {0} got divorced.' : '{u} broke up with {0}.', [name], [avatar], g.player.loc, 'love');
    return was === 'married' ? `You and ${name} are divorced.` : `You and ${name} broke up.`;
}

/* ---------- the night's verdict (from the diary call) ---------- */

export interface Change { avatar: string; name: string; why: string; f0: number; f1: number; r0: number; r1: number }
// lines like "Samantha | friendship +2 | romance 0 | talked at the gym"
export function applyVerdict(g: Save, people: { avatar: string; name: string }[], text: string): Change[] {
    const out: Change[] = [];
    for (const line of text.split('\n')) {
        const m = line.match(/^\s*[-*]?\s*([^|]+?)\s*\|\s*friendship\s*([+-]?\d)\s*\|\s*romance\s*([+-]?\d)\s*\|\s*(.+)$/i);
        if (!m) continue;
        const p = people.find(x => x.name.toLowerCase() === m[1].trim().toLowerCase());
        if (!p || out.some(c => c.avatar === p.avatar)) continue;
        const df = Math.max(-3, Math.min(3, Number(m[2]))) * 3, dr = Math.max(-3, Math.min(3, Number(m[3]))) * 3;
        const f0 = bondOf(g, p.avatar), r0 = romValue(g, p.avatar);
        if (df) bump(g, p.avatar, df);
        if (dr && !romanceBlocked(g, p.avatar)) addRomance(g, p.avatar, dr);
        out.push({ avatar: p.avatar, name: p.name, why: m[4].trim().slice(0, 160), f0, f1: bondOf(g, p.avatar), r0, r1: romValue(g, p.avatar) });
    }
    return out;
}

// For the AI: where {{user}} stands with the people in this scene (friendship and romance, in words).
export function romanceLine(g: Save, present: { avatar: string; name: string }[]) {
    const parts = present.map(r => {
        const f = friendTier(bondOf(g, r.avatar)).name.toLowerCase(), rt = romanceTier(g, r.avatar);
        return `${r.name}: ${f}${rt.id !== 'none' ? `, ${rt.name.toLowerCase()}` : ''}`;
    });
    return parts.length ? `How {{user}} stands with them: ${parts.join('; ')}.` : '';
}
