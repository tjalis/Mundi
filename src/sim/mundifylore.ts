// "Mundify" for lorebooks: a copy of a lorebook made for Mundi. Lorebooks written for chats often hold more than facts
// about the world: how the AI must reply, the narrator's rules, trackers, the opening scene, who {{user}} is. In a Mundi
// world those fight the game (the world sets the scene, the clock and who you are), and the world switches its
// lorebooks on while you play. The copy keeps every fact about the world and switches the rest off (entries that mix
// both are rewritten with the facts only). Any kind of world: the sorting is "facts about the world" against
// "instructions and setup", whatever the genre. The original lorebook is never changed.
import { lorebooks, loadLore, saveNewLorebook, quiet } from '../st/bridge.js';
import { settings, saveSettings } from '../core/store.js';
import { parseJson } from './fromlore.js';

export interface LoreMundified { from: string; at: number; ai: boolean; off: number; rewritten: number }
const marks = () => (settings().mundifiedLore ??= {});

/** The mark on a mundified copy (who it was made from, when, what changed), or null. */
export const loreMundifiedOf = (name: string): LoreMundified | null => marks()[name] ?? null;
/** The mundified copies made from a lorebook that still exist (newest first). */
export const loreCopies = (name: string): string[] => {
    const have = new Set(lorebooks());
    return Object.entries(marks()).filter(([n, m]) => m.from === name && have.has(n)).sort((a, b) => b[1].at - a[1].at).map(([n]) => n);
};
// Copies deleted in SillyTavern lose their mark the next time one is made.
function tidy() { const have = new Set(lorebooks()); for (const n of Object.keys(marks())) if (!have.has(n)) delete marks()[n]; }

type Verdict = 'keep' | 'off' | 'rewrite';
interface Entry { id: string; title: string; keys: string[]; text: string; constant: boolean }

/* ---------- without the AI: the plain signs of an instruction ---------- */

// Titles that name an instruction or the setup (not "Rules of the Guild", "System Lords" or "Emergency Response").
const HEAD = /^\s*\[?(ooc|instructions?|format(ting)?|jailbreak|guidelines?|scenario|opening( scene)?|first message|tracker)\b|\b(system (prompt|note|instructions?)|(ai|narrator|gm|game ?master|roleplay|rp|response|reply|writing|formatting) (instructions?|rules|guidelines?|style|format)|style guide|out of character|status (block|panel|bar|tracker)|stat ?block)\b|\{\{user\}\}'?s? (role|character|persona|background|backstory)\b|^\s*\{\{user\}\}\s*$/i;
const SENTENCE = [
    /^\s*\[?(system|ooc|note to (the )?ai|instructions?|rule)\]?\s*:/i,
    /\byou (are|will|must|should|shall|may not|can ?not|never|always) (be |act |play |write |respond |reply |describe |narrate |portray |roleplay |speak |control )?(the )?(narrator|game ?master|gm|ai|assistant|storyteller|dm)?\b.*\b(narrat|respond|repl|writ|describ|portray|roleplay|play|act|speak|control|continue)/i,
    /\b(respond|reply|write|answer|narrate)\b[^.]{0,40}\b(in|with|using) (the )?(third|first|second|present|past|\d+|one|two|three|short|long|detailed|vivid|markdown|asterisks|paragraphs?)/i,
    /\b(do not|don'?t|never) (write|speak|act|decide|describe|narrate|control|assume)[^.]{0,30}\b(for|as|on behalf of) \{\{user\}\}/i,
    /\b(always|never) (write|describe|speak|act|end|start|include|use|mention|break)\b/i,
    /\{\{user\}\} (is|will be|plays|has just|has arrived|arrives|wakes|starts|begins)\b/i,
];
const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(x => x.length > 3);
/** The verdict for an entry without asking the AI: off when its title says it is an instruction, or when most of it
 *  reads like one; otherwise kept (only the AI can rewrite an entry that mixes both). */
export function plainVerdict(e: { title: string; text: string }): Verdict {
    if (HEAD.test(e.title)) return 'off';
    const s = sentences(e.text);
    if (!s.length) return 'keep';
    const n = s.filter(x => SENTENCE.some(re => re.test(x))).length;
    return n / s.length >= 0.5 ? 'off' : 'keep';
}

/* ---------- with the AI ---------- */

const PART = 4500, CUT = 3000;
function prompt(list: Entry[]): string {
    return `Below are entries of a roleplay lorebook. It will be used in a life-simulation game. The game already runs the story: it sets the scene, the time, where people are, who the player is and what happens next, and it tells the AI how to write. So the lorebook must only hold facts about the world.

For each entry, decide:
- "keep": it is about the world: places, people, groups, history, technology, magic, creatures, customs, laws, how things work. Dark, strange or unusual settings are fine; keep them.
- "off": it is only instructions to the AI or the player (how to reply, writing style, format, rules for the narrator or game master, trackers, status blocks, out-of-character notes), the starting scenario or opening scene, or what {{user}} is and how others relate to {{user}}.
- "rewrite": it mixes both. Give "text": the entry with only its facts about the world, keeping every fact (and the wording where you can), without the instructions, the opening scenario or {{user}}'s role. Plain prose. Never for an entry marked (cut).
When unsure, "keep".

Reply with ONE JSON object, nothing else (no code fences):
{"entries":[{"id":"the entry's id","verdict":"keep|off|rewrite","text":"only for rewrite"}]}
Every entry id must appear once.

Entries:
${list.map(e => `### id ${e.id}: ${e.title}${e.keys.length ? ` (keys: ${e.keys.slice(0, 6).join(', ')})` : ''}${e.constant ? ' [always on]' : ''}${e.text.length > CUT ? ' (cut)' : ''}\n${e.text.slice(0, CUT)}`).join('\n\n')}`;
}
// Parts of about PART characters, one AI call each.
function parts(list: Entry[]): Entry[][] {
    const out: Entry[][] = []; let cur: Entry[] = [], size = 0;
    for (const e of list) {
        const n = Math.min(e.text.length, CUT) + e.title.length + 40;
        if (cur.length && size + n > PART) { out.push(cur); cur = []; size = 0; }
        cur.push(e); size += n;
    }
    if (cur.length) out.push(cur);
    return out;
}
/** The AI's verdicts for one part (an entry it skipped, or a rewrite it may not do, is decided without it). */
export function readVerdicts(raw: any, list: Entry[]): Map<string, { v: Verdict; text?: string }> {
    const out = new Map<string, { v: Verdict; text?: string }>();
    for (const x of Array.isArray(raw?.entries) ? raw.entries : []) {
        const e = list.find(y => y.id === String(x?.id ?? '').replace(/^id\s*/i, '').trim());
        if (!e || out.has(e.id)) continue;
        const v = String(x?.verdict ?? '').toLowerCase();
        const text = typeof x?.text === 'string' ? x.text.trim() : '';
        if (v === 'off') out.set(e.id, { v: 'off' });
        else if (v === 'rewrite' && text && e.text.length <= CUT) out.set(e.id, { v: 'rewrite', text });
        else out.set(e.id, { v: 'keep' });
    }
    for (const e of list) if (!out.has(e.id)) out.set(e.id, { v: plainVerdict(e) });
    return out;
}

/** Makes the mundified copy of a lorebook and returns its name. `ai`: the AI sorts the entries (and rewrites mixed
 *  ones); without it only entries that plainly are instructions are switched off. `step` tells how far it got. */
export async function mundifyLore(name: string, ai: boolean, step: (done: number, of: number) => void = () => {}): Promise<{ name: string; off: number; rewritten: number; kept: number }> {
    if (!lorebooks().includes(name)) throw new Error(`The lorebook “${name}” no longer exists.`);
    if (loreMundifiedOf(name)) throw new Error(`“${name}” is a mundified copy already.`);
    const data = structuredClone(await loadLore(name));
    const all: Entry[] = Object.entries<any>(data?.entries ?? {}).filter(([, e]) => e && !e.disable && String(e.content ?? '').trim())
        .map(([id, e]) => ({ id, title: String(e.comment || (e.key ?? [])[0] || `Entry ${id}`).trim(), keys: (Array.isArray(e.key) ? e.key : []).map(String), text: String(e.content).replace(/\r/g, '').trim(), constant: !!e.constant }));
    if (!all.length) throw new Error(`“${name}” has no entries switched on.`);
    // the AI first: if it fails, no copy is left behind
    const verdicts = new Map<string, { v: Verdict; text?: string }>();
    if (ai) {
        const ps = parts(all);
        let failed = 0;
        for (const [i, p] of ps.entries()) {
            step(i, ps.length);
            try { for (const [k, v] of readVerdicts(parseJson(await quiet(prompt(p), 4000)), p)) verdicts.set(k, v); }
            catch (e) { console.warn('[Mundi] mundify lorebook, part', i, e); failed++; for (const x of p) verdicts.set(x.id, { v: plainVerdict(x) }); }
        }
        if (failed === ps.length) throw new Error(`The AI did not answer in the expected form for “${name}”. Try again, or mundify without the AI.`);
    } else for (const x of all) verdicts.set(x.id, { v: plainVerdict(x) });
    let off = 0, rewritten = 0;
    for (const [id, { v, text }] of verdicts) {
        const e = data.entries[id];
        if (v === 'off') { e.disable = true; off++; }
        else if (v === 'rewrite' && text) { e.content = text; rewritten++; }
    }
    tidy();
    let copy = `${name} (Mundi)`;
    for (let n = 2; lorebooks().includes(copy); n++) copy = `${name} (Mundi ${n})`;
    await saveNewLorebook(copy, data);
    marks()[copy] = { from: name, at: Date.now(), ai, off, rewritten };
    saveSettings();
    return { name: copy, off, rewritten, kept: all.length - off - rewritten };
}
