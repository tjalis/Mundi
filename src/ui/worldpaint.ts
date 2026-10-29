// Paint a world with ComfyUI: maps, place backgrounds and the cover, on the player's own ComfyUI.
// A map is laid out first and painted over: Mundi draws a plan where the pins already are (district zones, roads
// between places, a building at each pin, water if the world has a coast or a river), ComfyUI paints over it
// (img2img), so every pin sits on a street or a building and the names stay Mundi's own labels. Backgrounds and
// the cover are plain pictures from a prompt. Each finished picture is saved into the world straight away.
//
// The workflow is any SillyTavern ComfyUI workflow with the usual placeholders (%prompt%, %seed%, %width%…), the
// same Megumin Suite and Image Generation use: for a map Mundi turns it into img2img by itself (its empty latent
// becomes the uploaded plan, encoded). Model, sampler, steps and negative prompt come from Megumin Suite.
import { notify, esc, toast, settings, saveSettings } from '../core/store.js';
import { type WorldDef, type MapDef, type Place } from '../core/world.js';
import { ctx, quiet } from '../st/bridge.js';
import { saveWorld, uploadWorldPicture } from '../sim/creator.js';
import { comfyUrl, loadWorkflow, runJob, workflowList } from './spritegen.js';
import { CW } from './creator.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

type Graph = Record<string, { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } }>;
type Kind = 'map' | 'bg' | 'cover';
interface Item { kind: Kind; id: string; name: string; state: 'wait' | 'busy' | 'done' | 'failed'; why?: string }
interface Prefs { v?: number; workflow: string; strength: number; loras: boolean; maps: boolean; bgs: boolean; cover: boolean; redo: boolean }

export const WP = { open: false, busy: false, stop: false, items: [] as Item[], flows: [] as string[], last: '' };
const prefs = (): Prefs => {
    const p = ((settings() as any).worldPaint ??= {}) as Prefs;
    p.workflow ??= meg().currentWorkflowName || 'Default_Comfy_Workflow.json';
    // v2: the plan is a soft guide now, so ComfyUI gets more room by default (0.6 copied the plan back)
    if (p.v !== 2) { p.strength = 0.8; p.v = 2; }
    p.loras ??= false; p.maps ??= true; p.bgs ??= true; p.cover ??= true; p.redo ??= false;
    return p;
};
// Megumin Suite's image settings (its default profile), else nothing: the workflow's own values stay.
const meg = (): any => { const es = ctx().extensionSettings ?? {}; const pr = es['Megumin-Suite']?.profiles ?? {}; return pr.default?.imageGen ?? Object.values(pr).map((x: any) => x?.imageGen).find(Boolean) ?? {}; };

/* ---------- what there is to paint ---------- */

const isPainted = (f?: string) => !!f && !f.startsWith('data:');
function todo(w: WorldDef, p: Prefs): Item[] {
    const out: Item[] = [];
    if (p.cover && (p.redo || !isPainted(w.cover))) out.push({ kind: 'cover', id: '', name: 'Cover', state: 'wait' });
    if (p.maps) for (const m of w.maps) if (p.redo || !isPainted(m.image)) out.push({ kind: 'map', id: m.id, name: `Map: ${m.name}`, state: 'wait' });
    if (p.bgs) for (const pl of w.places) if (!pl.link && (p.redo || !pl.bg)) out.push({ kind: 'bg', id: pl.id, name: pl.name, state: 'wait' });
    return out;
}

/* ---------- the plan drawn under a map ---------- */

// The plan is a soft guide, not a drawing: broad colour areas (districts, woods, fields, water), winding roads and
// a darker patch where each place stands, then blurred and grained. ComfyUI keeps where things are and invents
// every building, tree and street itself; a sharp plan would be copied back as it is.
const W_PX = 1344, H_PX = 832;
const WATER = /\b(sea|ocean|coast|coastal|beach|harbou?r|port|bay|river|lake|canal|docks?|pier|shore|island)\b/i;
const RURAL = /\b(kingdom|realm|region|province|country|lands?|wilds?|valley|island|continent|empire)\b/i;
const GREEN = /\b(park|garden|forest|woods?|field|farm|meadow|grove|cemetery|camp)\b/i;
const HILLS = /\b(mountains?|hills?|peaks?|cliffs?|highlands?|ridge)\b/i;
const indoor = (m: MapDef) => (m.trip ?? 99) <= 5;
const isCountry = (w: WorldDef, m: MapDef) => {
    const pins = w.places.filter(p => p.map === m.id);
    return !m.parent && (RURAL.test(`${m.name} ${m.area ?? ''}`) || (!pins.some(p => !p.link) && pins.filter(p => p.link).length > 1 && w.style === 'medieval'));
};
function rng(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }

export async function drawPlan(w: WorldDef, m: MapDef): Promise<Blob> {
    const c = document.createElement('canvas'); c.width = W_PX; c.height = H_PX;
    const g = c.getContext('2d')!;
    const r = rng(m.id);
    const pins = w.places.filter(p => p.map === m.id);
    const pts = pins.map(p => [(p.x / 100) * W_PX, (p.y / 100) * H_PX] as const);
    // an organic patch: a few overlapping ellipses round a point
    const patch = (x: number, y: number, size: number, col: string, n = 5) => {
        g.fillStyle = col;
        for (let k = 0; k < n; k++) { g.beginPath(); g.ellipse(x + (r() - 0.5) * size, y + (r() - 0.5) * size * 0.7, size * (0.35 + r() * 0.4), size * (0.25 + r() * 0.3), r() * Math.PI, 0, Math.PI * 2); g.fill(); }
    };
    const scatter = (n: number, size: number, cols: string[], ok: (x: number, y: number) => boolean = () => true) => {
        for (let k = 0; k < n; k++) { const x = r() * W_PX, y = r() * H_PX; if (ok(x, y)) patch(x, y, size * (0.6 + r() * 0.8), cols[k % cols.length]); }
    };
    if (indoor(m)) {
        // inside a building: dark walls, a warm floor, a room of its own colour at each place, a corridor joining them
        g.fillStyle = '#5b4a3a'; g.fillRect(0, 0, W_PX, H_PX);
        g.fillStyle = '#b89c78'; g.fillRect(50, 50, W_PX - 100, H_PX - 100);
        // the rest of the floor split into plain rooms, so the building is full rather than one big hall
        for (let y = 50; y < H_PX - 50; y += 150 + r() * 60) for (let x = 50; x < W_PX - 50; x += 180 + r() * 80) {
            g.strokeStyle = '#5b4a3a'; g.lineWidth = 10; g.strokeRect(x, y, 180 + r() * 80, 150 + r() * 60);
            if (r() < 0.6) { g.fillStyle = r() < 0.5 ? '#7a5e45' : '#9a8266'; g.fillRect(x + 20 + r() * 100, y + 20 + r() * 80, 30 + r() * 30, 20 + r() * 25); }
        }
        g.strokeStyle = '#d8c3a0'; g.lineCap = 'round'; g.lineWidth = 60; road(g, pts, r);
        const floors = ['#c9a77e', '#a9b3a2', '#c2967a', '#d2bf96', '#9fa7b5'];
        pts.forEach(([x, y], i) => {
            const ww = 200 + r() * 90, hh = 150 + r() * 70;
            g.fillStyle = '#4e3f31'; g.fillRect(x - ww / 2 - 10, y - hh / 2 - 10, ww + 20, hh + 20);
            g.fillStyle = floors[i % floors.length]; g.fillRect(x - ww / 2, y - hh / 2, ww, hh);
            for (let k = 0; k < 5; k++) { g.fillStyle = r() < 0.5 ? '#6d4f36' : '#8a7058'; g.fillRect(x - ww / 2 + 15 + r() * (ww - 60), y - hh / 2 + 15 + r() * (hh - 50), 25 + r() * 25, 18 + r() * 20); }
        });
        return blob(soften(c, r));
    }
    const country = isCountry(w, m);
    const text = `${m.name} ${m.area ?? ''} ${pins.map(p => `${p.name} ${p.desc ?? ''}`).join(' ')} ${m.parent ? '' : w.setting}`;
    // water: a river winding across, or a coast along the bottom
    let water: Path2D | null = null, river = false;
    if (WATER.test(text)) {
        water = new Path2D();
        if (/\b(river|canal)\b/i.test(text)) {
            river = true;
            water.moveTo(0, H_PX * (0.3 + r() * 0.4)); water.bezierCurveTo(W_PX * 0.35, H_PX * r(), W_PX * 0.65, H_PX * r(), W_PX, H_PX * (0.3 + r() * 0.4));
        } else {
            water.moveTo(0, H_PX); for (let x = 0; x <= W_PX; x += 48) water.lineTo(x, H_PX * 0.84 - Math.sin(x / 160 + r()) * 30 - r() * 14); water.lineTo(W_PX, H_PX); water.closePath();
        }
    }
    g.lineWidth = 80;
    const wet = (x: number, y: number) => !!water && (river ? g.isPointInStroke(water, x, y) : g.isPointInPath(water, x, y));
    const dry = (x: number, y: number) => !wet(x, y);
    if (country) {
        // countryside: meadow, woods, fields, hills at the top if the world has any
        g.fillStyle = '#8fac64'; g.fillRect(0, 0, W_PX, H_PX);
        scatter(26, 120, ['#a3b86c', '#7f9e58']);
        if (HILLS.test(text)) for (let x = -40; x < W_PX; x += 110) patch(x + r() * 60, r() * 70, 170, ['#8b8473', '#9a9283', '#6f6a5c'][Math.floor(r() * 3)], 3);
        scatter(18, 110, ['#c9b866', '#b7ad5e', '#d2c27a'], dry);
        scatter(34, 130, ['#4c7238', '#56803f', '#3f6331'], dry);
    } else {
        // a town: districts of their own tone round each district pin (or a few spread out), parks, rooftops for grain
        g.fillStyle = '#a19c92'; g.fillRect(0, 0, W_PX, H_PX);
        const hubs = pts.filter((_, i) => pins[i].link);
        const centres = hubs.length >= 2 ? hubs : [0, 1, 2, 3].map(() => [r() * W_PX, r() * H_PX] as const);
        const tones = ['#ad8f7c', '#8e959e', '#a3a58e', '#b4a68e', '#8a8794', '#9c8574'];
        centres.forEach(([x, y], i) => patch(x, y, 380, tones[i % tones.length], 9));
        for (let k = 0; k < 2600; k++) { const x = r() * W_PX, y = r() * H_PX; g.fillStyle = ['#7d6e64', '#8f8f8f', '#b5aa98', '#6b7280', '#c4bcae'][k % 5]; g.fillRect(x, y, 8 + r() * 12, 6 + r() * 10); }
        scatter(6, 80, ['#7a9a62', '#6c8c58'], dry);
    }
    if (water) {
        g.fillStyle = '#5f8fb0'; g.strokeStyle = '#5f8fb0';
        if (river) { g.lineWidth = 70; g.stroke(water); } else { g.fill(water); g.fillStyle = '#d9cfa8'; g.lineWidth = 18; g.strokeStyle = '#d9cfa8'; g.stroke(water); }
        g.lineWidth = 80;
    }
    // roads between the places, then a patch at each place: a town, a park, or a big building
    g.lineCap = 'round'; g.strokeStyle = country ? '#cdb98c' : '#d9d4ca'; g.lineWidth = country ? 16 : 26; road(g, pts, r);
    pins.forEach((p, i) => {
        const [x, y] = pts[i];
        if (GREEN.test(`${p.id} ${p.name}`)) patch(x, y, 110, '#6a9152', 4);
        else if (p.link) patch(x, y, country ? 130 : 160, country ? '#8d5f48' : '#7a6f68', 6);
        else patch(x, y, 80, country ? '#946650' : '#6a5f59', 3);
    });
    return blob(soften(c, r));
}
// Roads: every place joined to its nearest neighbours (a spanning tree), each road bending a little.
function road(g: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], r: () => number) {
    if (pts.length < 2) return;
    const inTree = [0], d = (a: number, b: number) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
    while (inTree.length < pts.length) {
        let best: [number, number] | null = null;
        for (const a of inTree) for (let b = 0; b < pts.length; b++) if (!inTree.includes(b) && (!best || d(a, b) < d(best[0], best[1]))) best = [a, b];
        const [a, b] = best!; inTree.push(b);
        const [x0, y0] = pts[a], [x1, y1] = pts[b], bend = (r() - 0.5) * 0.5;
        g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 - (y1 - y0) * bend, (y0 + y1) / 2 + (x1 - x0) * bend, x1, y1); g.stroke();
    }
}
// Blur (shrunk and grown back, so it works in every browser) and grain, so nothing in the plan is sharp enough to copy.
function soften(c: HTMLCanvasElement, r: () => number): HTMLCanvasElement {
    const out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
    const o = out.getContext('2d')!;
    o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high';
    const small = document.createElement('canvas'); small.width = Math.round(c.width / 20); small.height = Math.round(c.height / 20);
    const s = small.getContext('2d')!; s.imageSmoothingEnabled = true; s.imageSmoothingQuality = 'high';
    s.drawImage(c, 0, 0, small.width, small.height);
    o.drawImage(small, 0, 0, out.width, out.height);
    const img = o.getImageData(0, 0, out.width, out.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 34; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    o.putImageData(img, 0, 0);
    return out;
}
const blob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error('Could not draw the plan.'))), 'image/png'));

/* ---------- ComfyUI ---------- */

// The workflow's placeholders, filled the way Megumin Suite and Image Generation fill them.
function fill(g: Graph, v: { prompt: string; width: number; height: number; negative?: string }): Graph {
    const s = meg(), p = prefs();
    const loras = (n: number) => (p.loras ? s[`selectedLora${n === 1 ? '' : n}`] : '') || 'None';
    const triggers = p.loras ? [1, 2, 3, 4].filter(n => loras(n) !== 'None').map(n => s[`loraTrigger${n}`]).filter(Boolean) : [];
    const vals: Record<string, any> = {
        '%prompt%': [...triggers, s.promptPrefix, v.prompt].map(x => String(x).trim().replace(/,$/, '')).filter(Boolean).join(', '), '%negative_prompt%': [s.customNegative, 'text, letters, watermark, signature, people, person', v.negative].filter(Boolean).join(', '),
        '%seed%': Math.floor(Math.random() * 1e9), '%sampler%': s.selectedSampler || 'euler', '%model%': s.selectedModel || undefined, '%steps%': Number(s.steps) || 25,
        '%scale%': Number(s.cfg) || 6, '%scheduler%': s.scheduler || s.selectedScheduler || 'normal', '%denoise%': 1, '%clip_skip%': -Math.abs(Number(s.clipSkip) || 2), '%width%': v.width, '%height%': v.height,
        '%lora1%': loras(1), '%lora2%': loras(2), '%lora3%': loras(3), '%lora4%': loras(4),
        '%lorawt1%': p.loras ? Number(s.selectedLoraWt) || 1 : 0, '%lorawt2%': p.loras ? Number(s.selectedLoraWt2) || 1 : 0, '%lorawt3%': p.loras ? Number(s.selectedLoraWt3) || 1 : 0, '%lorawt4%': p.loras ? Number(s.selectedLoraWt4) || 1 : 0,
    };
    for (const n of Object.values(g)) for (const [k, x] of Object.entries(n.inputs ?? {})) {
        if (typeof x !== 'string' || !/^%\w+%$/.test(x)) continue;
        if (vals[x] !== undefined) n.inputs[k] = vals[x];
        else if (/prompt|text|tags|style/i.test(x)) n.inputs[k] = ''; // an extra text slot (a style or character prompt) stays empty
    }
    const left = Object.values(g).flatMap(n => Object.values(n.inputs ?? {})).find(x => typeof x === 'string' && /^%\w+%$/.test(x));
    if (left) throw new Error(`The workflow needs ${left}, which Megumin Suite does not set (choose a model there, or another workflow).`);
    return g;
}
// txt2img → img2img: the empty latent becomes the uploaded picture, encoded with the workflow's own VAE, and the
// sampler starts part of the way in (strength 0.8: the last 80% of the steps).
function toImg2Img(g: Graph, image: string, strength: number): Graph {
    const lat = Object.keys(g).find(id => /^Empty.*LatentImage$/.test(g[id].class_type));
    const dec = Object.values(g).find(n => n.class_type === 'VAEDecode');
    if (!lat || !dec?.inputs?.vae) throw new Error('This workflow has no Empty Latent Image and VAE Decode, so Mundi cannot paint over a plan with it.');
    g.mundi_load = { class_type: 'LoadImage', inputs: { image } };
    g.mundi_enc = { class_type: 'VAEEncode', inputs: { pixels: ['mundi_load', 0], vae: dec.inputs.vae } };
    for (const n of Object.values(g)) for (const [k, x] of Object.entries(n.inputs ?? {})) if (Array.isArray(x) && x[0] === lat) n.inputs[k] = ['mundi_enc', 0];
    delete g[lat];
    for (const n of Object.values(g)) {
        if (n.class_type === 'KSampler' && 'denoise' in n.inputs) n.inputs.denoise = strength;
        if (n.class_type === 'KSamplerAdvanced') { const steps = Number(n.inputs.steps) || 25; n.inputs.start_at_step = Math.round(steps * (1 - strength)); n.inputs.end_at_step = 10000; }
    }
    return g;
}
async function upload(b: Blob, name: string): Promise<string> {
    const f = new FormData(); f.append('image', b, name); f.append('overwrite', 'true');
    const res = await fetch(`${comfyUrl()}/upload/image`, { method: 'POST', body: f });
    if (!res.ok) throw new Error(`ComfyUI did not take the plan (${res.status}).`);
    const d = await res.json();
    return d.subfolder ? `${d.subfolder}/${d.name}` : d.name;
}
async function paint(prompt: string, width: number, height: number, plan?: Blob): Promise<Blob> {
    let g = fill(structuredClone(await loadWorkflow(prefs().workflow)) as Graph, { prompt, width, height, negative: plan ? MAP_NEG : '' });
    if (plan) g = toImg2Img(g, await upload(plan, `mundi-plan-${Date.now().toString(36)}.png`), prefs().strength);
    const out = await runJob(g as any);
    const saved = Object.keys(out).find(id => g[id]?.class_type === 'SaveImage') ?? Object.keys(out)[0];
    if (!saved) throw new Error('ComfyUI gave back no picture.');
    return out[saved];
}

/* ---------- prompts (the AI turns the world into tags once) ---------- */

// The look of Mundi's own maps: a detailed isometric game illustration seen from high above.
const MAP_BASE = 'masterpiece, best quality, highly detailed, no humans, scenery, isometric, from above, high angle, wide shot, game map, 2d game art, detailed illustration';
const MAP_TOWN = `${MAP_BASE}, cityscape, town, many buildings, rooftops, streets, trees, plaza`;
const MAP_COUNTRY = `${MAP_BASE}, landscape, countryside, forest, fields, winding road, village, hills, river`;
const MAP_INDOOR = 'masterpiece, best quality, highly detailed, no humans, scenery, isometric, cutaway, dollhouse view, building interior, multiple rooms, floor plan, from above, wide shot, walls, furniture, 2d game art, detailed illustration';
// tested on SDXL (Illustrious): without these the maps tilt into a photo with a skyline and fake shop signs
const MAP_NEG = 'grid, blueprint, diagram, chart, flat colors, simple background, blurry, lowres, abstract, pixelated, frame, border, sky, horizon, fisheye, sign, signboard, billboard, neon sign, english text, logo, photorealistic';
const mapTags = (w: WorldDef, m: MapDef) => (indoor(m) ? MAP_INDOOR : isCountry(w, m) ? MAP_COUNTRY : MAP_TOWN);
async function tagsFor(w: WorldDef, places: Place[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < Math.max(places.length, 1); i += 30) {
        const part = places.slice(i, i + 30);
        const prompt = `Write Danbooru tags (for the Illustrious image model) for background pictures of a world.
World: ${w.name}. ${w.setting}

Answer with one line per item, "id: tags", and nothing else. Scenery only: no people, no character tags, no text. 10 to 20 tags each, the place's look, era, materials and light.
world: <tags for the look of the whole world, used for its maps and cover>
${part.map(p => `${p.id}: <${p.name}${p.desc ? `, ${p.desc}` : ''}>`).join('\n')}`;
        try {
            const raw = await quiet(prompt, 1500);
            for (const l of raw.split('\n')) { const m = l.match(/^\s*[-*]?\s*([\w-]+)\s*:\s*(.+)$/); if (m) out.set(m[1], m[2].replace(/["<>]/g, '').trim()); }
        } catch (e) { console.warn('[Mundi] paint tags', e); }
    }
    return out;
}

/* ---------- the queue ---------- */

async function run() {
    const w = CW.w; if (!w || WP.busy) return;
    WP.busy = true; WP.stop = false; notify();
    const tags = await tagsFor(w, w.places.filter(p => WP.items.some(i => i.kind === 'bg' && i.id === p.id)));
    const look = tags.get('world') ?? '';
    for (const it of WP.items) {
        if (WP.stop) break;
        if (it.state === 'done') continue;
        it.state = 'busy'; notify();
        try {
            let pic: Blob;
            if (it.kind === 'map') {
                const m = w.maps.find(x => x.id === it.id)!;
                pic = await paint(`${mapTags(w, m)}, ${look}`, W_PX, H_PX, await drawPlan(w, m));
                m.image = await uploadWorldPicture(w, pic, `map-${m.id}`); m.ratio = +(W_PX / H_PX).toFixed(4); delete m.images;
                if (!isPainted(w.cover) && !WP.items.some(i => i.kind === 'cover' && i.state !== 'failed')) w.cover = m.image;
            } else if (it.kind === 'bg') {
                const p = w.places.find(x => x.id === it.id)!;
                pic = await paint(`masterpiece, best quality, no humans, scenery, ${tags.get(p.id) || `${p.name}, ${p.desc ?? ''}`}, ${look}`, 1216, 832);
                p.bg = await uploadWorldPicture(w, pic, `place-${p.id}`); delete p.bgs;
            } else {
                pic = await paint(`masterpiece, best quality, no humans, scenery, wide shot, landscape, ${look || w.setting}`, W_PX, 768);
                w.cover = await uploadWorldPicture(w, pic, 'cover');
            }
            WP.last = URL.createObjectURL(pic);
            it.state = 'done';
            await saveWorld(w); CW.dirty = false;
        } catch (e: any) { it.state = 'failed'; it.why = String(e?.message ?? e); console.warn('[Mundi] paint', it, e); }
        notify();
    }
    WP.busy = false;
    const done = WP.items.filter(i => i.state === 'done').length, bad = WP.items.filter(i => i.state === 'failed').length;
    toast(`${done} picture${done === 1 ? '' : 's'} painted${bad ? `, ${bad} failed` : ''}.`, bad ? 'warn' : 'success');
    notify();
}

/* ---------- the dialog ---------- */

export function paintHtml(): string {
    if (!WP.open || !CW.w) return '';
    const p = prefs(), w = CW.w;
    const list = WP.items.length ? WP.items : todo(w, p);
    const mark = (i: Item) => (i.state === 'done' ? icon('check') : i.state === 'busy' ? '…' : i.state === 'failed' ? icon('x') : '');
    const flows = [...new Set([p.workflow, ...WP.flows])];
    return `<div class="mu-dlg-veil" data-act="wp-close"><div class="mu-dlg mu-panel mu-paint" role="dialog" data-act="lib-stay">
        <h3>Paint with ComfyUI</h3>
        <p class="mu-muted">Maps are laid out by Mundi where the pins are, then painted over by ComfyUI, so every place sits on a street or a building. Your ComfyUI: <b data-notr>${esc(comfyUrl())}</b>.</p>
        ${WP.busy || WP.items.some(i => i.state !== 'wait') ? '' : `<div class="mu-paint-opts">
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="maps" ${p.maps ? 'checked' : ''}><span>Maps (${w.maps.length})</span></label>
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="bgs" ${p.bgs ? 'checked' : ''}><span>Place backgrounds (${w.places.filter(x => !x.link).length})</span></label>
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="cover" ${p.cover ? 'checked' : ''}><span>Cover</span></label>
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="redo" ${p.redo ? 'checked' : ''}><span>Paint again what already has a picture</span></label>
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="loras" ${p.loras ? 'checked' : ''}><span>Use my Megumin Suite LoRAs<small>Off: character LoRAs would bleed into scenery.</small></span></label>
            <label class="mu-field"><span>Workflow</span><select data-input="wp-flow">${flows.map(f => `<option ${f === p.workflow ? 'selected' : ''} data-notr>${esc(f)}</option>`).join('')}</select></label>
            <label class="mu-field"><span>How much ComfyUI may change the plan: ${Math.round(p.strength * 100)}%</span><input type="range" min="0.4" max="0.95" step="0.05" value="${p.strength}" data-input="wp-strength"></label></div>`}
        ${WP.last ? `<img class="mu-paint-last" src="${esc(WP.last)}" alt="">` : ''}
        <ul class="mu-paint-list">${list.map(i => `<li class="is-${i.state}" title="${esc(i.why ?? '')}"><span data-notr>${esc(i.name)}</span><i>${mark(i)}</i></li>`).join('') || '<li class="mu-muted">Nothing to paint: everything has a picture.</li>'}</ul>
        <div class="mu-row mu-dlg-btns">${WP.busy ? `<button data-act="wp-stop">${icon('x')}<span>Stop after this one</span></button>`
            : `<button data-act="wp-close">Close</button>${WP.items.some(i => i.state === 'failed') ? `<button data-act="wp-retry">Try the failed ones again</button>` : ''}<button class="mu-primary" data-act="wp-go" ${list.some(i => i.state !== 'done') ? '' : 'aria-disabled="true"'}>${icon('image')}<span>Paint ${list.filter(i => i.state !== 'done').length}</span></button>`}</div></div></div>`;
}
export async function openPaint() {
    WP.open = true; WP.items = []; WP.last = ''; notify();
    WP.flows = await workflowList(); notify();
}

Object.assign(ACT, {
    'wp-open': () => void openPaint(),
    'wp-close': (el, e) => { if (e && el.classList.contains('mu-dlg-veil') && e.target !== el) return; if (WP.busy) return; WP.open = false; notify(); },
    'wp-opt': (el) => { const p = prefs() as any, k = el.dataset.k!; p[k] = !p[k]; saveSettings(); notify(); },
    'wp-go': () => { if (WP.busy || !CW.w) return; if (!WP.items.length) WP.items = todo(CW.w, prefs()); if (WP.items.length) void run(); },
    'wp-retry': () => { for (const i of WP.items) if (i.state === 'failed') i.state = 'wait'; void run(); },
    'wp-stop': () => { WP.stop = true; notify(); },
});
Object.assign(INPUT, {
    'wp-flow': (el) => { prefs().workflow = el.value; saveSettings(); },
    'wp-strength': (el) => { prefs().strength = Number(el.value) || 0.8; saveSettings(); notify(); },
});
