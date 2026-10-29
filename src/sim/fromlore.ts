// World creator, "From lorebooks": your AI reads lorebooks and Mundi builds a world from what it finds.
// The AI only writes small flat sketches (places, people, groups, jobs) one part of the lorebooks at a time;
// everything with rules (ids, maps, pins, homes, ranks, pay, routines) is done here, so the world always loads.
// This file is pure data work (no SillyTavern calls): the screen in ui/fromlore.ts asks the AI and calls these.
import type { WorldDef, Place, MapDef, HomeZone, Occupation, ExampleCharacter, FactionDef, LoreEntry } from '../core/world.js';
import type { SkBasic } from './basics.js';

/* ---------- reading the lorebooks ---------- */

/** One enabled entry of a lorebook, flattened. */
export interface LoreItem { book: string; uid: string; title: string; keys: string[]; text: string; bucket: Bucket }
export type Bucket = 'places' | 'people' | 'groups' | 'rules' | 'other';
export const BUCKETS: { id: Bucket; name: string; desc: string }[] = [
    { id: 'places', name: 'Places', desc: 'cities, districts, buildings, sites' },
    { id: 'people', name: 'People', desc: 'characters, NPCs, who is who' },
    { id: 'groups', name: 'Groups', desc: 'guilds, companies, factions, governments' },
    { id: 'rules', name: 'Rules & history', desc: 'systems, magic, history, events: rarely needed for the map, but always read for the world details (shops, rent, realm…)' },
    { id: 'other', name: 'Other', desc: 'anything the titles and keys do not say' },
];
const RE: [Bucket, RegExp][] = [
    ['places', /\b(place|places|location|city|town|village|district|region|kingdom|country|map|building|tower|castle|academy|school|tavern|inn|shop|street|hospital|hq|headquarters|dungeon|gate|forest|island|realm)\b/i],
    ['people', /\b(people|person|character|characters|npc|npcs|cast|who|family|members?)\b/i],
    ['groups', /\b(guild|guilds|faction|factions|organi[sz]ations?|company|corporation|clan|house|order|gang|government|association|agency|church|army)\b/i],
    ['rules', /\b(rules?|system|systems|mechanics?|magic|spells?|history|timeline|lore|events?|calendar|agreements?|status|ranks?|stats?|instructions?|format|guide)\b/i],
];
export function bucketOf(title: string, keys: string[], text: string): Bucket {
    const head = `${title} ${keys.join(' ')}`;
    for (const [b, re] of RE) if (re.test(head)) return b;
    for (const [b, re] of RE) if (re.test(text.slice(0, 160))) return b;
    return 'other';
}
/** The enabled entries of a lorebook (SillyTavern's world info JSON). */
export function readBook(book: string, data: any): LoreItem[] {
    const out: LoreItem[] = [];
    for (const [uid, e] of Object.entries<any>(data?.entries ?? {})) {
        if (!e || e.disable || !String(e.content ?? '').trim()) continue;
        const keys = (Array.isArray(e.key) ? e.key : []).map(String).filter(Boolean);
        const title = String(e.comment || keys[0] || `Entry ${uid}`).trim();
        const text = String(e.content).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        out.push({ book, uid: String(e.uid ?? uid), title, keys, text, bucket: bucketOf(title, keys, text) });
    }
    return out;
}
/** Parts of about `max` characters, one AI call each (a long entry is cut into several parts). */
export interface Chunk { text: string; items: string[] }
export function chunk(items: LoreItem[], max = 6000): Chunk[] {
    const out: Chunk[] = [];
    let cur: Chunk = { text: '', items: [] };
    const push = () => { if (cur.text) out.push(cur); cur = { text: '', items: [] }; };
    for (const it of items) {
        const head = `### ${it.title}${it.keys.length ? ` (keys: ${it.keys.slice(0, 6).join(', ')})` : ''}\n`;
        let body = it.text;
        while (body) {
            const room = max - cur.text.length - head.length - 2;
            if (room < 800 && cur.text) { push(); continue; }
            const part = body.length <= room ? body : cutAt(body, room);
            cur.text += `${cur.text ? '\n\n' : ''}${head}${part}`; cur.items.push(`${it.book}:${it.uid}`);
            body = body.slice(part.length).trim();
            if (body) push();
        }
    }
    push();
    return out;
}
const cutAt = (s: string, n: number) => { const c = s.slice(0, n); const i = Math.max(c.lastIndexOf('\n'), c.lastIndexOf('. ')); return i > n * 0.5 ? c.slice(0, i + 1) : c; };

/* ---------- the sketch: what the AI found ---------- */

export const PLACE_KINDS = ['residential', 'office', 'shop', 'market', 'restaurant', 'cafe', 'bar', 'hotel', 'hospital', 'clinic', 'police', 'government',
    'school', 'park', 'gym', 'temple', 'guild', 'lab', 'warehouse', 'dock', 'factory', 'station', 'prison', 'dungeon', 'landmark', 'other'] as const;
export const AREA_KINDS = ['region', 'city', 'district', 'building'] as const;
export interface SkArea { name: string; in?: string; kind?: string; desc?: string; keep?: boolean }
export interface SkPlace { name: string; area?: string; kind?: string; desc?: string; floor?: string; hidden?: boolean; restricted?: string; keep?: boolean }
export interface SkTie { to: string; type?: string; tone?: string }
export interface SkPerson { name: string; aka?: string[]; gender?: string; age?: number; role?: string; job?: string; work?: string; lives?: string; looks?: string; clothes?: string; personality?: string; greeting?: string; ties?: SkTie[]; keep?: boolean }
export interface SkGroup { name: string; kind?: string; hq?: string; desc?: string; ranks?: string[]; allies?: string[]; rivals?: string[]; secret?: boolean; keep?: boolean }
export interface SkJob { name: string; place?: string; ranks?: string[]; keep?: boolean }
/** `basics`: the everyday places the lorebooks did not mention (sim/basics.ts); none until the AI was asked. */
export interface Sketch { areas: SkArea[]; places: SkPlace[]; people: SkPerson[]; groups: SkGroup[]; jobs: SkJob[]; basics?: SkBasic[] }
export const emptySketch = (): Sketch => ({ areas: [], places: [], people: [], groups: [], jobs: [] });

const TIES = ['parent', 'child', 'sibling', 'spouse', 'partner', 'cousin', 'roommate', 'friend', 'bestfriend', 'ally', 'colleague', 'dating', 'rival', 'enemy', 'ex', 'mentor', 'apprentice'];
const TONES = ['close', 'good', 'neutral', 'tense', 'hostile'];

/** The prompt for one part of the lorebooks. `known`: names found so far, so the same thing keeps one name. */
export function sketchPrompt(part: string, known: Sketch, style: string): string {
    const names = (l: { name: string }[]) => l.map(x => x.name).join(', ');
    const seen = [known.areas.length ? `Areas: ${names(known.areas)}` : '', known.places.length ? `Places: ${names(known.places)}` : '', known.people.length ? `People: ${names(known.people)}` : '', known.groups.length ? `Groups: ${names(known.groups)}` : '']
        .filter(Boolean).join('\n').slice(0, 2000);
    return `You are helping build the world of a life-simulation game (style: ${style}) from lorebook notes. The game needs a map of areas and places, the people who live there, the groups they belong to, and the jobs people do.

Read the notes below and reply with ONE JSON object, nothing else (no code fences, no comments):
{"areas":[{"name":"","in":"the bigger area it is inside, or empty","kind":"region|city|district|building","desc":"one line"}],
 "places":[{"name":"","area":"the area it is in","kind":"${PLACE_KINDS.join('|')}","desc":"one line: what it is and what it looks like","floor":"its floor or wing, when it is part of a building (Floor 3, Basement, East wing), else empty","hidden":false,"restricted":"who may go in, when not everyone may (S-rank hunters only, staff only), else empty"}],
 "people":[{"name":"full name","aka":["other names or titles used for them"],"gender":"man|woman|other","age":30,"role":"what they are in this world, one line","job":"their job title","work":"the place where they work","lives":"the area or place where they live","looks":"appearance (body, face, hair), one line","clothes":"their style and the clothes they usually wear, plus anything they always wear (a hijab, glasses…); chosen to fit them when the lorebook does not say, one line","personality":"one line","greeting":"one short line they would say when meeting someone new","ties":[{"to":"another person's full name","type":"${TIES.join('|')}","tone":"${TONES.join('|')}"}]}],
 "groups":[{"name":"","kind":"guild|company|government|gang|order|house|school|other","hq":"the place that is its headquarters","desc":"one line","ranks":["lowest rank","…","highest rank"],"allies":["group names"],"rivals":["group names"],"secret":false}],
 "jobs":[{"name":"job title","place":"where it is done","ranks":["lowest","…","highest"]}]}

Rules:
- Only what the notes state or clearly imply. Leave out anything not there; empty lists are fine.
- Keep names exactly as written. Use the names already found (below) for the same things.
- A building with floors or wings: the building is an area with kind "building"; each floor or wing that matters is a place in it, with its "floor".
- "hidden": true for a place most people do not know of or cannot find without being told or taken there (a secret base, an unlisted hideout, someone's private home).
- "restricted": for a place only some may enter (members, staff, a rank, a pass); leave it empty for public places.
- People's homes are areas or places, not separate entries in "places" unless the notes describe them.
- Story events, contracts and secrets are not places, people or groups: leave them out.
${seen ? `\nAlready found (reuse these names):\n${seen}\n` : ''}
Notes:
${part}`;
}
export function summaryPrompt(name: string, sk: Sketch, settingHints: string): string {
    const list = (l: { name: string; keep?: boolean }[], n = 40) => l.filter(x => x.keep !== false).slice(0, n).map(x => x.name).join(', ');
    return `A life-simulation world called "${name}" was built from lorebooks. It has these areas: ${list(sk.areas)}; places: ${list(sk.places)}; groups: ${list(sk.groups)}; people: ${list(sk.people, 25)}.
${settingHints ? `From the lorebooks:\n${settingHints.slice(0, 3000)}\n` : ''}
Reply with ONE JSON object, nothing else:
{"description":"what the world is, max 150 characters","setting":"2 to 4 sentences: the place, the time and what life there is like, told to the game's AI","currency":{"name":"the money's name","symbol":"its symbol","after":false,"perDollar":1},"realm":"the country or realm the areas belong to"}
"perDollar": about how many of this money one US dollar is worth (dollars 1, euros 1, yen 150, won 1300, gold coins 0.1). "after": true if the symbol goes after the amount.`;
}

/** Reads a JSON object out of an AI answer (code fences, text around it and trailing commas are forgiven; an answer
 *  cut off before its end keeps what came complete, and says so with `cutOff`). */
export function parseJson(raw: string): any {
    let s = String(raw ?? '').replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/```(?:json)?/gi, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0) throw new Error('The AI did not answer with JSON.');
    const tidy = (x: string) => x.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
    if (b > a) {
        const whole = s.slice(a, b + 1);
        try { return JSON.parse(whole); } catch { /* try the forgiving way */ }
        try { return JSON.parse(tidy(whole)); } catch { /* maybe cut off */ }
    }
    s = s.slice(a);
    const cut = mend(s);
    if (cut) try { return Object.defineProperty(JSON.parse(tidy(cut)), 'cutOff', { value: true }); } catch { /* not even that */ }
    throw new Error('The AI\'s answer was not complete JSON (it may have been cut off).');
}
// An answer cut off midway (the reply ran out of room): keeps it up to the last whole item, and closes what was
// still open.
function mend(s: string): string {
    const stack: string[] = [];
    let inStr = false, esc = false, best = '', i = 0;
    for (; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
        else if (c === '}' || c === ']') { stack.pop(); if (!stack.length) return s.slice(0, i + 1); best = s.slice(0, i + 1) + [...stack].reverse().join(''); }
        else if (c === ',' && stack.length) best = s.slice(0, i) + [...stack].reverse().join('');   // after a whole item or "key": value
    }
    return best;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.map(x => str(x, 80)).filter(Boolean) : []);
const longer = (a?: string, b?: string) => ((b ?? '').length > (a ?? '').length ? b : a);
const union = (a?: string[], b?: string[]) => { const out = [...(a ?? [])]; for (const x of b ?? []) if (!out.some(y => norm(y) === norm(x))) out.push(x); return out; };

/** Adds one AI answer to the sketch: new names are added, known ones get what they were missing. */
export function mergeSketch(sk: Sketch, raw: any): Sketch {
    const r = raw && typeof raw === 'object' ? raw : {};
    const add = <T extends { name: string }>(list: T[], item: T, fill: (old: T, x: T) => void, alias: (x: T) => string[] = () => []) => {
        if (!item.name) return;
        const keys = [item.name, ...alias(item)].map(norm);
        const old = list.find(x => [x.name, ...alias(x)].map(norm).some(k => keys.includes(k)));
        if (old) fill(old, item); else list.push(item);
    };
    for (const a of Array.isArray(r.areas) ? r.areas : []) add(sk.areas, { name: str(a?.name, 80), in: str(a?.in, 80), kind: str(a?.kind, 20), desc: str(a?.desc) },
        (o, x) => { o.in ||= x.in; o.kind ||= x.kind; o.desc = longer(o.desc, x.desc); });
    for (const p of Array.isArray(r.places) ? r.places : []) add(sk.places, { name: str(p?.name, 80), area: str(p?.area, 80), kind: str(p?.kind, 20), desc: str(p?.desc), floor: str(p?.floor, 30), hidden: p?.hidden === true || p?.hidden === 'true', restricted: str(p?.restricted, 80).replace(/^(none|no|everyone|anyone|open|public)$/i, '') },
        (o, x) => { o.area ||= x.area; o.kind = o.kind && o.kind !== 'other' ? o.kind : x.kind; o.desc = longer(o.desc, x.desc); o.floor ||= x.floor; o.hidden ||= x.hidden; o.restricted ||= x.restricted; });
    for (const p of Array.isArray(r.people) ? r.people : []) {
        const ties = (Array.isArray(p?.ties) ? p.ties : []).map((t: any) => ({ to: str(t?.to, 80), type: str(t?.type, 20), tone: str(t?.tone, 20) })).filter((t: SkTie) => t.to);
        const age = Number(p?.age);
        add(sk.people, { name: str(p?.name, 80), aka: strs(p?.aka), gender: str(p?.gender, 20), age: age > 0 && age < 1000 ? Math.round(age) : undefined, role: str(p?.role), job: str(p?.job, 80), work: str(p?.work, 80), lives: str(p?.lives, 80), looks: str(p?.looks), clothes: str(p?.clothes), personality: str(p?.personality), greeting: str(p?.greeting, 300), ties },
            (o, x) => { o.aka = union(o.aka, x.aka); o.gender ||= x.gender; o.age ??= x.age; o.role = longer(o.role, x.role); o.job ||= x.job; o.work ||= x.work; o.lives ||= x.lives; o.looks = longer(o.looks, x.looks); o.clothes = longer(o.clothes, x.clothes); o.personality = longer(o.personality, x.personality); o.greeting ||= x.greeting; for (const t of x.ties ?? []) if (!(o.ties ??= []).some(y => norm(y.to) === norm(t.to))) o.ties.push(t); },
            x => x.aka ?? []);
    }
    for (const g of Array.isArray(r.groups) ? r.groups : []) add(sk.groups, { name: str(g?.name, 80), kind: str(g?.kind, 20), hq: str(g?.hq, 80), desc: str(g?.desc), ranks: strs(g?.ranks), allies: strs(g?.allies), rivals: strs(g?.rivals), secret: g?.secret === true },
        (o, x) => { o.kind ||= x.kind; o.hq ||= x.hq; o.desc = longer(o.desc, x.desc); if ((x.ranks?.length ?? 0) > (o.ranks?.length ?? 0)) o.ranks = x.ranks; o.allies = union(o.allies, x.allies); o.rivals = union(o.rivals, x.rivals); o.secret ||= x.secret; });
    for (const j of Array.isArray(r.jobs) ? r.jobs : []) add(sk.jobs, { name: str(j?.name, 80), place: str(j?.place, 80), ranks: strs(j?.ranks) },
        (o, x) => { o.place ||= x.place; if ((x.ranks?.length ?? 0) > (o.ranks?.length ?? 0)) o.ranks = x.ranks; });
    // a place that is also an area (a building named as both) stays an area only
    sk.places = sk.places.filter(p => !sk.areas.some(a => norm(a.name) === norm(p.name) && a.kind === 'building'));
    return sk;
}

/* ---------- building the world ---------- */

export interface Summary { description?: string; setting?: string; currency?: { name?: string; symbol?: string; after?: boolean; perDollar?: number }; realm?: string }
/** What the place's kind means for the game: its tags, roles, when it is closed, and the job routine there. */
const KIND: Record<string, { tags: string[]; roles?: string[]; shut?: 'night' | 'morning'; routine?: string }> = {
    office: { tags: ['work'], shut: 'night' }, shop: { tags: ['work', 'shop'], shut: 'night' }, market: { tags: ['work', 'shop', 'leisure'], shut: 'night' },
    restaurant: { tags: ['work', 'food'], shut: 'morning' }, cafe: { tags: ['work', 'food'], shut: 'night', routine: 'early' }, bar: { tags: ['work', 'food', 'leisure'], roles: ['tavern', 'hire'], shut: 'morning', routine: 'night' },
    hotel: { tags: ['work', 'service'] }, hospital: { tags: ['work', 'health', 'service'], roles: ['healer'] }, clinic: { tags: ['work', 'health', 'service'], roles: ['healer'], shut: 'night' },
    police: { tags: ['work', 'service'], roles: ['guarded', 'jail'] }, government: { tags: ['work', 'service'], roles: ['guarded'], shut: 'night' },
    school: { tags: ['work', 'study'], shut: 'night' }, park: { tags: ['leisure'] }, gym: { tags: ['work', 'sport', 'leisure'] }, temple: { tags: ['leisure'], roles: ['shrine'] },
    guild: { tags: ['work'], roles: ['contracts', 'hire'] }, lab: { tags: ['work'], shut: 'night' }, warehouse: { tags: ['work'], roles: ['blackmarket'] }, dock: { tags: ['work', 'leisure'], roles: ['blackmarket'] },
    factory: { tags: ['work'], routine: 'early' }, station: { tags: ['service'], roles: ['guarded'] }, prison: { tags: ['work'], roles: ['jail', 'guarded'] },
    dungeon: { tags: ['leisure'], roles: [] }, landmark: { tags: ['leisure'] }, other: { tags: ['leisure'] },
};
// A small seeded random, so the same sketch always lays out the same map.
function rng(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
const idOf = (s: string) => norm(s).replace(/ /g, '_').slice(0, 30) || 'x';
const uniq = (used: Set<string>, base: string) => { let id = base, n = 2; while (used.has(id)) id = `${base}_${n++}`; used.add(id); return id; };

// A plain picture for a map until a real one is painted or uploaded: a tinted ground, a grid and the map's name.
export function mapPicture(name: string, kind = 'city'): string {
    const r = rng(name); const hue = Math.floor(r() * 360);
    const bg = kind === 'building' ? `hsl(${hue},12%,22%)` : kind === 'region' ? `hsl(${(hue + 90) % 360},28%,30%)` : `hsl(${hue},20%,26%)`;
    const blobs = Array.from({ length: 7 }, () => `<ellipse cx="${(10 + r() * 140).toFixed(0)}" cy="${(10 + r() * 80).toFixed(0)}" rx="${(10 + r() * 24).toFixed(0)}" ry="${(6 + r() * 16).toFixed(0)}" fill="hsla(${(hue + 30) % 360},30%,60%,0.10)"/>`).join('');
    const label = name.replace(/[<>&"']/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><defs><pattern id="g" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="0.4"/></pattern></defs><rect width="160" height="100" fill="${bg}"/>${blobs}<rect width="160" height="100" fill="url(#g)"/><text x="80" y="94" text-anchor="middle" font-family="Georgia,serif" font-size="6" fill="rgba(255,255,255,0.35)">${label}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Turns the kept parts of the sketch into the world (`w`: a new world with its style's rules and nothing else). */
export function buildWorld(w: WorldDef, sk: Sketch, sum: Summary, books: string[]): WorldDef {
    const keep = <T extends { keep?: boolean }>(l: T[]) => l.filter(x => x.keep !== false);
    const areas = keep(sk.areas), places = keep(sk.places), people = keep(sk.people), groups = keep(sk.groups), jobs = keep(sk.jobs);
    // the basics kept: places like the others, with their job
    for (const b of keep(sk.basics ?? [])) {
        if (places.some(p => norm(p.name) === norm(b.name))) continue;
        places.push({ name: b.name, area: b.area, kind: b.kind, desc: b.desc });
        // the same job in another settlement's basic place is a job of its own (one job is done at one place)
        if (b.job) jobs.push({ name: jobs.some(j => norm(j.name) === norm(b.job)) ? `${b.job}, ${b.name}` : b.job, place: b.name, ranks: b.ranks });
    }
    const used = new Set<string>();
    const scale = moneyScale(sum.currency?.perDollar);

    // the maps: every area is one; areas inside no other area hang from one top map
    const areaKey = new Map<string, MapDef>();
    const maps: MapDef[] = [];
    const roots = areas.filter(a => !a.in || !areas.some(b => b !== a && norm(b.name) === norm(a.in)));
    let top: MapDef;
    const mk = (name: string, kind: string): MapDef => { const m: MapDef = { id: uniq(used, `m_${idOf(name)}`), name, image: mapPicture(name, kind), ratio: 1.6, climate: 'temperate' }; maps.push(m); return m; };
    if (roots.length === 1) top = mk(roots[0].name, roots[0].kind || 'city');
    else top = mk(sum.realm || w.name, 'region');
    top.town = true; top.area = sum.realm || top.name;
    if (roots.length === 1) areaKey.set(norm(roots[0].name), top);
    const kindOf = new Map<MapDef, string>();
    kindOf.set(top, roots.length === 1 ? roots[0].kind || 'city' : 'region');
    // a building (an area of kind "building" with no areas inside) is not a map: it is one pin on its map, and its
    // places are its floors
    const isBuilding = (a: SkArea) => a.kind === 'building' && !areas.some(b => b !== a && norm(b.in) === norm(a.name));
    const buildingMap = new Map<string, MapDef>();
    // parents before children: walk down from the top
    const pending = areas.filter(a => !areaKey.has(norm(a.name)));
    for (let guard = 0; pending.length && guard < 20; guard++) {
        for (let i = 0; i < pending.length; i++) {
            const a = pending[i];
            const parent = a.in ? areaKey.get(norm(a.in)) : top;
            if (!parent && areas.some(b => norm(b.name) === norm(a.in))) continue;   // its parent is not made yet
            const p = parent ?? top;
            if (isBuilding(a)) { buildingMap.set(norm(a.name), p); pending.splice(i--, 1); continue; }
            const m = mk(a.name, a.kind || 'district');
            const pk = kindOf.get(p) ?? 'city';
            m.parent = p.id; m.area = p.area ?? top.area;
            m.trip = a.kind === 'building' ? 5 : pk === 'region' ? 90 : 25;
            kindOf.set(m, a.kind || 'district'); areaKey.set(norm(a.name), m);
            pending.splice(i--, 1);
        }
    }

    // the places, and a pin on each map for the maps inside it
    const out: Place[] = [];
    const placeKey = new Map<string, Place>();
    const night = w.time.periods.filter(p => p.from < 360 || p.from >= 1260).map(p => p.id);
    const morning = w.time.periods.filter(p => p.from < 720).map(p => p.id);
    const buildings = new Map<string, Place>();
    for (const a of areas) {
        const m = buildingMap.get(norm(a.name)); if (!m) continue;
        const b: Place = { id: uniq(used, idOf(a.name)), name: a.name, map: m.id, x: 0, y: 0, tags: ['leisure'], desc: a.desc || '' };
        (b as any).kind = 'other';
        out.push(b); placeKey.set(norm(a.name), b); buildings.set(norm(a.name), b);
    }
    for (const p of places) {
        const inB = buildings.get(norm(p.area));
        const map = inB ? maps.find(m => m.id === inB.map)! : areaKey.get(norm(p.area)) ?? top;
        const k = KIND[p.kind ?? ''] ?? (p.kind === 'residential' ? { tags: ['leisure'] } : KIND.other);
        const pl: Place = { id: uniq(used, idOf(p.name)), name: p.name, map: map.id, x: 0, y: 0, tags: [...k.tags], desc: p.desc || '' };
        if (k.roles) pl.roles = [...k.roles];
        if (k.shut) pl.closed = k.shut === 'night' ? night : morning;
        if (inB) { pl.in = inB.id; if (p.floor) pl.floor = p.floor; }
        if (p.hidden) pl.hidden = true;
        if (p.restricted) pl.restricted = p.restricted;
        (pl as any).kind = p.kind;   // read by the routines below, removed before saving
        out.push(pl); placeKey.set(norm(p.name), pl);
    }
    for (const m of maps) if (m.parent) out.push({ id: uniq(used, `to_${m.id.slice(2)}`), name: m.name, map: m.parent, x: 0, y: 0, link: m.id });
    for (const m of maps) layout(out.filter(p => p.map === m.id && !p.in), m.id);
    for (const p of out) if (p.in) { const b = out.find(x => x.id === p.in); if (b) { p.x = b.x; p.y = b.y; } }   // a floor sits on its building's pin
    // an empty map still gets one place, so it can be visited
    for (const m of maps) if (!out.some(p => p.map === m.id && !p.link)) out.push({ id: uniq(used, `${m.id.slice(2)}_streets`), name: `${m.name} streets`, map: m.id, x: 50, y: 50, tags: ['leisure'], desc: `the streets of ${m.name}` });

    const findPlace = (name?: string) => (name ? placeKey.get(norm(name)) ?? [...placeKey.values()].find(p => norm(p.name).includes(norm(name)) || norm(name).includes(norm(p.name))) : undefined);
    const findMap = (name?: string) => { if (!name) return undefined; const p = findPlace(name); return areaKey.get(norm(name)) ?? (p ? maps.find(m => m.id === p.map) : undefined); };
    const firstWork = out.find(p => !p.link && p.tags?.includes('work')) ?? out.find(p => !p.link)!;
    // where a job is done: the place named, or the first workplace in the area (a building) named
    const workAt = (name?: string) => { const p = findPlace(name); if (p) return (buildings.has(norm(p.name)) && out.find(x => x.in === p.id && x.tags?.includes('work'))) || p; const m = name ? areaKey.get(norm(name)) : undefined; return (m && out.find(x => x.map === m.id && !x.link && x.tags?.includes('work'))) || firstWork; };

    // homes: one housing area for each map people live on (and the top map, for the player)
    const kindIds = Object.keys(w.homes.kinds);
    const homeKind = kindIds.find(k => /apart|room|lodg|cottage|flat/i.test(k)) ?? kindIds[0] ?? 'apartment';
    const zones: HomeZone[] = [];
    const zoneFor = (m: MapDef): HomeZone => {
        let z = zones.find(x => x.map === m.id);
        if (!z) {
            const r = rng(m.id);
            z = { id: uniq(used, `home_${m.id.slice(2)}`), name: `${m.name} homes`, map: m.id, kind: homeKind, rent: round(120 * scale), desc: `homes in ${m.name}`,
                spots: Array.from({ length: 6 }, (_, i) => [Math.round(8 + (i % 3) * 7 + r() * 3), Math.round(80 + Math.floor(i / 3) * 8 + r() * 3)] as [number, number]) };
            zones.push(z);
        }
        return z;
    };
    zoneFor(top);

    // jobs: the listed ones, and any job title someone has
    const occ: Occupation[] = [];
    const occKey = new Map<string, Occupation>();
    const addJob = (name: string, at?: string, ranks?: string[]) => {
        if (!name || occKey.has(norm(name))) return occKey.get(norm(name));
        const place = workAt(at);
        const names = (ranks?.length ? ranks : [`Junior ${name}`, name, `Senior ${name}`]).slice(0, 6);
        const k = KIND[(place as any).kind ?? ''];
        const hours: [number, number] = k?.routine === 'night' ? [16, 24] : k?.routine === 'early' ? [6, 15] : [8, 18];
        const o: Occupation = { id: uniq(used, `job_${idOf(name)}`), name, place: place.id, shift: 6, hours, ranks: names.map((n, i) => ({ name: n, pay: round((15 + i * 6) * scale) })),
            promote: names.slice(1).map((_, i) => 4 + i * 4), cost: { energy: 25, hunger: 15, thirst: 15, mood: 5, hygiene: 15 }, likes: [] };
        for (const s of Object.keys(o.cost!)) if (!w.statuses.some(x => x.id === s)) delete o.cost![s];
        occ.push(o); occKey.set(norm(name), o); return o;
    };
    for (const j of jobs) addJob(j.name, j.place, j.ranks);
    for (const p of people) if (p.job) addJob(p.job, p.work);

    // people
    const tpl = Object.keys(w.cast.routineTemplates);
    const routineFor = (o?: Occupation) => { const k = o ? KIND[(out.find(p => p.id === o.place) as any)?.kind ?? '']?.routine : undefined; return k && tpl.includes(k) ? k : tpl.includes('office') ? 'office' : tpl[0] ?? ''; };
    const leisure = out.filter(p => !p.link && p.tags?.some(t => ['leisure', 'food', 'shop'].includes(t)));
    const cast: ExampleCharacter[] = people.slice(0, 40).map(p => {
        const o = p.job ? occKey.get(norm(p.job)) : undefined;
        const home = zoneFor(findMap(p.lives) ?? (o ? maps.find(m => m.id === out.find(x => x.id === o.place)?.map) : undefined) ?? top);
        const r = rng(p.name);
        const fun = [...new Set([0, 1, 2].map(() => leisure[Math.floor(r() * leisure.length)]?.id).filter(Boolean) as string[])];
        const desc = [`{{char}} is ${p.name}${p.age ? `, ${p.age}` : ''}${p.role ? `, ${p.role.replace(/\.$/, '')}` : ''}.`, p.looks, p.personality].filter(Boolean).map(s => s!.charAt(0).toUpperCase() + s!.slice(1)).map(s => /[.!?]$/.test(s) ? s : `${s}.`).join(' ')
            + (p.clothes ? `\n\nClothing and style:\n${p.clothes.charAt(0).toUpperCase()}${p.clothes.slice(1)}${/[.!?]$/.test(p.clothes) ? '' : '.'}` : '');
        const ex: ExampleCharacter = { name: p.name, age: p.age ?? 30, occupation: o?.id ?? null, home: home.id, routine: routineFor(o), leisure: fun, description: desc, first_mes: p.greeting ? `*${p.name} looks up.* ${p.greeting}` : '' };
        if (p.personality) ex.personality = p.personality;
        return ex;
    });
    const castKey = new Map<string, string>();
    for (const p of people.slice(0, 40)) for (const n of [p.name, ...(p.aka ?? [])]) castKey.set(norm(n), p.name);
    people.slice(0, 40).forEach((p, i) => {
        const ties = (p.ties ?? []).map(t => ({ to: castKey.get(norm(t.to)) ?? '', type: TIES.includes(t.type ?? '') ? t.type! : 'colleague', tone: TONES.includes(t.tone ?? '') ? t.tone! : 'neutral' }))
            .filter(t => t.to && t.to !== p.name);
        if (ties.length) cast[i].ties = ties;
    });

    // groups
    const gid = new Map<string, string>();
    for (const g of groups) gid.set(norm(g.name), uniq(used, `fac_${idOf(g.name)}`));
    const factions: FactionDef[] = groups.map(g => {
        const hq = findPlace(g.hq);
        const f: FactionDef = { id: gid.get(norm(g.name))!, name: g.name, kind: g.kind || 'guild', desc: g.desc, ranks: g.ranks?.length ? g.ranks.slice(0, 8) : ['Member', 'Officer', 'Leader'], quota: 1 };
        if (hq) { f.hq = hq.id; f.jobs = occ.filter(o => o.place === hq.id).map(o => o.id); }
        const ids = (l?: string[]) => (l ?? []).map(n => gid.get(norm(n))).filter((x): x is string => !!x && x !== f.id);
        if (ids(g.allies).length) f.allies = ids(g.allies);
        if (ids(g.rivals).length) f.rivals = ids(g.rivals);
        if (g.secret) { f.secret = true; if (hq && !hq.in) hq.hidden = true; }
        return f;
    });
    for (const b of buildings.values()) { const fl = out.filter(p => p.in === b.id); if (fl.length && fl.every(p => p.hidden)) b.hidden = true; }

    // the world
    for (const p of out) delete (p as any).kind;
    w.maps = maps; w.places = out; w.homes.zones = zones; w.occupations = occ; w.cast.examples = cast; w.factions = factions;
    w.description = (sum.description || `A world built from ${books.join(', ')}.`).slice(0, 160);
    w.setting = sum.setting || w.setting || '';
    if (sum.currency?.name) w.currency = { name: sum.currency.name, symbol: sum.currency.symbol || sum.currency.name, ...(sum.currency.after ? { after: true } : {}) };
    w.realm = { ...(w.realm ?? {}), name: sum.realm || top.name };
    w.cover ||= top.image;
    w.lorebooks = [...new Set([...(w.lorebooks ?? []), ...books])];
    w.lore = loreOf(w, places, groups);
    for (const o of w.catalogs.origins ?? []) o.home = zones[0].id;
    for (const s of w.statuses) if (s.zero && /life|health/.test(s.id)) { const h = out.find(p => p.roles?.includes('healer')); if (h) s.zero.place = h.id; }
    if (scale !== 1) scaleMoney(w, scale);
    w.moneyScale = scale;
    prune(w);
    return w;
}

// Pins spread over the map on a loose grid (never on top of each other); you move them in the map editor.
function layout(list: Place[], seed: string) {
    const r = rng(seed), n = list.length; if (!n) return;
    const cols = Math.ceil(Math.sqrt(n * 1.6)), rows = Math.ceil(n / cols);
    list.forEach((p, i) => {
        const c = i % cols, row = Math.floor(i / cols);
        p.x = Math.round(12 + (76 * (c + 0.5)) / cols + (r() - 0.5) * (40 / cols));
        p.y = Math.round(14 + (64 * (row + 0.5)) / rows + (r() - 0.5) * (30 / rows));
    });
}
function loreOf(w: WorldDef, places: SkPlace[], groups: SkGroup[]): LoreEntry[] {
    const out: LoreEntry[] = [];
    if (w.setting) out.push({ keys: [w.name], content: w.setting, constant: true });
    for (const p of places) if (p.desc) out.push({ keys: [p.name], content: `${p.name}${p.area ? ` (${p.area})` : ''}: ${p.desc}` });
    for (const g of groups) if (g.desc) out.push({ keys: [g.name], content: `${g.name}${g.kind ? `, a ${g.kind}` : ''}: ${g.desc}${g.ranks?.length ? ` Ranks: ${g.ranks.join(', ')}.` : ''}` });
    return out;
}

// Money: the base world counts in dollars; a world in won or yen multiplies every amount, rounded to a nice number.
const moneyScale = (perDollar?: number) => { const n = Number(perDollar); return n > 0 && (n > 1.5 || n < 0.67) ? Math.min(Math.max(n, 0.01), 100000) : 1; };
export function round(n: number) { if (n < 10) return Math.max(1, Math.round(n)); const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1); return Math.round(n / p) * p; }
function scaleMoney(w: WorldDef, k: number) {
    const m = (o: any, key: string) => { if (o && typeof o[key] === 'number' && o[key] > 0) o[key] = round(o[key] * k); };
    for (const a of w.actions) { m(a, 'cost'); m(a.roll?.success, 'money'); m(a.roll?.fail, 'money'); }
    for (const o of w.catalogs.origins ?? []) m(o, 'money');
    for (const list of Object.values(w.catalogs)) if (Array.isArray(list)) for (const x of list) { m(x, 'price'); m(x, 'cost'); }
    for (const k2 of Object.values(w.homes.kinds)) for (const b of Object.keys(k2.bills ?? {})) m(k2.bills, b);
    m(w.homes, 'repairCost');
    for (const s of w.statuses) m(s.zero, 'cost');
    for (const x of [...(w.goods ?? []), ...(w.pets ?? [])]) m(x, 'price');
    for (const x of w.crops ?? []) m(x, 'seed');
    for (const x of w.businesses ?? []) { m(x, 'cost'); m(x, 'profit'); }
    for (const x of w.institutions ?? []) m(x, 'tuition');
    for (const x of w.cityEvents ?? []) m(x, 'price');
}
// What the style's base still points at (its own places, factions' halls…) and this world does not have.
function prune(w: WorldDef) {
    const has = (id?: string) => !!id && w.places.some(p => p.id === id);
    w.institutions = (w.institutions ?? []).filter(x => has(x.place));
    w.cityEvents = (w.cityEvents ?? []).filter(x => has(x.place));
    w.towers = (w.towers ?? []).filter(x => has(x.place));
    for (const f of w.festivals ?? []) if (f.place && !has(f.place)) delete f.place;
    // goods cheap or dear in the style's maps, animals sold at its places
    const isMap = (id: string) => w.maps.some(m => m.id === id);
    for (const g of w.goods ?? []) { if (g.cheap) g.cheap = g.cheap.filter(isMap); if (g.dear) g.dear = g.dear.filter(isMap); }
    const sells = (x: string) => w.places.some(p => !p.link && (p.id === x || (p.tags ?? []).includes(x) || p.name.toLowerCase().includes(x.toLowerCase())));
    for (const p of w.pets ?? []) if (p.where) { p.where = p.where.filter(sells); if (!p.where.length) delete p.where; }   // none: any shop
    // an action tied to a place the world lacks is never offered: it moves to a place of the same sort if there is one
    retarget(w);
    delete w.retired;
}
// An action tied to a place the world does not have goes to a place of the same sort (the docks, a shrine, an inn…).
const SORTS: [RegExp, RegExp][] = [
    [/dock|harbou?r|port|pier|fish/i, /dock|harbou?r|port|pier|wharf|marina|beach|river|lake/i],
    [/chapel|church|pray|temple|shrine/i, /chapel|church|temple|shrine|cathedral|monaster|sanctum/i],
    [/inn|bath|tavern/i, /inn|bath|hotel|tavern|spa|lodge|\bbar\b|pub/i],
    [/cinema|theat/i, /cinema|theat|movie|arcade|stage/i],
    [/field|snare|farm|hunt/i, /field|farm|forest|wood|meadow|wild|hunting/i],
    [/hospital|doctor|clinic|heal/i, /hospital|clinic|heal|infirm|doctor/i],
];
export function retarget(w: WorldDef): number {
    let n = 0;
    for (const a of w.actions) {
        if (!a.place || w.places.some(p => p.id === a.place)) continue;
        const sort = SORTS.find(([key]) => key.test(`${a.id} ${a.place}`));
        const p = sort && w.places.find(q => !q.link && (sort[1].test(q.name) || (sort === SORTS[1] && q.roles?.includes('shrine')) || (sort === SORTS[5] && q.roles?.includes('healer'))));
        if (p) { a.place = p.id; n++; }
    }
    return n;
}
