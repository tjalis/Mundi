// LoRAs on the player's ComfyUI, picked in Settings › Add-ons. Mundi asks ComfyUI which LoRAs it has, and adds the
// ones picked here to every picture it draws (sprites, CG, world maps: each LoRA says which), whatever the workflow:
// a chain of LoRA loaders goes right after the workflow's own LoRAs, or after its checkpoint when it has none.
// The workflow's own LoRAs (LoRA Loader and rgthree's Power Lora Loader nodes) can be turned off or given another
// strength here too, without editing the workflow.
import { settings, saveSettings, notify, toast, esc } from '../core/store.js';
import { comfyUrl, sprPrefs, loadWorkflow, type Graph } from './spritegen.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

/** What a picture is for: each LoRA is used for the kinds turned on. */
export type Kind = 'sprites' | 'cg' | 'maps';
const KINDS: [Kind, string][] = [['sprites', 'Sprites'], ['cg', 'CG'], ['maps', 'Maps']];
interface Lora { name: string; strength: number; clip: number; on: boolean; for: Kind[] }
interface Prefs {
    added: Lora[];
    /** the workflow's own LoRAs, by file: turned off, or another strength */
    own: Record<string, { on: boolean; strength?: number }>;
}
export const loraPrefs = (): Prefs => {
    const s = settings() as any;
    const p = (s.loras ??= {}) as Prefs;
    p.added ??= []; p.own ??= {};
    return p;
};

/* ---------- what ComfyUI has ---------- */

const L = { list: null as string[] | null, for: '', err: '', draft: '', own: null as { name: string; strength: number; on: boolean }[] | null, ownFor: '' };
async function fetchLoras(): Promise<string[]> {
    const res = await fetch(`${comfyUrl()}/object_info/LoraLoader`);
    if (!res.ok) throw new Error(`ComfyUI answered ${res.status}`);
    const d = await res.json();
    const l = d?.LoraLoader?.input?.required?.lora_name?.[0];
    return Array.isArray(l) ? l.map(String) : [];
}
function readLoras(force = false) {
    const url = comfyUrl();
    if (!force && L.for === url) return;
    L.for = url; L.list = null; L.err = '';
    void fetchLoras().then(l => { L.list = l; }).catch(e => { L.list = []; L.err = String(e?.message ?? e); }).finally(notify);
}
// The sprite workflow's own LoRAs, as Settings shows them.
function readOwn() {
    const wf = sprPrefs().workflow;
    if (L.ownFor === wf) return;
    L.ownFor = wf; L.own = null;
    void loadWorkflow(wf).then(g => { L.own = ownLoras(g); }).catch(() => { L.own = []; }).finally(notify);
}
function ownLoras(g: Graph) {
    const out: { name: string; strength: number; on: boolean }[] = [];
    for (const n of Object.values(g)) {
        if (/^LoraLoader/.test(n.class_type) && typeof n.inputs?.lora_name === 'string') out.push({ name: n.inputs.lora_name, strength: Number(n.inputs.strength_model ?? 1), on: true });
        if (/power lora loader/i.test(n.class_type)) for (const v of Object.values(n.inputs ?? {})) if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.lora === 'string' && v.lora && v.lora !== 'None') out.push({ name: v.lora, strength: Number(v.strength ?? 1), on: v.on !== false });
    }
    return out;
}
const short = (f: string) => f.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');

/* ---------- into a workflow ---------- */

const isLink = (v: any) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';
const LOADERS = /^(CheckpointLoaderSimple|CheckpointLoader|ImageOnlyCheckpointLoader|UNETLoader|UnetLoaderGGUF|CheckpointLoaderNF4)/;
const isLoraNode = (n: Graph[string]) => /^LoraLoader/.test(n.class_type) || /power lora loader/i.test(n.class_type);

/** The graph with the LoRAs picked for this kind of picture (and the workflow's own as set here). Changes `g`. */
export function withLoras(g: Graph, kind: Kind): Graph {
    const p = loraPrefs();
    // the workflow's own: off, or another strength
    for (const n of Object.values(g)) {
        if (/^LoraLoader/.test(n.class_type) && typeof n.inputs?.lora_name === 'string') {
            const o = p.own[n.inputs.lora_name]; if (!o) continue;
            if (!o.on) { n.inputs.strength_model = 0; if ('strength_clip' in n.inputs) n.inputs.strength_clip = 0; }
            else if (o.strength !== undefined) { n.inputs.strength_model = o.strength; if ('strength_clip' in n.inputs) n.inputs.strength_clip = o.strength; }
        }
        if (/power lora loader/i.test(n.class_type)) for (const v of Object.values(n.inputs ?? {})) {
            if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.lora !== 'string') continue;
            const o = p.own[v.lora]; if (!o) continue;
            v.on = o.on; if (o.strength !== undefined) v.strength = o.strength;
        }
    }
    const add = p.added.filter(l => l.on && l.for.includes(kind) && l.name);
    if (!add.length) return g;
    // where the model comes from: the last of the workflow's LoRAs (one no other LoRA node reads), else its checkpoint
    const ids = Object.keys(g);
    const readBy = (id: string) => ids.filter(x => Object.values(g[x].inputs ?? {}).some(v => isLink(v) && v[0] === id));
    const loras = ids.filter(id => isLoraNode(g[id]));
    const root = loras.find(id => !readBy(id).some(x => isLoraNode(g[x]))) ?? ids.find(id => LOADERS.test(g[id].class_type));
    if (!root) { toast('The workflow has no checkpoint loader, so Mundi\'s LoRAs were not added.', 'warn'); return g; }
    // a model-only source (UNETLoader, a model-only LoRA) has no CLIP to pass on
    const hasClip = !/^(UNETLoader|UnetLoaderGGUF|LoraLoaderModelOnly)/.test(g[root].class_type);
    let model: [string, number] = [root, 0], clip: [string, number] = [root, 1];
    add.forEach((l, i) => {
        const id = `mundi_lora_${i + 1}`;
        g[id] = hasClip
            ? { class_type: 'LoraLoader', inputs: { lora_name: l.name, strength_model: l.strength, strength_clip: l.clip, model, clip }, _meta: { title: `Mundi LoRA: ${short(l.name)}` } }
            : { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: l.name, strength_model: l.strength, model }, _meta: { title: `Mundi LoRA: ${short(l.name)}` } };
        model = [id, 0]; clip = [id, 1];
    });
    // everything that read the root's model (and CLIP) now reads the last LoRA's
    for (const [id, n] of Object.entries(g)) {
        if (id.startsWith('mundi_lora_')) continue;
        for (const [k, v] of Object.entries(n.inputs ?? {})) {
            if (!isLink(v) || v[0] !== root) continue;
            if (v[1] === 0) n.inputs[k] = model;
            else if (v[1] === 1 && hasClip) n.inputs[k] = clip;
        }
    }
    return g;
}

/* ---------- Settings › Add-ons ---------- */

export function lorasSettingsHtml(): string {
    const p = loraPrefs(); readLoras(); readOwn();
    const list = L.list;
    const row = (l: Lora, i: number) => `<div class="mu-lora ${l.on ? '' : 'is-off'}">
        <label class="mu-check" title="${esc(l.name)}"><input type="checkbox" data-input="lora-on" data-i="${esc(i)}" ${l.on ? 'checked' : ''}><span data-notr>${esc(short(l.name))}</span></label>
        ${list && list.length && !list.includes(l.name) ? `<span class="mu-addon-state is-warn">Not in ComfyUI</span>` : ''}
        <label class="mu-lora-num" title="Strength on the model"><span>Model</span><input type="number" min="-4" max="4" step="0.05" value="${l.strength}" data-input="lora-str" data-i="${esc(i)}"></label>
        <label class="mu-lora-num" title="Strength on the text encoder (CLIP)"><span>CLIP</span><input type="number" min="-4" max="4" step="0.05" value="${l.clip}" data-input="lora-clip" data-i="${esc(i)}"></label>
        <span class="mu-lora-for">${KINDS.map(([k, n]) => `<label class="mu-check"><input type="checkbox" data-input="lora-for" data-i="${esc(i)}" data-v="${esc(k)}" ${l.for.includes(k) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</span>
        <button class="mu-ibtn mu-ghost" data-act="lora-del" data-i="${esc(i)}" title="Remove">${icon('x')}</button></div>`;
    const own = L.own ?? [];
    return `<section><h3>LoRAs</h3><p class="mu-muted">LoRAs from your ComfyUI (<b data-notr>${esc(comfyUrl())}</b>) added to what Mundi draws: sprites, CG pictures and world maps, each as you pick. They go after the workflow's own LoRAs. A LoRA's trigger words still belong in the prompt or the look's tags.</p>
        <div class="mu-field"><span>Add a LoRA ${list ? `· ${list.length} in ComfyUI` : '· asking ComfyUI…'}</span>
            <div class="mu-row mu-lora-add"><input type="text" list="mu-lora-list" placeholder="Type to search, e.g. Illustrious\\…" value="${esc(L.draft)}" data-input="lora-draft" data-notr>
                <button class="mu-ghost" data-act="lora-add">${icon('plus')}<span>Add</span></button>
                <button class="mu-ghost" data-act="lora-reload" title="Ask ComfyUI again">${icon('repost')}</button></div>
            <datalist id="mu-lora-list">${(list ?? []).map(f => `<option value="${esc(f)}"></option>`).join('')}</datalist>
            ${L.err ? `<p class="mu-muted">Could not ask ComfyUI for its LoRAs (${esc(L.err)}). Is it running at that address?</p>` : ''}</div>
        ${p.added.length ? `<div class="mu-loras">${p.added.map(row).join('')}</div>` : '<p class="mu-muted">None added yet.</p>'}
        ${own.length ? `<details class="mu-sprsheet"><summary>The sprite workflow's own LoRAs (${own.length})</summary>
            <p class="mu-muted">Set in <span data-notr>${esc(sprPrefs().workflow)}</span>. Turn one off or change its strength for Mundi's pictures, without editing the workflow.</p>
            <div class="mu-loras">${own.map(o => {
                const s = p.own[o.name]; const on = s ? s.on : o.on; const str = s?.strength ?? o.strength;
                return `<div class="mu-lora ${on ? '' : 'is-off'}"><label class="mu-check" title="${esc(o.name)}"><input type="checkbox" data-input="lora-own-on" data-v="${esc(o.name)}" data-was="${esc(o.on)}" ${on ? 'checked' : ''}><span data-notr>${esc(short(o.name))}</span></label>
                    <label class="mu-lora-num"><span>Strength</span><input type="number" min="-4" max="4" step="0.05" value="${str}" data-input="lora-own-str" data-v="${esc(o.name)}" data-was="${esc(o.strength)}"></label></div>`;
            }).join('')}</div></details>` : ''}
    </section>`;
}

const num = (v: string, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(-4, Math.min(4, n)) : d; };
const at = (el: HTMLElement) => loraPrefs().added[Number(el.dataset.i)];
function addDraft() {
    const name = L.draft.trim(); if (!name) return;
    const p = loraPrefs();
    // what was typed, else the one file it matches
    const list = L.list ?? [];
    const hit = list.includes(name) ? name : list.filter(f => f.toLowerCase().includes(name.toLowerCase()));
    const file = typeof hit === 'string' ? hit : hit.length === 1 ? hit[0] : '';
    if (!file) { toast(typeof hit === 'string' || !hit.length ? `ComfyUI has no LoRA "${name}".` : `${hit.length} LoRAs match "${name}": pick one from the list.`, 'warn'); return; }
    if (p.added.some(l => l.name === file)) { toast('That LoRA is already added.', 'info'); return; }
    p.added.push({ name: file, strength: 0.8, clip: 0.8, on: true, for: ['sprites', 'cg'] });
    L.draft = ''; saveSettings(); notify();
}
Object.assign(ACT, {
    'lora-add': () => addDraft(),
    'lora-reload': () => { readLoras(true); L.ownFor = ''; notify(); },
    'lora-del': (el) => { loraPrefs().added.splice(Number(el.dataset.i), 1); saveSettings(); notify(); },
});
Object.assign(INPUT, {
    // picking from the list adds it right away; typing only remembers it until Add
    'lora-draft': (el) => { L.draft = el.value; if (L.list?.includes(el.value.trim())) addDraft(); },
    'lora-on': (el) => { const l = at(el); if (l) { l.on = el.checked; saveSettings(); notify(); } },
    'lora-str': (el) => { const l = at(el); if (l) { l.strength = num(el.value, l.strength); saveSettings(); } },
    'lora-clip': (el) => { const l = at(el); if (l) { l.clip = num(el.value, l.clip); saveSettings(); } },
    'lora-for': (el) => { const l = at(el); if (!l) return; const k = el.dataset.v as Kind; l.for = el.checked ? [...new Set([...l.for, k])] : l.for.filter(x => x !== k); saveSettings(); },
    'lora-own-on': (el) => {
        const p = loraPrefs(); const n = el.dataset.v!; const o = (p.own[n] ??= { on: el.dataset.was === 'true' });
        o.on = el.checked;
        if (o.on === (el.dataset.was === 'true') && o.strength === undefined) delete p.own[n];
        saveSettings(); notify();
    },
    'lora-own-str': (el) => {
        const p = loraPrefs(); const n = el.dataset.v!; const was = Number(el.dataset.was);
        const o = (p.own[n] ??= { on: true }); o.strength = num(el.value, was);
        if (o.strength === was) { delete o.strength; if (o.on) delete p.own[n]; }
        saveSettings();
    },
});
