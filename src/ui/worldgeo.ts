// Real places painted from the real Earth: a map of Earth, or of a real country on it, gets its plan cut from NASA's
// Blue Marble picture (assets/earth.jpg, public domain), so ComfyUI paints the real continents and coastlines. Earth is
// a globe seen from space; a country is seen from orbit on the curve of the planet, the horizon and black space at the
// top of the frame. Tested on Illustrious with the Solo Leveling world: without the curve a country came back as a
// valley seen up close, however the prompt put it; with it the USA read as the whole country from space.
// The AI says where each map is (its centre and width in degrees), and where each of its places is: the pins move there.
import type { WorldDef, MapDef, Place } from '../core/world.js';
import { quiet } from '../st/bridge.js';

export interface Geo { lon: number; lat: number; w: number }
type View = { inv: (x: number, y: number) => [number, number, number] | null; fwd: (lon: number, lat: number) => [number, number] };
const RAD = Math.PI / 180;

// Orthographic projection round (lon0, lat0) with radius R, the centre of the disc at (cx, cy).
function ortho(lon0: number, lat0: number, R: number, cx: number, cy: number): View {
    const l0 = lon0 * RAD, p0 = lat0 * RAD, sp0 = Math.sin(p0), cp0 = Math.cos(p0);
    return {
        // pixel → [lon, lat, cos c] (cos c: 1 in the middle of the disc, 0 at its rim), or null off the planet
        inv: (x, y) => {
            const X = (x - cx) / R, Y = (cy - y) / R, rho = Math.hypot(X, Y);
            if (rho > 1) return null;
            const c = Math.asin(rho), sc = Math.sin(c), cc = Math.cos(c);
            const lat = rho ? Math.asin(cc * sp0 + (Y * sc * cp0) / rho) : p0;
            const lon = l0 + Math.atan2(X * sc, rho * cp0 * cc - Y * sp0 * sc);
            return [(((lon / RAD + 540) % 360) - 180), lat / RAD, cc];
        },
        // [lon, lat] → pixel; a point on the far side comes to the rim in its direction ("over the horizon")
        fwd: (lon, lat) => {
            const l = lon * RAD, p = lat * RAD;
            let X = Math.cos(p) * Math.sin(l - l0), Y = cp0 * Math.sin(p) - sp0 * Math.cos(p) * Math.cos(l - l0);
            if (sp0 * Math.sin(p) + cp0 * Math.cos(p) * Math.cos(l - l0) <= 0) { const k = 0.96 / (Math.hypot(X, Y) || 1); X *= k; Y *= k; }
            return [cx + R * X, cy - R * Y];
        },
    };
}
/** How a real map is framed: Earth as a whole globe, a country on the curve with the horizon near the top. */
export function geoView(g: Geo, planet: boolean, W: number, H: number): View {
    if (planet) return ortho(g.lon, g.lat, H * 0.625, W / 2, H / 2);
    // the country across about 70% of the frame (tested: the USA at R 1700), the horizon 40px from the top
    const R = Math.max(1700, Math.min(3500, (W * 0.7) / (g.w * RAD * Math.cos(g.lat * RAD)))), top = 40;
    const c = Math.asin((R + top - H / 2) / R) / RAD;   // how far north of the disc's centre the frame's middle is
    return ortho(g.lon, g.lat - c, R, W / 2, top + R);
}

let earth: Promise<ImageData> | null = null;
const loadEarth = () => (earth ??= new Promise<ImageData>((ok, bad) => {
    const i = new Image();
    i.onload = () => { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext('2d')!; g.drawImage(i, 0, 0); ok(g.getImageData(0, 0, c.width, c.height)); };
    i.onerror = () => { earth = null; bad(new Error('Mundi could not open its picture of the Earth (assets/earth.jpg).')); };
    i.src = new URL('../../assets/earth.jpg', import.meta.url).href;
}));

/** The plan of a real map: the Blue Marble seen through `geoView`, darker towards the rim, a thin blue atmosphere
 *  round the planet, stars in the black. */
export async function drawGeoPlan(g: Geo, planet: boolean, W: number, H: number, r: () => number): Promise<HTMLCanvasElement> {
    const src = await loadEarth(), v = geoView(g, planet, W, H);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d')!, out = ctx.createImageData(W, H), d = out.data, s = src.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, p = v.inv(x, y);
        if (!p) { d[i] = 5; d[i + 1] = 7; d[i + 2] = 13; d[i + 3] = 255; continue; }
        const sx = Math.min(src.width - 1, Math.floor(((p[0] + 180) / 360) * src.width)), sy = Math.min(src.height - 1, Math.floor(((90 - p[1]) / 180) * src.height));
        const j = (sy * src.width + sx) * 4, k = 0.6 + 0.4 * p[2];
        d[i] = s[j] * k; d[i + 1] = s[j + 1] * k; d[i + 2] = s[j + 2] * k; d[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    // the atmosphere: a blue rim just outside the planet's edge, found by stepping outwards from it
    ctx.fillStyle = 'rgb(90,150,220)';
    for (let x = 0; x < W; x += 2) for (let y = 0; y < H; y += 2) if (!v.inv(x, y) && (v.inv(x, y + 6) || v.inv(x, y - 6) || v.inv(x + 6, y) || v.inv(x - 6, y))) ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = '#c8d0e0';
    for (let k = 0; k < 160; k++) { const x = r() * W, y = r() * H; if (!v.inv(x, y)) ctx.fillRect(x, y, 1.5, 1.5); }
    // a little softer, so ComfyUI paints its own clouds and land rather than tracing the photo
    const soft = document.createElement('canvas'); soft.width = W; soft.height = H;
    const sg = soft.getContext('2d')!; sg.filter = 'blur(1.2px)'; sg.drawImage(c, 0, 0);
    return soft;
}

/** Asks the AI which of `maps` are real places on Earth, and where their places are. Sets `m.geo` on each real one
 *  and moves its pins to where they really are (kept inside the frame). Maps it calls made-up are left alone. */
export async function locate(w: WorldDef, maps: MapDef[], planet: (m: MapDef) => boolean, W: number, H: number): Promise<void> {
    const todo = maps.filter(m => !m.geo);
    if (!todo.length) return;
    const lines = todo.map(m => `${m.id}: ${m.name}${m.area && m.area !== m.name ? ` (in ${m.area})` : ''}\n${w.places.filter(p => p.map === m.id).map(p => `  ${p.id}: ${p.name}`).join('\n')}`).join('\n');
    const prompt = `World: ${w.name}. ${w.setting}

For each map below: if it is a real place on Earth (the planet itself, a real continent, country or region), answer "<map id>: <longitude>, <latitude>, <width in degrees of longitude it spans>" for its middle; for Earth itself use the point the story centres on and width 360. If it is made up, answer "<map id>: none". Then, for each place on a real map, answer "<place id>: <longitude>, <latitude>" where it is (for a made-up building, the real city it would be in; for a country, its middle). Numbers only, west and south negative, one line each, nothing else.

${lines}`;
    let raw = '';
    try { raw = await quiet(prompt, 1200); } catch (e) { console.warn('[Mundi] locate', e); return; }
    const at = new Map<string, number[] | null>();
    for (const l of raw.split('\n')) {
        const m = l.match(/^\s*[-*]?\s*([\w-]+)\s*:\s*(.+)$/); if (!m) continue;
        const n = m[2].split(/[,\s]+/).map(Number).filter(x => Number.isFinite(x));
        at.set(m[1], /none/i.test(m[2]) ? null : n.length >= 2 ? n : null);
    }
    for (const m of todo) {
        const g = at.get(m.id);
        if (!g || g.length < 3 || Math.abs(g[1]) > 90) continue;
        const pins = w.places.filter(x => x.map === m.id).map(p => [p, at.get(p.id)] as const).filter((x): x is readonly [Place, number[]] => !!x[1] && x[1].length >= 2);
        m.geo = { lon: g[0], lat: g[1], w: Math.max(1, Math.min(360, g[2])) };
        // a globe turns to face its places (the middle of them on the sphere), so as many as can be are on the near side
        if (planet(m) && pins.length > 1) {
            let X = 0, Y = 0, Z = 0;
            for (const [, [lo, la]] of pins) { X += Math.cos(la * RAD) * Math.cos(lo * RAD); Y += Math.cos(la * RAD) * Math.sin(lo * RAD); Z += Math.sin(la * RAD); }
            // (tilted no more than 30 degrees, or a world of northern countries shows mostly the Arctic)
            if (Math.hypot(X, Y, Z) > 0.1) m.geo = { ...m.geo, lon: +(Math.atan2(Y, X) / RAD).toFixed(1), lat: +Math.max(-30, Math.min(30, Math.atan2(Z, Math.hypot(X, Y)) / RAD)).toFixed(1) };
        }
        const v = geoView(m.geo, planet(m), W, H);
        for (const [p, [lo, la]] of pins) { const [x, y] = v.fwd(lo, la); movePin(p, (x / W) * 100, (y / H) * 100); }
    }
}
const movePin = (p: Place, x: number, y: number) => { p.x = +Math.max(4, Math.min(96, x)).toFixed(1); p.y = +Math.max(8, Math.min(94, y)).toFixed(1); };
