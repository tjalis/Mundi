// Quests from the lorebooks and from the story (RPG mode).
//   - Lorebooks: the world's, the chat's, each character's and your persona's lorebooks are read for quests
//     (missions, requests, bounties, jobs, a campaign ledger's open threads). One AI pass per part turns them into
//     the game's quests, with steps at the world's places, checks with its skills and fights with its foes. Quests the
//     books say are under way already are yours from the start; open ones wait to be found (a board, asking around, or
//     their giver when you meet). Each book is read once, and again when it changes.
//   - The story: after each reply, one AI call reads it. Someone asked {{user}} for help: a quest (yours if {{user}}
//     said yes). A step the story clearly did, or a quest it finished or ruined: counted. Rolls and fights are still
//     the game's: the story only does the steps without them.
import { nowAbs, settings, saveSettings, cfg, type Save } from '../core/store.js';
import type { WorldDef } from '../core/world.js';
import { rpgOf } from '../core/rpgdef.js';
import { loadLore, quiet, chat, personaName, persona, personaLore, charLorebooks, chatLores, openChatRef } from '../st/bridge.js';
import { parseJson } from './fromlore.js';
import { isRpg, sheetOf } from './rpg.js';
import { inCombat } from './combat.js';
import { quests, questPool, activeQuests, offeredQuests, giverOf, doStep, storyFinish, failQuest, plainStep, acceptQuest, offer, roomForMore, type Quest, type QuestStep } from './quests.js';

/* ---------- settings ---------- */

export interface QuestPrefs { story: boolean; lore: boolean }
export const questPrefs = (): QuestPrefs => { const s = settings() as any; s.quests ??= {}; s.quests.story ??= true; s.quests.lore ??= true; return s.quests; };
export function setQuestPref(k: keyof QuestPrefs, v: boolean) { questPrefs()[k] = v; saveSettings(); }

/* ---------- names ---------- */

const norm = (s: string) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
// The same person or place: the whole name, one inside the other, or the same first word (people).
const sameName = (a: string, b: string, first = true) => { const x = norm(a), y = norm(b); if (!x || !y) return false; return x === y || (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x))) || (first && x.split(' ')[0] === y.split(' ')[0] && x.split(' ')[0].length > 2); };
/** The world's person with that name (their avatar), or ''. */
export const personNamed = (g: Save, name: string) => Object.keys(g.cast).find(a => sameName(g.cast[a].name, name)) ?? '';
const youNames = () => [personaName(), 'you', 'user', '{{user}}', 'the player'];
const isYou = (n: string) => youNames().some(y => sameName(y, n));
/** The world's place with that name ('' when none). */
export function placeNamed(w: WorldDef, name: string): string {
    if (!norm(name)) return '';
    const list = w.places.filter(p => !p.link);
    return (list.find(p => norm(p.name) === norm(name) || (p.aka ?? []).some(a => norm(a) === norm(name)))
        ?? list.find(p => sameName(p.name, name, false) || (p.aka ?? []).some(a => sameName(a, name, false))))?.id ?? '';
}
const sameQuest = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && (x === y || (x.length > 6 && y.length > 6 && (x.includes(y) || y.includes(x)))); };
const known = (g: Save, title: string) => [...quests(g), ...questPool(g)].some(q => sameQuest(q.title, title));

/* ---------- what the AI sends back ---------- */

export const REWARDS: Record<string, Quest['reward']> = { small: { xp: 50, money: 20, renown: 3 }, medium: { xp: 100, money: 50, renown: 6 }, large: { xp: 200, money: 120, renown: 12 } };
const DC: Record<string, number> = { small: 11, medium: 13, large: 15 };
export interface RawQuest { title?: string; giver?: string; text?: string; status?: string; steps?: any[]; reward?: string; outcome?: string; days?: number; where?: string }

/** One quest from the AI's answer, made to fit the world (null: not usable). */
export function questFrom(g: Save, w: WorldDef, x: RawQuest, from: 'lore' | 'story', lore = ''): Quest | null {
    const title = String(x?.title ?? '').trim().slice(0, 80);
    const text = String(x?.text ?? '').trim().slice(0, 400);
    if (!title || !text) return null;
    const size = ['small', 'medium', 'large'].includes(String(x.reward)) ? String(x.reward) : 'medium';
    const skills = new Set((rpgOf(w)?.skills ?? []).map(s => s.id));
    const bestiary = rpgOf(w)?.bestiary ?? [];
    const steps: QuestStep[] = (Array.isArray(x.steps) ? x.steps : []).slice(0, 5).map((s: any) => {
        const what = String(s?.what ?? '').trim().slice(0, 120);
        if (!what) return null;
        const st: QuestStep = { place: placeNamed(w, String(s?.place ?? '')), what };
        const skill = String(s?.skill ?? '').toLowerCase().trim();
        if (s?.fight && bestiary.length) {
            st.fight = [];
            const foes = (Array.isArray(s?.foes) ? s.foes : []).map((n: any) => bestiary.find(f => sameName(f.name, String(n), false) || f.id === String(n))?.id).filter(Boolean) as string[];
            if (foes.length) st.foes = foes.slice(0, 4);
        } else if (skills.has(skill)) {
            st.check = { skill, dc: DC[size] };
            const name = rpgOf(w)!.skills.find(k => k.id === skill)!.name;
            if (!/\(.*check\)$/i.test(st.what)) st.what = `${st.what} (${name} check)`;
        }
        return st;
    }).filter(Boolean) as QuestStep[];
    if (!steps.length) steps.push({ place: '', what: text.split(/(?<=[.!?])\s/)[0].slice(0, 120) });
    const giverName = String(x?.giver ?? '').trim().slice(0, 60);
    const giver = giverName && !isYou(giverName) ? personNamed(g, giverName) : '';
    const days = Math.max(0, Math.min(60, Math.round(Number(x?.days) || 0)));
    const at = placeNamed(w, String(x?.where ?? ''));
    return {
        id: `q${nowAbs(g)}_${from}_${Math.floor(Math.random() * 1e6)}`, kind: from, title, giver, ...(giver || !giverName || isYou(giverName) ? {} : { giverName }),
        text, steps, step: 0, reward: REWARDS[size], due: 0, days, state: 'offered', from, ...(lore ? { lore } : {}),
        ...(at ? { at } : {}), ...(String(x?.outcome ?? '').trim() ? { outcome: String(x.outcome).trim().slice(0, 300) } : {}),
    };
}

/* ---------- the lorebooks ---------- */

/** Every lorebook this game can see: the world's, the chat's, the people's and your persona's. */
export function questBooks(g: Save): string[] {
    const ref = openChatRef();
    const people = [...Object.keys(g.cast), ...(ref?.avatar ? [ref.avatar] : [])];
    const list = [...(cfg(g).lore ?? []), ...chatLores(), ...people.flatMap(a => { try { return charLorebooks(a); } catch { return []; } }), personaLore(persona())];
    return list.filter((n, i, a) => n && a.indexOf(n) === i);
}
// Entries that may hold a quest (the rest is not sent): its title, keys or text speak of one.
const QUESTY = /\b(quests?|missions?|tasks?|jobs?|requests?|bount(y|ies)|contracts?|errands?|objectives?|goals?|favou?rs?|commissions?|assignments?|raids?|hunts?|dungeons?|gates?|ledger|campaign|open threads?|to ?do|plot hooks?|hooks?|story ?arcs?|arcs?|investigat\w*|rescue|deliver\w*|escort|retrieve|find|recover|protect|defeat|slay|clear)\b/i;
interface Entry { book: string; title: string; text: string }
const PART = 6000, CUT = 2500;
function parts(list: Entry[]): Entry[][] {
    const out: Entry[][] = []; let cur: Entry[] = [], size = 0;
    for (const e of list) {
        const n = Math.min(e.text.length, CUT) + e.title.length + 40;
        if (cur.length && size + n > PART) { out.push(cur); cur = []; size = 0; }
        cur.push(e); size += n;
    }
    if (cur.length) out.push(cur);
    return out.slice(0, 6);   // at most six calls, however big the books are
}
export function lorePrompt(g: Save, w: WorldDef, list: Entry[]): string {
    const r = rpgOf(w);
    return `Below are entries from roleplay lorebooks. They are used in a role-playing game where the player is ${personaName()} ({{user}}). Find the QUESTS in them: missions, requests, jobs, bounties, favors someone wants done, open threads of a campaign, goals {{user}} is pursuing. Only things that can be DONE (go somewhere, find, fetch, deliver, defeat, rescue, persuade, investigate…), not facts, history or descriptions. If there are none, answer {"quests":[]}.

For each quest:
- "title": a short name.
- "giver": who asks for it (a name), or "" if nobody or {{user}} themselves.
- "text": one or two sentences: what is wanted and why.
- "status": "active" if the entries say {{user}} has already taken it on or is in the middle of it; "done" if it is finished; otherwise "open".
- "steps": 1 to 4 steps in order, each {"what":"what to do, short","place":"a place from the list below, or \\"\\"","skill":"a skill id from the list below if it takes a roll, else \\"\\"","fight":true or false,"foes":["foe names from the list, if any"]}.
- "where": the place from the list where it would be posted or asked, or "".
- "reward": "small", "medium" or "large".
- "outcome": one sentence: what changes in the world when it is done.
- "days": days to do it once taken on, or 0 for no hurry.

Places: ${w.places.filter(p => !p.link).map(p => p.name).join(', ')}
People: ${Object.values(g.cast).map(c => c.name).join(', ') || '(none)'}
Skills (ids): ${(r?.skills ?? []).map(s => s.id).join(', ')}
Foes: ${(r?.bestiary ?? []).map(f => f.name).slice(0, 40).join(', ') || '(none)'}

Reply with ONE JSON object, nothing else (no code fences):
{"quests":[{"title":"","giver":"","text":"","status":"open","steps":[{"what":"","place":"","skill":"","fight":false,"foes":[]}],"where":"","reward":"medium","outcome":"","days":0}]}

Entries:
${list.map(e => `### ${e.title} (from ${e.book})${e.text.length > CUT ? ' (cut)' : ''}\n${e.text.slice(0, CUT)}`).join('\n\n')}`;
}
/** Adds the quests the AI found: active ones are yours, open ones wait to be found. Returns what was added. */
export function addLoreQuests(g: Save, w: WorldDef, raw: any, book = ''): { active: Quest[]; open: Quest[] } {
    const out = { active: [] as Quest[], open: [] as Quest[] };
    for (const x of Array.isArray(raw?.quests) ? raw.quests : []) {
        const status = String(x?.status ?? 'open').toLowerCase();
        if (status === 'done' || known(g, String(x?.title ?? ''))) continue;
        const q = questFrom(g, w, x, 'lore', book); if (!q) continue;
        if (status === 'active') { offer(g, q, q.at ?? g.player.loc); acceptQuest(g, q.id); out.active.push(q); }
        else { questPool(g).push(q); out.open.push(q); }
    }
    return out;
}
const readMarks = (g: Save): Record<string, number> => ((g as any).questLore ??= {});
/** The books not read yet (or changed since): `all` reads them all again. */
async function booksToRead(g: Save, all: boolean): Promise<{ name: string; entries: Entry[]; count: number }[]> {
    const out: { name: string; entries: Entry[]; count: number }[] = [];
    for (const name of questBooks(g)) {
        let data: any; try { data = await loadLore(name); } catch { continue; }
        const list = Object.values<any>(data?.entries ?? {}).filter(e => e && !e.disable && String(e.content ?? '').trim());
        if (!all && readMarks(g)[name] === list.length) continue;
        const entries = list.map(e => ({ book: name, title: String(e.comment || (e.key ?? [])[0] || 'Entry').trim(), text: String(e.content).replace(/\r/g, '').trim(), keys: (Array.isArray(e.key) ? e.key : []).join(' ') }))
            .filter(e => QUESTY.test(`${e.title} ${e.keys}`) || QUESTY.test(e.text.slice(0, 4000)))
            .map(({ book, title, text }) => ({ book, title, text }));
        out.push({ name, entries, count: list.length });
    }
    return out;
}
/** Reads the lorebooks for quests. Returns what to tell the player ('' : nothing new). */
export async function readLoreQuests(g: Save, w: WorldDef, all = false): Promise<string> {
    if (!isRpg(w) || !sheetOf(g)) return '';
    const books = await booksToRead(g, all);
    const entries = books.flatMap(b => b.entries);
    let active = 0, open = 0, failed = 0;
    const ps = parts(entries);
    for (const p of ps) {
        try { const r = addLoreQuests(g, w, parseJson(await quiet(lorePrompt(g, w, p), 3000)), p[0]?.book ?? ''); active += r.active.length; open += r.open.length; }
        catch (e) { console.warn('[Mundi] quests from lorebooks', e); failed++; }
    }
    if (ps.length && failed === ps.length) throw new Error('The AI did not answer in the expected form. Try again.');
    for (const b of books) readMarks(g)[b.name] = b.count;
    if (!active && !open) return '';
    return `From your lorebooks: ${[active ? `${active} quest${active > 1 ? 's' : ''} you are on` : '', open ? `${open} waiting to be found (boards, asking around, the people who need help)` : ''].filter(Boolean).join(', ')}.`;
}

/* ---------- the story ---------- */

export interface StoryQuest { kind: 'step' | 'done' | 'failed' | 'new'; n?: number; quest?: RawQuest; yes?: boolean }
export function parseStoryQuests(out: string): StoryQuest[] {
    const list: StoryQuest[] = [];
    for (const line of out.split('\n')) {
        let m = line.match(/^\s*[-*]?\s*(STEP|DONE|FAILED)\s+Q?(\d+)/i);
        if (m) { list.push({ kind: m[1].toLowerCase() as StoryQuest['kind'], n: Number(m[2]) }); continue; }
        m = line.match(/^\s*[-*]?\s*NEW\s*:?\s*(.+)$/i);
        if (m) {
            const [title, giver, text, yes] = m[1].split('|').map(x => x.trim());
            if (title && text) list.push({ kind: 'new', quest: { title, giver: giver ?? '', text, steps: [{ what: text, place: '' }], reward: 'small' }, yes: /^y/i.test(yes ?? '') });
        }
    }
    return list;
}
export function storyPrompt(g: Save, w: WorldDef, lines: string[], open: Quest[]): string {
    return `[You keep track of quests in a role-play for a game. You do not write the story.]

The story just now (judge ONLY the last message):
${lines.join('\n')}

${open.length ? `${personaName()}'s quests (number: title: the next step):\n${open.map((q, i) => `Q${i + 1}: ${q.title}${q.state === 'offered' ? ' (offered, not taken on yet)' : ''}: ${q.steps[q.step]?.what.replace(/ \(.*\)$/, '') ?? ''}`).join('\n')}\n\n` : ''}Answer with lines, only for what clearly happened in the LAST message:
${open.length ? `STEP Qn   (${personaName()} actually did that next step, not just talked or thought about it)
DONE Qn   (the whole quest was clearly finished)
FAILED Qn (it can no longer be done: the person died, the thing was lost, ${personaName()} refused for good)
` : ''}NEW: title | who asks | what they want done, one sentence | yes or no (did ${personaName()} agree?)
(NEW only when someone in the last message asked ${personaName()} to do a real task that takes doing (an errand, a job, a hunt, finding someone, a favor), not small talk${open.length ? ', and not one of the quests above' : ''})
If nothing, answer: none`;
}
/** After a reply: the AI reads it for quests. Returns what to tell the player. */
export async function storyQuests(g: Save, w: WorldDef): Promise<string[]> {
    if (!questPrefs().story || !isRpg(w) || !sheetOf(g) || inCombat(g)) return [];
    const all = chat(); const last = all.at(-1);
    if (!last || last.is_user || last.is_system || !String(last.mes ?? '').trim()) return [];
    const mark = (g as any).questSeen as { i: number; t: string } | undefined;
    if (mark && mark.i === all.length - 1 && mark.t === String(last.mes)) return [];   // already read (a redraw, not a new reply)
    (g as any).questSeen = { i: all.length - 1, t: String(last.mes) };
    const open = [...activeQuests(g), ...offeredQuests(g)].slice(0, 8);
    const lines = all.filter((m: any) => m && !m.is_system && m.mes).slice(-3)
        .map((m: any, i: number, a: any[]) => `${m.name ?? ''}: ${String(m.mes).replace(/\s+/g, ' ').slice(0, i === a.length - 1 ? 1500 : 600)}`);
    const out = await quiet(storyPrompt(g, w, lines, open), 200);
    if (/^\s*none\.?\s*$/i.test(out)) return [];
    return applyStoryQuests(g, w, parseStoryQuests(out), open);
}
/** Applies what the story did to the quests (tests call it directly). */
export function applyStoryQuests(g: Save, w: WorldDef, seen: StoryQuest[], open: Quest[]): string[] {
    const msgs: string[] = [];
    for (const s of seen) {
        const q = s.n ? open[s.n - 1] : undefined;
        if (s.kind === 'new' && s.quest) {
            if (known(g, s.quest.title!) || open.some(o => sameQuest(o.text, s.quest!.text!)) || !roomForMore(g)) continue;
            const nq = questFrom(g, w, s.quest, 'story'); if (!nq) continue;
            offer(g, nq);
            if (s.yes) { acceptQuest(g, nq.id); msgs.push(`New quest: ${nq.title}${giverOf(g, nq) ? ` (for ${giverOf(g, nq)})` : ''}.`); }
            else msgs.push(`${giverOf(g, nq) || 'Someone'} asked for your help: ${nq.title} (in your Quests, to take on or turn down).`);
            continue;
        }
        if (!q) continue;
        if (s.kind === 'failed') { const m = failQuest(g, q.id, 'in the story'); if (m) msgs.push(m); continue; }
        if (q.state === 'offered') { if (s.kind === 'step' || s.kind === 'done') acceptQuest(g, q.id); else continue; }
        if (s.kind === 'done') { const r = storyFinish(g, w, q.id); if (r) msgs.push(r.text, ...r.msgs); else if (plainStep(q.steps[q.step])) { const x = doStep(g, w, q.id, 'story'); if (x) msgs.push(x.text, ...x.msgs); } continue; }
        if (s.kind === 'step' && plainStep(q.steps[q.step])) { const r = doStep(g, w, q.id, 'story'); if (r) msgs.push(r.text, ...r.msgs); }
    }
    return msgs.filter(Boolean);
}

let lastLook = 0;
/** After a reply: the lorebooks first (once, then when one changes), then the story. */
export async function questsAfterReply(g: Save, w: WorldDef): Promise<string[]> {
    if (!isRpg(w) || !sheetOf(g)) return [];
    const out: string[] = [];
    // (the books are looked at again every few minutes at most: a changed book is read again)
    if (questPrefs().lore && Date.now() - lastLook > 5 * 60000) { lastLook = Date.now(); try { const m = await readLoreQuests(g, w); if (m) out.push(m); } catch { /* the AI is offline: next time */ } }
    out.push(...await storyQuests(g, w));
    return out;
}
