// New game, like The Sims: households (people who share a home, with how they are related), your own household
// (who lives with you), and choosing your home on the map. Everyone left over gets a home of their own at random.
import { homeKindName } from '../sim/places.js';
import { safeUrl } from '../core/safe.js';
import { state, notify, esc, toast, busy } from '../core/store.js';
import { getWorld, worldFile, isScenario, systemOn, type WorldDef } from '../core/world.js';
import { characters, thumb, charOf, createCharacter } from '../st/bridge.js';
import { pickFile } from './cropper.js';
import { TIE_TYPES, TIE_TONES, type TieType, type TieTone } from '../sim/living.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

export interface NgTie { a: string; b: string; type: TieType; tone: TieTone }
export interface NgHousehold { members: string[]; ties: NgTie[]; /** where they live (none: a home at random) */ home?: NgHome }
export interface NgFamily { avatar: string; type: TieType; tone: TieTone }
export interface NgHome { zone: string; x: number; y: number; n: number; /** inside a building (a place id), and the room's name */ in?: string; room?: string }

const wz = () => state.wizard as any;
const W = (): WorldDef => getWorld(wz().world)!;
const nm = (a: string) => charOf(a)?.name ?? a;
const hhs = (): NgHousehold[] => (wz().hh ??= []);
export const familyOf = (): NgFamily[] => (wz().family ??= []);
const inHousehold = (a: string) => hhs().some(h => h.members.includes(a)) || familyOf().some(f => f.avatar === a);
const opt = (v: string, l: string, on: boolean) => `<option value="${esc(v)}" ${on ? 'selected' : ''}>${esc(l)}</option>`;
const face = (a: string) => `<img src="${esc(thumb(a))}" alt="" title="${esc(nm(a))}">`;

/* ---------- step: households ---------- */

export function stepHouseholds(): string {
    const z = wz(); const list = hhs(); const sel = Math.min(z.hhSel ?? 0, Math.max(0, list.length - 1));
    const free = (z.cast as string[]).filter(a => !inHousehold(a));
    const h = list[sel];
    // a scenario: everyone lives in the same house, so only the relations
    if (isScenario(getWorld(z.world))) return `<p class="mu-muted">Everyone lives in the same house: say how they are related.</p>${relationsHtml(false)}${jobsHtml()}
        ${z.presetEdit || !(z.cast as string[]).length ? '' : `<div class="mu-row"><button class="mu-ghost" data-act="cp-save-wizard">${icon('save')}<span>Save these people as a preset</span></button></div>`}`;
    return `<h3>Households</h3>
        <p class="mu-muted">A household is people who live in the same home: a family, a couple, roommates. Put together the people who live together and say how they are related. Everyone you leave out gets a home of their own, at random. You can skip this.</p>
        <div class="mu-ngh">
            <aside class="mu-ngh-list">${list.map((x, i) => `<button class="mu-ngh-card ${i === sel ? 'is-on' : ''}" data-act="ngh-sel" data-i="${esc(i)}"><b>Household ${i + 1}</b>
                <span class="mu-hh-faces">${x.members.map(face).join('') || '<em>Empty</em>'}</span></button>`).join('')}
                <button class="mu-primary" data-act="ngh-new">${icon('plus')}<span>New household</span></button></aside>
            <section class="mu-ngh-edit">${h ? `
                <header class="mu-row"><h4>Household ${sel + 1}</h4><button class="mu-ghost mu-right" data-act="ngh-del" data-i="${esc(sel)}">${icon('trash')}<span>Remove</span></button></header>
                <div class="mu-ngh-members">${h.members.map(a => `<span class="mu-chip is-on">${face(a)}<span data-notr>${esc(nm(a))}</span><button class="mu-ibtn mu-ghost" data-act="ngh-out" data-who="${esc(a)}" title="Take out">${icon('x')}</button></span>`).join('') || '<p class="mu-muted">Click people below to add them.</p>'}</div>
                ${h.members.length >= 2 ? `<h5>How they are related</h5>
                    ${h.ties.map((t, k) => `<div class="mu-ties-add"><span data-notr>${esc(nm(t.a))} is</span><select data-input="ngh-tie" data-k="${esc(k)}" data-f="type">${TIE_TYPES.map(([id, l]) => opt(id, l, t.type === id)).join('')}</select>
                        <span data-notr>${esc(nm(t.b))}</span><select data-input="ngh-tie" data-k="${esc(k)}" data-f="tone">${TIE_TONES.map(([id, l]) => opt(id, l, t.tone === id)).join('')}</select>
                        <button class="mu-ibtn mu-ghost" data-act="ngh-tie-del" data-k="${esc(k)}">${icon('x')}</button></div>`).join('')}
                    <div class="mu-ties-add"><select data-input="ngh-pair" data-f="a">${h.members.map(a => opt(a, nm(a), (h.members.includes(z.hhA) ? z.hhA : h.members[0]) === a)).join('')}</select><span>and</span>
                        <select data-input="ngh-pair" data-f="b">${h.members.map(a => opt(a, nm(a), (h.members.includes(z.hhB) ? z.hhB : h.members[1]) === a)).join('')}</select>
                        <button data-act="ngh-tie-add">${icon('plus')}<span>Add a tie</span></button></div>` : ''}
                ${z.presetEdit ? '' : `<h5>Their home</h5>
                ${homePicker(sel, 'hhMap')}
                <div class="mu-row"><p class="mu-nghome-pick">${homeLine(h.home, 'No home chosen: one at random.')}</p>${h.home ? `<button class="mu-ghost" data-act="nghm-clear">${icon('x')}<span>At random</span></button>` : ''}</div>`}
                <h5>People without a household</h5>
                <div class="mu-chips">${free.map(a => `<button class="mu-chip" data-act="ngh-in" data-who="${esc(a)}">${face(a)}<span data-notr>${esc(nm(a))}</span></button>`).join('') || '<p class="mu-muted">Everyone has a household.</p>'}</div>`
            : '<p class="mu-muted">No households yet: everyone lives alone. Make one with "New household".</p>'}</section></div>
        ${relationsHtml(false)}
        ${jobsHtml()}
        ${z.presetEdit || !(z.cast as string[]).length ? '' : `<div class="mu-row"><button class="mu-ghost" data-act="cp-save-wizard">${icon('save')}<span>Save these people as a preset</span></button><small class="mu-muted">People, households and relations, for other worlds too (Library → Presets).</small></div>`}`;
}

/* ---------- jobs: what each of your characters does for a living ---------- */

// At random (the default), no job, or one of the world's jobs (in a scenario they happen off-screen).
function jobsHtml(): string {
    const z = wz(); const w = getWorld(z.world); if (z.presetEdit || !w || !systemOn(w, 'jobs') || !w.occupations.length) return '';
    const people = z.cast as string[]; if (!people.length) return '';
    const jobs: Record<string, string> = (z.jobs ??= {});
    return `<section class="mu-panel mu-ngjobs"><h3>Jobs</h3>
        <p class="mu-muted">What each one does for a living${isScenario(w) ? ' (outside the house, off-screen)' : ''}. "At random": the world picks one, or none.</p>
        <div class="mu-ngjobs-grid">${people.map(a => `<label class="mu-field"><span>${face(a)} <span data-notr>${esc(nm(a))}</span></span><select data-input="ngj-set" data-who="${esc(a)}">
            ${opt('', 'At random', !jobs[a])}${opt('none', 'No job', jobs[a] === 'none')}${w.occupations.map(o => opt(o.id, `${o.name} · ${o.ranks[0]?.name ?? ''}`, jobs[a] === o.id)).join('')}</select></label>`).join('')}</div>
    </section>`;
}

/* ---------- relations: anyone with anyone, in any household ---------- */

// Friends, rivals, enemies, allies, a couple… between any two people of this game (or with you), whatever
// household they live in. `mine`: only your relations (on the "Your character" step).
const rels = (): NgTie[] => (wz().rels ??= []);
export const relationsOf = (): NgTie[] => rels();
const who = (a: string) => (a === '__you' ? 'You' : nm(a));
function relationsHtml(mine: boolean): string {
    const z = wz();
    const people: string[] = [...new Set([...(z.cast as string[]), ...familyOf().map(f => f.avatar)])];
    const list = rels().map((t, k) => [t, k] as const).filter(([t]) => !mine || t.a === '__you' || t.b === '__you');
    const pick = (f: 'a' | 'b', def: string, withYou: boolean) => `<select data-input="ngr-pair" data-f="${esc(f)}">${(withYou ? ['__you', ...people] : people).map(a => opt(a, who(a), (z[`rel${f}`] ?? def) === a)).join('')}</select>`;
    return `<section class="mu-panel mu-ngrel"><h3>${mine ? 'Your relations' : 'Relations'}</h3>
        <p class="mu-muted">${mine ? 'How you start with anyone in this world, not only who lives with you: a best friend across town, a rival, an old enemy, someone you are dating.' : (isScenario(getWorld(z.world)) ? 'Between any two people of the house (or with you): siblings, friends, a couple, married, exes, rivals…' : 'Between any two people, in any household (or with you): friends, rivals, enemies, allies, a couple…')}</p>
        ${list.map(([t, k]) => `<div class="mu-ties-add">${t.a === '__you' ? '' : face(t.a)}<span data-notr>${esc(who(t.a))} ${t.a === '__you' ? 'are' : 'is'}</span>
            <select data-input="ngr-set" data-k="${esc(k)}" data-f="type">${TIE_TYPES.map(([id, l]) => opt(id, l, t.type === id)).join('')}</select>
            ${t.b === '__you' ? '' : face(t.b)}<span data-notr>${esc(who(t.b))}</span>
            <select data-input="ngr-set" data-k="${esc(k)}" data-f="tone">${TIE_TONES.map(([id, l]) => opt(id, l, t.tone === id)).join('')}</select>
            <button class="mu-ibtn mu-ghost" data-act="ngr-del" data-k="${esc(k)}">${icon('x')}</button></div>`).join('') || '<p class="mu-muted">None yet.</p>'}
        ${people.length ? `<div class="mu-ties-add">${mine ? '<span>You and</span>' : pick('a', '__you', true)}${mine ? '' : '<span>and</span>'}${pick('b', people[0], false)}
            <button data-act="ngr-add" data-mine="${mine ? '1' : ''}">${icon('plus')}<span>Add a relation</span></button></div>` : '<p class="mu-muted">Choose the people of this world first.</p>'}
    </section>`;
}

/* ---------- your household (on the "Your character" step, once you have one) ---------- */

export function yourHouseholdHtml(): string {
    const z = wz(); const fam = familyOf();
    if (isScenario(getWorld(z.world))) return relationsHtml(true);   // one house: no household of your own
    const q = String(z.famQ ?? '').toLowerCase();
    const pool = characters().filter(c => !fam.some(f => f.avatar === c.avatar) && !hhs().some(h => h.members.includes(c.avatar)) && (!q || String(c.name).toLowerCase().includes(q))).slice(0, 40);
    return `<section class="mu-panel mu-ngfam"><h3>Your household</h3>
        <p class="mu-muted">The people who live with you: family, a partner, roommates. They share your home and your wallet, and you can play as any of them later ("Play as").</p>
        ${fam.map((f, k) => `<div class="mu-ties-add">${face(f.avatar)}<b data-notr>${esc(nm(f.avatar))}</b><span>is your</span>
            <select data-input="ngf-set" data-k="${esc(k)}" data-f="type">${TIE_TYPES.map(([id, l]) => opt(id, l.replace(/ of$| to$/, ''), f.type === id)).join('')}</select>
            <select data-input="ngf-set" data-k="${esc(k)}" data-f="tone">${TIE_TONES.map(([id, l]) => opt(id, l, f.tone === id)).join('')}</select>
            <button class="mu-ibtn mu-ghost" data-act="ngf-del" data-k="${esc(k)}">${icon('x')}</button></div>`).join('') || '<p class="mu-muted">You live alone for now.</p>'}
        ${z.famNew ? newCharForm(z.famNew) : z.famOpen ? `<input class="mu-search" type="search" data-input="ngf-q" data-focus="ngfq" placeholder="Search your characters" value="${esc(z.famQ ?? '')}">
            <div class="mu-chips mu-ngfam-pool"><button class="mu-chip mu-ngfam-newchip" data-act="ngf-new">${icon('plus')}<span>Create a new character</span></button>${pool.map(c => `<button class="mu-chip" data-act="ngf-add" data-who="${esc(c.avatar)}">${face(c.avatar)}<span data-notr>${esc(c.name)}</span></button>`).join('') || '<p class="mu-muted">No characters found.</p>'}</div>`
            : `<div class="mu-row mu-ngfam-btns"><button data-act="ngf-open">${icon('plus')}<span>Add someone to your household</span></button><button data-act="ngf-new">${icon('user')}<span>Create a new character</span></button></div>`}
    </section>${relationsHtml(true)}`;
}

// A new SillyTavern character, made right here, who moves in with you.
interface NewChar { name: string; desc: string; url?: string; blob?: Blob }
function newCharForm(n: NewChar): string {
    return `<div class="mu-ngfam-new">
        <button class="mu-ngfam-pic" data-act="ngf-new-pic" title="Choose a picture" style="${n.url ? `background-image:url('${safeUrl(n.url)}')` : ''}">${n.url ? '' : `${icon('image')}<small>Picture</small>`}</button>
        <div class="mu-ngfam-newf">
            <input type="text" data-input="ngf-new-f" data-f="name" data-focus="ngfnew-name" maxlength="40" placeholder="Name" value="${esc(n.name)}">
            <textarea rows="3" data-input="ngf-new-f" data-f="desc" data-focus="ngfnew-desc" placeholder="Who they are: looks, personality, what they do (optional)">${esc(n.desc)}</textarea>
            <div class="mu-row"><small class="mu-muted">Saved as a character in your SillyTavern.</small><span class="mu-right mu-row"><button class="mu-ghost" data-act="ngf-new-cancel">Cancel</button><button class="mu-primary" data-act="ngf-new-yes">${icon('plus')}<span>Create and add</span></button></span></div>
        </div></div>`;
}

/* ---------- a home on the map (yours, or a household's) ---------- */

const sameHome = (a: NgHome | null | undefined, zone: string, x: number, y: number) => !!a && a.zone === zone && a.x === x && a.y === y;
// `who`: 'you' or a household's index. Homes chosen by someone else are shown as taken.
function homePicker(who: 'you' | number, mapKey: 'homeMap' | 'hhMap'): string {
    const z = wz(); const w = W();
    const maps = w.maps.filter(m => w.homes.zones.some(zn => zn.map === m.id));
    const mapId = maps.some(m => m.id === z[mapKey]) ? z[mapKey] : maps[0]?.id;
    const m = w.maps.find(x => x.id === mapId);
    const mine: NgHome | null = who === 'you' ? z.home ?? null : hhs()[who]?.home ?? null;
    const others: NgHome[] = [...(who === 'you' ? [] : [z.home]), ...hhs().filter((_h, i) => i !== who).map(h => h.home)].filter(Boolean) as NgHome[];
    const act = who === 'you' ? 'ngm' : 'nghm';
    return `${maps.length > 1 ? `<div class="mu-chips">${maps.map(x => `<button class="mu-chip ${x.id === mapId ? 'is-on' : ''}" data-act="${act}-map" data-id="${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>` : ''}
        ${m ? `<div class="mu-nghome-map" style="aspect-ratio:${m.ratio};width:min(100%, calc(64vh * ${m.ratio}));background-image:url('${safeUrl(worldFile(w, m.image))}')">
            ${w.homes.zones.filter(zn => zn.map === m.id).map(zn => zn.spots.map(([x, y], k) => {
                const on = sameHome(mine, zn.id, x, y), taken = others.some(o => sameHome(o, zn.id, x, y));
                return `<button class="mu-nghome-spot ${on ? 'is-on' : ''} ${taken ? 'is-taken' : ''}" style="left:${x}%;top:${y}%" data-act="${act}-pick" data-zone="${esc(zn.id)}" data-k="${esc(k)}" ${taken ? 'aria-disabled="true"' : ''} title="${esc(zn.name)} · ${zn.kind === 'house' ? 'House' : 'Apartment'} ${k + 1} · rent ${zn.rent}${taken ? ' · taken' : ''}">${icon('home')}</button>`;
            }).join('')).join('')}</div>` : ''}`;
}
const homeLine = (h: NgHome | null | undefined, none: string) => { const w = W(); const b = h?.in ? w.places.find(p => p.id === h.in) : null; if (b) return `${icon('home')} <b>${esc(h!.room || 'A room')}</b> in <b data-notr>${esc(b.name)}</b> · no rent`; const zone = h && w.homes.zones.find(zn => zn.id === h.zone); return zone && h ? `${icon('home')} <b>${esc(zone.name)}, ${esc(homeKindName(w, zone.kind))} ${h.n}</b> · ${esc(w.homes.kinds[zone.kind]?.name ?? zone.kind)} · rent ${zone.rent}` : `<span class="mu-muted">${none}</span>`; };

/* ---------- step: choosing your home ---------- */

export function stepHome(): string {
    const w = W();
    if (isScenario(w)) {   // a scenario: the kinds of bedroom as pictures, no floor plan
        const cur = wz().home;
        return `<h3>Choose your room</h3><p class="mu-muted">Your bedroom in ${esc(w.name)}. Not choosing: one is given to you.</p>
            <div class="mu-rooms-grid">${w.homes.zones.map(zn => { const k = w.homes.kinds[zn.kind]; const pic = k?.image ? worldFile(w, k.image) : '';
                return `<button class="mu-room ${cur?.zone === zn.id ? 'is-you' : ''}" data-act="ngm-pick" data-zone="${esc(zn.id)}" data-k="0"><i style="${pic ? `background-image:url('${safeUrl(pic)}')` : ''}">${cur?.zone === zn.id ? `<em>${icon('pin')} Yours</em>` : ''}</i>
                    <b data-notr>${esc(k?.name ?? zn.name)}</b><small class="mu-muted" data-notr>${esc(k?.desc ?? zn.desc ?? '')}</small></button>`; }).join('')}</div>`;
    }
    return `<h3>Choose your home</h3>
        <p class="mu-muted">Click a home on the map. The others are given to the people of the world after you choose.${familyOf().length ? ' Your household moves in with you.' : ''}</p>
        ${homePicker('you', 'homeMap')}
        <p class="mu-nghome-pick">${homeLine(wz().home, 'No home chosen yet: one is given by your origin.')}</p>
        ${insideHtml()}`;
}
// Or a home inside a building (a room in a guild tower, a dorm, a barracks): the building's pin is your home's, and
// your home is one of its floors.
export const homeInside = (w: WorldDef, place: string, room: string): NgHome | null => {
    const b = w.places.find(p => p.id === place); if (!b) return null;
    const zone = w.homes.zones.find(z => z.map === b.map) ?? w.homes.zones[0]; if (!zone) return null;
    return { zone: zone.id, x: b.x, y: b.y, n: 0, in: b.id, room: room.trim().slice(0, 60) };
};
function insideHtml() {
    const w = W(), z = wz(), cur: NgHome | undefined = z.home?.in ? z.home : undefined;
    const withFloors = new Set(w.places.map(p => p.in).filter(Boolean));
    const list = w.places.filter(p => !p.link && !p.in && !p.hidden).sort((a, b) => Number(withFloors.has(b.id)) - Number(withFloors.has(a.id)) || a.name.localeCompare(b.name));
    if (!list.length) return '';
    return `<section class="mu-panel mu-nghome-in"><h4>Or live inside a building</h4><p class="mu-muted">A room in a guild tower, a dorm, a barracks: your home becomes part of that building. No rent.</p>
        <div class="mu-row"><label class="mu-field"><span>Building</span><select data-input="ngm-in"><option value="">Choose…</option>${list.map(p => `<option value="${esc(p.id)}" ${cur?.in === p.id ? 'selected' : ''}>${esc(p.name)}${withFloors.has(p.id) ? ' (has floors)' : ''}</option>`).join('')}</select></label>
        <label class="mu-field"><span>Your room</span><input data-input="ngm-room" data-focus="ngmroom" maxlength="60" placeholder="Floor 9, Room 918" value="${esc(cur?.room ?? z.homeRoom ?? '')}"></label></div></section>`;
}

/* ---------- actions ---------- */

Object.assign(ACT, {
    'ngh-new': () => { hhs().push({ members: [], ties: [] }); wz().hhSel = hhs().length - 1; notify(); },
    'ngh-sel': (el) => { wz().hhSel = Number(el.dataset.i); notify(); },
    'ngh-del': (el) => { hhs().splice(Number(el.dataset.i), 1); wz().hhSel = 0; notify(); },
    'ngh-in': (el) => { const h = hhs()[wz().hhSel ?? 0]; if (h) h.members.push(el.dataset.who!); notify(); },
    'ngh-out': (el) => { const h = hhs()[wz().hhSel ?? 0]; if (!h) return; const a = el.dataset.who!; h.members = h.members.filter(x => x !== a); h.ties = h.ties.filter(t => t.a !== a && t.b !== a); notify(); },
    'ngh-tie-add': () => {
        const z = wz(); const h = hhs()[z.hhSel ?? 0]; if (!h) return;
        const a = z.hhA && h.members.includes(z.hhA) ? z.hhA : h.members[0], b = z.hhB && h.members.includes(z.hhB) ? z.hhB : h.members[1];
        if (!a || !b || a === b) { toast('Choose two different people.', 'info'); return; }
        h.ties = h.ties.filter(t => !((t.a === a && t.b === b) || (t.a === b && t.b === a)));
        h.ties.push({ a, b, type: 'sibling', tone: 'good' }); notify();
    },
    'ngh-tie-del': (el) => { const h = hhs()[wz().hhSel ?? 0]; if (h) h.ties.splice(Number(el.dataset.k), 1); notify(); },
    'ngf-open': () => { wz().famOpen = true; notify(); },
    'ngr-add': (el) => {
        const z = wz(); const people: string[] = [...new Set([...(z.cast as string[]), ...familyOf().map(f => f.avatar)])];
        const a = el.dataset.mine ? '__you' : (z.rela ?? '__you'), b = z.relb ?? people[0];
        if (!a || !b || a === b) { toast('Choose two different people.', 'info'); return; }
        const list = rels(); const i = list.findIndex(t => (t.a === a && t.b === b) || (t.a === b && t.b === a));
        const t: NgTie = { a, b, type: 'friend', tone: 'good' };
        if (i >= 0) list.splice(i, 1, t); else list.push(t);
        notify();
    },
    'ngr-del': (el) => { rels().splice(Number(el.dataset.k), 1); notify(); },
    'ngf-add': (el) => {
        const a = el.dataset.who!; const z = wz();
        familyOf().push({ avatar: a, type: 'sibling', tone: 'good' });
        if (!z.cast.includes(a)) z.cast.push(a);   // they live in this world, of course
        z.famOpen = false; z.famQ = ''; notify();
    },
    'ngf-new': () => { wz().famNew = { name: '', desc: '' }; notify(); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#mundi-root [data-focus="ngfnew-name"]')?.focus()); },
    'ngf-new-cancel': () => { const n = wz().famNew as NewChar | null; if (n?.url) URL.revokeObjectURL(n.url); wz().famNew = null; notify(); },
    'ngf-new-pic': async () => {
        const f = await pickFile(); const n = wz().famNew as NewChar | null; if (!f || !n) return;
        if (n.url) URL.revokeObjectURL(n.url);
        n.blob = f; n.url = URL.createObjectURL(f); notify();
    },
    'ngf-new-yes': async () => {
        const z = wz(); const n = z.famNew as NewChar | null; if (!n) return;
        const name = n.name.trim(); if (!name) { toast('Write a name.', 'warn'); return; }
        let a = '';
        try { a = await busy('Creating', () => createCharacter({ name, description: n.desc.trim() || `${name}.` }, n.blob)); }
        catch (e) { toast(String((e as Error).message ?? e), 'error'); return; }
        if (n.url) URL.revokeObjectURL(n.url);
        familyOf().push({ avatar: a, type: 'sibling', tone: 'good' });
        if (!z.cast.includes(a)) z.cast.push(a);
        z.famNew = null; z.famOpen = false; z.famQ = '';
        toast(`${name} was created and lives with you. Say how you are related.`, 'success'); notify();
    },
    'ngf-del': (el) => { familyOf().splice(Number(el.dataset.k), 1); notify(); },
    'ngm-map': (el) => { wz().homeMap = el.dataset.id; notify(); },
    'nghm-map': (el) => { wz().hhMap = el.dataset.id; notify(); },
    'nghm-pick': (el) => {
        const h = hhs()[wz().hhSel ?? 0]; const zn = W().homes.zones.find(x => x.id === el.dataset.zone); const k = Number(el.dataset.k);
        if (!h || !zn || !zn.spots[k] || el.getAttribute('aria-disabled') === 'true') return;
        h.home = { zone: zn.id, x: zn.spots[k][0], y: zn.spots[k][1], n: k + 1 }; notify();
    },
    'nghm-clear': () => { const h = hhs()[wz().hhSel ?? 0]; if (h) delete h.home; notify(); },
    'ngm-pick': (el) => {
        const zn = W().homes.zones.find(x => x.id === el.dataset.zone); const k = Number(el.dataset.k);
        if (!zn || !zn.spots[k] || el.getAttribute('aria-disabled') === 'true') return;
        wz().home = { zone: zn.id, x: zn.spots[k][0], y: zn.spots[k][1], n: k + 1 }; notify();
    },
});
Object.assign(INPUT, {
    'ngm-in': (el) => { const z = wz(); z.home = el.value ? homeInside(W(), el.value, z.home?.room ?? z.homeRoom ?? '') : null; notify(); },
    'ngm-room': (el) => { const z = wz(); z.homeRoom = el.value; if (z.home?.in) z.home.room = el.value.trim().slice(0, 60); },
    'ngj-set': (el) => { const z = wz(); const j = (z.jobs ??= {}); const a = el.dataset.who!; if (el.value) j[a] = el.value; else delete j[a]; },
    'ngh-tie': (el) => { const h = hhs()[wz().hhSel ?? 0]; const t = h?.ties[Number(el.dataset.k)]; if (t) (t as any)[el.dataset.f!] = el.value; },
    'ngh-pair': (el) => { wz()[el.dataset.f === 'a' ? 'hhA' : 'hhB'] = el.value; },
    'ngr-set': (el) => { const t = rels()[Number(el.dataset.k)]; if (t) (t as any)[el.dataset.f!] = el.value; },
    'ngr-pair': (el) => { wz()[el.dataset.f === 'a' ? 'rela' : 'relb'] = el.value; },
    'ngf-set': (el) => { const f = familyOf()[Number(el.dataset.k)]; if (f) (f as any)[el.dataset.f!] = el.value; },
    'ngf-new-f': (el) => { const n = wz().famNew as NewChar | null; if (n) (n as any)[el.dataset.f!] = el.value; },
    'ngf-q': (el) => { wz().famQ = el.value; notify(); },
});
