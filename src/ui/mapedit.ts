// The world creator's maps: upload a map picture, then click on it to add places, links to other maps (a city on
// the region map) or homes. Pins can be dragged. A place gets a name, a description, tags and a background
// (one of SillyTavern's backgrounds, or a picture you upload).
import { TIME_SLOTS } from '../sim/daynight.js';
import { safeUrl, num as toNum } from '../core/safe.js';
import { notify, esc, toast, ROOT_ID } from '../core/store.js';
import { worldFile, isScenario, PLACE_ROLES, placeIs, guessRoles, getWorld, builtInIds, type WorldDef, type Place, type MapDef } from '../core/world.js';
import { bgHead, bgGrid, bgHref } from './bgpick.js';
import { uploadWorldPicture, imageRatio, newId } from '../sim/creator.js';
import { closedOf } from '../sim/daynight.js';
import { pickFile } from './cropper.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';
import { CW, W, txt, area, sel, num, chk } from './creator.js';

export const ME = { map: '', mode: 'move' as 'move' | 'place' | 'link' | 'homes', zone: '', pin: '', zoom: 1, bgPick: false, bgq: '', bgs: null as string[] | null, bgPeriod: '' };
const TAGS = ['leisure', 'food', 'shop', 'work', 'study', 'service', 'health'];
const TAG_NAMES: Record<string, string> = { leisure: 'Leisure', food: 'Food', shop: 'Shopping', work: 'Work', study: 'Study', service: 'Services', health: 'Health' };

// A place's background: the usual one, or the one of a part of the day ('' removes it).
function setBg(p: Place, period: string, url: string) {
    if (!period) { if (url) p.bg = url; else delete p.bg; return; }
    if (url) (p.bgs ??= {})[period] = url;
    else if (p.bgs) { delete p.bgs[period]; if (!Object.keys(p.bgs).length) delete p.bgs; }
}
const curMap = (w: WorldDef): MapDef | undefined => w.maps.find(m => m.id === ME.map) ?? w.maps[0];
const placeIdx = (w: WorldDef, id: string) => w.places.findIndex(p => p.id === id);

function pinHtml(w: WorldDef, p: Place) {
    const target = p.link ? w.maps.find(m => m.id === p.link) : null;
    return `<div class="mu-me-pin ${p.link ? 'is-link' : ''} ${ME.pin === p.id ? 'is-sel' : ''}" data-pin="${esc(p.id)}" style="left:${p.x}%;top:${p.y}%">
        <span class="dot">${p.link ? icon('map') : p.hidden || p.restricted ? icon('lock') : ''}</span><span class="label">${esc(p.name)}${target ? ` → ${esc(target.name)}` : ''}${p.in ? ` (${esc(p.floor || 'a floor')} of ${esc(w.places.find(b => b.id === p.in)?.name ?? '?')})` : ''}</span></div>`;
}
function homesHtml(w: WorldDef, m: MapDef) {
    return w.homes.zones.filter(z => z.map === m.id).map(z => z.spots.map((s, k) => `<div class="mu-me-home ${ME.mode === 'homes' && z.id === ME.zone ? 'is-zone' : ''}" data-zone="${esc(z.id)}" data-k="${esc(k)}" style="left:${s[0]}%;top:${s[1]}%" title="${esc(z.name)} · ${k + 1}">${k + 1}</div>`).join('')).join('');
}

function placeForm(w: WorldDef): string {
    const i = placeIdx(w, ME.pin);
    if (i < 0) return `<p class="mu-muted">${ME.mode === 'place' ? 'Click on the map to add a place.' : ME.mode === 'link' ? 'Click on the map where the other map is (a city on the region map, say).' : ME.mode === 'homes' ? 'Click on the map to add a home to the chosen area; click a home to remove it.' : 'Click a pin to edit it. Drag pins to move them.'}</p>`;
    const p = w.places[i]; const path = `places.${i}`;
    if (p.link) {
        return `<h4>Link to another map</h4>${txt('Name', `${path}.name`)}
            ${sel('Opens the map', `${path}.link`, w.maps.filter(m => m.id !== p.map).map(m => [m.id, m.name] as [string, string]))}
            <p class="mu-muted">In the game, clicking it opens that map.</p>
            <button class="mu-danger" data-act="me-del-pin">${icon('trash')}<span>Remove</span></button>`;
    }
    const bg = p.bg ? worldFile(w, p.bg) : '';
    return `<h4>Place</h4><div class="mu-me-pf"><div class="mu-me-pfcol">${txt('Name', `${path}.name`)}${area('What it is (the AI and the map card use it)', `${path}.desc`, 3)}${txt('What is going on there (optional)', `${path}.event`, 'Always busy at lunch.')}</div>
        <div class="mu-me-pfcol"><div class="mu-field"><span>Tags</span><div class="mu-chips">${TAGS.map(t => `<button class="mu-chip ${(p.tags ?? []).includes(t) ? 'is-on' : ''}" data-act="cw-chip" data-path="${path}.tags" data-v="${esc(t)}">${TAG_NAMES[t]}</button>`).join('')}</div>
            <small class="mu-muted">Leisure: people spend free time here. Food and Shopping: what can be bought. Work: jobs can be here.</small></div>
            <div class="mu-field"><span>What it is for the game</span><div class="mu-chips">${PLACE_ROLES.map(r => `<button class="mu-chip ${placeIs(p, r.id) ? 'is-on' : ''}" data-act="me-role" data-v="${esc(r.id)}">${esc(r.name)}</button>`).join('')}</div>
                <small class="mu-muted">${p.roles ? 'Set by you.' : 'Guessed from its name; click to set them yourself.'}</small></div>
            ${isScenario(w) ? chk('Off unless the player picks it', `${path}.scenarioOff`, 'A Home: when starting a game, the player chooses which rooms the house has.') : ''}
            ${num('How busy (× its kind; 0.5 quiet, 1.5 lively)', `${path}.crowd`, 0, 0.1)}
            <div class="mu-field"><span>Closed at</span><div class="mu-chips">${w.time.periods.map(per => `<button class="mu-chip ${closedOf(w, p).includes(per.id) ? 'is-on' : ''}" data-act="me-closed" data-period="${esc(per.id)}">${esc(per.name)}</button>`).join('')}</div>
                <small class="mu-muted">${Array.isArray(p.closed) ? 'Its own hours.' : 'Like places of its kind (shops close at night, offices at dawn…). Click to set its own hours.'} Closed: nothing to do there, nobody comes for leisure.</small></div></div>
        <div class="mu-me-pfcol"><div class="mu-field"><span>Background of the scene</span>
            <div class="mu-cw-cover is-small" style="${bg ? `background-image:url('${safeUrl(bg)}')` : ''}">${bg ? '' : '<span>The map around it</span>'}</div>
            <div class="mu-row"><button data-act="me-bg-pick">${icon('image')}<span>From Backgrounds</span></button><button class="mu-ghost" data-act="me-bg-upload">${icon('upload')}<span>Upload</span></button>${bg ? `<button class="mu-ghost" data-act="me-bg-clear">${icon('x')}</button>` : ''}</div></div>
            <details class="mu-me-times" ${Object.keys(p.bgs ?? {}).length ? 'open' : ''}><summary>At other times of the day</summary>
                ${TIME_SLOTS.map(per => { const b = p.bgs?.[per.id] ? worldFile(w, p.bgs[per.id]) : ''; return `<div class="mu-me-time"><div class="mu-cw-cover is-mini" style="${b ? `background-image:url('${safeUrl(b)}')` : ''}">${b ? '' : '<span>usual</span>'}</div><b>${esc(per.name)}</b>
                    <button class="mu-ghost mu-ibtn" data-act="me-bg-pick" data-period="${esc(per.id)}" title="From Backgrounds">${icon('image')}</button><button class="mu-ghost mu-ibtn" data-act="me-bg-upload" data-period="${esc(per.id)}" title="Upload">${icon('upload')}</button>${b ? `<button class="mu-ghost mu-ibtn" data-act="me-bg-clear" data-period="${esc(per.id)}" title="Use the usual one">${icon('x')}</button>` : ''}</div>`; }).join('')}
                <small class="mu-muted">Day 5–12 h, afternoon 12–18 h, night 18–5 h. Empty: the usual one.</small></details>
        ${storyFields(w, p, path)}
        <button class="mu-danger" data-act="me-del-pin">${icon('trash')}<span>Remove this place</span></button></div></div>`;
}
// A floor of a building, and how the place opens up in the story (hidden until found, restricted until let in).
function storyFields(w: WorldDef, p: Place, path: string): string {
    const buildings = w.places.filter(x => x.id !== p.id && !x.link && !x.in && x.map === p.map);
    const facs = w.factions ?? [];
    const o = `${path}.opens`;
    return `<details class="mu-me-times" ${p.in || p.hidden || p.restricted ? 'open' : ''}><summary>Floors, hidden and restricted</summary>
        ${sel('A floor of a building', `${path}.in`, [['', '(no: a place of its own)'], ...buildings.map(b => [b.id, b.name] as [string, string])])}
        ${p.in ? txt('Which floor', `${path}.floor`, 'Floor 3') : ''}
        <small class="mu-muted">A building is one pin on the map; clicking it shows its floors. Each floor is a place of its own (people, roles, hours); going up or down takes a few minutes.</small>
        ${chk('Hidden until found', `${path}.hidden`, 'Not on the map until the story gives the player the way there (an address, being taken there).')}
        ${txt('Restricted: who it is for (empty: open)', `${path}.restricted`, 'Hunters Association members only')}
        <label class="mu-field"><span>Other names the story may use (commas)</span><input data-input="cw" data-type="csv" data-path="${path}.aka" data-focus="${path}.aka" value="${esc((p.aka ?? []).join(', '))}" placeholder="an address, a nickname"></label>
        <div class="mu-field"><span>A hidden or restricted place opens by itself when (all that are set)</span>
            ${txt('You know this person well', `${o}.who`, 'a name')}${num('…with a bond of at least (0-100, empty: 30)', `${o}.bond`, 0)}
            ${facs.length ? sel('You are in this faction', `${o}.faction`, [['', '(any)'], ...facs.map(f => [f.id, f.name] as [string, string])]) : ''}
            ${p.opens?.faction ? sel('…at this rank or higher', `${o}.rank`, (facs.find(f => f.id === p.opens!.faction)?.ranks ?? []).map((r, k) => [String(k + 1), r] as [string, string]), 'num') : ''}
            ${num('RPG level at least', `${o}.level`, 0)}${num('Reputation here at least (-100 to 100)', `${o}.rep`, -100)}
            <small class="mu-muted">The story can open it too: when a reply names it, a short AI check asks whether the player just learned the way or got let in. And the player can open it by hand.</small></div>
    </details>`;
}

function bgPicker(): string {
    if (!ME.bgPick) return '';
    return `<div class="mu-dlg-veil" data-act="me-bg-close"></div><div class="mu-panel mu-scpick" role="dialog"><header><h3>Background</h3><button class="mu-ibtn mu-ghost" data-act="me-bg-close" aria-label="Close">${icon('x')}</button></header>
        ${bgHead('me-bgq', 'mebgq', ME.bgq)}${bgGrid({ act: 'me-bg', q: ME.bgq, keep: 'mebg' })}</div>`;
}

// The maps of the ready worlds (their pictures, as links any world can use).
function libraryMaps(): { url: string; name: string; ratio: number }[] {
    const out: { url: string; name: string; ratio: number }[] = []; const seen = new Set<string>();
    for (const id of builtInIds()) { const bw = getWorld(id); if (!bw) continue; for (const m of bw.maps) { const url = worldFile(bw, m.image); if (!url || seen.has(url)) continue; seen.add(url); out.push({ url, name: `${m.name} (${bw.name})`, ratio: m.ratio }); } }
    return out;
}

export function mapEditorHtml(w: WorldDef): string {
    const m = curMap(w);
    if (m) ME.map = m.id;
    if (ME.mode === 'homes' && !w.homes.zones.some(z => z.id === ME.zone)) ME.zone = w.homes.zones.find(z => z.map === m?.id)?.id ?? '';
    const mi = m ? w.maps.indexOf(m) : -1;
    const maps = `<aside class="mu-me-maps">
        <h4>Maps</h4>${w.maps.map(x => `<button class="mu-cw-row ${x.id === m?.id ? 'is-on' : ''}" data-act="me-map" data-id="${esc(x.id)}"><b>${esc(x.name)}</b><small>${x.parent ? `in ${esc(w.maps.find(y => y.id === x.parent)?.name ?? '')}` : 'Top map'}</small></button>`).join('')}
        <button class="mu-primary" data-act="me-add-map">${icon('plus')}<span>Add a map</span></button>
        <details class="mu-me-lib"><summary>Add one of Mundi's maps</summary><div class="mu-me-libgrid">${libraryMaps().map(x => `<button data-act="me-add-lib" data-url="${esc(x.url)}" data-ratio="${toNum(x.ratio, 1)}" data-name="${esc(x.name.replace(/ \(.*\)$/, ''))}" title="${esc(x.name)}"><i style="background-image:url('${safeUrl(x.url)}')"></i><span>${esc(x.name)}</span></button>`).join('')}</div></details>
        ${m ? `<div class="mu-me-mapform">${txt('Name', `maps.${mi}.name`)}
            ${txt('Where it is (its city, state or province)', `maps.${mi}.area`, 'Porto Alto')}
            ${sel('It is inside', `maps.${mi}.parent`, [['', '(nothing: a top map)'], ...w.maps.filter(x => x.id !== m.id).map(x => [x.id, x.name] as [string, string])])}
            ${m.parent ? num('Minutes to get here from the map it is inside (empty: like any trip between maps)', `maps.${mi}.trip`, 0, 5) : ''}
            ${w.maps.some(x => x.parent === m.id) ? chk('A town with districts (trips between its own places stay short)', `maps.${mi}.town`) : ''}
            <details class="mu-me-region"><summary>Life in this region</summary>
                ${num('Public mood (−100 … 100)', `maps.${mi}.mood`, -100)}${num('Tension (0 … 100)', `maps.${mi}.tension`, 0)}
                ${num('Prices ×', `maps.${mi}.prices`, 0.2, 0.05)}${num('Crowds ×', `maps.${mi}.crowd`, 0, 0.1)}
                ${chk('Its own weather', `maps.${mi}.ownWeather`)}
                ${sel('Climate (its extreme weather)', `maps.${mi}.climate`, [['', '(as the map it is in; else temperate)'], ['temperate', 'Temperate'], ['cold', 'Cold'], ['hot', 'Hot'], ['coastal', 'Coastal']])}
                <small class="mu-muted">Empty: mood 15, tension 10, prices and crowds ×1. They drift day by day around these (weather, weekends, what happens there).</small></details>
            <details class="mu-me-times" ${Object.keys(m.images ?? {}).length ? 'open' : ''}><summary>Picture at other times of the day</summary>
                ${TIME_SLOTS.map(per => { const b = m.images?.[per.id] ? worldFile(w, m.images[per.id]) : ''; return `<div class="mu-me-time"><div class="mu-cw-cover is-mini" style="${b ? `background-image:url('${safeUrl(b)}')` : ''}">${b ? '' : '<span>usual</span>'}</div><b>${esc(per.name)}</b>
                    <button class="mu-ghost mu-ibtn" data-act="me-map-img" data-period="${esc(per.id)}" title="Upload">${icon('upload')}</button>${b ? `<button class="mu-ghost mu-ibtn" data-act="me-map-img-clear" data-period="${esc(per.id)}" title="Use the usual one">${icon('x')}</button>` : ''}</div>`; }).join('')}
                <small class="mu-muted">Day 5–12 h, afternoon 12–18 h, night 18–5 h (same size as the usual picture, so pins stay in place).</small></details>
            <details class="mu-me-lib"><summary>Use one of Mundi's maps</summary><div class="mu-me-libgrid">${libraryMaps().map(x => `<button class="${m.image === x.url ? 'is-on' : ''}" data-act="me-map-lib" data-url="${esc(x.url)}" data-ratio="${toNum(x.ratio, 1)}" title="${esc(x.name)}"><i style="background-image:url('${safeUrl(x.url)}')"></i><span>${esc(x.name)}</span></button>`).join('')}</div>
                <small class="mu-muted">The pictures of the ready worlds: pick one for this map (the original stays in its world).</small></details>
            <div class="mu-row"><button class="mu-ghost" data-act="me-map-img">${icon('image')}<span>Change picture</span></button><button class="mu-ghost" data-act="me-del-map">${icon('trash')}</button></div></div>` : ''}
        <p class="mu-muted">One map per city or area. On a bigger map (a region, a kingdom), add a link where each city is: in the game it opens that city's map.</p></aside>`;
    if (!m) return `<div class="mu-me">${maps}<div class="mu-me-empty"><p>Add a map: a picture of your city, region or kingdom.</p></div></div>`;
    const zones = w.homes.zones.filter(z => z.map === m.id);
    const tools = `<div class="mu-me-tools">
        ${([['move', 'Select / move', 'select'], ['place', 'Add a place', 'pin'], ['link', 'Link to a map', 'map'], ['homes', 'Homes', 'home']] as const).map(([id, l, ic]) => `<button class="${ME.mode === id ? 'is-on' : ''}" data-act="me-mode" data-v="${esc(id)}">${icon(ic)}<span>${l}</span></button>`).join('')}
        ${ME.mode === 'homes' ? `<select data-input="me-zone">${zones.map(z => `<option value="${esc(z.id)}" ${z.id === ME.zone ? 'selected' : ''}>${esc(z.name)} (${z.spots.length})</option>`).join('') || '<option value="">(no area on this map)</option>'}</select><button class="mu-ghost" data-act="me-new-zone">${icon('plus')}<span>New area</span></button>` : ''}
        <span class="mu-me-zoom"><button data-act="me-zoom" data-d="-1">−</button><button data-act="me-zoom" data-d="1">+</button></span></div>`;
    return `<div class="mu-me">${maps}
        <div class="mu-me-center">${tools}
            <div class="mu-me-stage is-${ME.mode}" data-keep="me-stage"><div class="mu-me-img" data-me-img style="width:${ME.zoom * 100}%;aspect-ratio:${m.ratio};background-image:url('${safeUrl(worldFile(w, m.image))}')">
                ${homesHtml(w, m)}${w.places.filter(p => p.map === m.id).map(p => pinHtml(w, p)).join('')}</div></div></div>
        <aside class="mu-me-side" data-keep="me-side">${placeForm(w)}</aside></div>${bgPicker()}`;
}

/* ---------- pointer: add, select and drag pins ---------- */

let drag: { id: string; el: HTMLElement; sx: number; sy: number; moved: boolean; home?: { zone: string; k: number } } | null = null;
const pct = (e: PointerEvent, img: HTMLElement) => { const r = img.getBoundingClientRect(); return [+(((e.clientX - r.left) / r.width) * 100).toFixed(2), +(((e.clientY - r.top) / r.height) * 100).toFixed(2)] as [number, number]; };
const clamp = (v: number) => Math.max(0, Math.min(100, v));

// Scrolling over the map zooms it, around the mouse.
document.addEventListener('wheel', (e) => {
    const stage = (e.target as HTMLElement).closest?.(`#${ROOT_ID} .mu-me-stage`) as HTMLElement | null;
    if (!stage) return;
    const img = stage.querySelector<HTMLElement>('[data-me-img]'); if (!img) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const fx = (stage.scrollLeft + e.clientX - r.left) / img.offsetWidth, fy = (stage.scrollTop + e.clientY - r.top) / img.offsetHeight;
    ME.zoom = Math.max(0.5, Math.min(4, ME.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    img.style.width = `${ME.zoom * 100}%`;
    stage.scrollLeft = fx * img.offsetWidth - (e.clientX - r.left);
    stage.scrollTop = fy * img.offsetHeight - (e.clientY - r.top);
}, { passive: false });

document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest?.(`#${ROOT_ID} .mu-me-stage`) || !CW.w) return;
    const pin = t.closest<HTMLElement>('.mu-me-pin');
    const home = t.closest<HTMLElement>('.mu-me-home');
    if (pin) drag = { id: pin.dataset.pin!, el: pin, sx: e.clientX, sy: e.clientY, moved: false };
    else if (home && ME.mode !== 'homes') drag = { id: '', el: home, sx: e.clientX, sy: e.clientY, moved: false, home: { zone: home.dataset.zone!, k: Number(home.dataset.k) } };
    else return;
    e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    drag.moved = true;
    const img = drag.el.closest<HTMLElement>('[data-me-img]'); if (!img) return;
    const [x, y] = pct(e, img);
    drag.el.style.left = `${clamp(x)}%`; drag.el.style.top = `${clamp(y)}%`;
});
document.addEventListener('pointerup', (e) => {
    const t = e.target as HTMLElement;
    if (drag) {
        const d = drag; drag = null;
        const w = CW.w; if (!w) return;
        if (d.moved) {
            const x = clamp(parseFloat(d.el.style.left)), y = clamp(parseFloat(d.el.style.top));
            if (d.home) { const z = w.homes.zones.find(z => z.id === d.home!.zone); if (z) z.spots[d.home.k] = [x, y]; }
            else { const p = w.places.find(p => p.id === d.id); if (p) { p.x = x; p.y = y; } }
            CW.dirty = true; notify(); return;
        }
        if (!d.home) { ME.pin = d.id; notify(); }
        return;
    }
    const img = t.closest?.<HTMLElement>(`#${ROOT_ID} [data-me-img]`);
    const w = CW.w; if (!img || !w) return;
    const [x, y] = pct(e, img);
    const m = curMap(w); if (!m) return;
    const homeEl = t.closest<HTMLElement>('.mu-me-home');
    if (ME.mode === 'homes') {
        const z = w.homes.zones.find(z => z.id === ME.zone);
        if (!z) { toast('Create a housing area first (New area).', 'info'); return; }
        if (homeEl && homeEl.dataset.zone === z.id) z.spots.splice(Number(homeEl.dataset.k), 1);
        else z.spots.push([x, y]);
        CW.dirty = true; notify(); return;
    }
    if (ME.mode === 'place') {
        const p: Place = { id: newId('place'), name: 'New place', map: m.id, x, y, tags: ['leisure'], desc: '' };
        w.places.push(p); ME.pin = p.id; ME.mode = 'move'; CW.dirty = true; notify();
        setTimeout(() => document.querySelector<HTMLInputElement>(`#${ROOT_ID} .mu-me-side input`)?.select(), 50);
        return;
    }
    if (ME.mode === 'link') {
        const other = w.maps.find(x2 => x2.id !== m.id);
        if (!other) { toast('Add the other map first (Add a map).', 'info'); return; }
        const p: Place = { id: newId('link'), name: other.name, map: m.id, x, y, link: other.id };
        if (!other.parent) other.parent = m.id;
        w.places.push(p); ME.pin = p.id; ME.mode = 'move'; CW.dirty = true; notify();
        return;
    }
    if (!t.closest('.mu-me-pin')) { ME.pin = ''; notify(); }
});

/* ---------- actions ---------- */

async function addMapPicture(): Promise<{ image: string; ratio: number } | null> {
    const f = await pickFile('image/*'); if (!f) return null;
    try {
        const image = await uploadWorldPicture(W(), f, 'map');
        return { image, ratio: await imageRatio(image) };
    } catch (e: any) { toast(String(e?.message ?? e), 'error'); return null; }
}

Object.assign(ACT, {
    'me-map': (el) => { ME.map = el.dataset.id!; ME.pin = ''; notify(); },
    'me-mode': (el) => { ME.mode = el.dataset.v as any; notify(); },
    'me-zoom': (el) => { ME.zoom = Math.max(0.5, Math.min(4, ME.zoom * (el.dataset.d === '1' ? 1.25 : 0.8))); notify(); },
    'me-add-map': async () => {
        const pic = await addMapPicture(); if (!pic) return;
        const w = W();
        const m: MapDef = { id: newId('map'), name: w.maps.length ? 'New map' : w.name, ...pic };
        w.maps.push(m); ME.map = m.id; ME.pin = ''; CW.dirty = true; notify();
    },
    'me-map-img': async (el) => {
        const m = curMap(W()); if (!m) return;
        const per = el.dataset.period;
        if (per) {   // the picture of one part of the day (the usual one keeps the map's size)
            const f = await pickFile('image/*'); if (!f) return;
            try { (m.images ??= {})[per] = await uploadWorldPicture(W(), f, `map-${m.id}-${per}`); CW.dirty = true; } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
            notify(); return;
        }
        const pic = await addMapPicture(); if (!pic) return; Object.assign(m, pic); CW.dirty = true; notify();
    },
    'me-add-lib': (el) => {
        const w = W(); const m: MapDef = { id: newId('map'), name: w.maps.length ? el.dataset.name || 'New map' : w.name, image: el.dataset.url!, ratio: Number(el.dataset.ratio) || 1.79 };
        w.maps.push(m); ME.map = m.id; ME.pin = ''; CW.dirty = true; notify();
    },
    'me-map-lib': (el) => { const m = curMap(W()); if (!m) return; m.image = el.dataset.url!; m.ratio = Number(el.dataset.ratio) || m.ratio; delete m.images; CW.dirty = true; notify(); },
    'me-map-img-clear': (el) => { const m = curMap(W()); if (!m?.images) return; delete m.images[el.dataset.period!]; if (!Object.keys(m.images).length) delete m.images; CW.dirty = true; notify(); },
    'me-role': (el) => {
        const w = W(); const p = w.places.find(x => x.id === ME.pin); if (!p) return;
        const list = new Set(p.roles ?? guessRoles(p)); const r = el.dataset.v!;
        if (list.has(r)) list.delete(r); else list.add(r);
        p.roles = PLACE_ROLES.map(x => x.id).filter(id => list.has(id)); CW.dirty = true; notify();
    },
    'me-closed': (el) => {
        const w = W(); const p = w.places.find(x => x.id === ME.pin); if (!p) return;
        const list = new Set(closedOf(w, p)); const per = el.dataset.period!;
        if (list.has(per)) list.delete(per); else list.add(per);
        p.closed = w.time.periods.map(x => x.id).filter(id => list.has(id)); CW.dirty = true; notify();
    },
    'me-del-map': () => {
        const w = W(); const m = curMap(w); if (!m) return;
        const n = w.places.filter(p => p.map === m.id && !p.link).length;
        if (n && !confirmTwice(`del-map-${m.id}`, `This map has ${n} places. Click again to remove the map and its places.`)) return;
        w.places = w.places.filter(p => p.map !== m.id && p.link !== m.id);
        w.homes.zones.forEach(z => { if (z.map === m.id) z.spots = []; });
        w.maps = w.maps.filter(x => x.id !== m.id);
        w.maps.forEach(x => { if (x.parent === m.id) delete x.parent; });
        ME.map = w.maps[0]?.id ?? ''; ME.pin = ''; CW.dirty = true; notify();
    },
    'me-del-pin': () => {
        const w = W(); const i = placeIdx(w, ME.pin); if (i < 0) return;
        const used = w.occupations.filter(o => o.place === ME.pin).map(o => o.name);
        if (used.length && !confirmTwice(`del-${ME.pin}`, `Jobs are here (${used.join(', ')}). Click again to remove it anyway.`)) return;
        w.places.splice(i, 1); ME.pin = ''; CW.dirty = true; notify();
    },
    'me-new-zone': () => {
        const w = W(); const m = curMap(w); if (!m) return;
        const z = { id: newId('zone'), name: `Area ${w.homes.zones.length + 1}`, map: m.id, kind: Object.keys(w.homes.kinds)[0] ?? 'apartment', rent: 300, desc: '', spots: [] as [number, number][] };
        w.homes.zones.push(z); ME.zone = z.id; CW.dirty = true; notify();
    },
    'me-bg-pick': (el) => { ME.bgPick = true; ME.bgq = ''; ME.bgs = null; ME.bgPeriod = el.dataset.period ?? ''; notify(); },
    'me-bg-close': () => { ME.bgPick = false; notify(); },
    'me-bg': (el) => { const p = W().places.find(p => p.id === ME.pin); if (p) { setBg(p, ME.bgPeriod, bgHref(el.dataset.file!)); CW.dirty = true; } ME.bgPick = false; notify(); },
    'me-bg-upload': async (el) => {
        const p = W().places.find(p => p.id === ME.pin); if (!p) return;
        const f = await pickFile('image/*'); if (!f) return;
        const per = el.dataset.period ?? '';
        try { setBg(p, per, await uploadWorldPicture(W(), f, `place-${p.name}${per ? `-${per}` : ''}`)); CW.dirty = true; } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        notify();
    },
    'me-bg-clear': (el) => { const p = W().places.find(p => p.id === ME.pin); if (p) { setBg(p, el.dataset.period ?? '', ''); CW.dirty = true; } notify(); },
});
Object.assign(INPUT, {
    'me-zone': (el) => { ME.zone = el.value; notify(); },
    'me-bgq': (el) => { ME.bgq = el.value; notify(); },
});

const asked = new Map<string, number>();
function confirmTwice(key: string, msg: string) {
    const t = asked.get(key) ?? 0;
    if (Date.now() - t < 5000) { asked.delete(key); return true; }
    asked.set(key, Date.now()); toast(msg, 'warn'); return false;
}
