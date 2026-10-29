// World creator, "From lorebooks": pick lorebooks → your AI reads them a part at a time → you choose what to keep →
// Mundi builds the world and opens it in the World creator. The reading is saved as it goes (Mundi's settings), so
// closing SillyTavern halfway picks up at the next part. The data side lives in sim/fromlore.ts.
import { notify, esc, toast, busy, settings, saveSettings } from '../core/store.js';
import { type GameMode } from '../core/world.js';
import { lorebooks, loadLore, quiet } from '../st/bridge.js';
import { newWorldFrom, saveWorld } from '../sim/creator.js';
import { readBook, chunk, sketchPrompt, summaryPrompt, parseJson, mergeSketch, emptySketch, buildWorld, BUCKETS, type LoreItem, type Sketch, type Bucket, type Chunk } from '../sim/fromlore.js';
import { CW } from './creator.js';
import { openPaint } from './worldpaint.js';
import { styleName } from './styles.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

type Step = 'books' | 'reading' | 'review';
type ReviewTab = 'areas' | 'places' | 'people' | 'groups' | 'jobs';
// A run of the reading, as saved between sessions.
interface Draft { name: string; style: string; base: string; game: GameMode; books: string[]; skip: Bucket[]; done: number; failed: number[]; sketch: Sketch }
export const FL = {
    on: false, step: 'books' as Step, tab: 'places' as ReviewTab, bq: '', busy: false, stop: false,
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
    FL.run = { name: s.name.trim(), style: s.style, base: s.base, game: s.game, books: [], skip: ['rules'], done: 0, failed: [], sketch: emptySketch() };
    notify();
}

/* ---------- the parts to read ---------- */

async function itemsOf(book: string) {
    if (!FL.items.has(book)) FL.items.set(book, readBook(book, await loadLore(book)));
    return FL.items.get(book)!;
}
const chosen = () => R().books.flatMap(b => FL.items.get(b) ?? []).filter(i => !R().skip.includes(i.bucket));
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
        <div class="mu-chips mu-situation-books">${books.slice(0, 80).map(b => `<button class="mu-chip ${r.books.includes(b) ? 'is-on' : ''}" data-act="fl-book" data-name="${esc(b)}" data-notr>${esc(b)}</button>`).join('') || '<span class="mu-muted">No lorebooks.</span>'}</div>
        ${r.books.length ? `<h3>What to read</h3>
        <p class="mu-muted">Sorted by each entry's title and keys. Untick what does not describe the world itself. Everything stays switched on as a lorebook of the world either way.</p>
        <div class="mu-fl-buckets">${BUCKETS.map(b => `<label class="mu-check"><input type="checkbox" data-act="fl-bucket" data-id="${b.id}" ${r.skip.includes(b.id) ? '' : 'checked'}><span>${b.name} (${count(b.id)})<small>${b.desc}</small></span></label>`).join('')}</div>
        <p class="${parts > MAX_CALLS ? 'mu-warn' : 'mu-muted'}">${chosen().length} entries in ${parts} part${parts === 1 ? '' : 's'}: ${parts} AI call${parts === 1 ? '' : 's'}, plus one to sum up.${parts > MAX_CALLS ? ` That is a lot (over ${MAX_CALLS}): untick some kinds or lorebooks, or it will take a long time and many tokens.` : ''}</p>` : ''}
        <div class="mu-row mu-cw-new-go"><span class="mu-muted">${r.books.length} lorebook${r.books.length === 1 ? '' : 's'} chosen</span>
            <button class="mu-primary mu-big" data-act="fl-read" ${parts ? '' : 'aria-disabled="true"'}>${icon('sparkles')}<span>Read the lorebooks</span></button></div>`;
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
    const r = R(), sk = r.sketch, list: any[] = sk[FL.tab];
    const kept = list.filter(x => x.keep !== false).length;
    const detail = (x: any): string => FL.tab === 'areas' ? [x.kind, x.in ? `in ${x.in}` : 'the top map', x.desc].filter(Boolean).join(' · ')
        : FL.tab === 'places' ? [x.kind, x.area, x.desc].filter(Boolean).join(' · ')
        : FL.tab === 'people' ? [x.age, x.gender, x.job || x.role, x.work ? `at ${x.work}` : '', x.aka?.length ? `also: ${x.aka.join(', ')}` : ''].filter(Boolean).join(' · ')
        : FL.tab === 'groups' ? [x.kind, x.hq ? `HQ: ${x.hq}` : '', x.ranks?.length ? `ranks: ${x.ranks.join(' → ')}` : '', x.secret ? 'secret' : ''].filter(Boolean).join(' · ')
        : [x.place ? `at ${x.place}` : '', x.ranks?.length ? x.ranks.join(' → ') : ''].filter(Boolean).join(' · ');
    return `<p class="mu-muted">Untick what should not be in the world, and fix names if you like. Maps are the areas: a city, its districts, a building with floors. Places sit on them.${r.failed.length ? ` ${r.failed.length} part${r.failed.length === 1 ? '' : 's'} could not be read: <button class="mu-ghost" data-act="fl-retry">Try them again</button>` : ''}</p>
        <nav class="mu-tabs mu-fl-tabs">${TABS.map(([id, l]) => `<button class="${FL.tab === id ? 'is-on' : ''}" data-act="fl-tab" data-tab="${id}">${l} (${sk[id].filter((x: any) => x.keep !== false).length})</button>`).join('')}</nav>
        ${kept > CAPS[FL.tab] ? `<p class="mu-warn">Only the first ${CAPS[FL.tab]} are used. Untick the ones that matter least.</p>` : ''}
        <div class="mu-fl-list">${list.map((x, i) => `<div class="mu-fl-row ${x.keep === false ? 'is-off' : ''}"><input type="checkbox" data-act="fl-keep" data-i="${i}" ${x.keep === false ? '' : 'checked'} title="Keep">
            <input class="mu-fl-name" data-input="fl-name" data-i="${i}" data-focus="fl-${FL.tab}-${i}" value="${esc(x.name)}" data-notr><small class="mu-muted" data-notr>${esc(detail(x))}</small></div>`).join('') || '<p class="mu-muted">Nothing found.</p>'}</div>
        <div class="mu-row mu-cw-new-go"><button data-act="fl-books">← Lorebooks</button><span class="mu-grow"></span>
            <button class="mu-primary mu-big" data-act="fl-build" ${sk.places.length + sk.areas.length ? '' : 'aria-disabled="true"'}>${icon('map')}<span>Build the world</span></button></div>`;
}

/* ---------- reading ---------- */

async function readParts(which: number[]) {
    const r = R();
    FL.busy = true; FL.stop = false; FL.step = 'reading'; notify();
    for (const i of which) {
        if (FL.stop) break;
        const prompt = sketchPrompt(FL.chunks[i].text, r.sketch, styleName(r.style));
        try {
            let raw = await quiet(prompt, 3000);
            let data: any;
            try { data = parseJson(raw); }
            catch (e: any) { raw = await quiet(`${prompt}\n\nYour last answer could not be read (${String(e?.message ?? e)}). Reply with the JSON object only.`, 3000); data = parseJson(raw); }
            mergeSketch(r.sketch, data);
            r.failed = r.failed.filter(x => x !== i);
        } catch (e) {
            console.warn('[Mundi] from lorebooks, part', i, e);
            if (!r.failed.includes(i)) r.failed.push(i);
        }
        r.done = Math.max(r.done, i + 1);
        save(); notify();
    }
    FL.busy = false;
    if (!FL.stop) FL.step = 'review';
    notify();
}
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);

/* ---------- building ---------- */

async function build() {
    const r = R();
    try {
        const w = await busy('Building the world', async () => {
            const base = await newWorldFrom(r.base, 'empty', r.name);
            let sum = {};
            const hints = (FL.chunks[0]?.text ?? '').slice(0, 3000);
            try { sum = parseJson(await quiet(summaryPrompt(r.name, r.sketch, hints), 800)); } catch (e) { console.warn('[Mundi] from lorebooks, summary', e); }
            const sk = structuredClone(r.sketch);
            for (const k of Object.keys(CAPS) as ReviewTab[]) { let n = 0; for (const x of sk[k] as any[]) if (x.keep !== false && ++n > CAPS[k]) x.keep = false; }
            const out = buildWorld(base, sk, sum, r.books);
            out.mode = r.game;
            await saveWorld(out);
            return out;
        });
        FL.on = false; FL.run = null; save();
        CW.w = w; CW.start = null; CW.tab = 'maps'; CW.dirty = false; CW.confirmDel = false;
        toast(`“${w.name}” built: ${w.maps.length} maps, ${w.places.filter(p => !p.link).length} places, ${w.cast.examples.length} people. Paint its maps and places with ComfyUI, or move the pins in Maps & places.`, 'success');
        void openPaint();
    } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
    notify();
}

// A new name for something: whatever pointed at the old name follows it.
function rename(sk: Sketch, tab: ReviewTab, from: string, to: string) {
    const fix = (o: any, k: string) => { if (o?.[k] === from) o[k] = to; };
    const fixAll = (l?: string[]) => l?.forEach((x, i) => { if (x === from) l[i] = to; });
    if (tab === 'areas') { sk.areas.forEach(a => fix(a, 'in')); sk.places.forEach(p => fix(p, 'area')); sk.people.forEach(p => { fix(p, 'lives'); fix(p, 'work'); }); }
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
        r.done = 0; r.failed = []; r.sketch = emptySketch();
        void readParts(range(0, FL.chunks.length));
    },
    'fl-stop': () => { FL.stop = true; notify(); },
    'fl-continue': () => { if (!FL.busy) void readParts(range(R().done, FL.chunks.length)); },
    'fl-retry': () => { if (!FL.busy) void readParts([...R().failed]); },
    'fl-review': () => { FL.step = 'review'; notify(); },
    'fl-books': () => { FL.step = 'books'; notify(); },
    'fl-resume': async () => {
        const old = draft(); if (!old) return;
        FL.run = structuredClone(old);
        try { for (const b of old.books) await itemsOf(b); } catch { toast('A lorebook of that reading is gone.', 'error'); return; }
        FL.chunks = plan();
        FL.step = old.done >= FL.chunks.length ? 'review' : 'reading'; notify();
    },
    'fl-forget': () => { (settings() as any).fromLore = undefined; saveSettings(); notify(); },
    'fl-tab': (el) => { FL.tab = el.dataset.tab as ReviewTab; notify(); },
    'fl-keep': (el) => { const x: any = R().sketch[FL.tab][Number(el.dataset.i)]; if (x) { x.keep = x.keep === false; save(); notify(); } },
    'fl-build': () => { if (!FL.busy) void build(); },
});
Object.assign(INPUT, {
    'fl-bq': (el) => { FL.bq = el.value; notify(); },
    'fl-name': (el) => { const x: any = R().sketch[FL.tab][Number(el.dataset.i)]; const v = el.value.trim(); if (x && v && v !== x.name) { rename(R().sketch, FL.tab, x.name, v); x.name = v; save(); } },
});
