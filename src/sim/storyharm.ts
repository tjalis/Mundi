// Harm in the story (RPG, death being real). After each reply, one AI call reads what just happened: who was hurt and
// how badly, whose wounds were tended, who died. Wounds cost hit points like a fight's, and sim/mortal.ts does the
// rest (down under a tenth, dead at 0 unless someone gets them through). A reply that tells a fight the game already
// played is skipped (that harm is counted). A swipe takes back what the replaced reply did, unless someone fell.
import type { Save } from '../core/store.js';
import type { WorldDef } from '../core/world.js';
import { quiet, chat, personaName } from '../st/bridge.js';
import { sheetOf, hpMax, mortalOn, changeHp, syncLife } from './rpg.js';
import { mortalOf, deathOf, memberHurt, residentDies } from './mortal.js';
import { partyOf, memberKey, memberName, type Member } from './party.js';
import { memberMaxHp, inCombat } from './combat.js';
import { presentAt } from './people.js';
import { isDown } from './wounds.js';

/** How much of someone's hit points a wound takes. */
export const SEVERITY: Record<string, number> = { scratch: 0.03, light: 0.1, serious: 0.25, grave: 0.45, mortal: 1 };
const HEAL: Record<string, number> = { some: 0.15, much: 0.4 };
export interface Harm { kind: 'hurt' | 'healed' | 'died'; name: string; level: string; cause: string }
// What one reply did, to take back on a swipe: hit points for you and each companion; `fell`: someone went down.
interface Mark { idx: number; text: string; you: number; members: Record<string, number>; fell?: boolean }
interface HarmState { harm?: Mark; harmFights?: number; fights?: number }
const stateOf = (g: Save) => mortalOf(g) as unknown as HarmState;

export function parseHarm(out: string): Harm[] {
    const list: Harm[] = [];
    for (const line of out.split('\n')) {
        const m = line.match(/^\s*[-*]?\s*(HURT|HEALED|DIED)\s+([^:]+?)\s*:\s*(.*)$/i); if (!m) continue;
        const kind = m[1].toLowerCase() as Harm['kind'];
        const [first, ...rest] = m[3].split(/[;,]/).map(x => x.trim());
        const level = kind === 'died' ? '' : (first ?? '').toLowerCase().replace(/[^a-z]/g, '');
        if (kind === 'hurt' && !SEVERITY[level]) continue;
        if (kind === 'healed' && !HEAL[level]) continue;
        list.push({ kind, name: m[2].replace(/^[*_"']+|[*_"']+$/g, '').trim(), level, cause: (kind === 'died' ? m[3] : rest.join(', ')).trim().slice(0, 60) });
    }
    return list;
}

const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9 ]/g, '').trim();
// The same person: the whole name, or the first name.
const same = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.split(' ')[0] === y.split(' ')[0]); };
const youNames = () => [personaName(), 'you', 'user', '{{user}}'];

/** Applies what the story did (tests call it directly). */
export function applyHarm(g: Save, w: WorldDef, harms: Harm[], mark: Mark = { idx: -1, text: '', you: 0, members: {} }): string[] {
    const s = sheetOf(g); if (!s) return [];
    const lines: string[] = [];
    const why = (h: Harm) => (h.cause ? ` (${h.cause})` : '');
    for (const h of harms) {
        if (deathOf(g)) break;
        if (youNames().some(n => same(n, h.name))) {
            const max = hpMax(w, s); const before = s.hp;
            if (h.kind === 'healed') {
                if (s.hp >= max) continue;
                changeHp(g, w, Math.round(max * HEAL[h.level])); mark.you += s.hp - before;
                lines.push(`💚 Your wounds are tended: +${s.hp - before} HP.`);
                continue;
            }
            const dmg = Math.max(1, Math.round(max * SEVERITY[h.kind === 'died' ? 'mortal' : h.level]));
            if (isDown(before - dmg, max)) mark.fell = true;
            lines.push(`🩸 You are hurt${why(h)}: −${Math.min(dmg, before)} HP.`);
            (g as any)._hurtBy = 'wounds';
            try { changeHp(g, w, -dmg); } finally { delete (g as any)._hurtBy; }
            if (!mark.fell) mark.you -= before - s.hp;
            continue;
        }
        const m = partyOf(g).members.find(x => same(memberName(g, x), h.name) || (x.merc && same(x.merc.name, h.name)));
        if (m) {
            const key = memberKey(m); const name = memberName(g, m);
            const max = m.max ?? memberMaxHp(g, w, m); const hp = m.hp ?? max;
            if (h.kind === 'healed') {
                if (hp >= max) continue;
                const add = Math.min(max - hp, Math.round(max * HEAL[h.level]));
                setHp(m, hp + add, max); mark.members[key] = (mark.members[key] ?? 0) + add;
                lines.push(`💚 ${name}'s wounds are tended: +${add} HP.`);
                continue;
            }
            const dmg = h.kind === 'died' ? max : Math.max(1, Math.round(max * SEVERITY[h.level]));
            if (isDown(hp - dmg, max)) mark.fell = true;
            else mark.members[key] = (mark.members[key] ?? 0) - dmg;
            lines.push(h.kind === 'died' ? `💀 ${name}${why(h)}…` : `🩸 ${name} is hurt${why(h)}: −${Math.min(dmg, hp)} HP.`);
            lines.push(...memberHurt(g, w, key, dmg, max));
            continue;
        }
        // anyone else here: the game does not count their hit points, but the dead are dead
        if (h.kind !== 'died') continue;
        const r = presentAt(g, w, g.player.loc).find(x => same(x.name, h.name));
        const avatar = r && Object.keys(g.cast).find(a => g.cast[a] === r);
        if (!avatar) continue;
        mark.fell = true;
        lines.push(residentDies(g, w, avatar, h.cause ? `died (${h.cause})` : 'died'));
    }
    return lines.filter(Boolean);
}
function setHp(m: Member, hp: number, max: number) {
    if (hp >= max) { delete m.hp; delete m.max; } else { m.hp = Math.max(0, hp); m.max = max; }
}
// A swipe: what the replaced reply did to hit points, taken back.
function undo(g: Save, w: WorldDef, mark: Mark) {
    const s = sheetOf(g);
    if (s && mark.you) { s.hp = Math.max(1, Math.min(hpMax(w, s), s.hp - mark.you)); syncLife(g, w); }
    for (const [key, d] of Object.entries(mark.members)) {
        const m = partyOf(g).members.find(x => memberKey(x) === key); if (!m) continue;
        const max = m.max ?? memberMaxHp(g, w, m);
        setHp(m, Math.max(1, (m.hp ?? max) - d), max);
    }
}

function prompt(g: Save, w: WorldDef, lines: string[]): string {
    const party = partyOf(g).members.map(m => (m.merc ? m.merc.name : memberName(g, m)));
    const others = presentAt(g, w, g.player.loc).map(r => r.name).filter(n => !party.some(p => same(p, n)));
    return `[You keep track of injuries in a role-play for a game. You do not write the story.]

The story just now (judge ONLY the last message):
${lines.join('\n')}

People whose health the game tracks: ${personaName()} (the player)${party.length ? `, ${party.join(', ')}` : ''}.${others.length ? ` Others here: ${others.join(', ')}.` : ''}
For each of them physically hurt in the LAST message, one line:
HURT Name: <scratch|light|serious|grave|mortal>; <what did it, 2 to 6 words>
(scratch: a graze or a bruise; light: a cut, a hard blow; serious: a deep wound, a broken bone, a bad burn; grave: a wound that kills without help; mortal: a wound nobody survives without a miracle)
For each of them whose wounds were properly treated in the last message (a healer, a doctor, stitches and bandages, a healing potion or spell):
HEALED Name: <some|much>
For anyone named above who clearly DIED in the last message:
DIED Name: <how, 2 to 6 words>
Only what really happened in the last message: not threats, near misses, memories, dreams, or harm told before. Pain, fear and tiredness are not wounds.
Answer only with such lines. If nothing, answer: none`;
}

/** After a reply: the AI reads it for harm, and the game applies it. Returns what to tell the player. */
export async function storyHarm(g: Save, w: WorldDef): Promise<string[]> {
    if (!mortalOn(g, w) || deathOf(g) || inCombat(g)) return [];
    const all = chat(); const idx = all.length - 1; const last = all[idx];
    if (!last || last.is_user || last.is_system || !String(last.mes ?? '').trim()) return [];
    const text = String(last.mes);
    const st = stateOf(g);
    // the reply after a fight the game played tells that fight: its wounds are already counted
    if ((st.fights ?? 0) !== (st.harmFights ?? 0)) { st.harmFights = st.fights ?? 0; st.harm = { idx, text, you: 0, members: {}, fell: true }; return []; }
    const prev = st.harm;
    if (prev && prev.idx === idx) { if (prev.text === text || prev.fell) return []; undo(g, w, prev); }
    const mark: Mark = { idx, text, you: 0, members: {} };
    st.harm = mark;
    const lines = all.filter((m: any) => m && !m.is_system && m.mes).slice(-3)
        .map((m: any, i: number, a: any[]) => `${m.name ?? ''}: ${String(m.mes).replace(/\s+/g, ' ').slice(0, i === a.length - 1 ? 1500 : 700)}`);
    const out = await quiet(prompt(g, w, lines), 200);
    if (/^\s*none\.?\s*$/i.test(out)) return [];
    return applyHarm(g, w, parseHarm(out), mark);
}
