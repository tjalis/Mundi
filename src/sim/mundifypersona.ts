// "Mundify" for personas: a copy of a persona made for Mundi, with a mundified copy of its lorebook. Personas written
// for chats often carry the chat's setup (the opening, who they are to the card's character, rules for the AI). The
// copy keeps who you are: appearance, clothing and style, backstory, personality and details, and its lorebook keeps
// the facts about you (your powers and how they work, your limits, the people you know) without the instructions.
// The original persona and its lorebook are never changed.
import { personas, personaImage, createPersona, personaLore, setPersonaLore, personaSheet, setPersonaSheet, personaData, savePersonaData, quiet } from '../st/bridge.js';
import { STYLE_HEAD, CLOTHING, parse } from './mundify.js';
import { mundifyLore, loreMundifiedOf } from './mundifylore.js';

export interface PersonaMundified { from: string; name: string; at: number; ai: boolean; lore?: string }

/** The mark on a mundified persona copy, or null. */
export const personaMundifiedOf = (file: string): PersonaMundified | null => { const m = personaData(file, false)?.mundified; return m?.from ? m as PersonaMundified : null; };
/** The mundified copies made from a persona (newest first). */
export const personaCopies = (file: string): string[] => personas().map(p => p.file).filter(f => personaMundifiedOf(f)?.from === file).sort((a, b) => personaMundifiedOf(b)!.at - personaMundifiedOf(a)!.at);

const text = (v: any) => String(v ?? '').trim();

function ask(name: string, src: string): string {
    return `Below is the description of ${name}, the player's own character in a roleplay (a SillyTavern persona). It will be used in a life simulation game. The game already decides the setting, the scene, the time, where people are and what happens next, so the description must only say who ${name} is.

Rewrite it into these five sections:
[APPEARANCE] What ${name} looks like: height, build, face, skin, hair, eyes, voice, scent, how they move and how others tend to see them (not their clothes).
[CLOTHING] ${CLOTHING(name)}
[BACKSTORY] ${name}'s past and life: where they come from, family, history, job, important events.
[PERSONALITY] Character traits, habits, likes and dislikes, fears, goals, how they speak and behave.
[DETAILS] Any other facts about ${name} that fit nowhere else (abilities, limits, possessions, quirks).

Rules:
- Keep every fact about ${name}. Do not invent anything, except the clothing where the description says little.
- If ${name} is under 18, describe their body only by height, build, skin, hair, eyes and the physical limits it gives them (such as back strain or avoiding running). Do not describe their breasts or chest size, nipples, genitals, buttocks or any other intimate part, and nothing sexual.
- Drop everything that is not about ${name}: the starting situation, the plot setup, instructions to the AI, roleplay or formatting rules, out-of-character notes.
- Write ${name} instead of {{user}}. Third person, plain prose, short and dense. No markdown headings, no lists of rules.
- If a section has nothing, write "None."
- Answer with the five sections only, each starting with its tag on its own line.

The description:
${src}`;
}

/** Makes the mundified copy of a persona and returns the copy's file. `ai`: the AI rewrites the description into its
 *  sections (without it the description is copied as it is). `lore`: also makes a mundified copy of the persona's
 *  lorebook (a copy that is already mundified is linked as it is). `step` tells what it is doing. */
export async function mundifyPersona(file: string, ai: boolean, lore: boolean, step: (what: string) => void = () => {}): Promise<{ file: string; lore: string }> {
    const p = personas().find(x => x.file === file);
    if (!p) throw new Error('This persona no longer exists.');
    if (personaMundifiedOf(file)) throw new Error(`${p.name} is a mundified copy already.`);
    let description = text(p.description);
    if (ai) {
        if (!description) throw new Error(`${p.name}'s description is empty.`);
        step(`Rewriting ${p.name}`);
        // the AI first: if it fails, no copy is left behind
        const parts = parse(await quiet(ask(p.name, description.replace(/\{\{user\}\}/gi, p.name)), 2500));
        if (!parts) throw new Error(`The AI did not answer in the expected form for ${p.name}. Try again, or mundify without the AI.`);
        description = [['Appearance', parts.APPEARANCE], [STYLE_HEAD, parts.CLOTHING], ['Backstory', parts.BACKSTORY], ['Personality', parts.PERSONALITY], ['Details', parts.DETAILS]]
            .filter(([, v]) => v).map(([k, v]) => `${k}:\n${v}`).join('\n\n');
    }
    // the lorebook: its own mundified copy (made once; a persona whose lorebook is already a copy keeps it)
    let book = personaLore(file);
    if (lore && book && !loreMundifiedOf(book)) {
        book = (await mundifyLore(book, ai, (i, n) => step(n > 1 ? `Mundifying the lorebook: part ${i + 1} of ${n}` : 'Mundifying the lorebook'), true)).name;
    }
    step('Saving the copy');
    const blob = await (await fetch(personaImage(file))).blob();
    const copy = await createPersona(p.name, description, blob);
    const from = personaData(file, false) ?? {};
    const d = personaData(copy)!;
    for (const k of ['position', 'depth', 'role'] as const) if (from[k] !== undefined) d[k] = from[k];
    d.description = description;
    d.title = 'Mundified';
    d.mundified = { from: file, name: p.name, at: Date.now(), ai, ...(book ? { lore: book } : {}) } satisfies PersonaMundified;
    const sheet = personaSheet(file); if (sheet) setPersonaSheet(copy, JSON.parse(JSON.stringify(sheet)));
    if (book) setPersonaLore(copy, book);
    savePersonaData();
    return { file: copy, lore: book };
}
