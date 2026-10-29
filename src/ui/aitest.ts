// Settings → AI tests: runs the steps that need your AI (a world from lorebooks, its tabs, floors and hidden places,
// the RPG system) against the model you have selected in SillyTavern, on a lorebook you pick, and checks what comes
// back. Nothing is saved as a world: the test world lives in memory only. Every answer is kept with the report, so
// "Check again with these answers" re-runs all the checks (after a fix in Mundi) without asking the AI again.
import { notify, esc, toast } from '../core/store.js';
import type { WorldDef } from '../core/world.js';
import type { Save } from '../core/store.js';
import { lorebooks, loadLore, quiet, QUIET_TAP } from '../st/bridge.js';
import { newWorldFrom } from '../sim/creator.js';
import { readBook, chunk, summaryPrompt, parseJson, mergeSketch, emptySketch, buildWorld, type LoreItem, type Sketch } from '../sim/fromlore.js';
import { DETAILS, detailLore, type DetailGroup } from '../sim/lorebits.js';
import { systemFromLore } from '../sim/rpgfromlore.js';
import { judgePrompt, parseJudge } from '../sim/discovery.js';
import { readPart, askDetail, putDetail } from './fromlore.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

type Mode = 'quick' | 'full';
type Status = 'pass' | 'warn' | 'fail' | 'skip';
interface Check { area: string; name: string; status: Status; detail: string }
interface Call { prompt: string; answer: string; ms: number; error?: string }
interface Run { at: number; books: string[]; mode: Mode; calls: Call[]; checks: Check[]; stopped?: boolean; replayed?: boolean; error?: string }

const QUICK_ENTRIES = 15;
const QUICK_GROUPS: DetailGroup[] = ['society', 'work'];
const STORE = 'mundi-aitest';
const T = {
    books: [] as string[], mode: 'quick' as Mode, bq: '', busy: false, stop: false, step: '',
    last: null as Run | null,
};
try { T.last = JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { /* no saved run */ }
const keep = () => { try { localStorage.setItem(STORE, JSON.stringify(T.last)); } catch (e) { console.warn('[Mundi] AI tests: the report is too big to keep', e); } };

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s: string) => Math.ceil(s.length / 4);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/* ---------- what is read ---------- */

async function itemsOf(books: string[], mode: Mode): Promise<LoreItem[]> {
    const all: LoreItem[] = [];
    for (const b of books) all.push(...readBook(b, await loadLore(b)));
    if (mode === 'full') return all;
    // quick: the entries that describe the world (places, people, groups) first, then the rest
    const order = ['places', 'people', 'groups', 'other', 'rules'];
    return [...all].sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket)).slice(0, QUICK_ENTRIES);
}
const mapItems = (items: LoreItem[]) => items.filter(i => i.bucket !== 'rules');
const groupsOf = (mode: Mode): DetailGroup[] => (mode === 'quick' ? QUICK_GROUPS : DETAILS.map(d => d.id).filter(id => id !== 'rpg'));

/** About how many AI calls and tokens a run takes (before any retries). */
async function estimate(books: string[], mode: Mode) {
    const items = await itemsOf(books, mode);
    const parts = chunk(mapItems(items));
    const groups = groupsOf(mode);
    const calls = parts.length + 1 + groups.length + 2 + 2;
    const tok = parts.reduce((n, p) => n + tokens(p.text) + 1200 + 1500, 0) + 1500 + groups.reduce((n, g) => n + tokens(detailLore(items, g)) + 2500, 0) + 2 * (3500 + 2500) + 2 * 600;
    return { parts: parts.length, calls, tok };
}

/* ---------- the run ---------- */

async function run(books: string[], mode: Mode, replay?: Call[]) {
    if (T.busy) return;
    const r: Run = { at: Date.now(), books: [...books], mode, calls: [], checks: [], replayed: !!replay };
    const add = (area: string, name: string, status: Status, detail = '') => { r.checks.push({ area, name, status, detail }); notify(); };
    const step = (s: string) => { T.step = s; notify(); };
    T.busy = true; T.stop = false; T.last = r;
    QUIET_TAP.seen = (prompt, answer, ms, error) => { r.calls.push({ prompt, answer, ms, ...(error ? { error } : {}) }); notify(); };
    // a saved run answers in the same order (the prompts are the same while the answers are)
    let n = 0;
    if (replay) QUIET_TAP.replay = (prompt) => { const c = replay[n++]; if (!c) return undefined; if (c.prompt !== prompt) console.info('[Mundi] AI tests: a prompt changed since the saved run', n); return c.error ? '' : c.answer; };
    const stopped = () => { if (T.stop) { r.stopped = true; throw new Error('stopped'); } };
    try {
        step('Reading the lorebooks');
        const items = await itemsOf(books, mode);
        if (!items.length) throw new Error('Those lorebooks have no enabled entries.');
        const lore = norm(items.map(i => `${i.title} ${i.keys.join(' ')} ${i.text}`).join(' '));
        const raw = items.map(i => i.text).join('\n');

        /* 1. the map: places, people, groups, jobs */
        const parts = chunk(mapItems(items));
        const runCtx = { sketch: emptySketch(), style: 'modern' };
        const failed: number[] = []; let cut = 0;
        for (const [i, p] of parts.entries()) {
            stopped(); step(`Reading part ${i + 1} of ${parts.length}`);
            const before = r.calls.length;
            try { for (const d of await readPart(p.text, true, runCtx)) mergeSketch(runCtx.sketch, d); }
            catch (e) { console.warn('[Mundi] AI tests, part', i, e); failed.push(i + 1); }
            if (r.calls.length - before > 1) cut++;
        }
        const sk: Sketch = runCtx.sketch;
        add('World from lorebooks', 'Every part was read', failed.length ? 'fail' : 'pass', failed.length ? `Parts ${failed.join(', ')} of ${parts.length} could not be read, even asked again and in halves.` : `${parts.length} part${parts.length === 1 ? '' : 's'}.`);
        add('World from lorebooks', 'Answers came back whole', cut ? 'warn' : 'pass', cut ? `${cut} part${cut === 1 ? '' : 's'} had to be asked again (an answer that was not JSON, or was cut off).` : 'Every part answered with JSON on the first try.');
        const found = sk.areas.length + sk.places.length;
        add('World from lorebooks', 'Found maps and places', found ? 'pass' : 'fail', `${sk.areas.length} areas, ${sk.places.length} places, ${sk.people.length} people, ${sk.groups.length} groups, ${sk.jobs.length} jobs.`);
        const names = [...sk.areas, ...sk.places, ...sk.people, ...sk.groups].map(x => x.name);
        const made = names.filter(x => !lore.includes(norm(x)) && !norm(x).split(' ').filter(w => w.length > 3).every(w => lore.includes(w)));
        const real = pct(names.length - made.length, names.length);
        add('World from lorebooks', 'Names come from the lorebook', !names.length ? 'skip' : real >= 75 ? 'pass' : real >= 50 ? 'warn' : 'fail', names.length ? `${real}% of ${names.length} names are in the lorebook.${made.length ? ` Not found in it: ${made.slice(0, 12).join(', ')}${made.length > 12 ? '…' : ''}.` : ''}` : 'Nothing to check.');
        const basics = sk.people.filter(p => p.gender && (p.role || p.job)).length;
        add('World from lorebooks', 'People have the basics', !sk.people.length ? 'skip' : pct(basics, sk.people.length) >= 60 ? 'pass' : 'warn', sk.people.length ? `${basics} of ${sk.people.length} people have a gender and a role or job.` : 'No people in these entries.');

        /* 2. building it */
        stopped(); step('Building the world (in memory only)');
        let sum: any = {};
        try { sum = parseJson(await quiet(summaryPrompt('AI test', sk, (parts[0]?.text ?? '').slice(0, 3000)), 800)); } catch (e) { console.warn('[Mundi] AI tests, summary', e); }
        add('World from lorebooks', 'Summary of the world', sum.description && sum.setting ? 'pass' : 'warn', sum.description ? `“${String(sum.description).slice(0, 150)}”` : 'The summary could not be read: the world gets no description or setting.');
        const w = buildWorld(await newWorldFrom('modern', 'empty', 'AI test'), structuredClone(sk), sum, books);
        w.mode = 'rpg';
        add('World from lorebooks', 'The world holds together', ...shape(w));

        /* 3. floors and hidden places */
        const floors = sk.places.filter(p => p.floor), hidden = sk.places.filter(p => p.hidden), locked = sk.places.filter(p => p.restricted);
        const says = (re: RegExp) => re.test(raw);
        const expect = (has: number, re: RegExp, what: string, list: string) => add('Floors and hidden places', `${what[0].toUpperCase()}${what.slice(1)}`,
            has ? 'pass' : says(re) ? 'warn' : 'skip', has ? list : says(re) ? `The lorebook seems to mention ${what}, but the AI marked none.` : `This lorebook does not seem to have ${what}.`);
        expect(floors.length, /\b(floors?|basement|storey|stories|levels? \d+|wing|penthouse|rooftop)\b/i, 'floors of buildings', floors.slice(0, 8).map(p => `${p.floor} of ${p.area || '?'}: ${p.name}`).join('; '));
        expect(hidden.length, /\b(secret|hidden|hideout|unknown to|unlisted|concealed|underground)\b/i, 'hidden places', hidden.slice(0, 8).map(p => p.name).join(', '));
        expect(locked.length, /\b(only|restricted|members|staff|forbidden|authori[sz]ed|clearance|rank(ed)?)\b/i, 'places only some may enter', locked.slice(0, 8).map(p => `${p.name} (${p.restricted})`).join('; '));
        const fl = w.places.filter(p => p.floor);
        const lost = fl.filter(p => !p.in || !w.places.some(b => b.id === p.in));
        if (floors.length) add('Floors and hidden places', 'Floors sit in their building', lost.length ? 'fail' : fl.length ? 'pass' : 'warn',
            lost.length ? `Not in a building: ${lost.map(p => p.name).join(', ')}.` : fl.length ? `${fl.length} floor${fl.length === 1 ? '' : 's'} in ${new Set(fl.map(p => p.in)).size} building${new Set(fl.map(p => p.in)).size === 1 ? '' : 's'}.` : 'The AI gave floors, but none was in an area it called a building, so they became plain places.');
        stopped(); await judge(w, add, step);

        /* 4. the other World creator tabs */
        for (const [i, g] of groupsOf(mode).entries()) {
            stopped();
            const d = DETAILS.find(x => x.id === g)!;
            step(`Filling ${d.name} (${i + 1} of ${groupsOf(mode).length})`);
            try { const line = putDetail(w, g, await askDetail(w, g, items, books)); add('World creator tabs', d.name, line ? 'pass' : 'warn', line || 'The answer was read, but nothing was filled in (the lorebook may not say anything for these tabs).'); }
            catch (e: any) { add('World creator tabs', d.name, 'fail', String(e?.message ?? e)); }
        }

        /* 5. the RPG system */
        stopped(); step('Writing the RPG system');
        try { add('RPG system from lorebooks', 'The system', ...system((await systemFromLore(books, 'for the world "AI test"')).def)); }
        catch (e: any) { add('RPG system from lorebooks', 'The system', 'fail', String(e?.message ?? e)); }
    } catch (e: any) {
        if (!r.stopped) { r.error = String(e?.message ?? e); console.warn('[Mundi] AI tests', e); }
    } finally {
        QUIET_TAP.seen = undefined; QUIET_TAP.replay = undefined;
        T.busy = false; T.step = ''; keep(); notify();
    }
    const bad = r.checks.filter(c => c.status === 'fail').length;
    toast(r.error ? `The AI tests stopped: ${r.error}` : r.stopped ? 'AI tests stopped.' : bad ? `AI tests: ${bad} check${bad === 1 ? '' : 's'} failed.` : 'AI tests: everything passed.', r.error || bad ? 'warn' : 'success');
}

// Ids are unique, every place is on a map, every floor's building and every map's parent exist.
function shape(w: WorldDef): [Status, string] {
    const bad: string[] = [];
    const maps = new Set(w.maps.map(m => m.id)), ids = new Set<string>();
    if (!w.maps.length) bad.push('no maps');
    for (const p of w.places) {
        if (ids.has(p.id)) bad.push(`two places with the id ${p.id}`); ids.add(p.id);
        if (!maps.has(p.map)) bad.push(`${p.name} is on a map that does not exist`);
        if (p.link && !maps.has(p.link)) bad.push(`${p.name} opens a map that does not exist`);
    }
    for (const p of w.places) if (p.in && !ids.has(p.in)) bad.push(`${p.name} is in a building that does not exist`);
    for (const m of w.maps) if (m.parent && !maps.has(m.parent)) bad.push(`the map ${m.name} hangs from a map that does not exist`);
    const pins = w.places.filter(p => !p.link).length;
    if (!pins) bad.push('no places');
    return bad.length ? ['fail', `${bad.slice(0, 6).join('; ')}.`] : ['pass', `${w.maps.length} maps, ${pins} places, ${w.cast.examples.length} people, ${w.occupations.length} jobs.`];
}

function system(d: any): [Status, string] {
    const attrs = d.attributes?.length ?? 0, classes = d.classes?.length ?? 0;
    const bad: string[] = [];
    if (attrs < 4 || attrs > 7) bad.push(`${attrs} attributes (4 to 7 expected)`);
    if (!classes) bad.push('no classes');
    const keys = new Set((d.attributes ?? []).map((a: any) => a.id));
    for (const c of d.classes ?? []) if (!keys.has(c.key)) bad.push(`the class ${c.name} uses an attribute that does not exist`);
    const line = `${d.name}: ${attrs} attributes (${(d.attributes ?? []).map((a: any) => a.short || a.name).join(' ')}), ${d.skills?.length ?? 0} skills, ${classes} classes, ${d.spells?.length ?? 0} powers, ${d.bestiary?.length ?? 0} foes.`;
    if (bad.length) return ['fail', `${bad.join('; ')}. ${line}`];
    return [!d.spells?.length || (d.bestiary?.length ?? 0) <= 1 ? 'warn' : 'pass', `${line}${!d.spells?.length ? ' The powers could not be read.' : ''}`];
}

// The story judge for hidden and locked places: a line that gives the way there should open it, a rumour should not.
async function judge(w: WorldDef, add: (a: string, n: string, s: Status, d?: string) => void, step: (s: string) => void) {
    const p = w.places.find(x => x.hidden && !x.link) ?? w.places.find(x => x.restricted && !x.link);
    if (!p) { add('Floors and hidden places', 'The story opens a place', 'skip', 'No hidden or restricted place in the test world.'); return; }
    const g = { discovery: { found: [], open: [], added: [] }, cast: {}, player: { loc: '' } } as unknown as Save;
    const hid = !!p.hidden;
    const cases: [string, string, ('found' | 'allowed' | 'both' | 'no')[]][] = [
        ['a line that gives the way in', hid ? `Guide: "${p.name}? Follow me, I'll take you there right now." They walk together until the guide stops at the entrance of ${p.name}.`
            : `Guard: "Your pass for ${p.name} came through. Here it is, you may go in whenever you want."`, hid ? ['found', 'both'] : ['allowed', 'both']],
        ['a line that only names it', `Stranger: "People whisper about ${p.name}, but nobody I know has ever been there."`, ['no']],
    ];
    for (const [what, line, ok] of cases) {
        step(`Asking the story judge about ${p.name}`);
        try {
            const a = parseJudge(await quiet(judgePrompt(g, w, [line], [p]), 60), 1)[0];
            add('Floors and hidden places', `The story judge, ${what}`, ok.includes(a) ? 'pass' : 'fail', `${p.name} (${hid ? 'hidden' : 'restricted'}): answered “${a}”, expected ${ok.join(' or ')}.`);
        } catch (e: any) { add('Floors and hidden places', `The story judge, ${what}`, 'fail', String(e?.message ?? e)); }
    }
}

/* ---------- the screen ---------- */

const MARK: Record<Status, string> = { pass: '✅', warn: '⚠️', fail: '❌', skip: '➖' };
let est: { key: string; v?: Awaited<ReturnType<typeof estimate>> } = { key: '' };
function estimateLine(): string {
    const key = `${T.mode}|${T.books.join('|')}`;
    if (!T.books.length) return '';
    if (est.key !== key) { est = { key }; estimate(T.books, T.mode).then(v => { if (est.key === key) { est.v = v; notify(); } }).catch(() => undefined); }
    const v = est.v;
    return v ? `<p class="mu-muted">About ${v.calls} AI calls (${v.parts} part${v.parts === 1 ? '' : 's'} of the lorebook${T.mode === 'quick' ? `, its first ${QUICK_ENTRIES} entries` : ''}), roughly ${Math.round(v.tok / 1000)}k tokens in and out, plus any retries.</p>` : '<p class="mu-muted">Counting…</p>';
}

export function aiTestHtml(): string {
    const q = T.bq.toLowerCase();
    const books = lorebooks().filter(b => !q || b.toLowerCase().includes(q)).sort((a, b) => Number(T.books.includes(b)) - Number(T.books.includes(a)) || a.localeCompare(b));
    const r = T.last;
    return `<section><h3>AI tests</h3>
        <p class="mu-muted">Runs the steps that need your AI with the model selected in SillyTavern right now: a world from a lorebook (maps, places, people), its floors and hidden places, the World creator tabs and the RPG system. Mundi checks each answer. No world is saved.</p>
        <input class="mu-search" type="search" data-input="at-bq" data-focus="atbq" placeholder="Search lorebooks" value="${esc(T.bq)}">
        <div class="mu-chips mu-situation-books">${books.slice(0, 60).map(b => `<button class="mu-chip ${T.books.includes(b) ? 'is-on' : ''}" data-act="at-book" data-name="${esc(b)}" data-notr>${esc(b)}</button>`).join('') || '<span class="mu-muted">No lorebooks.</span>'}</div>
        <div class="mu-chips">${([['quick', `Quick (first ${QUICK_ENTRIES} entries, 2 tabs)`], ['full', 'Full (the whole lorebook, every tab)']] as const).map(([id, l]) => `<button class="mu-chip ${T.mode === id ? 'is-on' : ''}" data-act="at-mode" data-v="${esc(id)}">${l}</button>`).join('')}</div>
        ${estimateLine()}
        <div class="mu-row">${T.busy ? `<span class="mu-muted">${esc(T.step)}…</span><button data-act="at-stop">${icon('x')}<span>Stop</span></button>`
            : `<button class="mu-primary" data-act="at-run" ${T.books.length ? '' : 'aria-disabled="true"'}>${icon('sparkles')}<span>Run the AI tests</span></button>`}</div></section>
        ${r ? reportHtml(r) : ''}`;
}

function reportHtml(r: Run): string {
    const n = (s: Status) => r.checks.filter(c => c.status === s).length;
    const tin = r.calls.reduce((a, c) => a + tokens(c.prompt), 0), tout = r.calls.reduce((a, c) => a + tokens(c.answer), 0);
    const secs = Math.round(r.calls.reduce((a, c) => a + c.ms, 0) / 1000);
    const areas = [...new Set(r.checks.map(c => c.area))];
    return `<section><h3>${r.replayed ? 'Checked again with saved answers' : 'Last run'} · <span data-notr>${esc(r.books.join(', '))}</span> · ${r.mode}</h3>
        <p class="${n('fail') || r.error ? 'mu-warn' : 'mu-muted'}">${MARK.pass} ${n('pass')} · ${MARK.warn} ${n('warn')} · ${MARK.fail} ${n('fail')} · ${MARK.skip} ${n('skip')}. ${r.calls.length} AI call${r.calls.length === 1 ? '' : 's'}${r.replayed ? ' (from the saved answers, free)' : `, about ${Math.round(tin / 1000)}k tokens sent and ${Math.round(tout / 1000)}k received, ${secs} s`}.${r.error ? ` Stopped by an error: ${esc(r.error)}` : r.stopped ? ' Stopped before the end.' : ''}</p>
        ${areas.map(a => `<h4>${esc(a)}</h4>${r.checks.filter(c => c.area === a).map(c => `<p>${MARK[c.status]} <b>${esc(c.name)}</b><br><small class="mu-muted" data-notr>${esc(c.detail)}</small></p>`).join('')}`).join('')}
        <div class="mu-row">${r.calls.length && !T.busy ? `<button data-act="at-replay">${icon('forward')}<span>Check again with these answers (no AI)</span></button>` : ''}<button data-act="at-save">${icon('download')}<span>Download the report</span></button></div></section>`;
}

Object.assign(ACT, {
    'at-book': (el) => { const b = el.dataset.name!; T.books = T.books.includes(b) ? T.books.filter(x => x !== b) : [...T.books, b]; notify(); },
    'at-mode': (el) => { T.mode = el.dataset.v as Mode; notify(); },
    'at-run': () => { if (T.books.length) void run(T.books, T.mode); },
    'at-stop': () => { T.stop = true; notify(); },
    'at-replay': () => { const r = T.last; if (!r || T.busy) return; if (!r.books.every(b => lorebooks().includes(b))) { toast('A lorebook of that run is gone.', 'error'); return; } void run(r.books, r.mode, r.calls); },
    'at-save': () => {
        const r = T.last; if (!r) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
        a.download = `mundi-ai-test-${new Date(r.at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
});
Object.assign(INPUT, {
    'at-bq': (el) => { T.bq = el.value; notify(); },
});
