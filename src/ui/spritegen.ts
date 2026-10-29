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
// Only the nodes a picture needs are sent, so other parts of the workflow (a base frame) never run.
// A CG section ("Position N (…)" nodes as "name: tags", gathered in a list node, and a "Save CG" node) is drawn
// too, one picture per position, into the person's "cg" subfolder (not an outfit: the scene never wears it). It
// uses the look's appearance and usual outfit (for the face) and the same seed. Never for a minor or a child's look.
// A "State" node (its tags joined after the outfit's) draws a condition on an outfit (wet, muddy, hurt…): the scene's
// looks (sim/looks.ts) ask for a variant folder ("swimsuit+wet") when the story or the weather calls for one. A
// workflow without it gets the condition's tags added to the outfit's instead.
import { settings, saveSettings, notify, state, toast, esc, game } from '../core/store.js';
import { ctx, charOf, fetchSprites, uploadSprite, fullCharacter, setCharacterImage, quiet, expressionLabels, personas, personaName, outfitOf, wearOutfit } from '../st/bridge.js';
import { addOutfit, forgetOutfits, savedOutfits, outfitsOf, hasOutfit } from './outfits.js';
import { lookPrefs, stateTags, stateNames, matchOutfit, RULE_LABELS, STATES, type LookDeps } from '../sim/looks.js';
import { isMinor } from '../sim/family.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

type Mode = 'off' | 'ask' | 'auto';
interface Sheet {
    name: string; appearance: string; outfits: { name: string; tags: string }[]; seed: number; drawn?: number; avatarSet?: boolean;
    /** what they always wear, whatever the outfit (a hijab, glasses, a necklace…): tags, '' for nothing; unset: not asked yet */
    keeps?: string;
    /** their personal style in a few words (streetwear, dark colors): every outfit written for them follows it */
    style?: string;
}
// An outfit's tags with what they always wear (the ones it does not have already).
export function withKeeps(tags: string, keeps = ''): string {
    const norm = (t: string) => t.trim().toLowerCase().replace(/[\s_]+/g, ' ');
    const have = new Set(tags.split(',').map(norm));
    const add = keeps.split(',').map(t => t.trim()).filter(t => t && !have.has(norm(t)));
    return add.length ? [tags.trim(), ...add].filter(Boolean).join(', ') : tags;
}
const noneish = (v: string) => /^(none|nothing|n\/a|-)?\.?$/i.test(v.trim());
interface Prefs {
    mode: Mode; workflow: string; url: string; outfits: string[] | null; off: string[]; avatar: boolean; sheets: Record<string, Sheet>;
    /** which expressions: the workflow's own, all of SillyTavern's, or a list of labels */
    labels: 'workflow' | 'all' | string[]; tags: Record<string, string>; expressions?: string[] | null;
    /** CG pictures: drawn with "Draw all" too, and the positions turned off */
    cg: boolean; cgOff: string[];
}

export const sprPrefs = (): Prefs => {
    const s = settings() as any;
    const p = (s.sprites ??= {}) as Prefs;
    p.mode ??= 'ask'; p.workflow ??= 'Character.modular.workflow.json'; p.url ??= '';
    p.outfits ??= null; p.off ??= []; p.avatar ??= true; p.sheets ??= {}; p.tags ??= {};
    p.cg ??= true; p.cgOff ??= [];
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
interface Parts {
    appearance: string[]; outfits: { id: string; name: string; tags: string }[]; list: string | null; seed: string | null; expr: Expr[]; folder: string | null; switches: { id: string; name: string }[]; state: string | null;
    /** the CG section: its positions, their list node, its Save node and its file prefix node */
    cg: { positions: { id: string; name: string; tags: string }[]; list: string | null; save: string; prefix: string | null } | null;
}
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
    const positions = ids.filter(id => /^position\s*\d+/i.test(titleOf(g, id)) && typeof g[id].inputs?.value === 'string')
        .sort((a, b) => numIn(titleOf(g, a)) - numIn(titleOf(g, b)))
        .map(id => ({ id, ...splitOutfit(g[id].inputs.value) }))
        .map((o, k) => ({ ...o, name: (o.name || `position${k + 1}`).replace(/[\\/:*?"<>|]+/g, '') }));
    const pset = new Set(positions.map(o => o.id));
    const cgSave = ids.find(id => /^save\s*cg/i.test(titleOf(g, id).trim()));
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
        state: ids.find(id => /^state$/i.test(titleOf(g, id).trim()) && typeof g[id].inputs?.value === 'string') ?? null,
        switches: ids.filter(id => /any switch/i.test(g[id].class_type) && /on\/off|\(on, else/i.test(titleOf(g, id)) && isLink(g[id].inputs?.any_01))
            .map(id => ({ id, name: titleOf(g, id).replace(/\s*\(.*$/, '').replace(/\s*on\/off.*$/i, '').trim() })),
        cg: positions.length && cgSave ? {
            positions, save: cgSave,
            list: ids.find(id => Object.values(g[id].inputs ?? {}).some(v => isLink(v) && pset.has(v[0]))) ?? null,
            prefix: ids.find(id => /^cg file prefix$/i.test(titleOf(g, id).trim())) ?? null,
        } : null,
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

// One ComfyUI job: one picture (an outfit, a condition's tags or none, and a label). Returns the graph and the Save
// node that gives it.
function job(base: Graph, p: Parts, sheet: Sheet, outfit: number, label: string, cond = ''): { graph: Graph; save: string } {
    const g = structuredClone(base);
    for (const id of p.appearance) g[id].inputs.value = sheet.appearance;
    if (p.seed) g[p.seed].inputs.seed = sheet.seed;
    const slot = p.outfits[0];
    const o = sheet.outfits[outfit];
    if (slot && o) {
        g[slot.id].inputs.value = `${o.name}: ${withKeeps(o.tags, sheet.keeps)}${cond && !p.state ? `, ${cond}` : ''}`;
        if (p.list) { const l = g[p.list]; for (const k of Object.keys(l.inputs)) if (isLink(l.inputs[k])) delete l.inputs[k]; l.inputs.value1 = [slot.id, 0]; }
    }
    if (p.state) g[p.state].inputs.value = cond;
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

// One CG picture: one position, with the look's appearance, its usual outfit (the CG face pass uses it) and seed.
function cgJob(base: Graph, p: Parts, sheet: Sheet, pos: number): { graph: Graph; save: string } {
    const cg = p.cg!; const g = structuredClone(base);
    for (const id of p.appearance) g[id].inputs.value = sheet.appearance;
    if (p.seed) g[p.seed].inputs.seed = sheet.seed;
    const slot = p.outfits[0], o = sheet.outfits[0];
    if (slot && o) g[slot.id].inputs.value = `${o.name}: ${withKeeps(o.tags, sheet.keeps)}`;
    const one = cg.positions[pos];
    if (cg.list) { const l = g[cg.list]; for (const k of Object.keys(l.inputs)) if (isLink(l.inputs[k])) delete l.inputs[k]; l.inputs.value1 = [one.id, 0]; }
    if (cg.prefix) { const f = g[cg.prefix].inputs; const key = Object.keys(f).find(k => typeof f[k] === 'string'); if (key) f[key] = `Mundi/${sheet.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}/cg/`; }
    for (const s of p.switches) if (sprPrefs().off.includes(s.name)) delete g[s.id].inputs.any_01;
    return { graph: prune(g, [cg.save]), save: cg.save };
}
export const CG_FOLDER = 'cg';
// Tags that mean a child: no CG for a look that has them.
const CHILD = /(^|[\s,(])(loli|shota|child|kid|toddler|baby|infant|preteen|underage|minor|aged_down|elementary_school|middle_school|young_(girl|boy)|little_(girl|boy))($|[\s,):])/i;
// Why there can be no CG of this person ('' when there can): a child of yours not grown up yet, or a look with a
// child's tags.
export function cgBlocked(k: string): string {
    const g = game();
    if (g && !personaOf(k) && isMinor(g, k)) return `${nameOf(k)} is a minor`;
    const s = sprPrefs().sheets[k];
    if (s && CHILD.test(s.appearance.replace(/\s*,\s*/g, ',').replace(/\s+/g, '_'))) return `${nameOf(k)}'s look has a child's tags`;
    return '';
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
style: <${name}'s personal style in a few plain words (streetwear, dark colors; preppy; practical workwear…), from the card or chosen to fit them>
always: <what ${name} wears whatever the outfit, if the card says so: a hijab or other religious headwear, glasses, a necklace or keepsake they never take off, a prosthetic… or none>

Comma-separated tags only, no sentences (the style line: a few plain words). Every outfit fits the style. Take every detail the card gives; invent the rest so it fits the character. What is in "always" is part of every outfit too.`;
    const raw = await quiet(prompt, 600);
    const lines = new Map(raw.split('\n').map(l => l.match(/^\s*[-*]?\s*([^:\n]+?)\s*:\s*(.+)$/)).filter(Boolean).map(m => [m![1].toLowerCase(), m![2].trim()]));
    const appearance = lines.get('appearance') ?? '';
    if (!appearance) throw new Error(`The AI did not describe ${name}.`);
    const always = lines.get('always') ?? '', style = lines.get('style') ?? '';
    return { name, appearance, style: noneish(style) ? '' : style.slice(0, 120), outfits: slots.map(o => ({ name: o.name, tags: lines.get(o.name.toLowerCase()) ?? o.tags })), seed: newSeed(), keeps: !lines.has('always') ? undefined : noneish(always) ? '' : always.slice(0, 300) };
}
// A look written before "always wears" existed: asked once, from the card and the usual clothes.
async function writeKeeps(k: string, sheet: Sheet): Promise<void> {
    if (sheet.keeps !== undefined) return;
    const name = nameOf(k);
    const card = (await cardText(k)).slice(0, 3000);
    const raw = await quiet(`What does ${name} always wear, whatever the outfit? For example a hijab or other religious headwear, glasses, a necklace or keepsake they never take off, a prosthetic. Only what the card says.

<character>
${card || name}
</character>
Their usual clothes: ${sheet.outfits[0]?.tags ?? ''}

Answer with one line of comma-separated Danbooru tags, or: none`, 120);
    const line = raw.split('\n').map(l => l.replace(/^\s*[-*]?\s*(always[^:]*:)?\s*/i, '').trim()).find(Boolean) ?? '';
    sheet.keeps = noneish(line) ? '' : line.slice(0, 300);
    saveSettings();
}
const newSeed = () => Math.floor(Math.random() * 2 ** 31);
// A new outfit for a look (the story put on a kimono, a rule wants a swimsuit): the AI writes only the clothes.
// `fresh`: rewritten for a new style, so their current clothes are not shown as the example.
async function writeOutfit(k: string, sheet: Sheet, outfit: string, fresh = false): Promise<string> {
    const name = nameOf(k);
    const card = (await cardText(k)).slice(0, 3000);
    const raw = await quiet(`Write what ${name} wears for "${outfit.replace(/[_-]+/g, ' ')}" as Danbooru tags for an image model (Illustrious).

<character>
${card || name}
</character>
Their body and face (do not repeat these): ${sheet.appearance}
${fresh ? '' : `Their usual clothes: ${sheet.outfits[0]?.tags ?? ''}\n`}${sheet.style ? `Their style: ${sheet.style}. The outfit fits it.\n` : ''}${sheet.keeps ? `They always wear, whatever the outfit: ${sheet.keeps}. Keep these in it, and make the outfit go with them (modest swimwear with a hijab, say).\n` : ''}
Answer with one line of comma-separated tags for the clothes only (garments, colors, shoes, accessories), in their style, nothing about the body or face, no sentences.`, 200);
    const line = raw.split('\n').map(l => l.replace(/^\s*[-*]?\s*([^:,\n]{1,30}:)?\s*/, '').trim()).find(l => l.includes(',') || l.length > 3) ?? '';
    if (!line) throw new Error(`The AI did not describe ${name}'s ${outfit}.`);
    return line.slice(0, 600);
}

/* ---------- the queue ---------- */

// What to draw: some outfits (indexes in the look; all the chosen ones when left out) and labels, or only the missing.
interface Order { who: string; outfits?: number[]; labels?: string[]; missing?: boolean; lookOnly?: boolean; variant?: Variant; cg?: 'only' | 'also'; restyle?: boolean }
// A look the scene asked for: an outfit by name ('' the usual one) with a condition or none, saved in `folder`.
interface Variant { outfit: string; state: string; folder: string }
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
        if (o.variant) { if (n && o.labels) toast(`${name}: new look drawn (${o.variant.folder.replace(/[_]+/g, ' ')}).`, 'success'); }
        else if (o.cg === 'only') toast(n ? `${name}: ${n === 1 ? '1 CG picture' : `${n} CG pictures`} drawn.` : `${name} has every CG picture already.`, 'success');
        else if (!o.lookOnly) toast(n ? `${name}: ${n === 1 ? '1 picture' : `${n} pictures`} drawn.` : `${name} has every sprite already.`, 'success');
    } catch (e: any) {
        // a look that failed leaves their own sprites as they were
        S.status.set(o.who, o.variant && (await fetchSprites(o.who, '').catch(() => [])).length ? 'has' : 'failed');
        if (o.variant) S.queue = S.queue.filter(x => !(x.who === o.who && x.variant?.folder === o.variant!.folder));
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
    await writeKeeps(o.who, sheet).catch(() => {});   // asked once; drawing goes on without it
    if (o.restyle) {   // a new style: every outfit written again in it, then drawn
        for (const x of sheet.outfits) { S.now = `writing the ${x.name} outfit in their style`; notify(); x.tags = await writeOutfit(o.who, sheet, x.name, true); }
        saveSettings();
    }
    if (o.lookOnly) return 0;
    if (o.variant) return drawVariant(o, o.variant, base, p, sheet);
    if (o.cg === 'only') return drawCg(o, base, p, sheet);
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
    // "Draw all" (nothing picked) also draws the CG pictures, when the workflow has them and Settings allow it
    const all = !o.labels && !o.outfits && !o.missing;
    if ((o.cg === 'also' || (all && prefs.cg)) && p.cg && !cgBlocked(o.who)) done += await drawCg(o, base, p, sheet, done);
    return done;
}

// The CG pictures: every position turned on (or only the missing ones), saved in the person's "cg" folder.
async function drawCg(o: Order, base: Graph, p: Parts, sheet: Sheet, before = 0): Promise<number> {
    if (!p.cg) throw new Error('the workflow has no CG section ("Position N (…)" nodes and a "Save CG" node).');
    const why = cgBlocked(o.who); if (why) throw new Error(`no CG pictures: ${why}.`);
    let todo = p.cg.positions.map((x, i) => i).filter(i => !sprPrefs().cgOff.includes(p.cg!.positions[i].name));
    if (o.missing) { const have = new Set((await fetchSprites(o.who, CG_FOLDER)).map(s => String(s.label))); todo = todo.filter(i => !have.has(p.cg!.positions[i].name)); }
    let done = 0;
    for (const i of todo) {
        const pos = p.cg.positions[i].name;
        S.step = `${before + done}/${before + todo.length}`; S.now = `CG · ${pos}`; notify();
        const { graph, save } = cgJob(base, p, sheet, i);
        const png = (await runJob(graph))[save];
        if (!png) throw new Error('ComfyUI gave no picture.');
        await uploadSprite(o.who, pos, png, pos, CG_FOLDER);
        done++;
        refreshed(o.who);
    }
    return done;
}

// A look the scene asked for: one outfit (written by the AI first when the look has none of that name) with a
// condition or none, saved as its own folder. Neutral comes first; the scene puts it on as soon as it is in.
async function drawVariant(o: Order, v: Variant, base: Graph, p: Parts, sheet: Sheet): Promise<number> {
    let i = 0;
    if (v.outfit) {
        // the look's own outfit of that name (or one that means the same: "swim" for a swimsuit), else a new one
        const same = matchOutfit(v.outfit, sheet.outfits.map(x => x.name));
        i = same ? sheet.outfits.findIndex(x => x.name === same) : -1;
        if (i < 0) {
            sheet.outfits.push({ name: v.outfit, tags: await writeOutfit(o.who, sheet, v.outfit) });
            i = sheet.outfits.length - 1; saveSettings();
        }
    }
    const tags = v.state ? stateTags(v.state) : '';
    let todo = o.labels ?? labelsFor(p);
    todo = [...todo].sort((a, b) => Number(b === 'neutral') - Number(a === 'neutral'));
    if (o.missing) { const have = new Set((await fetchSprites(o.who, v.folder)).map(s => String(s.label))); todo = todo.filter(l => !have.has(l)); }
    let done = 0;
    for (const l of todo) {
        S.step = `${done}/${todo.length}`; S.now = `${v.folder} · ${l}`; notify();
        const { graph, save } = job(base, p, sheet, i, l, tags);
        const png = (await runJob(graph))[save];
        if (!png) throw new Error('ComfyUI gave no picture.');
        await uploadSprite(o.who, l, png, l, v.folder);
        done++;
        addOutfit(o.who, v.folder);
        refreshed(o.who);
        if (done === 1) void import('../sim/game.js').then(m => m.syncScene());   // the first picture is in: wear it
    }
    return done;
}

/* ---------- scene looks: drawing what is missing ---------- */

// Session only: looks already asked for (one try each; a failure is not tried again until Mundi reloads).
const ASKED = new Set<string>();
let capWarned = '';
// Draws a look the scene wants and nobody has drawn yet, if the settings allow it.
function drawLook(a: string, v: Variant) {
    const lp = lookPrefs(), sp = sprPrefs();
    if (!lp.draw || sp.mode === 'off' || a.startsWith('__tut:') || !charOf(a)) return;
    // someone with sprites of their own (not drawn here) would get a ComfyUI face in the new pictures
    if (!sp.sheets[a] && !lp.others && S.status.get(a) !== 'none') return;
    const key = `${a}|${v.folder.toLowerCase()}`;
    if (ASKED.has(key) || waiting(a)) return;   // one order per person at a time: the next scene sync asks again
    const today = new Date().toDateString();
    if (lp.used.day !== today) lp.used = { day: today, n: 0 };
    if (lp.cap > 0 && lp.used.n >= lp.cap) {
        if (capWarned !== today) { capWarned = today; toast(`New looks drawn today: ${lp.cap} (the limit in Settings › Add-ons › Sprites). The rest wait until tomorrow.`, 'info'); }
        return;
    }
    ASKED.add(key); lp.used.n++; saveSettings();
    S.status.set(a, 'queued');
    S.queue.push({ who: a, variant: v, labels: ['neutral'] }, { who: a, variant: v, missing: true });
    notify(); void pump();
}
/** What the scene's looks need from the sprites: the outfits someone has, wearing one, drawing a missing one. */
export const lookDeps = (): LookDeps => ({
    outfits: outfitsOf, has: hasOutfit, current: outfitOf,
    wear: (a, f) => { wearOutfit(a, f); delete (state.sprites as any)[a]; },
    draw: drawLook,
});

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
        <label class="mu-field"><span>Style (every outfit written for them follows it)</span><input type="text" data-input="spr-sheet" data-who="${esc(k)}" data-k="style" value="${esc(s.style ?? '')}" placeholder="streetwear, dark colors · preppy · practical workwear…"></label>
        ${s.style ? `<div class="mu-row">${b('spr-restyle', 'Rewrite outfits in this style and redraw', 'mu-ghost')}<small class="mu-muted">New outfits follow the style by themselves; this redoes the ones they have.</small></div>` : ''}
        <label class="mu-field"><span>Always wears, whatever the outfit (a hijab, glasses, a necklace…)</span><input type="text" data-input="spr-sheet" data-who="${esc(k)}" data-k="keeps" value="${esc(s.keeps ?? '')}" placeholder="${s.keeps === undefined ? 'Asked from the card the next time they are drawn' : 'Nothing'}"></label>
        ${oi >= 0 && s.outfits[oi] ? `<label class="mu-field"><span>Outfit: <span data-notr>${esc(s.outfits[oi].name)}</span></span><textarea rows="2" data-input="spr-sheet" data-who="${esc(k)}" data-k="${oi}">${esc(s.outfits[oi].tags)}</textarea></label>`
            : `<p class="mu-muted">The look has no outfit called “${esc(outfit)}”: these pictures can be uploaded, not drawn.</p>`}
        <div class="mu-row">
            ${oi >= 0 ? `${b('spr-draw-missing', 'Draw missing', 'mu-primary')}${b('spr-draw-outfit', 'Redraw this outfit')}` : ''}
            ${b('spr-draw-all', 'Redraw everything')}${b('spr-newface', 'New face', 'mu-ghost')}
            <small class="mu-muted">Seed ${s.seed} · the same seed keeps the same face</small></div>
        ${cgRow(k, busy)}
        ${s.outfits.length > 1 ? `<small class="mu-muted">Outfits in this look: ${s.outfits.map((o, i) => `<span data-notr>${esc(o.name)}</span>${i === 0 ? ' (usual)' : ''}`).join(', ')}. Pick one above to see and edit it.</small>` : ''}
        ${state1}</section>`;
}
// The CG pictures of a look: draw them all or the missing ones (when the workflow has a CG section).
function cgRow(k: string, busy: boolean): string {
    readWorkflow();
    const n = WF.parts?.cg?.positions.filter(x => !sprPrefs().cgOff.includes(x.name)).length ?? 0;
    if (!n) return '';
    const why = cgBlocked(k);
    if (why) return `<small class="mu-muted">No CG pictures: ${esc(why)}.</small>`;
    const b = (act: string, label: string, cls = '') => `<button class="${cls}" data-act="${act}" data-who="${esc(k)}" ${busy ? 'aria-disabled="true"' : ''}>${label}</button>`;
    return `<div class="mu-row">${b('spr-draw-cg-missing', `Draw missing CG`, 'mu-primary')}${b('spr-draw-cg', `Redraw CG (${n})`)}
        <small class="mu-muted">CG pictures go in their “${CG_FOLDER}” folder and show in the Gallery${sprPrefs().cg ? ', and “Draw all” draws them too' : ''}.</small></div>`;
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
// The CG pictures of a character or persona, for the Gallery (an album of their own).
export async function spriteCgPhotos(k: string): Promise<{ url: string; caption: string }[]> {
    if (!sprPrefs().sheets[k]) return [];
    return (await fetchSprites(k, CG_FOLDER)).map(x => ({ url: String(x.path), caption: `CG · ${x.label}` }));
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
            ${parts.cg ? `<div class="mu-field"><span>CG pictures (the workflow's CG section, one per position; never for a minor or a child's look)</span>
                ${chk('spr-cg', '', p.cg, '"Draw all" draws them too')}
                ${parts.cg.positions.map(x => chk('spr-cgpos', x.name, !p.cgOff.includes(x.name), x.name)).join('')}</div>` : ''}
            ${parts.switches.length ? `<div class="mu-field"><span>Workflow options</span>${parts.switches.map(s => chk('spr-switch', s.name, !p.off.includes(s.name), s.name)).join('')}</div>` : ''}`
            : `<p class="mu-muted">${WF.for ? 'Reading the workflow… (if this stays, the file is missing or not in API format)' : ''}</p>`}
        <label class="mu-check"><input type="checkbox" data-input="spr-avatar" ${p.avatar ? 'checked' : ''}><span>Give the world's people a card picture from their sprite<small>Only the people a world made (they start with an initials picture), once.</small></span></label>
        ${looksSettingsHtml()}
        ${looks.length ? `<h4>Looks written so far</h4><div class="mu-sprlooks">${looks.map(([k, s]) => `<button class="mu-chip" data-act="spr-open" data-who="${esc(k)}" title="Open their Expressions page"><span data-notr>${esc(s.name)}</span>${s.drawn ? '' : ' · not drawn'}</button>`).join('')}</div>` : ''}
    </section>`;
}

// Scene looks: what people wear and how they look change with the scene and the story (sim/looks.ts).
function looksSettingsHtml(): string {
    const lp = lookPrefs();
    const chk = (act: string, on: boolean, label: string, hint = '') => `<label class="mu-check"><input type="checkbox" data-input="${act}" ${on ? 'checked' : ''}><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`;
    const rule = (r: (typeof lp.rules)[number], i: number) => `<div class="mu-lookrule">
        <label class="mu-check"><input type="checkbox" data-input="look-rule-on" data-i="${i}" ${r.on ? 'checked' : ''}><span>${esc(RULE_LABELS[r.id] ?? r.id)}</span></label>
        ${r.places !== undefined ? `<input type="text" data-input="look-rule-places" data-i="${i}" value="${esc(r.places)}" title="Words in the place's name, separated by commas">` : ''}
        ${r.state !== undefined
            ? `<span class="mu-muted">→ condition</span><select data-input="look-rule-state" data-i="${i}">${stateNames().map(n => `<option value="${esc(n)}" ${n === r.state ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`
            : `<span class="mu-muted">→ outfit</span><input type="text" data-input="look-rule-outfit" data-i="${i}" value="${esc(r.outfit ?? '')}" maxlength="30" placeholder="outfit name">`}</div>`;
    return `<h4>Scene looks</h4>
        <p class="mu-muted">People change clothes with the scene and the story: a swimsuit at the pool, pajamas at night, soaked after the rain, a kimono when the story puts one on. Mundi wears the outfit folder that fits (synonyms count: a "bikini" folder is a swimsuit), and draws the ones they don't have yet. The AI is told how everyone here looks.</p>
        ${chk('look-on', lp.on, 'Change how people look with the scene')}
        ${lp.on ? `${chk('look-story', lp.story, 'Read the story after each reply', 'One short AI call: who changed clothes, got wet, muddy, hurt…')}
        ${chk('look-draw', lp.draw, 'Draw looks they don\'t have yet on ComfyUI', 'An outfit, or an outfit with a condition (needs the sprite drawing above on). Until it is drawn they keep their sprite.')}
        ${lp.draw ? `${chk('look-others', lp.others, 'Also for people with sprites of their own', 'Their new pictures get a face drawn by ComfyUI, which may not match their own art.')}
        <label class="mu-field"><span>New looks drawn per day, at most (0: no limit) · ${lp.used.day === new Date().toDateString() ? lp.used.n : 0} today</span><input type="number" min="0" max="200" value="${lp.cap}" data-input="look-cap"></label>` : ''}
        <div class="mu-field"><span>Rules (the first that fits gives the outfit; the story wins over them for six hours)</span>${lp.rules.map(rule).join('')}</div>
        <details class="mu-sprsheet"><summary>Conditions and their tags (${stateNames().length})</summary>
            <p class="mu-muted">One per line, as “condition: tags”. Drawn with the workflow's "State" node (or added to the outfit's tags when it has none). A new line adds a condition the story can use.</p>
            <textarea rows="8" data-input="look-states">${esc(stateNames().map(n => `${n}: ${stateTags(n)}`).join('\n'))}</textarea></details>` : ''}`;
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
    'spr-restyle': (el) => enqueue(orderOf(el, { restyle: true })),
    'spr-draw-cg': (el) => enqueue(orderOf(el, { cg: 'only' })),
    'spr-draw-cg-missing': (el) => enqueue(orderOf(el, { cg: 'only', missing: true })),
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
// A change to the looks' settings shows in the scene (once typing stops).
let lookSync: ReturnType<typeof setTimeout> | undefined;
const lookInput = (fn: (el: HTMLInputElement) => void, redraw = false) => (el: HTMLInputElement) => {
    fn(el); saveSettings(); if (redraw) notify();
    clearTimeout(lookSync);
    lookSync = setTimeout(() => { if (game()) void import('../sim/game.js').then(m => m.syncScene()); }, 600);
};
Object.assign(INPUT, {
    'look-on': lookInput(el => { lookPrefs().on = el.checked; }, true),
    'look-story': lookInput(el => { lookPrefs().story = el.checked; }),
    'look-draw': lookInput(el => { lookPrefs().draw = el.checked; }, true),
    'look-others': lookInput(el => { lookPrefs().others = el.checked; }),
    'look-cap': lookInput(el => { lookPrefs().cap = Math.max(0, Math.min(200, Math.round(Number(el.value) || 0))); }),
    'look-rule-on': lookInput(el => { const r = lookPrefs().rules[Number(el.dataset.i)]; if (r) r.on = el.checked; }),
    'look-rule-places': lookInput(el => { const r = lookPrefs().rules[Number(el.dataset.i)]; if (r) r.places = el.value; }),
    'look-rule-outfit': lookInput(el => { const r = lookPrefs().rules[Number(el.dataset.i)]; if (r) r.outfit = el.value.trim(); }),
    'look-rule-state': lookInput(el => { const r = lookPrefs().rules[Number(el.dataset.i)]; if (r) r.state = el.value; }),
    'look-states': lookInput(el => {
        const p = lookPrefs(); const next: Record<string, string> = {};
        for (const line of el.value.split('\n')) {
            const m = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/); if (!m) continue;
            const id = m[1].toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 20); if (!id) continue;
            if (m[2].trim() !== (STATES[id]?.tags ?? '')) next[id] = m[2].trim();
        }
        p.states = next;
    }),
});
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
    'spr-cg': (el) => { sprPrefs().cg = el.checked; saveSettings(); notify(); },
    'spr-cgpos': (el) => { const p = sprPrefs(); p.cgOff = el.checked ? p.cgOff.filter(x => x !== el.dataset.v) : [...new Set([...p.cgOff, el.dataset.v!])]; saveSettings(); notify(); },
    'spr-switch': (el) => { const p = sprPrefs(); p.off = el.checked ? p.off.filter(x => x !== el.dataset.v) : [...new Set([...p.off, el.dataset.v!])]; saveSettings(); },
    'spr-sheet': (el) => {
        const s = sprPrefs().sheets[el.dataset.who!]; if (!s) return;
        const k = el.dataset.k!;
        if (k === 'appearance') s.appearance = el.value.trim(); else if (k === 'keeps') s.keeps = el.value.trim(); else if (k === 'style') { const had = !!s.style; s.style = el.value.trim(); if (had !== !!s.style) notify(); } else if (s.outfits[Number(k)]) s.outfits[Number(k)].tags = el.value.trim();
        saveSettings();
    },
});
