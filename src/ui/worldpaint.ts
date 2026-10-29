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
import { worldFile, type WorldDef, type MapDef, type Place } from '../core/world.js';
import { ctx, quiet } from '../st/bridge.js';
import { saveWorld, uploadWorldPicture } from '../sim/creator.js';
import { comfyUrl, loadWorkflow, runJob, workflowList } from './spritegen.js';
import { stoppable, isStopped, stopCount, checkStop } from './comfystop.js';
import { drawGeoPlan, locate } from './worldgeo.js';
import { CW } from './creator.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

type Graph = Record<string, { class_type: string; inputs: Record<string, any>; _meta?: { title?: string } }>;
type Kind = 'map' | 'bg' | 'cover';
interface Item { kind: Kind; id: string; name: string; state: 'wait' | 'busy' | 'done' | 'failed'; why?: string }
interface Prefs { found?: boolean; v?: number; workflow: string; strength: number; loras: boolean; maps: boolean; bgs: boolean; cover: boolean; redo?: boolean; redoMaps: boolean; redoBgs: boolean }

export const WP = { open: false, busy: false, stop: false, items: [] as Item[], flows: [] as string[], last: '' };
// The Stop button (comfystop.ts): the picture being painted ends and the rest wait.
stoppable({
    stop: () => { if (WP.busy) WP.stop = true; },
    doing: () => (WP.busy && !WP.stop ? `Painting the world · ${WP.items.filter(i => i.state === 'done').length}/${WP.items.length}` : ''),
});
const prefs = (): Prefs => {
    const p = ((settings() as any).worldPaint ??= {}) as Prefs;
    p.workflow ??= meg().currentWorkflowName || 'Default_Comfy_Workflow.json';
    // v2: the plan is a soft guide now, so ComfyUI gets more room by default (0.6 copied the plan back)
    if (p.v !== 2) { p.strength = 0.8; p.v = 2; }
    p.loras ??= false; p.maps ??= true; p.bgs ??= true; p.cover ??= true;
    // "paint again" is two choices now: a map painted again is a new map, a background painted again is one picture
    p.redoMaps ??= !!p.redo; p.redoBgs ??= !!p.redo; delete p.redo;
    return p;
};
// Megumin Suite's image settings (its default profile), else nothing: the workflow's own values stay.
const meg = (): any => { const es = ctx().extensionSettings ?? {}; const pr = es['Megumin-Suite']?.profiles ?? {}; return pr.default?.imageGen ?? Object.values(pr).map((x: any) => x?.imageGen).find(Boolean) ?? {}; };

/* ---------- what there is to paint ---------- */

const isPainted = (f?: string) => !!f && !f.startsWith('data:');
function todo(w: WorldDef, p: Prefs): Item[] {
    const out: Item[] = [];
    if (p.cover && (p.redoMaps || !isPainted(w.cover))) out.push({ kind: 'cover', id: '', name: 'Cover', state: 'wait' });
    if (p.maps) for (const m of w.maps) if (p.redoMaps || !isPainted(m.image)) out.push({ kind: 'map', id: m.id, name: `Map: ${m.name}`, state: 'wait' });
    if (p.bgs) for (const pl of w.places) if (!pl.link && (p.redoBgs || !pl.bg)) out.push({ kind: 'bg', id: pl.id, name: pl.name, state: 'wait' });
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
const ISLAND = /\b(island|isle|islet|atoll|archipelago)\b/i;
const PLANET = /\b(world|earth|planet|globe|continents?)\b/i;
const TOWNISH = /\b(city|town|village|capital|metropolis|hamlet|-gu|-si|ward|borough)\b/i;
const indoor = (m: MapDef) => (m.trip ?? 99) <= 5;
// How much ground a map covers, which decides its plan and prompt: a planet is oceans and continents, a country is
// terrain with small towns, an island is land in the sea, a city is seen whole from high above, a district is streets
// and rooftops. Read from the map's name and where it sits among the maps (a map inside a planet is a country, inside
// a country a city, inside a city a district), since names like "USA" or "Seoul" say nothing by themselves.
export type Scale = 'planet' | 'country' | 'island' | 'city' | 'district' | 'indoor';
const STEP: Record<Scale, Scale> = { planet: 'country', country: 'city', island: 'district', city: 'district', district: 'district', indoor: 'indoor' };
export function mapScale(w: WorldDef, m: MapDef, seen = new Set<string>()): Scale {
    if (indoor(m)) return 'indoor';
    const name = `${m.name} ${m.parent ? '' : m.area ?? ''}`;
    if (ISLAND.test(m.name)) return 'island';
    if (TOWNISH.test(m.name)) return /-gu|ward|borough/i.test(m.name) ? 'district' : 'city';
    const kids = w.maps.filter(x => x.parent === m.id), deep = kids.some(k => w.maps.some(x => x.parent === k.id));
    const up = m.parent && !seen.has(m.id) ? w.maps.find(x => x.id === m.parent) : undefined;
    if (up) return STEP[mapScale(w, up, seen.add(m.id))];
    if (PLANET.test(name) && (kids.length > 1 || !w.places.some(p => p.map === m.id && !p.link))) return 'planet';
    const pins = w.places.filter(p => p.map === m.id);
    if (RURAL.test(name) || deep || (!pins.some(p => !p.link) && pins.filter(p => p.link).length > 1 && w.style === 'medieval')) return 'country';
    return 'district';   // a town on its own, or one whose maps are its neighbourhoods: streets and rooftops as before
}
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
    const scale = mapScale(w, m);
    if (m.geo && (scale === 'planet' || scale === 'country')) return blob(await drawGeoPlan(m.geo, scale === 'planet', W_PX, H_PX, r));
    if (scale === 'planet' || scale === 'island') return blob(soften(scale === 'planet' ? planetPlan(g, r, pins, pts, patch) : islandPlan(g, r, pts, patch), r));
    if (scale === 'city') return blob(soften(cityPlan(g, r, pins, pts, patch), r));
    if (scale === 'country') { orbitPlan(g, r, pts, patch, WATER.test(`${m.name} ${m.area ?? ''} ${m.climate ?? ''}`)); horizon(g, r); return blob(soften(g.canvas, r)); }
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
    // a town: districts of their own tone round each district pin (or a few spread out), parks, rooftops for grain
    g.fillStyle = '#a19c92'; g.fillRect(0, 0, W_PX, H_PX);
    const hubs = pts.filter((_, i) => pins[i].link);
    const centres = hubs.length >= 2 ? hubs : [0, 1, 2, 3].map(() => [r() * W_PX, r() * H_PX] as const);
    const tones = ['#ad8f7c', '#8e959e', '#a3a58e', '#b4a68e', '#8a8794', '#9c8574'];
    centres.forEach(([x, y], i) => patch(x, y, 380, tones[i % tones.length], 9));
    for (let k = 0; k < 2600; k++) { const x = r() * W_PX, y = r() * H_PX; g.fillStyle = ['#7d6e64', '#8f8f8f', '#b5aa98', '#6b7280', '#c4bcae'][k % 5]; g.fillRect(x, y, 8 + r() * 12, 6 + r() * 10); }
    scatter(6, 80, ['#7a9a62', '#6c8c58'], dry);
    if (water) {
        g.fillStyle = '#5f8fb0'; g.strokeStyle = '#5f8fb0';
        if (river) { g.lineWidth = 70; g.stroke(water); } else { g.fill(water); g.fillStyle = '#d9cfa8'; g.lineWidth = 18; g.strokeStyle = '#d9cfa8'; g.stroke(water); }
        g.lineWidth = 80;
    }
    // roads between the places, then a patch at each place: a town, a park, or a big building
    g.lineCap = 'round'; g.strokeStyle = '#d9d4ca'; g.lineWidth = 26; road(g, pts, r);
    pins.forEach((p, i) => {
        const [x, y] = pts[i];
        if (GREEN.test(`${p.id} ${p.name}`)) patch(x, y, 110, '#6a9152', 4);
        else if (p.link) patch(x, y, 160, '#7a6f68', 6);
        else patch(x, y, 80, '#6a5f59', 3);
    });
    return blob(soften(c, r));
}
type Patch = (x: number, y: number, size: number, col: string, n?: number) => void;
type Pts = readonly (readonly [number, number])[];
// A ragged landmass: patches drifting away from a point.
function land(r: () => number, patch: Patch, x: number, y: number, size: number, col: string, n: number) {
    for (let k = 0; k < n; k++) { patch(x, y, size, col, 3); x += (r() - 0.5) * size * 0.9; y += (r() - 0.5) * size * 0.6; }
}
// A planet: a globe in black space, a continent under each country and an island under each other place, deserts
// and forests on the land, swirls of cloud, a blue rim of atmosphere. Tested on Illustrious: a flat world map came back
// as one continent; a globe read as a whole planet (with "multiple planets, ring" in the negative).
function planetPlan(g: CanvasRenderingContext2D, r: () => number, pins: Place[], pts: Pts, patch: Patch): HTMLCanvasElement {
    const cx = W_PX / 2, cy = H_PX / 2, R = Math.max(380, ...pts.map(([x, y]) => Math.hypot(x - cx, y - cy) + 90));
    g.fillStyle = '#05070d'; g.fillRect(0, 0, W_PX, H_PX);
    g.fillStyle = '#c8d0e0'; for (let k = 0; k < 160; k++) g.fillRect(r() * W_PX, r() * H_PX, 1.5, 1.5);
    g.fillStyle = '#6fa8e0'; g.beginPath(); g.arc(cx, cy, R + 14, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1d4f86'; g.fillRect(0, 0, W_PX, H_PX);
    for (let k = 0; k < 30; k++) patch(r() * W_PX, r() * H_PX, 260, ['#1a4a80', '#24598f', '#173f70'][Math.floor(r() * 3)], 2);
    pts.forEach(([x, y], i) => land(r, patch, x, y, pins[i].link ? 120 : 60, '#5f8a48', pins[i].link ? 6 : 2));
    for (let k = 0; k < 3; k++) land(r, patch, cx + (r() - 0.5) * R * 1.4, cy + (r() - 0.5) * R, 90, '#6d8f4c', 4);
    for (let k = 0; k < 40; k++) {
        const x = r() * W_PX, y = r() * H_PX, [, gr] = g.getImageData(x, y, 1, 1).data;
        if (gr > 110) patch(x, y, 60, ['#b9a46a', '#3f6b35', '#8a7f6a'][Math.floor(r() * 3)], 3);
    }
    for (let k = 0; k < 14; k++) { const x = cx + (r() - 0.5) * R * 1.6, y = cy + (r() - 0.5) * R * 1.6; for (let j = 0; j < 4; j++) patch(x + (r() - 0.5) * 60, y + (r() - 0.5) * 30, 40, '#dfe6ee', 1); }
    // darker towards the rim, so it reads as a sphere
    const shade = g.createRadialGradient(cx - R * 0.15, cy - R * 0.15, R * 0.3, cx, cy, R);
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(4,12,30,0.55)');
    g.fillStyle = shade; g.fillRect(0, 0, W_PX, H_PX); g.restore();
    pts.forEach(([x, y]) => patch(x, y, 22, '#8b7d6b', 2));
    return g.canvas;
}
// A whole country from orbit: everything small. Grass and farmland, a drier side and a wooded side, long thin
// mountain chains, lakes, rivers, sea along the edges, its towns as specks, clouds. (A countryside plan of fields and
// woods the size of a village came back as one valley.)
function orbitPlan(g: CanvasRenderingContext2D, r: () => number, pts: Pts, patch: Patch, coast: boolean) {
    g.fillStyle = '#7f9a5c'; g.fillRect(0, 0, W_PX, H_PX);
    for (let k = 0; k < 60; k++) patch(r() * W_PX, r() * H_PX, 110, ['#8fa866', '#6f8c4e', '#9aa86a', '#a9a070'][Math.floor(r() * 4)], 2);
    for (let k = 0; k < 25; k++) patch(r() * W_PX * 0.4, H_PX * (0.35 + r() * 0.6), 90, ['#c2a878', '#b8955f', '#cdb48a'][Math.floor(r() * 3)], 2);
    for (let k = 0; k < 30; k++) patch(W_PX * (0.55 + r() * 0.45), r() * H_PX, 80, ['#4f7a3c', '#3f6a33'][Math.floor(r() * 2)], 2);
    for (let chain = 0; chain < 3; chain++) {
        let x = W_PX * (0.12 + r() * 0.2 + chain * 0.28), y = H_PX * 0.05; const a = Math.PI / 2 + (r() - 0.5) * 0.5;
        for (let k = 0; k < 26; k++) { patch(x, y, 34, r() < 0.2 ? '#e8e8e8' : ['#8b8070', '#6f6658', '#7a705f'][Math.floor(r() * 3)], 2); x += Math.cos(a) * 32 + (r() - 0.5) * 20; y += Math.sin(a) * 32; }
    }
    for (let k = 0; k < 5; k++) patch(W_PX * (0.5 + r() * 0.3), H_PX * (0.05 + r() * 0.15), 40, '#3c6f9c', 2);
    g.fillStyle = '#24578a';
    const shore = (pt: (t: number) => [number, number], close: [number, number][]) => { g.beginPath(); close.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y)); for (let t = 0; t <= 1.0001; t += 0.03) g.lineTo(...pt(t)); g.closePath(); g.fill(); };
    if (coast) {
        shore(t => [W_PX * 0.06 + Math.sin(t * 12 + r()) * 30 + r() * 15, t * H_PX], [[0, H_PX], [0, 0]]);
        shore(t => [W_PX * 0.93 - Math.sin(t * 14 + r()) * 35 - r() * 15, (1 - t) * H_PX], [[W_PX, 0], [W_PX, H_PX]]);
    }
    shore(t => [t * W_PX, H_PX * 0.93 - Math.sin(t * 15 + r()) * 25 - r() * 10], [[W_PX, H_PX], [0, H_PX]]);
    g.strokeStyle = '#4f86b0'; g.lineWidth = 4;
    for (let k = 0; k < 6; k++) { let x = r() * W_PX, y = H_PX * 0.1; g.beginPath(); g.moveTo(x, y); for (let j = 0; j < 12; j++) { x += (r() - 0.5) * 60; y += H_PX * 0.07; g.lineTo(x, y); } g.stroke(); }
    pts.forEach(([x, y]) => patch(x, y, 18, '#9a948c', 3));
    for (let k = 0; k < 14; k++) { const x = r() * W_PX, y = r() * H_PX, a = r() * Math.PI; for (let j = 0; j < 5; j++) patch(x + Math.cos(a) * j * 30, y + Math.sin(a) * j * 14, 34, '#eef1f4', 1); }
}
// The curve of the planet across the top of a country seen from orbit: black space and stars above, a thin blue rim.
// Tested on Illustrious: without it a country came back as a valley seen up close; with it, as the whole land from space.
function horizon(g: CanvasRenderingContext2D, r: () => number) {
    const R = 1700, cy = 40 + R, cx = W_PX / 2;
    g.save(); g.beginPath(); g.rect(0, 0, W_PX, H_PX); g.arc(cx, cy, R + 12, 0, Math.PI * 2, true); g.clip('evenodd');
    g.fillStyle = '#05070d'; g.fillRect(0, 0, W_PX, H_PX);
    g.fillStyle = '#c8d0e0'; for (let k = 0; k < 60; k++) g.fillRect(r() * W_PX, r() * 160, 1.5, 1.5);
    g.restore();
    g.strokeStyle = '#6fa8e0'; g.lineWidth = 12; g.beginPath(); g.arc(cx, cy, R + 6, Math.PI, 2 * Math.PI); g.stroke();
}
// An island: sea all round, shallows, a beach, green land, high ground in the middle, a village at each place.
function islandPlan(g: CanvasRenderingContext2D, r: () => number, pts: Pts, patch: Patch): HTMLCanvasElement {
    g.fillStyle = '#2f6f9a'; g.fillRect(0, 0, W_PX, H_PX);
    const xs = pts.length ? pts.map(p => p[0]) : [W_PX / 2], ys = pts.length ? pts.map(p => p[1]) : [H_PX / 2];
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const rx = Math.max(W_PX * 0.3, (Math.max(...xs) - Math.min(...xs)) / 2 + 170), ry = Math.max(H_PX * 0.28, (Math.max(...ys) - Math.min(...ys)) / 2 + 150);
    g.fillStyle = '#4f9cc0'; g.beginPath(); g.ellipse(cx, cy, rx + 70, ry + 60, 0, 0, Math.PI * 2); g.fill();
    const shore = Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * Math.PI * 2, k = 0.85 + r() * 0.25; return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as const; });
    const poly = (k: number, col: string) => { g.fillStyle = col; g.beginPath(); shore.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](cx + (x - cx) * k, cy + (y - cy) * k)); g.closePath(); g.fill(); };
    poly(1, '#e2d3a0'); poly(0.9, '#6f9e55');
    for (let k = 0; k < 14; k++) patch(cx + (r() - 0.5) * rx * 1.2, cy + (r() - 0.5) * ry * 1.1, 90, ['#4c7a3c', '#86a85e', '#a7b36c'][Math.floor(r() * 3)], 3);
    patch(cx, cy - ry * 0.1, 160, '#7d7464', 4); patch(cx, cy - ry * 0.1, 60, '#5d564c', 2);
    g.lineCap = 'round'; g.strokeStyle = '#cdb98c'; g.lineWidth = 10; road(g, pts, r);
    pts.forEach(([x, y]) => patch(x, y, 50, '#8d6a58', 3));
    return g.canvas;
}
// A whole city: a mass of rooftops in the middle with countryside round it, a river through it, parks.
function cityPlan(g: CanvasRenderingContext2D, r: () => number, pins: Place[], pts: Pts, patch: Patch): HTMLCanvasElement {
    g.fillStyle = '#8fac64'; g.fillRect(0, 0, W_PX, H_PX);
    patch(W_PX / 2, H_PX / 2, 900, '#a19c92', 9);
    for (let k = 0; k < 2600; k++) {
        const x = r() * W_PX, y = r() * H_PX;
        if (Math.hypot(x - W_PX / 2, y - H_PX / 2) < 560) { g.fillStyle = ['#7d6e64', '#8f8f8f', '#b5aa98', '#6b7280', '#c4bcae'][k % 5]; g.fillRect(x, y, 8 + r() * 12, 6 + r() * 10); }
    }
    g.strokeStyle = '#5f8fb0'; g.lineWidth = 46; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, H_PX * (0.45 + r() * 0.1));
    for (let k = 1; k <= 6; k++) g.lineTo((W_PX * k) / 6, H_PX * (0.4 + r() * 0.2));
    g.stroke();
    for (let k = 0; k < 8; k++) patch(r() * W_PX, r() * H_PX, 80, '#6c8c58', 3);
    g.strokeStyle = '#d9d4ca'; g.lineWidth = 18; road(g, pts, r);
    pts.forEach(([x, y], i) => patch(x, y, pins[i].link ? 120 : 90, '#6a5f59', 3));
    return g.canvas;
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
async function paint(prompt: string, width: number, height: number, plan?: Blob, strength = prefs().strength, negative = plan ? MAP_NEG : ''): Promise<Blob> {
    let g = fill(structuredClone(await loadWorkflow(prefs().workflow)) as Graph, { prompt, width, height, negative });
    if (plan) g = toImg2Img(g, await upload(plan, `mundi-plan-${Date.now().toString(36)}.png`), strength);
    const out = await runJob(g as any, 'maps');
    const saved = Object.keys(out).find(id => g[id]?.class_type === 'SaveImage') ?? Object.keys(out)[0];
    if (!saved) throw new Error('ComfyUI gave back no picture.');
    return out[saved];
}

/* ---------- prompts (the AI turns the world into tags once) ---------- */

// The look of Mundi's own maps: a detailed isometric game illustration seen from high above.
const MAP_BASE = 'masterpiece, best quality, highly detailed, no humans, scenery, isometric, from above, high angle, wide shot, game map, 2d game art, detailed illustration';
const MAP_TOWN = `${MAP_BASE}, cityscape, town, many buildings, rooftops, streets, trees, plaza`;
const MAP_INDOOR = 'masterpiece, best quality, highly detailed, no humans, scenery, isometric, cutaway, dollhouse view, building interior, multiple rooms, floor plan, from above, wide shot, walls, furniture, 2d game art, detailed illustration';
// tested on SDXL (Illustrious): without these the maps tilt into a photo with a skyline and fake shop signs
const MAP_NEG = 'grid, blueprint, diagram, chart, flat colors, simple background, blurry, lowres, abstract, pixelated, frame, border, sky, horizon, fisheye, sign, signboard, billboard, neon sign, english text, logo, photorealistic';
// Maps bigger than a district are seen from much higher up, straight down, and get no city in the prompt: tested on
// Illustrious with the Solo Leveling world, "isometric, game map, cityscape" and the world's look (glowing gates,
// city at dusk) turned Earth, the USA and Jeju into one city each with a portal in the middle. These came back as
// continents in an ocean, a landscape, an island in the sea and a whole city with its river.
const Q = 'masterpiece, best quality, highly detailed, no humans, scenery';
const QA = `${Q}, anime style, anime screencap, painted`;
// a planet or a country is seen from space: no city, no close-up, nothing the model likes to add in orbit
const SPACE_NEG = 'grid, blueprint, diagram, chart, simple background, lowres, abstract, pixelated, frame, border, fisheye, sign, english text, logo, photorealistic, photo, realistic, city close-up, cityscape, skyscraper, street, rooftops, isometric, close-up, magic circle, portal, glowing lines, airplane, character, satellite, spaceship, spacecraft, space station, vertical line, planetary ring, ring, multiple planets, moon, lens flare';
const MAP_GLOBE = (real: boolean) => `${QA}, ${real ? 'planet earth' : 'a planet'} seen from space, single planet, globe, continents, blue oceans, white clouds, thin atmosphere glow, outer space, black background, stars`;
const MAP_ORBIT = (name: string) => `${QA}, seen from space, curved horizon of the planet, ${name} from orbit, whole country visible, extremely high altitude, tiny details, coastline, clouds far below, thin blue atmosphere, black space above`;
// tested: an island by night with its towns lit read as lived in; by day it read as empty farmland
const MAP_ISLAND = `${Q}, aerial view from high above, island surrounded by dark ocean, night, inhabited island, glowing town lights along the coast, harbor lights, roads lit up, mountain in the middle above the clouds, clouds around the island, moonlight`;
const MAP_CITY = `${Q}, satellite view, top-down, from very high above, whole city, wide river through the city, bridges, countless tiny buildings, green hills around the city, parks`;
const NEG_ISLAND = `${MAP_NEG}, city close-up, cityscape, skyscraper, street, rooftops, isometric, close-up, magic circle, portal, airplane, character, satellite, flat colors, mainland, eruption, lava, smoke`;
const NEG_CITY = `${MAP_NEG}, isometric, close-up, magic circle, portal, perspective`;
const CLIMATE: Record<string, string> = { hot: 'hot climate, dry plains, savanna', cold: 'cold climate, snow, tundra, pine forests', coastal: 'coastline, sea', temperate: 'temperate climate, green' };
const far = (s: Scale) => s === 'planet' || s === 'country' || s === 'island';
const mapTags = (w: WorldDef, m: MapDef) => { const s = mapScale(w, m); return s === 'indoor' ? MAP_INDOOR : s === 'planet' ? MAP_GLOBE(!!m.geo) : s === 'country' ? MAP_ORBIT(m.name) : s === 'island' ? MAP_ISLAND : s === 'city' ? MAP_CITY : MAP_TOWN; };
// How much ComfyUI may change the plan, by scale (tested): a real globe or country keeps its coastlines at these,
// higher melts them. Districts and rooms keep the player's own setting.
const STRENGTH: Partial<Record<Scale, number>> = { planet: 0.8, country: 0.85, island: 0.85, city: 0.75 };
const mapStrength = (w: WorldDef, m: MapDef) => { const s = mapScale(w, m); return m.geo && s === 'planet' ? 0.75 : m.geo && s === 'country' ? 0.6 : STRENGTH[s] ?? prefs().strength; };
/** The prompt and negative prompt for painting map `m`: a district keeps the world's look, a bigger map gets its own
 *  landscape tags from the AI (or its climate) instead, since the look is written for streets and places. */
function mapPrompt(w: WorldDef, m: MapDef, tags: Map<string, string>): { prompt: string; neg: string } {
    const s = mapScale(w, m), own = tags.get(m.id) ?? CLIMATE[m.climate ?? ''] ?? '';
    if (s === 'indoor' || s === 'district') return { prompt: `${mapTags(w, m)}, ${tags.get('world') ?? ''}`, neg: MAP_NEG };
    return { prompt: `${mapTags(w, m)}, ${own}`, neg: s === 'city' ? NEG_CITY : s === 'island' ? NEG_ISLAND : SPACE_NEG };
}
async function tagsFor(w: WorldDef, places: Place[], maps: MapDef[] = []): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const big = maps.filter(m => !['indoor', 'district'].includes(mapScale(w, m)));
    for (let i = 0; i < Math.max(places.length, 1); i += 30) {
        const part = places.slice(i, i + 30), mine = i ? [] : big;
        const prompt = `Write Danbooru tags (for the Illustrious image model) for background pictures of a world.
World: ${w.name}. ${w.setting}

Answer with one line per item, "id: tags", and nothing else. Scenery only: no people, no character tags, no text. 10 to 20 tags each, the place's look, era, materials and light.
world: <tags for the look of the whole world, used for its maps and cover>
${mine.map(m => `${m.id}: <${m.name} (${mapScale(w, m)}) seen from far above: its landscape, terrain, climate and coast, 8 to 15 tags, no buildings up close, no magic effects>`).join('\n')}
${part.map(p => `${p.id}: <${p.name}${p.desc ? `, ${p.desc}` : ''}>`).join('\n')}`;
        try {
            const raw = await quiet(prompt, 1500);
            for (const l of raw.split('\n')) { const m = l.match(/^\s*[-*]?\s*([\w-]+)\s*:\s*(.+)$/); if (m) out.set(m[1], m[2].replace(/["<>]/g, '').trim()); }
        } catch (e) { console.warn('[Mundi] paint tags', e); }
    }
    return out;
}

/* ---------- one place drawn into a finished map ---------- */

// A place added to a map that already has its picture (painted, uploaded, or one of Mundi's): the square round the
// pin is cut out, ComfyUI repaints it with the place in the middle, and it goes back with feathered edges, so the
// rest of the map stays as it was. Each picture of the map (each part of the day) gets the same; the pictures from
// before are kept for this session, for "Undo". Tested on Illustrious SDXL: a square of 60% of the map's height at
// 70% strength gave a clear new building at the scale of its neighbours and no visible seam; a guide drawn under it
// (a footprint, an open space) came back as an empty lot or a flat roof, so there is none.
const DRAW_SIDE = 0.6, DRAW_STRENGTH = 0.7, DRAW_PX = 1024;
const loadImg = (url: string) => new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Could not open the map picture.')); i.src = url; });
const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export const canDrawInto = (m?: MapDef) => !!m?.image && !m.image.startsWith('data:');
export const DRAWN: Record<string, { image: string; images?: Record<string, string> }> = {};

// The square round the pin (a share of the map's short side), centred on it: near an edge of the map it runs over
// the edge (that part is a plain fill for ComfyUI, and is cut off again when the square goes back).
function square(iw: number, ih: number, p: Place) {
    const s = Math.round(Math.min(iw, ih) * DRAW_SIDE);
    return { l: Math.round((p.x / 100) * iw - s / 2), t: Math.round((p.y / 100) * ih - s / 2), s };
}
async function drawPatch(url: string, p: Place, prompt: string): Promise<Blob> {
    const img = await loadImg(url), iw = img.naturalWidth, ih = img.naturalHeight;
    const { l, t, s } = square(iw, ih, p);
    const plan = canvas(DRAW_PX, DRAW_PX), pg = plan.getContext('2d')!;
    const k = DRAW_PX / s;
    pg.fillStyle = '#6b6660'; pg.fillRect(0, 0, DRAW_PX, DRAW_PX);
    pg.imageSmoothingQuality = 'high'; pg.drawImage(img, -l * k, -t * k, iw * k, ih * k);
    const url2 = URL.createObjectURL(await paint(prompt, DRAW_PX, DRAW_PX, await blob(plan), DRAW_STRENGTH));
    const done = await loadImg(url2).finally(() => URL.revokeObjectURL(url2));
    // back into the map: full strength in the middle, fading out towards the edges of the square
    const patch = canvas(s, s), q = patch.getContext('2d')!;
    q.imageSmoothingQuality = 'high'; q.drawImage(done, 0, 0, s, s);
    const fade = q.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s * 0.5);
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    q.globalCompositeOperation = 'destination-in'; q.fillStyle = fade; q.fillRect(0, 0, s, s);
    const out = canvas(iw, ih), og = out.getContext('2d')!;
    og.drawImage(img, 0, 0); og.drawImage(patch, l, t);
    return blob(out);
}
/** Draws place `p` into the picture(s) of its map with ComfyUI. Saves nothing: the caller saves the world. */
export async function drawIntoMap(w: WorldDef, p: Place): Promise<void> {
    const m = w.maps.find(x => x.id === p.map);
    if (!m || !canDrawInto(m)) throw new Error('This map has no picture to draw into yet: paint or upload one first.');
    const at = stopCount();
    const tags = await tagsFor(w, [p]);
    const green = GREEN.test(`${p.id} ${p.name}`);
    const what = tags.get(p.id) || `${p.name}${p.desc ? `, ${p.desc}` : ''}`;
    const scale = mapScale(w, m);
    const thing = indoor(m) ? 'a room' : far(scale) ? (p.link ? 'a city seen from far above' : 'a small town seen from far above') : p.link ? 'a town' : green ? 'a park' : 'a single distinctive building';
    const prompt = `${mapTags(w, m)}, ${far(scale) || scale === 'city' ? '' : `${tags.get('world') ?? ''}, `}${thing} in the middle, ${far(scale) ? '' : what}`;
    const before = { image: m.image, ...(m.images ? { images: { ...m.images } } : {}) };
    const image = await uploadWorldPicture(w, await drawPatch(worldFile(w, m.image), p, prompt), `map-${m.id}`);
    const images: Record<string, string> = {};
    for (const [per, f] of Object.entries(m.images ?? {})) { checkStop(at); images[per] = await uploadWorldPicture(w, await drawPatch(worldFile(w, f), p, prompt), `map-${m.id}-${per}`); }
    DRAWN[m.id] ??= before;
    m.image = image; if (m.images) m.images = images;
}
/** Paints the background of one place with ComfyUI (as "Paint" does for every place without one). */
export async function paintBackground(w: WorldDef, p: Place): Promise<string> {
    const tags = await tagsFor(w, [p]);
    const pic = await paint(`masterpiece, best quality, no humans, scenery, ${tags.get(p.id) || `${p.name}, ${p.desc ?? ''}`}, ${tags.get('world') ?? ''}`, 1216, 832);
    return uploadWorldPicture(w, pic, `place-${p.id}`);
}

/** "Paint it with my ComfyUI" when adding a place found in play (remembered). */
export const paintFoundOn = (v?: boolean) => { const p = prefs(); if (v !== undefined) { p.found = v; saveSettings(); } return !!p.found; };
/** A place the story added in this game: its background, and, in a world you made, drawn into its map too. */
export async function paintFound(w: WorldDef, p: Place, mine: boolean): Promise<{ bg?: string; drawn: boolean }> {
    const out: { bg?: string; drawn: boolean } = { drawn: false }, at = stopCount();
    if (!p.bg) out.bg = await paintBackground(w, p);
    checkStop(at);
    const m = w.maps.find(x => x.id === p.map);
    if (mine && !p.in && canDrawInto(m)) {
        const ew = structuredClone(w); ew.base = w.base;   // the world is saved as a whole, like the creator does
        await drawIntoMap(ew, p); await saveWorld(ew); out.drawn = true;
    }
    return out;
}

/* ---------- the queue ---------- */

async function run() {
    const w = CW.w; if (!w || WP.busy) return;
    WP.busy = true; WP.stop = false; notify();
    const at = stopCount();
    const tags = await tagsFor(w, w.places.filter(p => WP.items.some(i => i.kind === 'bg' && i.id === p.id)), w.maps.filter(m => WP.items.some(i => i.kind === 'map' && i.id === m.id)));
    const look = tags.get('world') ?? '';
    // real places (Earth, a real country) are cut from the real Earth, and their pins move to where they really are
    const big = w.maps.filter(m => WP.items.some(i => i.kind === 'map' && i.id === m.id) && ['planet', 'country'].includes(mapScale(w, m)));
    await locate(w, big, m => mapScale(w, m) === 'planet', W_PX, H_PX);
    for (const it of WP.items) {
        if (WP.stop) break;
        if (it.state === 'done') continue;
        it.state = 'busy'; notify();
        try {
            let pic: Blob;
            if (it.kind === 'map') {
                const m = w.maps.find(x => x.id === it.id)!;
                const { prompt, neg } = mapPrompt(w, m, tags);
                pic = await paint(prompt, W_PX, H_PX, await drawPlan(w, m), mapStrength(w, m), neg);
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
        } catch (e: any) {
            if (isStopped(e)) it.state = 'wait';
            else { it.state = 'failed'; it.why = String(e?.message ?? e); console.warn('[Mundi] paint', it, e); }
        }
        notify();
    }
    WP.busy = false;
    const done = WP.items.filter(i => i.state === 'done').length, bad = WP.items.filter(i => i.state === 'failed').length;
    if (stopCount() !== at) { notify(); return; }   // the Stop button says so itself; "Paint" carries on with the rest
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
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="redoMaps" ${p.redoMaps ? 'checked' : ''}><span>Paint again the maps and cover that have a picture<small>A whole new picture each. For one new place, use "Draw it into the map" on its pin instead.</small></span></label>
            <label class="mu-check"><input type="checkbox" data-act="wp-opt" data-k="redoBgs" ${p.redoBgs ? 'checked' : ''}><span>Paint again the backgrounds that have a picture</span></label>
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
