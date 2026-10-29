// World creator, "From lorebooks": pick lorebooks → your AI reads them a part at a time → you choose what to keep →
// Mundi builds the world and opens it in the World creator. The reading is saved as it goes (Mundi's settings), so
// closing SillyTavern halfway picks up at the next part. The data side lives in sim/fromlore.ts.
import { notify, esc, toast, busy, settings, saveSettings, state } from '../core/store.js';
import { type GameMode } from '../core/world.js';
import { lorebooks, loadLore, quiet } from '../st/bridge.js';
import { newWorldFrom, saveWorld } from '../sim/creator.js';
import { readBook, chunk, sketchPrompt, summaryPrompt, parseJson, mergeSketch, emptySketch, buildWorld, BUCKETS, type LoreItem, type Sketch, type Bucket, type Chunk } from '../sim/fromlore.js';
import { DETAILS, TAB_GROUP, detailLore, detailPrompt, applyDetail, type DetailGroup } from '../sim/lorebits.js';
import { systemFromLore } from '../sim/rpgfromlore.js';
import { mundifyLore, loreMundifiedOf, loreCopies } from '../sim/mundifylore.js';
import { needs, basicsPrompt, readBasics, guessBasics, fnName } from '../sim/basics.js';
import type { WorldDef } from '../core/world.js';
import { CW } from './creator.js';
import { openPaint } from './worldpaint.js';
import { styleName } from './styles.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

type Step = 'books' | 'reading' | 'review';
type ReviewTab = 'areas' | 'places' | 'people' | 'groups' | 'jobs';
type FlTab = ReviewTab | 'details' | 'basics';
// A run of the reading, as saved between sessions.
// `details`: the groups of tabs to fill from the lorebooks once the map is built (unticked ones keep the style's);
// `got`: the AI's answers so far, so a build stopped halfway does not ask again.
// `mfyAi`: whether "Mundify them first" uses the AI (on unless unticked).
interface Draft { name: string; style: string; base: string; game: GameMode; books: string[]; skip: Bucket[]; done: number; failed: number[]; sketch: Sketch; details?: DetailGroup[]; got?: Record<string, any>; mfyAi?: boolean }
export const FL = {
    on: false, step: 'books' as Step, tab: 'places' as FlTab, bq: '', busy: false, stop: false,
    /** the AI is naming the basics */
    basics: false,
    /** the detail group being redone in the World creator (one at a time) */
    redo: '' as DetailGroup | '',
    run: null as Draft | null,
    chunks: [] as Chunk[],
    // the chosen books' entries, read once per book
    items: new Map<string, LoreItem[]>(),
};
const MAX_CALLS = 40;
const CAPS: Record<ReviewTab, number> = { areas: 20, places: 60, people: 40, groups: 20, jobs: 30 };
const draft = (): Draft | null => (settings() as any).fromLore ?? null;
const save = () => { (settings() as any).fromLore = FL.run ? structuredClone(FL.run) : undefined; saveSettings(); };
const R = () => FL.run!;

export function openFromLore(s: { name: string; style: string; base: string; game: GameMode }) {
    FL.on = true; FL.step = 'books'; FL.tab = 'places'; FL.bq = ''; FL.stop = false;
    FL.run = { name: s.name.trim(), style: s.style, base: s.base, game: s.game, books: [], skip: ['rules'], done: 0, failed: [], sketch: emptySketch(), details: groupsFor(s.game), got: {} };
    notify();
}

/* ---------- the parts to read ---------- */

async function itemsOf(book: string) {
    if (!FL.items.has(book)) FL.items.set(book, readBook(book, await loadLore(book)));
    return FL.items.get(book)!;
}
const chosen = () => R().books.flatMap(b => FL.items.get(b) ?? []).filter(i => !R().skip.includes(i.bucket));
// The world details read every entry of the books (rules and history too: that is where the economy and the realm are).
const allItems = () => R().books.flatMap(b => FL.items.get(b) ?? []);
// The RPG is only made for a world played as an RPG (a Life-Sim never shows it).
const groupsFor = (game: GameMode): DetailGroup[] => DETAILS.map(d => d.id).filter(id => id !== 'rpg' || game !== 'lifesim');
const plan = () => chunk(chosen());

/* ---------- screens ---------- */

export function fromLoreHtml(): string {
    const r = R();
    const body = FL.step === 'books' ? booksHtml() : FL.step === 'reading' ? readingHtml() : reviewHtml();
    return `<div class="mu-settings mu-cw-new mu-fromlore">
        <div class="mu-subhead"><button data-act="fl-back" data-sfx="back">← Back</button><h2>From lorebooks</h2><small data-notr>${esc(r.name)} · ${esc(styleName(r.style))}</small></div>
        <div class="mu-cw-new-body mu-panel">${body}</div></div>`;
}

function booksHtml(): string {
    const r = R();
    const q = FL.bq.toLowerCase();
    const books = lorebooks().filter(b => !q || b.toLowerCase().includes(q)).sort((a, b) => Number(r.books.includes(b)) - Number(r.books.includes(a)) || a.localeCompare(b));
    const items = r.books.flatMap(b => FL.items.get(b) ?? []);
    const count = (k: Bucket) => items.filter(i => i.bucket === k).length;
    const parts = plan().length;
    const old = draft();
    const resume = old && old.done > 0 ? `<section class="mu-panel mu-fl-resume"><p>A reading was left halfway: <b data-notr>${esc(old.name)}</b>, ${old.done} of ${chunk(old.books.flatMap(b => FL.items.get(b) ?? []).filter(i => !old.skip.includes(i.bucket))).length || '?'} parts read from ${old.books.map(esc).join(', ')}.</p>
        <div class="mu-row"><button class="mu-primary" data-act="fl-resume">${icon('forward')}<span>Continue it</span></button><button class="mu-ghost" data-act="fl-forget">${icon('x')}<span>Forget it</span></button></div></section>` : '';
    return `${resume}
        <p class="mu-muted">Your AI reads the lorebooks you choose, a part at a time, and finds the places, people, groups and jobs in them. You choose what to keep, then Mundi builds the world. You can change everything afterwards in the World creator.</p>
        <h3>Lorebooks</h3>
        <input class="mu-search" type="search" data-input="fl-bq" data-focus="flbq" placeholder="Search lorebooks" value="${esc(FL.bq)}">
        <div class="mu-chips mu-situation-books">${books.slice(0, 80).map(b => `<button class="mu-chip ${r.books.includes(b) ? 'is-on' : ''}" data-act="fl-book" data-name="${esc(b)}" data-notr ${loreMundifiedOf(b) ? 'title="Mundified copy"' : ''}>${loreMundifiedOf(b) ? icon('sparkles') : ''}${esc(b)}</button>`).join('') || '<span class="mu-muted">No lorebooks.</span>'}</div>
        ${mfyHtml()}
        ${r.books.length ? `<h3>What to read</h3>
        <p class="mu-muted">Sorted by each entry's title and keys. Untick what does not describe the world itself. Everything stays switched on as a lorebook of the world either way.</p>
        <div class="mu-fl-buckets">${BUCKETS.map(b => `<label class="mu-check"><input type="checkbox" data-act="fl-bucket" data-id="${b.id}" ${r.skip.includes(b.id) ? '' : 'checked'}><span>${b.name} (${count(b.id)})<small>${b.desc}</small></span></label>`).join('')}</div>
        <p class="${parts > MAX_CALLS ? 'mu-warn' : 'mu-muted'}">${chosen().length} entries in ${parts} part${parts === 1 ? '' : 's'}: ${parts} AI call${parts === 1 ? '' : 's'}, plus one to sum up.${parts > MAX_CALLS ? ` That is a lot (over ${MAX_CALLS}): untick some kinds or lorebooks, or it will take a long time and many tokens.` : ''}</p>` : ''}
        <div class="mu-row mu-cw-new-go"><span class="mu-muted">${r.books.length} lorebook${r.books.length === 1 ? '' : 's'} chosen</span>
            <button class="mu-primary mu-big" data-act="fl-read" ${parts ? '' : 'aria-disabled="true"'}>${icon('sparkles')}<span>Read the lorebooks</span></button></div>`;
}

// Lorebooks made for chats tell the AI how to reply, set an opening scene, say who {{user}} is: a mundified copy keeps
// only the facts about the world, so the reading is cleaner and the world links the copy (sim/mundifylore.ts).
function mfyHtml(): string {
    const r = R();
    if (!r.books.length) return '';
    const plain = r.books.filter(b => !loreMundifiedOf(b));
    if (!plain.length) return `<p class="mu-muted">${icon('sparkles')} Reading mundified copies: their instructions, opening scene and {{user}}'s role are left out, and the world uses these copies while you play.</p>`;
    const made = plain.filter(b => loreCopies(b).length);
    return `<section class="mu-panel mu-fl-mfy"><p>${plain.length === r.books.length ? (plain.length === 1 ? 'This lorebook is' : 'These lorebooks are') : `${plain.length} of these lorebooks are`} not mundified. Lorebooks made for chats often tell the AI how to reply, set an opening scene or say who {{user}} is, which fight a Mundi world. Mundify makes a copy with only the facts about the world, and the world uses the copy; the original stays as it is.${made.length ? ` <span data-notr>${made.map(esc).join(', ')}</span> ${made.length === 1 ? 'has a copy' : 'have copies'} already: ${made.length === 1 ? 'it is' : 'they are'} used.` : ''}</p>
        <div class="mu-row"><button class="mu-primary" data-act="fl-mfy">${icon('sparkles')}<span>Mundify ${plain.length === 1 ? 'it' : 'them'} first</span></button>
            <label class="mu-check"><input type="checkbox" data-act="fl-mfy-ai" ${r.mfyAi === false ? '' : 'checked'}><span>With the AI<small>It reads every entry (one call for a few entries) and rewrites the mixed ones. Without it, only entries that plainly are instructions are switched off.</small></span></label></div></section>`;
}
async function mundifyChosen() {
    const r = R(), ai = r.mfyAi !== false;
    const notes: string[] = [], failed: string[] = [];
    for (const b of r.books.filter(x => !loreMundifiedOf(x))) {
        try {
            let copy = loreCopies(b)[0];
            if (!copy) {
                const out = await busy(`Mundifying ${b}`, () => mundifyLore(b, ai, (i, n) => { if (n > 1) { state.busy = `Mundifying ${b}: part ${i + 1} of ${n}`; notify(); } }));
                copy = out.name; notes.push(`${b}: ${out.off} off${out.rewritten ? `, ${out.rewritten} rewritten` : ''}`);
            }
            await itemsOf(copy);
            r.books = r.books.map(x => (x === b ? copy! : x));
        } catch (e: any) { failed.push(`${b}: ${String(e?.message ?? e)}`); }
    }
    save();
    if (failed.length) toast(failed.join('\n'), 'error');
    else toast(`Using the mundified copies${notes.length ? ` (${notes.join('; ')})` : ''}. The originals are unchanged.`, 'success');
    notify();
}

function readingHtml(): string {
    const r = R(), n = FL.chunks.length, sk = r.sketch;
    const pct = n ? Math.round((r.done / n) * 100) : 0;
    return `<h3>${FL.busy ? `Reading part ${Math.min(r.done + 1, n)} of ${n}…` : `Stopped after ${r.done} of ${n} parts`}</h3>
        <div class="mu-bar"><i style="width:${pct}%"></i></div>
        <p class="mu-muted">Found so far: ${sk.areas.length} areas, ${sk.places.length} places, ${sk.people.length} people, ${sk.groups.length} groups, ${sk.jobs.length} jobs.${r.failed.length ? ` ${r.failed.length} part${r.failed.length === 1 ? '' : 's'} could not be read.` : ''}</p>
        <p class="mu-muted">It is saved as it goes: if you close SillyTavern, it continues from here next time.</p>
        <div class="mu-row mu-cw-new-go">${FL.busy ? `<button data-act="fl-stop">${icon('x')}<span>Stop</span></button>`
            : `<button data-act="fl-continue">${icon('forward')}<span>Continue reading</span></button><button class="mu-primary mu-big" data-act="fl-review">Choose what to keep ▶</button>`}</div>`;
}

const TABS: [ReviewTab, string][] = [['places', 'Places'], ['areas', 'Maps'], ['people', 'People'], ['groups', 'Groups'], ['jobs', 'Jobs']];
function reviewHtml(): string {
    const sk = R().sketch;
    if (FL.tab === 'details') return reviewShell(detailsHtml());
    if (FL.tab === 'basics') return reviewShell(basicsHtml());
    const list: any[] = sk[FL.tab];
    const kept = list.filter(x => x.keep !== false).length;
    const detail = (x: any): string => FL.tab === 'areas' ? [x.kind, x.in ? `in ${x.in}` : 'the top map', x.desc].filter(Boolean).join(' · ')
        : FL.tab === 'places' ? [x.kind, x.floor ? `${x.floor} of ${x.area}` : x.area, x.hidden ? 'hidden until found' : '', x.restricted ? `restricted: ${x.restricted}` : '', x.desc].filter(Boolean).join(' · ')
        : FL.tab === 'people' ? [x.age, x.gender, x.job || x.role, x.work ? `at ${x.work}` : '', x.aka?.length ? `also: ${x.aka.join(', ')}` : ''].filter(Boolean).join(' · ')
        : FL.tab === 'groups' ? [x.kind, x.hq ? `HQ: ${x.hq}` : '', x.ranks?.length ? `ranks: ${x.ranks.join(' → ')}` : '', x.secret ? 'secret' : ''].filter(Boolean).join(' · ')
        : [x.place ? `at ${x.place}` : '', x.ranks?.length ? x.ranks.join(' → ') : ''].filter(Boolean).join(' · ');
    return reviewShell(`${kept > CAPS[FL.tab] ? `<p class="mu-warn">Only the first ${CAPS[FL.tab]} are used. Untick the ones that matter least.</p>` : ''}
        <div class="mu-fl-list">${list.map((x, i) => `<div class="mu-fl-row ${x.keep === false ? 'is-off' : ''}"><input type="checkbox" data-act="fl-keep" data-i="${i}" ${x.keep === false ? '' : 'checked'} title="Keep">
            <input class="mu-fl-name" data-input="fl-name" data-i="${i}" data-focus="fl-${FL.tab}-${i}" value="${esc(x.name)}" data-notr><small class="mu-muted" data-notr>${esc(detail(x))}</small></div>`).join('') || '<p class="mu-muted">Nothing found.</p>'}</div>`);
}
function reviewShell(body: string): string {
    const r = R(), sk = r.sketch;
    const on = (r.details ?? []).length;
    return `<p class="mu-muted">Untick what should not be in the world, and fix names if you like. Maps are the areas: a city, its districts, a building with floors. Places sit on them.${r.failed.length ? ` ${r.failed.length} part${r.failed.length === 1 ? '' : 's'} could not be read: <button class="mu-ghost" data-act="fl-retry">Try them again</button>` : ''}</p>
        <nav class="mu-tabs mu-fl-tabs">${TABS.map(([id, l]) => `<button class="${FL.tab === id ? 'is-on' : ''}" data-act="fl-tab" data-tab="${id}">${l} (${sk[id].filter((x: any) => x.keep !== false).length})</button>`).join('')}<button class="${FL.tab === 'basics' ? 'is-on' : ''}" data-act="fl-tab" data-tab="basics">Basics (${FL.basics ? '…' : (sk.basics ?? []).filter(x => x.keep !== false).length})</button><button class="${FL.tab === 'details' ? 'is-on' : ''}" data-act="fl-tab" data-tab="details">Details (${on})</button></nav>
        ${body}
        <div class="mu-row mu-cw-new-go"><button data-act="fl-books">← Lorebooks</button><span class="mu-grow"></span>
            <button class="mu-primary mu-big" data-act="fl-build" ${sk.places.length + sk.areas.length && !FL.basics ? '' : 'aria-disabled="true"'}>${icon('map')}<span>Build the world</span></button></div>`;
}
// The everyday places the lorebooks did not mention, named for this world by the AI (sim/basics.ts).
function basicsHtml(): string {
    const sk = R().sketch, list = sk.basics ?? [];
    const intro = `<p class="mu-muted">Every town needs a few everyday places so life works there: somewhere to heal, buy food, eat and drink, sleep, find work, the law… These are the ones the lorebooks did not mention, named for this world by your AI (or none, where a place would not have one). Untick the ones you do not want; each comes with its job.</p>`;
    const again = `<button class="mu-ghost" data-act="fl-basics" ${FL.basics ? 'aria-disabled="true"' : ''}>${icon('sparkles')}<span>${FL.basics ? 'Asking your AI…' : sk.basics ? 'Ask again' : 'Ask your AI'}</span></button><small class="mu-muted">Ask again after changing which places and maps you keep.</small>`;
    if (FL.basics && !list.length) return `${intro}<p class="mu-muted">Your AI is naming them…</p>`;
    const rows = list.map((x, i) => `<div class="mu-fl-row ${x.keep === false ? 'is-off' : ''}"><input type="checkbox" data-act="fl-keep" data-i="${i}" ${x.keep === false ? '' : 'checked'} title="Keep">
        <input class="mu-fl-name" data-input="fl-name" data-i="${i}" data-focus="fl-basics-${i}" value="${esc(x.name)}" data-notr><small class="mu-muted" data-notr>${esc([fnName(x.fn), x.area ? `in ${x.area}` : 'the top map', x.job ? `job: ${x.job}` : '', x.desc, x.guess ? '(the usual one: your AI did not name it)' : ''].filter(Boolean).join(' · '))}</small></div>`).join('');
    return `${intro}<div class="mu-row mu-fl-redo">${again}</div>
        <div class="mu-fl-list">${rows || `<p class="mu-muted">${sk.basics ? 'Nothing missing: the lorebooks cover the basics.' : 'Not asked yet.'}</p>`}</div>`;
}
// Asks the AI for the basics the kept places do not cover (without an answer: the style's usual places).
async function askBasics() {
    const r = R();
    if (FL.basics) return;
    const list = needs(r.sketch);
    if (!list.length) { r.sketch.basics = []; save(); notify(); return; }
    FL.basics = true; notify();
    const items = allItems();
    const hints = (items.filter(i => i.bucket === 'rules' || i.bucket === 'other').map(i => `### ${i.title}\n${i.text}`).join('\n\n') || FL.chunks[0]?.text || '').slice(0, 3000);
    try { r.sketch.basics = readBasics(parseJson(await quiet(basicsPrompt(r.name, styleName(r.style), list, hints), 3000)), list, r.sketch, r.style); }
    catch (e) { console.warn('[Mundi] from lorebooks, basics', e); r.sketch.basics = guessBasics(list, r.sketch, r.style); toast('Your AI could not name the basics: the usual ones are listed in the Basics tab instead.', 'warn'); }
    FL.basics = false; save(); notify();
}
// The other World creator tabs: filled from the lorebooks after the map is built, one AI call per group.
function detailsHtml(): string {
    const r = R(), on = r.details ?? [];
    const rows = DETAILS.filter(d => d.id !== 'rpg' || r.game !== 'lifesim').map(d => `<label class="mu-check"><input type="checkbox" data-act="fl-detail" data-id="${d.id}" ${on.includes(d.id) ? 'checked' : ''}><span>${d.name}${r.got?.[d.id] ? ' ✓' : ''}<small>${d.tabs}</small></span></label>`).join('');
    return `<p class="mu-muted">Once the map is built, your AI reads the lorebooks again (rules and history too) for each group ticked here, and fills those World creator tabs with what it finds: one AI call each${on.includes('rpg') ? ', two for the RPG' : ''}. Untick a group to keep the style's usual entries there. Anything the lorebooks do not mention keeps the style's entries either way, and each tab has a "Redo from the lorebooks" button later.</p>
        <div class="mu-fl-buckets">${rows}</div>`;
}

/* ---------- reading ---------- */

async function readParts(which: number[]) {
    const r = R();
    FL.busy = true; FL.stop = false; FL.step = 'reading'; notify();
    for (const i of which) {
        if (FL.stop) break;
        try {
            const data = await readPart(FL.chunks[i].text);
            for (const d of data) mergeSketch(r.sketch, d);
            r.failed = r.failed.filter(x => x !== i);
        } catch (e) {
            console.warn('[Mundi] from lorebooks, part', i, e);
            if (!r.failed.includes(i)) r.failed.push(i);
        }
        r.done = Math.max(r.done, i + 1);
        save(); notify();
    }
    FL.busy = false;
    if (!FL.stop) { FL.step = 'review'; if (!r.sketch.basics) void askBasics(); }
    notify();
}
// One part: asked twice; if both answers cannot be read, or the answer was cut off (a part full of people can run out
// of room), its two halves are asked one at a time.
async function readPart(text: string, halves = true): Promise<any[]> {
    const ask = (t: string, extra = '') => quiet(`${sketchPrompt(t, R().sketch, styleName(R().style))}${extra}`, 3000).then(parseJson);
    const inHalves = async (first: any[], why: unknown) => {
        const cut = halfAt(text);
        if (!halves || !cut) { if (first.length) return first; throw why; }
        console.warn('[Mundi] from lorebooks: reading a part in two halves', why);
        const out = [...first];
        for (const t of cut) { try { out.push(...await readPart(t, false)); } catch (e3) { console.warn('[Mundi] from lorebooks, half a part', e3); } }
        if (!out.length) throw why;
        return out;
    };
    try { const d = await ask(text); return d.cutOff ? inHalves([d], 'the answer was cut off') : [d]; }
    catch (e: any) {
        try { return [await ask(text, `\n\nYour last answer could not be read (${String(e?.message ?? e)}). Reply with the JSON object only, and keep each line short.`)]; }
        catch (e2) { return inHalves([], e2); }
    }
}
// Splits a part at the entry heading nearest its middle (none: no split).
function halfAt(text: string): [string, string] | null {
    const heads = [...text.matchAll(/\n\n### /g)].map(m => m.index!);
    if (!heads.length) return null;
    const mid = heads.reduce((a, b) => (Math.abs(b - text.length / 2) < Math.abs(a - text.length / 2) ? b : a));
    return [text.slice(0, mid), text.slice(mid + 2)];
}
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);

/* ---------- building ---------- */

async function build() {
    const r = R();
    try {
        const { w, notes, failed } = await busy('Building the world', async () => {
            const base = await newWorldFrom(r.base, 'empty', r.name);
            let sum = {};
            const hints = (FL.chunks[0]?.text ?? '').slice(0, 3000);
            try { sum = parseJson(await quiet(summaryPrompt(r.name, r.sketch, hints), 800)); } catch (e) { console.warn('[Mundi] from lorebooks, summary', e); }
            if (!r.sketch.basics) { state.busy = 'Naming the basics'; notify(); await askBasics(); state.busy = 'Building the world'; notify(); }
            const sk = structuredClone(r.sketch);
            for (const k of Object.keys(CAPS) as ReviewTab[]) { let n = 0; for (const x of sk[k] as any[]) if (x.keep !== false && ++n > CAPS[k]) x.keep = false; }
            const out = buildWorld(base, sk, sum, r.books);
            out.mode = r.game;
            // the other tabs, one group at a time (each answer is kept, so a stop here does not ask again)
            const groups = DETAILS.map(d => d.id).filter(id => (r.details ?? []).includes(id) && (id !== 'rpg' || r.game !== 'lifesim'));
            const notes: string[] = [], failed: string[] = [];
            for (const [i, g] of groups.entries()) {
                const name = DETAILS.find(d => d.id === g)!.name;
                state.busy = `Filling the world from the lorebooks: ${name} (${i + 1} of ${groups.length})`; notify();
                try {
                    r.got ??= {};
                    r.got[g] ??= await askDetail(out, g, allItems(), r.books);
                    save();
                    const line = putDetail(out, g, r.got[g]);
                    if (line) notes.push(`${name}: ${line}`);
                } catch (e) { console.warn('[Mundi] from lorebooks, details', g, e); failed.push(name); }
            }
            await saveWorld(out);
            return { w: out, notes, failed };
        });
        FL.on = false; FL.run = null; save();
        CW.w = w; CW.start = null; CW.tab = 'maps'; CW.dirty = false; CW.confirmDel = false;
        toast(`“${w.name}” built: ${w.maps.length} maps, ${w.places.filter(p => !p.link).length} places, ${w.cast.examples.length} people.${notes.length ? ` From the lorebooks too: ${notes.join('; ')}.` : ''}${failed.length ? ` Could not read (the style's entries stay, try "Redo from the lorebooks" in their tabs): ${failed.join(', ')}.` : ''} Paint its maps and places with ComfyUI, or move the pins in Maps & places.`, failed.length ? 'warn' : 'success');
        void openPaint();
    } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
    notify();
}

/* ---------- the other tabs: the world details ---------- */

/** Asks the AI for one group of tabs of the world `w` (built already, so the AI uses its names). */
async function askDetail(w: WorldDef, g: DetailGroup, items: LoreItem[], books: string[]): Promise<any> {
    if (g === 'rpg') return (await systemFromLore(books, `for the world "${w.name}"`)).def;
    const prompt = detailPrompt(g, w, detailLore(items, g));
    try { return parseJson(await quiet(prompt, 3500)); }
    catch (e: any) { return parseJson(await quiet(`${prompt}\n\nYour last answer could not be read (${String(e?.message ?? e)}). Reply with the JSON object only.`, 3500)); }
}
function putDetail(w: WorldDef, g: DetailGroup, got: any): string {
    if (g !== 'rpg') return applyDetail(w, g, got);
    if (!got?.classes?.length) return '';
    w.rpg = structuredClone(got);
    if (!(w.tags ?? []).includes('rpg')) w.tags = [...(w.tags ?? ['lifesim']), 'rpg'];
    return `${got.classes.length} classes, ${got.spells?.length ?? 0} powers, ${got.bestiary?.length ?? 0} foes`;
}

/** "Redo from the lorebooks" at the top of a World creator tab (a world with lorebooks; the group that fills the tab). */
export function redoHtml(w: WorldDef, tab: string): string {
    const g = TAB_GROUP[tab];
    if (!g || !w.lorebooks?.length) return '';
    const d = DETAILS.find(x => x.id === g)!;
    const on = FL.redo === g;
    return `<div class="mu-row mu-fl-redo"><button class="mu-ghost" data-act="fl-redo" data-id="${g}" ${FL.redo ? 'aria-disabled="true"' : ''}>${icon('sparkles')}<span>${on ? 'Reading the lorebooks…' : 'Redo from the lorebooks'}</span></button>
        <small class="mu-muted">Your AI reads ${w.lorebooks.map(b => `<span data-notr>${esc(b)}</span>`).join(', ')} again and fills ${esc(d.tabs)}. What the lorebooks do not mention stays as it is.</small></div>`;
}
async function redo(g: DetailGroup) {
    const w = CW.w; if (!w || FL.redo) return;
    FL.redo = g; notify();
    try {
        const books = (w.lorebooks ?? []).filter(b => lorebooks().includes(b));
        if (!books.length) throw new Error('None of this world\'s lorebooks is in SillyTavern any more.');
        const items: LoreItem[] = [];
        for (const b of books) items.push(...await itemsOf(b));
        const line = putDetail(w, g, await askDetail(w, g, items, books));
        CW.dirty = true;
        toast(line ? `From the lorebooks: ${line}. Save the world to keep it.` : 'The lorebooks did not say anything new for these tabs.', line ? 'success' : 'info');
    } catch (e: any) { console.warn('[Mundi] redo from lorebooks', g, e); toast(`Could not read that from the lorebooks: ${String(e?.message ?? e)}`, 'error'); }
    FL.redo = ''; notify();
}

// A new name for something: whatever pointed at the old name follows it.
function rename(sk: Sketch, tab: ReviewTab, from: string, to: string) {
    const fix = (o: any, k: string) => { if (o?.[k] === from) o[k] = to; };
    const fixAll = (l?: string[]) => l?.forEach((x, i) => { if (x === from) l[i] = to; });
    if (tab === 'areas') { sk.areas.forEach(a => fix(a, 'in')); sk.places.forEach(p => fix(p, 'area')); sk.people.forEach(p => { fix(p, 'lives'); fix(p, 'work'); }); sk.basics?.forEach(b => fix(b, 'area')); }
    if (tab === 'places') { sk.people.forEach(p => { fix(p, 'work'); fix(p, 'lives'); }); sk.jobs.forEach(j => fix(j, 'place')); sk.groups.forEach(g => fix(g, 'hq')); }
    if (tab === 'people') sk.people.forEach(p => p.ties?.forEach(t => fix(t, 'to')));
    if (tab === 'groups') sk.groups.forEach(g => { fixAll(g.allies); fixAll(g.rivals); });
    if (tab === 'jobs') sk.people.forEach(p => fix(p, 'job'));
}

/* ---------- actions ---------- */

Object.assign(ACT, {
    'fl-back': () => { if (FL.busy) { FL.stop = true; return; } if (FL.step === 'review') { FL.step = 'books'; notify(); return; } FL.on = false; notify(); },
    'fl-book': async (el) => {
        const r = R(), n = el.dataset.name!;
        if (r.books.includes(n)) r.books = r.books.filter(b => b !== n);
        else { r.books.push(n); try { await itemsOf(n); } catch (e: any) { toast(`Could not read “${n}”.`, 'error'); r.books = r.books.filter(b => b !== n); } }
        notify();
    },
    'fl-bucket': (el) => { const r = R(), id = el.dataset.id as Bucket; r.skip = r.skip.includes(id) ? r.skip.filter(x => x !== id) : [...r.skip, id]; notify(); },
    'fl-read': () => {
        const r = R(); FL.chunks = plan(); if (!FL.chunks.length || FL.busy) return;
        r.done = 0; r.failed = []; r.sketch = emptySketch(); r.got = {};
        void readParts(range(0, FL.chunks.length));
    },
    'fl-stop': () => { FL.stop = true; notify(); },
    'fl-continue': () => { if (!FL.busy) void readParts(range(R().done, FL.chunks.length)); },
    'fl-retry': () => { if (!FL.busy) void readParts([...R().failed]); },
    'fl-review': () => { FL.step = 'review'; if (!R().sketch.basics) void askBasics(); notify(); },
    'fl-mfy': () => { if (!FL.busy) void mundifyChosen(); },
    'fl-mfy-ai': () => { const r = R(); r.mfyAi = r.mfyAi === false; save(); notify(); },
    'fl-basics': () => { void askBasics(); },
    'fl-books': () => { FL.step = 'books'; notify(); },
    'fl-resume': async () => {
        const old = draft(); if (!old) return;
        FL.run = structuredClone(old);
        FL.run.details ??= groupsFor(old.game);   // a reading saved before the world details
        try { for (const b of old.books) await itemsOf(b); } catch { toast('A lorebook of that reading is gone.', 'error'); return; }
        FL.chunks = plan();
        FL.step = old.done >= FL.chunks.length ? 'review' : 'reading';
        if (FL.step === 'review' && !FL.run.sketch.basics) void askBasics();
        notify();
    },
    'fl-forget': () => { (settings() as any).fromLore = undefined; saveSettings(); notify(); },
    'fl-tab': (el) => { FL.tab = el.dataset.tab as FlTab; notify(); },
    'fl-keep': (el) => { if (FL.tab === 'details') return; const x: any = (FL.tab === 'basics' ? R().sketch.basics ?? [] : R().sketch[FL.tab])[Number(el.dataset.i)]; if (x) { x.keep = x.keep === false; save(); notify(); } },
    'fl-build': () => { if (!FL.busy) void build(); },
    'fl-detail': (el) => { const r = R(), id = el.dataset.id as DetailGroup, on = r.details ?? []; r.details = on.includes(id) ? on.filter(x => x !== id) : [...on, id]; save(); notify(); },
    'fl-redo': (el) => { void redo(el.dataset.id as DetailGroup); },
});
Object.assign(INPUT, {
    'fl-bq': (el) => { FL.bq = el.value; notify(); },
    'fl-name': (el) => {
        if (FL.tab === 'details') return;
        const v = el.value.trim();
        if (FL.tab === 'basics') { const b = R().sketch.basics?.[Number(el.dataset.i)]; if (b && v) { b.name = v; save(); } return; }
        const x: any = R().sketch[FL.tab][Number(el.dataset.i)]; if (x && v && v !== x.name) { rename(R().sketch, FL.tab, x.name, v); x.name = v; save(); }
    },
});
