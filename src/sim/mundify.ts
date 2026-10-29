// "Mundify": a copy of a character card made for Mundi. Most cards are written for a one-on-one chat and carry their
// own scenario, rules, greetings and prompt overrides, which fight the world (the world sets the scene, the clock, the
// first meeting). The copy keeps only who the character is: appearance, backstory, personality and other details about
// them. The original card is never changed.
import { characters, charOf, fullCharacter, duplicateCharacter, saveCharacter, tagCharacter, quiet, charLorebooks, setCharLorebooks } from '../st/bridge.js';

export interface Mundified { from: string; name: string; at: number; ai: boolean }
export const MUNDI_TAG = 'Mundified';

// The mark on a mundified copy (who it was made from, when, and whether the AI cleaned it up).
export const mundifiedOf = (c: any): Mundified | null => { const m = c?.data?.extensions?.mundified; return m?.from ? m as Mundified : null; };
// Cards Mundi made itself (the worlds' own people, the character maker) are already written for it.
export const madeForMundi = (c: any) => !!c?.data?.extensions?.mundi || c?.creator === 'Mundi' || c?.data?.creator === 'Mundi';
// The mundified copies made from a card (newest first).
export const mundiCopies = (avatar: string): any[] => characters().filter(c => mundifiedOf(c)?.from === avatar).sort((a, b) => (mundifiedOf(b)!.at - mundifiedOf(a)!.at));

const text = (v: any) => String(v ?? '').trim();
const SECTIONS = ['APPEARANCE', 'CLOTHING', 'BACKSTORY', 'PERSONALITY', 'DETAILS'] as const;
type Parts = Record<(typeof SECTIONS)[number], string>;

// Everything on the card that can say something about the character, the parts that are not about them included:
// the AI keeps the facts about the character and drops the rest.
function source(c: any): string {
    const d = c.data ?? {};
    const parts: [string, any][] = [
        ['Description', c.description], ['Personality', c.personality], ['Scenario', c.scenario],
        ['Greeting', c.first_mes], ['Example dialogue', c.mes_example],
        ['Main prompt override', d.system_prompt], ['Post-history instructions', d.post_history_instructions],
        ["Character's note", d.extensions?.depth_prompt?.prompt],
    ];
    return parts.filter(([, v]) => text(v)).map(([k, v]) => `## ${k}\n${text(v)}`).join('\n\n');
}

// Clothes set people apart (and the sprites are drawn from them): every mundified card gets its own section, written
// from the card, or chosen to fit who they are where the card says little.
export const STYLE_HEAD = 'Clothing and style';
export const CLOTHING = (name: string) => `${name}'s clothing and style: their personal style in a few words (streetwear, preppy, gothic, practical workwear…), the clothes they usually wear (garments, colors, shoes), what they wear for work or going out if it differs, and anything they always wear whatever the outfit (a hijab, glasses, a necklace or keepsake they never take off). Take what the card says; where it says little, choose what fits who ${name} is, their age, job, personality and the world.`;
/** Whether a card has its own clothing and style section (mundified copies made before it existed do not). */
export const hasStyle = (c: any) => new RegExp(`(^|\\n)${STYLE_HEAD}:`, 'i').test(String(c?.description ?? ''));

// Adds the clothing and style section to a card that lacks it (a mundified copy made before the section existed), after
// its appearance. Only the description changes.
export async function addStyle(avatar: string): Promise<void> {
    const c = await fullCharacter(avatar);
    if (!c) throw new Error('This character no longer exists.');
    if (hasStyle(c)) return;
    const name = String(c.name ?? '');
    const card = [c.description, c.personality].map(text).filter(Boolean).join('\n\n').replace(/\{\{char\}\}/gi, name);
    const out = await quiet(`Below is ${name}'s character card from a life simulation game. Write one more section for it.

${CLOTHING(name)}

Plain prose in the third person, two to four short sentences. Answer with the section only, no heading.

The card:
${card || name}`, 400);
    const body = out.replace(/^\s*\[?(clothing( and style)?|style)\]?\s*:?\s*/i, '').trim();
    if (!body || /^none\.?$/i.test(body)) throw new Error(`The AI did not describe ${name}'s clothes.`);
    const desc = text(c.description);
    // after the appearance section when there is one, else first
    const m = desc.match(/^Appearance:\n[\s\S]*?(?=\n\n[A-Z][^\n]{0,40}:\n|$)/);
    const section = `${STYLE_HEAD}:\n${body}`;
    const description = m ? `${m[0]}\n\n${section}${desc.slice(m[0].length)}` : `${section}\n\n${desc}`.trim();
    await saveCharacter(avatar, { description });
}

export function ask(name: string, src: string): string {
    return `Below is a roleplay character card for ${name}. It will be used in a life simulation game. The game already decides the setting, the scene, the time, where people are, how they met the player and what happens next, so the card must only describe who ${name} is.

Rewrite the card into these five sections:
[APPEARANCE] What ${name} looks like: body, face, hair, eyes, voice (not their clothes).
[CLOTHING] ${CLOTHING(name)}
[BACKSTORY] ${name}'s past and life: where they come from, family, history, job, important events.
[PERSONALITY] Character traits, habits, likes and dislikes, fears, goals, how they speak and behave.
[DETAILS] Any other facts about ${name} that fit nowhere else (skills, possessions, quirks, speech examples in one or two short lines).

Rules:
- Keep every fact about ${name} that is on the card. Do not invent anything, except the clothing where the card says little.
- Drop everything that is not about ${name}: the starting situation or scenario, the story's plot setup, the relationship to {{user}} or what {{user}} is, instructions to the AI, roleplay or formatting rules, out-of-character notes, greetings, and lines written as dialogue.
- Write ${name} instead of {{char}}. Never mention {{user}}.
- Plain prose in the third person, short and dense. No markdown headings, no lists of rules.
- If a section has nothing, write "None."
- Answer with the five sections only, each starting with its tag on its own line.

The card:
${src}`;
}

export function parse(out: string): Parts | null {
    const parts: Parts = { APPEARANCE: '', CLOTHING: '', BACKSTORY: '', PERSONALITY: '', DETAILS: '' };
    const re = /\[(APPEARANCE|CLOTHING|BACKSTORY|PERSONALITY|DETAILS)\]\s*:?/gi;
    const hits = [...out.matchAll(re)];
    if (hits.length < 2) return null;
    hits.forEach((m, k) => {
        const end = k + 1 < hits.length ? hits[k + 1].index! : out.length;
        const body = out.slice(m.index! + m[0].length, end).trim();
        parts[m[1].toUpperCase() as keyof Parts] = /^none\.?$/i.test(body) ? '' : body;
    });
    return parts.APPEARANCE || parts.BACKSTORY || parts.PERSONALITY ? parts : null;
}

// Makes the mundified copy of a card and returns the copy's avatar file. With `ai`, the AI rewrites the description into
// appearance, backstory, personality and details (and saves the facts hidden in the scenario, greetings or notes);
// without it, the description and personality are kept word for word. Either way the copy loses its scenario,
// greetings, example dialogue, main prompt override, post-history instructions and Character's note. Its lorebooks
// stay linked (the card's own and the additional ones).
export async function mundify(avatar: string, ai: boolean): Promise<string> {
    const c = await fullCharacter(avatar);
    if (!c) throw new Error('This character no longer exists.');
    if (madeForMundi(c)) throw new Error(`${c.name} was made for Mundi already.`);
    if (mundifiedOf(c)) throw new Error(`${c.name} is a mundified copy already.`);
    let description = text(c.description), personality = text(c.personality);
    if (ai) {
        const src = source(c);
        if (!src) throw new Error(`${c.name}'s card is empty.`);
        // the AI first: if it fails, no copy is left behind
        const p = parse(await quiet(ask(c.name, src), 2500));
        if (!p) throw new Error(`The AI did not answer in the expected form for ${c.name}. Try again, or mundify without the AI.`);
        description = [['Appearance', p.APPEARANCE], [STYLE_HEAD, p.CLOTHING], ['Backstory', p.BACKSTORY], ['Details', p.DETAILS]]
            .filter(([, v]) => v).map(([k, v]) => `${k}:\n${v}`).join('\n\n');
        personality = p.PERSONALITY;
    }
    const copy = await duplicateCharacter(avatar);
    if (!copy || !charOf(copy)) throw new Error('Could not make the copy.');
    const mark: Mundified = { from: avatar, name: String(c.name ?? ''), at: Date.now(), ai };
    await saveCharacter(copy, {
        description, personality, scenario: '', first_mes: '', alternate_greetings: [], mes_example: '',
        system_prompt: '', post_history_instructions: '', depth_prompt: { prompt: '', depth: 4, role: 'system' },
        extensions: { mundified: mark },
    });
    // the additional lorebooks are kept by card file in SillyTavern's settings: the copy gets the same ones
    const books = charLorebooks(avatar);
    if (books.length > 1) await setCharLorebooks(copy, books);
    tagCharacter(copy, MUNDI_TAG);
    return copy;
}
