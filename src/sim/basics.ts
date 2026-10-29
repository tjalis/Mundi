// "Basics" for a world built from lorebooks: the everyday places every settlement needs so life works there (a place to
// heal, to buy food, to drink, the law…). Lorebooks rarely list them, and the world starts with an empty map, so a world
// read from them could have no hospital, no shop and no jail. Basics go by what a place is FOR, not what it is called:
// the AI names each one in the world's own terms (an Enforcer precinct in a hive city, a doc's shack in a wasteland, a
// shaman's hut on a primal world), or says a settlement has none. Only what the lorebooks did not cover is asked for.
// Pure data work, like sim/fromlore.ts: the screen in ui/fromlore.ts asks the AI.
import type { Sketch, SkArea, SkPlace } from './fromlore.js';

export type BasicFn = 'healing' | 'supplies' | 'drink' | 'lodging' | 'law' | 'work' | 'worship' | 'leisure' | 'travel' | 'learning' | 'government';
interface FnDef {
    id: BasicFn; name: string;
    /** what it is for, told to the AI */
    for: string;
    /** the place kind it is built as (sim/fromlore.ts KIND gives the tags, roles and hours) */
    kind: string;
    /** the place kinds that already do this job */
    covers: string[];
    /** when the AI cannot be asked: `{area}` is the settlement's name */
    names: { modern: string; medieval: string };
    jobs: { modern: string[]; medieval: string[] };
}
export const FUNCS: FnDef[] = [
    { id: 'healing', name: 'Healing', for: 'where the sick and wounded are treated (and where you wake up after passing out)', kind: 'hospital', covers: ['hospital', 'clinic'],
        names: { modern: '{area} Hospital', medieval: "{area} Healer's House" }, jobs: { modern: ['Orderly', 'Nurse', 'Doctor'], medieval: ['Herb gatherer', 'Healer', 'Master healer'] } },
    { id: 'supplies', name: 'Food & supplies', for: 'where people buy food and everyday goods', kind: 'market', covers: ['market', 'shop'],
        names: { modern: '{area} Market', medieval: '{area} Market Square' }, jobs: { modern: ['Stock clerk', 'Cashier', 'Store manager'], medieval: ['Porter', 'Stall keeper', 'Merchant'] } },
    { id: 'drink', name: 'Food & drink', for: 'where people eat, drink and meet (a bar, a tavern, a canteen)', kind: 'bar', covers: ['bar', 'restaurant', 'cafe'],
        names: { modern: '{area} Bar & Grill', medieval: 'The {area} Tavern' }, jobs: { modern: ['Dishwasher', 'Server', 'Bartender'], medieval: ['Pot boy', 'Serving hand', 'Innkeeper'] } },
    { id: 'lodging', name: 'Lodging', for: 'where travellers sleep and rent a room', kind: 'hotel', covers: ['hotel'],
        names: { modern: '{area} Hotel', medieval: "{area} Travellers' Inn" }, jobs: { modern: ['Porter', 'Desk clerk', 'Hotel manager'], medieval: ['Stable hand', 'Chamber keeper', 'Innkeeper'] } },
    { id: 'law', name: 'Law', for: 'who keeps order, and where lawbreakers are held', kind: 'police', covers: ['police', 'prison'],
        names: { modern: '{area} Police Station', medieval: '{area} Guardhouse' }, jobs: { modern: ['Cadet', 'Officer', 'Sergeant'], medieval: ['Recruit', 'Guard', 'Captain of the guard'] } },
    { id: 'work', name: 'Finding work', for: 'where people find jobs, contracts and hired hands', kind: 'guild', covers: ['guild'],
        names: { modern: '{area} Job Center', medieval: "{area} Notice Board" }, jobs: { modern: [], medieval: [] } },
    { id: 'worship', name: 'Worship', for: 'where people pray or keep their faith, if the world has one', kind: 'temple', covers: ['temple'],
        names: { modern: '{area} Chapel', medieval: '{area} Chapel' }, jobs: { modern: [], medieval: ['Acolyte', 'Priest'] } },
    { id: 'leisure', name: 'Leisure', for: 'a free place to spend time outdoors or relax', kind: 'park', covers: ['park', 'landmark', 'gym'],
        names: { modern: '{area} Park', medieval: '{area} Green' }, jobs: { modern: [], medieval: [] } },
    { id: 'travel', name: 'Travel', for: 'where people leave for other places (a station, a port, a landing pad, a caravan stop)', kind: 'station', covers: ['station', 'dock'],
        names: { modern: '{area} Station', medieval: '{area} Coaching Post' }, jobs: { modern: ['Porter', 'Conductor'], medieval: ['Stable hand', 'Coachman'] } },
    { id: 'learning', name: 'Learning', for: 'where people study or are trained', kind: 'school', covers: ['school'],
        names: { modern: '{area} School', medieval: '{area} Schoolhouse' }, jobs: { modern: ['Teaching assistant', 'Teacher', 'Principal'], medieval: ['Monitor', 'Schoolmaster'] } },
    { id: 'government', name: 'Government', for: 'who rules or runs the settlement, and where', kind: 'government', covers: ['government'],
        names: { modern: '{area} City Hall', medieval: "{area} Reeve's Hall" }, jobs: { modern: ['Clerk', 'Official'], medieval: ['Scribe', 'Reeve'] } },
];
const FN = new Map(FUNCS.map(f => [f.id, f]));
export const fnName = (id: string) => FN.get(id as BasicFn)?.name ?? id;

/** One basic place: what it is for, the settlement it is in ('' = the top map), and who works there. */
export interface SkBasic { fn: BasicFn; area: string; name: string; kind: string; desc?: string; job?: string; ranks?: string[]; keep?: boolean; guess?: boolean }
/** A settlement and the everyday places it lacks. */
export interface Need { area: string; kind?: string; in?: string; desc?: string; missing: BasicFn[] }

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const MAX_SETTLEMENTS = 10;

/** The settlements of a sketch (cities; a region or other area with no city inside; the top map when there are no
 *  areas), each with the basics none of its places covers yet. */
export function needs(sk: Sketch): Need[] {
    const areas = sk.areas.filter(a => a.keep !== false), places = sk.places.filter(p => p.keep !== false);
    const byName = new Map(areas.map(a => [norm(a.name), a]));
    const parentOf = (a: SkArea) => (a.in ? byName.get(norm(a.in)) : undefined);
    // the chain of areas an area sits in, itself first
    const chain = (name?: string): SkArea[] => { const out: SkArea[] = []; let a = name ? byName.get(norm(name)) : undefined; while (a && !out.includes(a)) { out.push(a); a = parentOf(a); } return out; };
    const isCity = (a: SkArea) => a.kind === 'city';
    const hasCityInside = (a: SkArea) => areas.some(b => b !== a && isCity(b) && chain(b.name).includes(a));
    let towns = areas.filter(isCity);
    // a region (a planet, a wild land) with no city in it is a settlement of its own: the innermost one only
    const lone = areas.filter(a => !isCity(a) && a.kind !== 'building' && a.kind !== 'district' && !hasCityInside(a) && !chain(a.name).slice(1).some(isCity));
    towns.push(...lone.filter(a => !lone.some(b => b !== a && chain(b.name).includes(a))));
    // districts with no city and no region above them are settlements too (a world of districts only)
    if (!towns.length) towns = areas.filter(a => a.kind === 'district' && !parentOf(a));
    const out: Need[] = [];
    const townOf = (p: SkPlace) => chain(p.area).find(a => towns.includes(a));
    if (!towns.length) {
        out.push({ area: '', missing: missingIn(places) });
    } else {
        for (const t of towns.slice(0, MAX_SETTLEMENTS)) {
            // places on no known area count for the first settlement only (they land on the top map)
            const mine = places.filter(p => townOf(p) === t || (!townOf(p) && t === towns[0] && !chain(p.area).length));
            out.push({ area: t.name, kind: t.kind, in: t.in, desc: t.desc, missing: missingIn(mine) });
        }
    }
    return out.filter(n => n.missing.length);
}
const missingIn = (places: SkPlace[]): BasicFn[] => FUNCS.filter(f => !places.some(p => f.covers.includes(p.kind ?? ''))).map(f => f.id);

/** The prompt asking the AI what the missing basics are in this world. */
export function basicsPrompt(world: string, style: string, list: Need[], hints: string): string {
    const where = (n: Need) => (n.area ? `"${n.area}"${n.kind ? ` (${n.kind}${n.in ? `, in ${n.in}` : ''})` : ''}${n.desc ? `: ${n.desc}` : ''}` : `"${world}" (the whole world: no towns were named)`);
    return `A life-simulation game (rules: ${style}) is building the world "${world}" from lorebooks. Every settlement needs a few everyday places so daily life works there:
${FUNCS.map(f => `- ${f.id}: ${f.for}`).join('\n')}

These settlements were found, each with the everyday places the lorebooks did not mention:
${list.map(n => `- ${where(n)}. Missing: ${n.missing.join(', ')}`).join('\n')}

For each missing one, say what it is in THIS world, in the world's own terms, names, technology and tone (a far-future hive city, a wasteland, a fantasy realm and a modern town each have their own). Something that does the same job counts (a shaman's hut for healing, a ration hall for food). Only if a settlement truly would not have one at all, set "none": true.

Reply with ONE JSON object, nothing else (no code fences):
{"basics":[{"area":"the settlement's name exactly as above","fn":"${FUNCS.map(f => f.id).join('|')}","name":"the place's name","desc":"one line: what it is and what it looks like","job":"the title of the people who work there, or empty","ranks":["lowest rank of that job","…","highest"],"none":false}]}
${hints ? `\nAbout the world, from the lorebooks:\n${hints.slice(0, 3000)}\n` : ''}`;
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const styleKey = (style: string): 'modern' | 'medieval' => (/mediev|fantasy|western/i.test(style) ? 'medieval' : 'modern');
const taken = (sk: Sketch) => new Set([...sk.places, ...sk.areas].map(x => norm(x.name)));

/** The AI's answer as basics, for the needs it was asked about (anything else is ignored). A need it skipped gets the
 *  style's usual place, unticked. An answer with no basics at all throws (the caller then uses guessBasics). */
export function readBasics(raw: any, list: Need[], sk: Sketch, style: string): SkBasic[] {
    const out: SkBasic[] = [], used = taken(sk), answered = new Set<string>();
    if (!Array.isArray(raw?.basics) || !raw.basics.length) throw new Error('The AI named no basics.');
    const needOf = (area: string) => list.find(n => norm(n.area) === norm(area)) ?? (list.length === 1 ? list[0] : undefined);
    for (const b of raw.basics) {
        const n = needOf(str(b?.area, 80)), fn = str(b?.fn, 20).toLowerCase() as BasicFn, f = FN.get(fn);
        if (!n || !f || !n.missing.includes(fn) || answered.has(`${n.area}|${fn}`)) continue;
        answered.add(`${n.area}|${fn}`);
        if (b?.none === true || b?.none === 'true') continue;
        const name = str(b?.name, 80);
        if (!name || used.has(norm(name))) continue;
        used.add(norm(name));
        const ranks = (Array.isArray(b?.ranks) ? b.ranks : []).map((x: unknown) => str(x, 60)).filter(Boolean).slice(0, 6);
        out.push({ fn, area: n.area, name, kind: f.kind, desc: str(b?.desc), job: str(b?.job, 60) || undefined, ranks: ranks.length ? ranks : undefined });
    }
    for (const n of list) for (const fn of n.missing) if (!answered.has(`${n.area}|${fn}`)) { const g = guess(n, fn, style, used); if (g) out.push({ ...g, keep: false }); }
    return out;
}
/** Without the AI: the style's usual place for each need (all ticked). */
export function guessBasics(list: Need[], sk: Sketch, style: string): SkBasic[] {
    const used = taken(sk);
    return list.flatMap(n => n.missing.map(fn => guess(n, fn, style, used)).filter((x): x is SkBasic => !!x));
}
function guess(n: Need, fn: BasicFn, style: string, used: Set<string>): SkBasic | null {
    const f = FN.get(fn)!, k = styleKey(style);
    let name = f.names[k].replace('{area}', n.area || 'Town').trim();
    for (let i = 2; used.has(norm(name)); i++) name = `${f.names[k].replace('{area}', n.area || 'Town').trim()} ${i}`;
    used.add(norm(name));
    const jobs = f.jobs[k];
    return { fn, area: n.area, name, kind: f.kind, desc: `${f.name} for ${n.area || 'the world'}: ${f.for.replace(/ \(.*\)$/, '')}`, job: jobs.length ? jobs[Math.min(1, jobs.length - 1)] : undefined, ranks: jobs.length ? [...jobs] : undefined, guess: true };
}
