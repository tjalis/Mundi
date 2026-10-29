// Sprites drawn on the player's ComfyUI. The AI writes a person's look as Danbooru tags, Mundi fills a ComfyUI
// workflow with it and saves what comes back as their sprites: the first outfit in their Expressions folder, the
// others as outfit subfolders ("Bianca/swim"), which the outfit menu and the rooms' dress codes already use.
// It runs from the scene (people with no sprites, asking first or by itself) and from the Library's Expressions
// page, for any character or persona ("persona:<file>", whose folder is the persona's name: when you Play as
// someone else, the card made for you by that name finds them).
//
// The workflow is any API-format workflow saved in SillyTavern (user/workflows). Mundi finds its parts by their
// titles, so it can keep being edited in ComfyUI: "Appearance", "Outfit N (…)" (as "name: tags", gathered in a
// list node), the seed node ("… seed"), "Expression N: name" + "Save: name", "Output folder", and Any Switch
// nodes titled "… on/off" or "(on, else …)" (each an on/off option here: off takes the switch's first input away).
// Each picture is its own small job: ComfyUI keeps the body it already drew, so the next expression is only a face
// pass. An expression the workflow has no node for is drawn through its neutral face pass with that label's tags.
// Only the nodes a picture needs are sent, so other parts of the workflow (a CG section, a base frame) never run.
import { settings, saveSettings, notify, state, toast, esc, game } from '../core/store.js';
import { ctx, charOf, fetchSprites, uploadSprite, fullCharacter, setCharacterImage, quiet, expressionLabels, personas, personaName } from '../st/bridge.js';
import { addOutfit, forgetOutfits, savedOutfits } from './outfits.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

type Mode = 'off' | 'ask' | 'auto';
interface Sheet { name: string; appearance: string; outfits: { name: string; tags: string }[]; seed: number; drawn?: number; avatarSet?: boolean }
interface Prefs {
    mode: Mode; workflow: string; url: string; outfits: string[] | null; off: string[]; avatar: boolean; sheets: Record<string, Sheet>;
    /** which expressions: the workflow's own, all of SillyTavern's, or a list of labels */
    labels: 'workflow' | 'all' | string[]; tags: Record<string, string>; expressions?: string[] | null;
}

export const sprPrefs = (): Prefs => {
    const s = settings() as any;
    const p = (s.sprites ??= {}) as Prefs;
    p.mode ??= 'ask'; p.workflow ??= 'Character.modular.workflow.json'; p.url ??= '';
    p.outfits ??= null; p.off ??= []; p.avatar ??= true; p.sheets ??= {}; p.tags ??= {};
    if (p.labels === undefined) { p.labels = Array.isArray(p.expressions) ? p.expressions.map(labelOf) : 'workflow'; delete p.expressions; }
    return p;
};

/* ---------- who: a character (their card file) or a persona ("persona:<file>") ---------- */

export const personaKey = (file: string) => `persona:${file}`;
const personaOf = (k: string) => (k.startsWith('persona:') ? k.slice(8) : null);
const exists = (k: string) => { const f = personaOf(k); return f ? personas().some(p => p.file === f) : !!charOf(k); };
const nameOf = (k: string) => { const f = personaOf(k); return f ? personaName(f) : String(charOf(k)?.name ?? k); };

/* ---------- the ComfyUI server ---------- */

// The address set here, else Megumin Suite's (its default profile first), else SillyTavern's Image Generation.
export function comfyUrl(): string {
    const own = sprPrefs().url.trim();
    if (own) return own.replace(/\/+$/, '');
    const es = ctx().extensionSettings ?? {};
    const profiles = es['Megumin-Suite']?.profiles ?? {};
    const meg = profiles.default?.imageGen?.comfyUrl || Object.values(profiles).map((p: any) => p?.imageGen?.comfyUrl).find(Boolean);
    return String(meg || es.sd?.comfy_url || 'http://127.0.0.1:8188').replace(/\/+$/, '');
}
const stHeaders = () => ctx().getRequestHeaders();

/* ---------- expressions: SillyTavern's labels and their tags ---------- */

// The workflow's expression names as SillyTavern's labels.
const LABELS: Record<string, string> = { happy: 'joy', sad: 'sadness', angry: 'anger', surprised: 'surprise', embarrassed: 'embarrassment', aroused: 'desire', scared: 'fear', disgusted: 'disgust', confused: 'confusion', loving: 'love', proud: 'pride' };
function labelOf(n: string) { const k = n.toLowerCase(); return LABELS[k] ?? k; }
// Tags for the labels a workflow has no node of its own for (editable in Settings).
export const DEFAULT_TAGS: Record<string, string> = {
    neutral: 'light_smile, looking_at_viewer', joy: 'happy, grin, looking_at_viewer', sadness: '(sad:0.8), (frown:0.7), tears',
    anger: '(angry:0.7), furrowed_brow, clenched_teeth', surprise: '(surprised:0.8), open_mouth, (wide-eyed:0.8)',
    embarrassment: '(embarrassed:0.8), parted_lips, blush', desire: '(smug:0.8), parted_lips, (half-closed_eyes:0.8), blush',
    admiration: 'sparkling_eyes, light_smile, looking_at_viewer', amusement: 'laughing, closed_eyes, open_mouth',
    annoyance: 'annoyed, (frown:0.7), half-closed_eyes', approval: 'smile, closed_mouth, nodding, looking_at_viewer',
    caring: 'gentle_smile, soft_eyes, head_tilt', confusion: 'confused, head_tilt, (frown:0.5), question_mark',
    curiosity: 'curious, head_tilt, looking_at_viewer, parted_lips', disappointment: 'disappointed, (frown:0.6), looking_down',
    disapproval: 'disapproving, frown, crossed_arms', disgust: '(disgust:0.8), wrinkled_nose, frown',
    excitement: 'excited, (open_mouth:0.8), smile, sparkling_eyes', fear: '(scared:0.8), wide-eyed, (trembling:0.7), open_mouth',
    gratitude: 'grateful, warm_smile, closed_eyes', grief: 'crying, tears, (sad:0.9), looking_down',
    love: 'loving, (heart-shaped_pupils:0.6), blush, smile', nervousness: 'nervous, sweatdrop, (wavy_mouth:0.7), looking_away',
    optimism: 'smile, looking_up, bright_eyes', pride: 'smug, chin_up, closed_mouth, (hand_on_own_chest:0.6)',
    realization: 'surprised, (open_mouth:0.6), raised_eyebrows', relief: 'relieved, closed_eyes, light_smile, exhaling',
    remorse: 'guilty, looking_down, (frown:0.6), downcast_eyes',
};
const tagsFor = (label: string) => sprPrefs().tags[label] ?? DEFAULT_TAGS[label] ?? label.replace(/\s+/g, '_');

/* ---------- the workflow ---------- */

export type Graph = Record<string, { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } }>;
const titleOf = (g: Graph, id: string) => String(g[id]?._meta?.title ?? '');
const isLink = (v: any) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';

export async function loadWorkflow(name = sprPrefs().workflow): Promise<Graph> {
    const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: stHeaders(), body: JSON.stringify({ file_name: name }) });
    if (!res.ok) throw new Error(`Could not load the workflow "${name}". Save it in SillyTavern's workflows (user/workflows).`);
    let w = await res.json();
    if (typeof w === 'string') w = JSON.parse(w);
    if (!w || typeof w !== 'object' || Array.isArray(w.nodes)) throw new Error(`"${name}" is not in ComfyUI's API format. In ComfyUI use Workflow → Export (API).`);
    return w as Graph;
}
export async function workflowList(): Promise<string[]> {
    try {
        const res = await fetch('/api/sd/comfy/workflows', { method: 'POST', headers: stHeaders(), body: JSON.stringify({ url: comfyUrl() }) });
        const l = res.ok ? await res.json() : [];
        return Array.isArray(l) ? l.map(String) : [];
    } catch { return []; }
}

// What a workflow offers, read from its titles.
interface Expr { name: string; label: string; node: string; save: string }
interface Parts { appearance: string[]; outfits: { id: string; name: string; tags: string }[]; list: string | null; seed: string | null; expr: Expr[]; folder: string | null; switches: { id: string; name: string }[] }
const splitOutfit = (v: string) => { const m = String(v ?? '').match(/^\s*([^:\n]+?)\s*:\s*([\s\S]*)$/); return m ? { name: m[1], tags: m[2].trim() } : { name: '', tags: String(v ?? '').trim() }; };
const numIn = (s: string) => Number(s.match(/\d+/)?.[0] ?? 0);
function partsOf(g: Graph): Parts {
    const ids = Object.keys(g);
    const outfits = ids.filter(id => /^outfit\s*\d+/i.test(titleOf(g, id)) && typeof g[id].inputs?.value === 'string')
        .sort((a, b) => numIn(titleOf(g, a)) - numIn(titleOf(g, b)))
        .map(id => ({ id, ...splitOutfit(g[id].inputs.value) }))
        .map((o, k) => ({ ...o, name: o.name || (k ? `outfit${k + 1}` : 'default') }));
    const oset = new Set(outfits.map(o => o.id));
    const list = ids.find(id => Object.values(g[id].inputs ?? {}).some(v => isLink(v) && oset.has(v[0]))) ?? null;
    const saves = new Map(ids.filter(id => /^save:\s*/i.test(titleOf(g, id))).map(id => [titleOf(g, id).replace(/^save:\s*/i, '').trim().toLowerCase(), id]));
    const expr = ids.filter(id => /^expression\s*\d+\s*:/i.test(titleOf(g, id)) && typeof g[id].inputs?.value === 'string')
        .sort((a, b) => numIn(titleOf(g, a)) - numIn(titleOf(g, b)))
        .map(id => ({ id, name: titleOf(g, id).replace(/^expression\s*\d+\s*:\s*/i, '').trim() }))
        .filter(e => saves.has(e.name.toLowerCase()))
        .map(e => ({ name: e.name, label: labelOf(e.name), node: e.id, save: saves.get(e.name.toLowerCase())! }));
    return {
        appearance: ids.filter(id => /^appearance$/i.test(titleOf(g, id).trim()) && typeof g[id].inputs?.value === 'string'),
        outfits, list,
        seed: ids.find(id => /seed/i.test(titleOf(g, id)) && typeof g[id].inputs?.seed === 'number') ?? null,
        expr,
        folder: ids.find(id => /^output folder$/i.test(titleOf(g, id).trim())) ?? null,
        switches: ids.filter(id => /any switch/i.test(g[id].class_type) && /on\/off|\(on, else/i.test(titleOf(g, id)) && isLink(g[id].inputs?.any_01))
            .map(id => ({ id, name: titleOf(g, id).replace(/\s*\(.*$/, '').replace(/\s*on\/off.*$/i, '').trim() })),
    };
}
// The labels to draw: the workflow's own, all of SillyTavern's, or the ones picked.
function labelsFor(p: Parts): string[] {
    const l = sprPrefs().labels;
    if (l === 'all') return [...new Set([...p.expr.map(e => e.label), ...expressionLabels()])];
    if (l === 'workflow') return p.expr.map(e => e.label);
    return l;
}

// Only what the chosen Save nodes need (following their inputs back), so nothing else in the workflow runs.
function prune(g: Graph, keep: string[]): Graph {
    const out: Graph = {}; const todo = [...keep];
    while (todo.length) {
        const id = todo.pop()!; if (out[id] || !g[id]) continue;
        out[id] = g[id];
        for (const v of Object.values(g[id].inputs ?? {})) if (isLink(v)) todo.push(v[0]);
    }
    return out;
}

// One ComfyUI job: one picture (an outfit and a label). Returns the graph and the Save node that gives it.
function job(base: Graph, p: Parts, sheet: Sheet, outfit: number, label: string): { graph: Graph; save: string } {
    const g = structuredClone(base);
    for (const id of p.appearance) g[id].inputs.value = sheet.appearance;
    if (p.seed) g[p.seed].inputs.seed = sheet.seed;
    const slot = p.outfits[0];
    const o = sheet.outfits[outfit];
    if (slot && o) {
        g[slot.id].inputs.value = `${o.name}: ${o.tags}`;
        if (p.list) { const l = g[p.list]; for (const k of Object.keys(l.inputs)) if (isLink(l.inputs[k])) delete l.inputs[k]; l.inputs.value1 = [slot.id, 0]; }
    }
    if (p.folder) { const f = g[p.folder].inputs; const key = Object.keys(f).find(k => typeof f[k] === 'string'); if (key) f[key] = `Mundi/${sheet.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}/`; }
    for (const s of p.switches) if (sprPrefs().off.includes(s.name)) delete g[s.id].inputs.any_01;
    // the workflow's own face pass for this label, else its neutral one with this label's tags
    let e = p.expr.find(x => x.label === label);
    if (!e || sprPrefs().tags[label] !== undefined) {
        const via = e ?? p.expr.find(x => x.label === 'neutral') ?? p.expr[0];
        g[via.node].inputs.value = tagsFor(label);
        e = via;
    }
    return { graph: prune(g, [e.save]), save: e.save };
}

export async function runJob(graph: Graph, onStep?: () => void): Promise<Record<string, Blob>> {
    const url = comfyUrl();
    const res = await fetch(`${url}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: `mundi-${Date.now()}` }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.prompt_id) {
        const why = Object.values(data.node_errors ?? {}).flatMap((n: any) => (n.errors ?? []).map((e: any) => `${n.class_type}: ${e.details || e.message}`))[0] || data.error?.message || res.statusText;
        throw new Error(`ComfyUI refused the workflow (${why}).`);
    }
    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until) {
        await new Promise(r => setTimeout(r, 2000)); onStep?.();
        const h = await (await fetch(`${url}/history/${data.prompt_id}`)).json().catch(() => ({}));
        const run = h[data.prompt_id]; if (!run) continue;
        if (run.status?.status_str === 'error') throw new Error('ComfyUI stopped with an error (see its console).');
        const out: Record<string, Blob> = {};
        for (const [id, o] of Object.entries(run.outputs ?? {}) as [string, any][]) {
            const img = o.images?.[0]; if (!img) continue;
            const r = await fetch(`${url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${encodeURIComponent(img.type ?? 'output')}`);
            if (r.ok) out[id] = await r.blob();
        }
        return out;
    }
    throw new Error('ComfyUI took more than 20 minutes.');
}

/* ---------- the look, written by the AI ---------- */

async function cardText(k: string): Promise<string> {
    const f = personaOf(k), name = nameOf(k);
    if (f) return String(personas().find(p => p.file === f)?.description ?? '').replace(/\{\{user\}\}/gi, name);
    const c = await fullCharacter(k);
    return [c?.description, c?.personality, c?.data?.extensions?.depth_prompt?.prompt].map(x => String(x ?? '').replace(/\{\{char\}\}/gi, name).trim()).filter(Boolean).join('\n\n');
}
async function writeSheet(k: string, p: Parts): Promise<Sheet> {
    const name = nameOf(k);
    const card = (await cardText(k)).slice(0, 6000);
    const slots = p.outfits.length ? p.outfits : [{ name: 'default', tags: '' }];
    const prompt = `Write the look of ${name} as Danbooru tags for an image model (Illustrious).

<character>
${card || name}
</character>

Answer with exactly these lines and nothing else:
appearance: <the subject count tag first (1girl, 1boy…), then age, body, skin, face, eyes, hair: only what does not change with clothes>
${slots.map(o => `${o.name}: <what ${name} wears for "${o.name}"${o.tags ? `, in the spirit of: ${o.tags.split(',').slice(0, 8).join(',')}` : ''}>`).join('\n')}

Comma-separated tags only, no sentences. Take every detail the card gives; invent the rest so it fits the character.`;
    const raw = await quiet(prompt, 600);
    const lines = new Map(raw.split('\n').map(l => l.match(/^\s*[-*]?\s*([^:\n]+?)\s*:\s*(.+)$/)).filter(Boolean).map(m => [m![1].toLowerCase(), m![2].trim()]));
    const appearance = lines.get('appearance') ?? '';
    if (!appearance) throw new Error(`The AI did not describe ${name}.`);
    return { name, appearance, outfits: slots.map(o => ({ name: o.name, tags: lines.get(o.name.toLowerCase()) ?? o.tags })), seed: newSeed() };
}
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/* ---------- the queue ---------- */

// What to draw: some outfits (indexes in the look; all the chosen ones when left out) and labels, or only the missing.
interface Order { who: string; outfits?: number[]; labels?: string[]; missing?: boolean; lookOnly?: boolean }
// Session only: who is waiting, being drawn, done or skipped (a failure is not tried again until asked).
const S = { queue: [] as Order[], busy: null as Order | null, step: '', now: '', status: new Map<string, 'none' | 'has' | 'queued' | 'busy' | 'failed'>() };
export const spriteStatus = (k: string) => S.status.get(k);
const waiting = (k: string) => S.busy?.who === k || S.queue.some(o => o.who === k);

async function hasSprites(k: string) {
    const known = S.status.get(k); if (known) return known !== 'none';
    S.status.set(k, 'has');   // while looking
    const has = (await fetchSprites(k, '')).length > 0;
    if (S.status.get(k) === 'has') S.status.set(k, has ? 'has' : 'none');
    return has;
}
// Looks up which of these have sprites (the Library's "No sprites" filter), redrawing as answers come.
const checking = new Set<string>();
export function checkSprites(keys: string[]) {
    const todo = keys.filter(k => !S.status.has(k) && !checking.has(k)); if (!todo.length) return;
    todo.forEach(k => checking.add(k));
    // a few at a time, so a long list does not flood SillyTavern
    const next = async (): Promise<void> => { const k = todo.shift(); if (!k) return; await hasSprites(k).catch(() => S.status.delete(k)); checking.delete(k); return next(); };
    void Promise.all(Array.from({ length: 6 }, next)).then(notify);
}

// Called whenever the scene changes, with who is there.
export async function spritesFor(avatars: string[]) {
    const mode = sprPrefs().mode; if (mode === 'off') return;
    let fresh = false;
    for (const a of avatars) {
        if (a.startsWith('__tut:') || !charOf(a)) continue;
        const known = S.status.has(a);
        if (await hasSprites(a)) continue;
        if (mode === 'auto' && S.status.get(a) === 'none') enqueue({ who: a });
        else if (!known) fresh = true;   // "Draw sprite" shows on them
    }
    if (fresh) notify();
}
export function enqueue(o: Order) {
    if (!exists(o.who)) return;
    if (waiting(o.who)) { toast(`${nameOf(o.who)} is already being drawn.`, 'info'); return; }
    S.status.set(o.who, 'queued'); S.queue.push(o); notify();
    void pump();
}

async function pump() {
    if (S.busy) return;
    const o = S.queue.shift(); if (!o) return;
    S.busy = o; S.status.set(o.who, 'busy'); S.step = 'Writing the look'; S.now = ''; notify();
    const name = nameOf(o.who);
    try {
        const n = await draw(o);
        S.status.set(o.who, (await fetchSprites(o.who, '')).length ? 'has' : 'none');
        if (!o.lookOnly) toast(n ? `${name}: ${n === 1 ? '1 sprite' : `${n} sprites`} drawn.` : `${name} has every sprite already.`, 'success');
    } catch (e: any) {
        S.status.set(o.who, 'failed');
        toast(`Could not draw ${name}: ${String(e?.message ?? e)}`, 'error');
    } finally {
        S.busy = null; S.step = ''; S.now = ''; notify();
        void pump();
    }
}

// The pictures changed: the scene, the Library page and the outfit menu read them again.
function refreshed(k: string) {
    delete (state.sprites as any)[k]; forgetOutfits(k);
    if (state.lib.expr === k) state.lib.sprites = null;
    notify();
}

async function draw(o: Order): Promise<number> {
    const base = await loadWorkflow(); const p = partsOf(base);
    if (!p.expr.length) throw new Error('the workflow has no "Expression N: name" nodes with a matching "Save: name".');
    const prefs = sprPrefs();
    const sheet = prefs.sheets[o.who] ??= await writeSheet(o.who, p);
    saveSettings();
    if (o.lookOnly) return 0;
    const labels = o.labels ?? labelsFor(p);
    const outfits = o.outfits ?? sheet.outfits.map((x, i) => i).filter(i => i === 0 || !prefs.outfits || prefs.outfits.includes(sheet.outfits[i].name));
    // the pictures to make, the first outfit's neutral one first so they show up quickly
    let todo = outfits.flatMap(i => labels.map(l => ({ i, l })));
    todo.sort((a, b) => Number(b.i === outfits[0] && b.l === 'neutral') - Number(a.i === outfits[0] && a.l === 'neutral'));
    if (o.missing) {
        const have = new Map<number, Set<string>>();
        for (const i of outfits) have.set(i, new Set((await fetchSprites(o.who, i === 0 ? '' : sheet.outfits[i].name)).map(s => String(s.label))));
        todo = todo.filter(t => !have.get(t.i)!.has(t.l));
    }
    let done = 0;
    for (const t of todo) {
        const sub = t.i === 0 ? '' : sheet.outfits[t.i].name;
        S.step = `${done}/${todo.length}`; S.now = `${sub || sheet.outfits[0]?.name || ''} · ${t.l}`; notify();
        const { graph, save } = job(base, p, sheet, t.i, t.l);
        const png = (await runJob(graph))[save];
        if (!png) throw new Error('ComfyUI gave no picture.');
        await uploadSprite(o.who, t.l, png, t.l, sub);
        done++;
        if (sub) addOutfit(o.who, sub);
        if (t.i === 0 && t.l === 'neutral') await fixAvatar(o.who, png);
        refreshed(o.who);
    }
    sheet.drawn = Date.now(); saveSettings();
    return done;
}

// A person the world made (an example of the world, with an initials picture) gets a picture from the sprite.
async function fixAvatar(avatar: string, sprite: Blob) {
    const c = charOf(avatar), sheet = sprPrefs().sheets[avatar];
    if (!sheet || sheet.avatarSet || !sprPrefs().avatar || !c?.data?.extensions?.mundi?.example) return;
    const img = await createImageBitmap(sprite);
    const w = Math.round(img.width * 0.62), h = Math.min(img.height, Math.round(w * 1.5));
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 600;
    const g2 = cv.getContext('2d')!;
    g2.fillStyle = '#20232b'; g2.fillRect(0, 0, 400, 600);
    g2.drawImage(img, Math.round((img.width - w) / 2), 0, w, h, 0, 0, 400, 600);
    const png = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/png'));
    if (!png) return;
    await setCharacterImage(avatar, png);
    sheet.avatarSet = true; saveSettings();
}

/* ---------- in the scene and the menu ---------- */

const progress = (k: string) => (S.busy?.who === k ? `Drawing… ${S.step}${S.now ? ` · ${S.now}` : ''}` : S.queue.some(o => o.who === k) ? 'Waiting to be drawn' : '');
// On a person's figure in the scene, when they have no sprites: a button (ask first) or how far the drawing is.
export function spriteBadge(avatar: string): string {
    const st = S.status.get(avatar), mode = sprPrefs().mode;
    if (mode === 'off' || !st || st === 'has') return '';
    if (st === 'busy' || st === 'queued') return `<small class="mu-sprgen is-busy">${icon('image')}<span>${esc(progress(avatar))}</span></small>`;
    return `<button class="mu-sprgen" data-act="spr-draw" data-who="${esc(avatar)}" title="Draw their sprites on ComfyUI">${icon('image')}<span>${st === 'failed' ? 'Try drawing again' : 'Draw sprite'}</span></button>`;
}
// In the sprite's menu (left side, with the outfits).
export function spriteMenuButtons(avatar: string): string[] {
    if (sprPrefs().mode === 'off' || !charOf(avatar) || waiting(avatar)) return [];
    return [`<button data-act="spr-open" data-who="${esc(avatar)}">🎨<span>Sprites…</span></button>`];
}

/* ---------- the Library's Expressions page ---------- */

// The current outfit of the page ('' = the usual one) as an index in the look, or -1 when the look has no such outfit.
const outfitIndex = (s: Sheet | undefined, outfit: string) => (!outfit ? 0 : s ? s.outfits.findIndex((o, i) => i > 0 && o.name.toLowerCase() === outfit.toLowerCase()) : -1);

// The look and the drawing buttons, above the expression pictures.
export function spriteLookHtml(k: string, outfit: string): string {
    const s = sprPrefs().sheets[k];
    const busy = waiting(k), oi = outfitIndex(s, outfit);
    const b = (act: string, label: string, cls = '', extra = '') => `<button class="${cls}" data-act="${act}" data-who="${esc(k)}" data-o="${oi}" ${busy ? 'aria-disabled="true"' : ''} ${extra}>${label}</button>`;
    const state1 = busy ? `<p class="mu-sprgen-state">${icon('image')} ${esc(progress(k))}</p>` : '';
    if (!s) return `<section class="mu-sprlook"><h4>Draw with ComfyUI</h4>
        <p class="mu-muted">The AI writes their look as tags from the ${personaOf(k) ? 'persona\'s description' : 'card'}, then ComfyUI draws every expression and outfit with the same face.</p>
        <div class="mu-row">${b('spr-draw-all', 'Draw all', 'mu-primary')}${b('spr-look', 'Only write the look', 'mu-ghost')}</div>${state1}</section>`;
    return `<section class="mu-sprlook"><h4>Draw with ComfyUI</h4>
        <label class="mu-field"><span>Appearance</span><textarea rows="3" data-input="spr-sheet" data-who="${esc(k)}" data-k="appearance">${esc(s.appearance)}</textarea></label>
        ${oi >= 0 && s.outfits[oi] ? `<label class="mu-field"><span>Outfit: <span data-notr>${esc(s.outfits[oi].name)}</span></span><textarea rows="2" data-input="spr-sheet" data-who="${esc(k)}" data-k="${oi}">${esc(s.outfits[oi].tags)}</textarea></label>`
            : `<p class="mu-muted">The look has no outfit called “${esc(outfit)}”: these pictures can be uploaded, not drawn.</p>`}
        <div class="mu-row">
            ${oi >= 0 ? `${b('spr-draw-missing', 'Draw missing', 'mu-primary')}${b('spr-draw-outfit', 'Redraw this outfit')}` : ''}
            ${b('spr-draw-all', 'Redraw everything')}${b('spr-newface', 'New face', 'mu-ghost')}
            <small class="mu-muted">Seed ${s.seed} · the same seed keeps the same face</small></div>
        ${s.outfits.length > 1 ? `<small class="mu-muted">Outfits in this look: ${s.outfits.map((o, i) => `<span data-notr>${esc(o.name)}</span>${i === 0 ? ' (usual)' : ''}`).join(', ')}. Pick one above to see and edit it.</small>` : ''}
        ${state1}</section>`;
}
// The button on one expression's tile.
export function spriteTileButton(k: string, label: string, outfit: string): string {
    const s = sprPrefs().sheets[k], oi = outfitIndex(s, outfit);
    if (oi < 0 || waiting(k)) return '';
    return `<button class="mu-ibtn mu-ghost" data-act="spr-draw-one" data-who="${esc(k)}" data-o="${oi}" data-l="${esc(label)}" title="Draw this one on ComfyUI">${icon('image')}</button>`;
}
// Every sprite of a character or persona, for the Gallery: the usual outfit first, then the outfits of their look.
export async function spritePhotos(k: string): Promise<{ url: string; caption: string }[]> {
    const s = sprPrefs().sheets[k];
    const seen = new Set<string>();
    const outs = ['', ...savedOutfits(k), ...(s?.outfits.slice(1).map(o => o.name) ?? [])].filter(o => { const l = o.toLowerCase(); if (seen.has(l)) return false; seen.add(l); return true; });
    const lists = await Promise.all(outs.map(o => fetchSprites(k, o).then(l => l.map(x => ({ url: String(x.path), caption: `${o || 'usual'} · ${x.label}`, label: String(x.label) })))));
    // in each outfit, neutral first
    return lists.flatMap(l => l.sort((a, b) => Number(b.label === 'neutral') - Number(a.label === 'neutral'))).map(({ url, caption }) => ({ url, caption }));
}
export const lookedKeys = () => Object.keys(sprPrefs().sheets);

/* ---------- settings (Add-ons) ---------- */

const WF = { list: null as string[] | null, parts: null as Parts | null, for: '' };
function readWorkflow() {
    const name = sprPrefs().workflow;
    if (WF.for === name) return; WF.for = name; WF.parts = null;
    void loadWorkflow(name).then(g => { WF.parts = partsOf(g); }).catch(() => { WF.parts = null; }).finally(notify);
    if (!WF.list) void workflowList().then(l => { WF.list = l; notify(); });
}

export function spritesSettingsHtml(): string {
    const p = sprPrefs(); readWorkflow();
    const parts = WF.parts;
    const chk = (act: string, v: string, on: boolean, label: string) => `<label class="mu-check"><input type="checkbox" data-input="${act}" data-v="${esc(v)}" ${on ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    const files = [...new Set([p.workflow, ...(WF.list ?? [])])];
    const own = parts?.expr.map(e => e.label) ?? [];
    const all = [...new Set([...own, ...expressionLabels()])];
    const lmode = Array.isArray(p.labels) ? 'pick' : p.labels;
    const others = all.filter(l => !own.includes(l));
    const looks = Object.entries(p.sheets);
    return `<section><h3>Sprites</h3><p class="mu-muted">Draws Expressions sprites on your ComfyUI: from the scene for people who have none, and for anyone from the Library (a character or persona › Expressions). The model, LoRAs and quality settings are the workflow's own.</p>
        <label class="mu-field"><span>In the scene, for people with no sprites</span><select data-input="spr-mode">${([['off', 'Do nothing'], ['ask', 'Ask first (a "Draw sprite" button on them)'], ['auto', 'Draw them automatically']] as const).map(([v, l]) => `<option value="${v}" ${p.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="mu-field"><span>Workflow (API format, in SillyTavern's workflows)</span><select data-input="spr-wf">${files.map(f => `<option value="${esc(f)}" ${f === p.workflow ? 'selected' : ''} data-notr>${esc(f)}</option>`).join('')}</select></label>
        <label class="mu-field"><span>ComfyUI address · now ${esc(comfyUrl())}</span><input type="text" placeholder="Empty: Megumin Suite's, else Image Generation's" value="${esc(p.url)}" data-input="spr-url"></label>
        ${parts ? `<label class="mu-field"><span>Expressions to draw</span><select data-input="spr-labels">${([['workflow', `The workflow's own (${own.length})`], ['all', `All of SillyTavern's (${all.length})`], ['pick', 'Pick them']] as const).map(([v, l]) => `<option value="${v}" ${lmode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            ${lmode === 'pick' ? `<div class="mu-field mu-sprlabels">${all.map(l => chk('spr-label', l, (p.labels as string[]).includes(l), l)).join('')}</div>` : ''}
            ${others.length ? `<details class="mu-sprsheet"><summary>Tags for the expressions the workflow has no node for (${others.length})</summary>
                <p class="mu-muted">Drawn through the workflow's neutral face pass with these tags instead. One per line, as “label: tags”.</p>
                <textarea rows="10" data-input="spr-tags">${esc(others.map(l => `${l}: ${tagsFor(l)}`).join('\n'))}</textarea></details>` : ''}
            ${parts.outfits.length > 1 ? `<div class="mu-field"><span>Outfits (the first is always drawn)</span>${parts.outfits.slice(1).map(o => chk('spr-outfits', o.name, !p.outfits || p.outfits.includes(o.name), o.name)).join('')}</div>` : ''}
            ${parts.switches.length ? `<div class="mu-field"><span>Workflow options</span>${parts.switches.map(s => chk('spr-switch', s.name, !p.off.includes(s.name), s.name)).join('')}</div>` : ''}`
            : `<p class="mu-muted">${WF.for ? 'Reading the workflow… (if this stays, the file is missing or not in API format)' : ''}</p>`}
        <label class="mu-check"><input type="checkbox" data-input="spr-avatar" ${p.avatar ? 'checked' : ''}><span>Give the world's people a card picture from their sprite<small>Only the people a world made (they start with an initials picture), once.</small></span></label>
        ${looks.length ? `<h4>Looks written so far</h4><div class="mu-sprlooks">${looks.map(([k, s]) => `<button class="mu-chip" data-act="spr-open" data-who="${esc(k)}" title="Open their Expressions page"><span data-notr>${esc(s.name)}</span>${s.drawn ? '' : ' · not drawn'}</button>`).join('')}</div>` : ''}
    </section>`;
}

const toggle = (list: string[] | null, all: string[], v: string, on: boolean) => {
    const cur = new Set(list ?? all); if (on) cur.add(v); else cur.delete(v);
    return all.every(x => cur.has(x)) ? null : all.filter(x => cur.has(x));
};
const orderOf = (el: HTMLElement, extra: Partial<Order> = {}): Order => ({ who: el.dataset.who!, ...extra });
const oneOutfit = (el: HTMLElement) => { const i = Number(el.dataset.o); return i >= 0 ? [i] : undefined; };
Object.assign(ACT, {
    'spr-draw': (el) => { const a = el.dataset.who!; S.status.delete(a); enqueue(orderOf(el)); },
    'spr-draw-all': (el) => enqueue(orderOf(el)),
    'spr-draw-missing': (el) => enqueue(orderOf(el, { outfits: oneOutfit(el), missing: true })),
    'spr-draw-outfit': (el) => enqueue(orderOf(el, { outfits: oneOutfit(el) })),
    'spr-draw-one': (el) => enqueue(orderOf(el, { outfits: oneOutfit(el), labels: [el.dataset.l!] })),
    'spr-look': (el) => enqueue(orderOf(el, { lookOnly: true })),
    'spr-newface': (el) => { const s = sprPrefs().sheets[el.dataset.who!]; if (s) { s.seed = newSeed(); saveSettings(); } enqueue(orderOf(el)); },
    'spr-open': async (el) => { const m = await import('./library.js'); m.openExpressions(el.dataset.who!); },
});
// Draws everyone in a list (the Library's "No sprites" filter): their neutral sprite first, then the rest.
export function drawEveryone(keys: string[]) {
    const list = keys.filter(k => exists(k) && !waiting(k));
    for (const k of list) { S.status.set(k, 'queued'); S.queue.push({ who: k, labels: ['neutral'], outfits: [0] }); }
    for (const k of list) S.queue.push({ who: k, missing: true });
    notify(); void pump();
    return list.length;
}
Object.assign(INPUT, {
    'spr-mode': (el) => { sprPrefs().mode = el.value as Mode; saveSettings(); notify(); if (game()) void import('../sim/game.js').then(m => m.syncScene()); },
    'spr-wf': (el) => { sprPrefs().workflow = el.value; saveSettings(); notify(); },
    'spr-url': (el) => { sprPrefs().url = el.value.trim(); saveSettings(); },
    'spr-avatar': (el) => { sprPrefs().avatar = el.checked; saveSettings(); },
    'spr-labels': (el) => { const p = sprPrefs(); p.labels = el.value === 'pick' ? (WF.parts ? WF.parts.expr.map(e => e.label) : []) : el.value as 'workflow' | 'all'; saveSettings(); notify(); },
    'spr-label': (el) => { const p = sprPrefs(); const l = Array.isArray(p.labels) ? p.labels : []; p.labels = el.checked ? [...new Set([...l, el.dataset.v!])] : l.filter(x => x !== el.dataset.v); saveSettings(); },
    'spr-tags': (el) => {
        const p = sprPrefs();
        for (const line of el.value.split('\n')) { const m = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/); if (!m) continue; const l = m[1].toLowerCase(); if (m[2].trim() === (DEFAULT_TAGS[l] ?? '')) delete p.tags[l]; else p.tags[l] = m[2].trim(); }
        saveSettings();
    },
    'spr-outfits': (el) => { const all = WF.parts?.outfits.slice(1).map(o => o.name) ?? []; sprPrefs().outfits = toggle(sprPrefs().outfits, all, el.dataset.v!, el.checked); saveSettings(); },
    'spr-switch': (el) => { const p = sprPrefs(); p.off = el.checked ? p.off.filter(x => x !== el.dataset.v) : [...new Set([...p.off, el.dataset.v!])]; saveSettings(); },
    'spr-sheet': (el) => {
        const s = sprPrefs().sheets[el.dataset.who!]; if (!s) return;
        const k = el.dataset.k!;
        if (k === 'appearance') s.appearance = el.value.trim(); else if (s.outfits[Number(k)]) s.outfits[Number(k)].tags = el.value.trim();
        saveSettings();
    },
});
