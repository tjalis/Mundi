// World creator, "From lorebooks", second pass: the world details. Once the map is built, your AI reads the lorebooks
// again, one group of World creator tabs at a time (the realm and its words, homes and origins, work and study, the
// market, the calendar), knowing the places, jobs and groups the world now has. It writes names and levels ("cheap",
// "rich"), never ids or game numbers: each thing it names copies the mechanics of the closest entry the world already
// has ("like"), and Mundi sets the numbers in the world's money. Whatever the lorebooks do not mention keeps the
// style's default, so the world always loads. Pure data work: ui/fromlore.ts asks the AI and calls these.
import type { WorldDef, Place, MapDef, Origin, FestivalDef, CityEventDef, InstitutionDef, GoodDef, BusinessDef, PetDef, CelestialDef, HazardDef, TowerDef, ActionDef, God, Government, PowerAffinity } from '../core/world.js';
import type { ShopItem } from '../core/presets.js';
import type { Course } from './skills.js';
import { LEXICON, lexDefault } from '../core/lexicon.js';
import { appsOf } from '../core/world.js';
import type { LoreItem } from './fromlore.js';
import { round, retarget } from './fromlore.js';

export type DetailGroup = 'society' | 'living' | 'work' | 'market' | 'calendar' | 'rpg';
export const DETAILS: { id: DetailGroup; name: string; tabs: string; re: RegExp }[] = [
    { id: 'society', name: 'Realm and words', tabs: 'Realm & factions, Words, Needs and app names',
        re: /\b(realm|kingdom|empire|country|nation|government|king|queen|emperor|president|council|ruler|law|god|gods|goddess|religion|faith|church|temple|faction|guild|association|clan|alliance|war|power|magic|mana|system|status|rank|hunter|title|term|called|known as)\b/i },
    { id: 'living', name: 'Homes and origins', tabs: 'Homes & rent, Character creation',
        re: /\b(home|homes|house|apartment|flat|dorm|room|rent|lodging|inn|live|lives|living|district|neighbou?rhood|rich|poor|slum|wealth|bill|tax|origin|born|background|family|orphan|noble|appearance|eyes|hair|race|species|clan)\b/i },
    { id: 'work', name: 'Work and study', tabs: 'Jobs, Courses, Schools',
        re: /\b(job|jobs|work|career|salary|pay|wage|earn|income|profession|trade|hire|rank|license|licence|exam|test|school|academy|university|college|class|classes|course|training|train|lesson|student|teacher|master|apprentice|guild|skill)\b/i },
    { id: 'market', name: 'Shops and trade', tabs: 'Shop, Goods, Businesses, Animals',
        re: /\b(shop|store|market|buy|sell|price|cost|money|currency|coin|gold|won|yen|dollar|item|items|potion|weapon|armor|armour|gear|equipment|artifact|crystal|core|stone|material|goods|trade|merchant|business|company|vehicle|car|horse|pet|familiar|beast|mount|food|drink|illegal|black market|auction)\b/i },
    { id: 'calendar', name: 'Calendar and dangers', tabs: 'Customs & calendar, Economy & skies, Things to do',
        re: /\b(festival|holiday|celebration|ceremony|ritual|event|events|tournament|match|game|games|concert|fair|season|calendar|day|night|moon|sun|eclipse|star|sky|storm|weather|winter|summer|disaster|gate|gates|dungeon|tower|break|outbreak|monster|monsters|raid|portal|rift)\b/i },
    { id: 'rpg', name: 'The RPG', tabs: 'RPG (attributes, classes, powers, foes)', re: /./ },
];
/** Which detail group fills each World creator tab (the tabs with a "Redo from the lorebooks" button). */
export const TAB_GROUP: Record<string, DetailGroup> = {
    realm: 'society', words: 'society', needs: 'society', features: 'society',
    homes: 'living', character: 'living',
    jobs: 'work', courses: 'work',
    shop: 'market', economy: 'market',
    customs: 'calendar', actions: 'calendar',
    rpg: 'rpg',
};

/* ---------- small helpers ---------- */

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const strs = (v: unknown, n = 8, max = 40) => (Array.isArray(v) ? v.map(x => str(x, max)).filter(Boolean).slice(0, n) : []);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
const num = (v: unknown, lo: number, hi: number, fb: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fb; };
const idOf = (s: string) => norm(s).replace(/ /g, '_').slice(0, 30) || 'x';
const one = (v: unknown, list: readonly string[], fb: string) => { const s = norm(v); return list.find(x => norm(x) === s) ?? fb; };
const emoji = (v: unknown, fb: string) => { const s = str(v, 8); return s && !/[a-z0-9]/i.test(s) ? s : fb; };
function ids(w: WorldDef): Set<string> {
    const out = new Set<string>();
    const add = (l?: { id: string }[]) => l?.forEach(x => out.add(x.id));
    add(w.maps); add(w.places); add(w.homes.zones); add(w.occupations); add(w.factions); add(w.institutions); add(w.festivals); add(w.cityEvents); add(w.towers);
    add(w.goods); add(w.businesses); add(w.pets); add(w.actions); add((w.catalogs as any).shop); add((w.catalogs as any).courses); add(w.catalogs.origins);
    return out;
}
const uniq = (used: Set<string>, base: string) => { let id = base, n = 2; while (used.has(id)) id = `${base}_${n++}`; used.add(id); return id; };
/** One of the world's money for one dollar of the base world: as it was built, or read from what a first rank of a job pays (15 at 1:1). */
export function moneyUnit(w: WorldDef): number {
    if (w.moneyScale && w.moneyScale > 0) return w.moneyScale;
    const pays = w.occupations.map(o => o.ranks[0]?.pay).filter((n): n is number => n > 0).sort((a, b) => a - b);
    return pays.length ? Math.max(0.01, pays[Math.floor(pays.length / 2)] / 15) : 1;
}
const LEVEL: Record<string, number> = { free: 0, none: 0, 'very cheap': 0.3, cheap: 0.5, low: 0.6, poor: 0.5, modest: 0.8, normal: 1, middle: 1, average: 1, dear: 1.8, high: 1.7, rich: 2, expensive: 2, 'very dear': 3.5, 'very high': 2.6, luxury: 3.5 };
const level = (v: unknown, fb = 1) => LEVEL[norm(v)] ?? fb;

// Places and maps by the names the AI uses.
const findPlace = (w: WorldDef, name?: string): Place | undefined => {
    if (!name) return undefined;
    const n = norm(name), real = w.places.filter(p => !p.link);
    return real.find(p => norm(p.name) === n) ?? real.find(p => norm(p.name).includes(n) || n.includes(norm(p.name)));
};
const findMap = (w: WorldDef, name?: string): MapDef | undefined => {
    if (!name) return undefined;
    const n = norm(name);
    return w.maps.find(m => norm(m.name) === n) ?? w.maps.find(m => norm(m.name).includes(n) || n.includes(norm(m.name))) ?? (() => { const p = findPlace(w, name); return p ? w.maps.find(m => m.id === p.map) : undefined; })();
};

/**
 * Lore things onto the world's own list: each one names the entry it is "like"; the first one like an entry takes its
 * place (its id and mechanics stay, only the words change), the next ones are copies of it with ids of their own.
 * With `replace` (enough lore things), entries no lore thing was like are dropped, except the ones in `keep`.
 */
function remap<T extends { id: string; name: string }>(list: T[], items: any[], used: Set<string>, make: (tpl: T | undefined, x: any) => T | null, replace: boolean, keep: (t: T) => boolean = () => false): T[] {
    const taken = new Set<string>();
    const out: T[] = [];
    for (const x of items) {
        const like = str(x.like, 40);
        const base = list.find(t => t.id === like) ?? list.find(t => norm(t.name) === norm(like));
        const made = make(base, x);
        if (!made) continue;
        if (base && !taken.has(base.id)) { taken.add(base.id); made.id = base.id; }
        else made.id = uniq(used, idOf(made.name));
        out.push(made);
    }
    if (!out.length) return list;
    const rest = list.filter(t => !taken.has(t.id) && (!replace || keep(t)));
    // the lore ones take the places of the ones they are like, in the order the world had them
    return replace ? [...out, ...rest] : [...list.map(t => out.find(o => o.id === t.id) ?? t), ...out.filter(o => !list.some(t => t.id === o.id))];
}

/* ---------- what the AI reads ---------- */

/** The lore that matters for one group: every entry (rules and history too), the ones about the group first. */
export function detailLore(items: LoreItem[], g: DetailGroup, max = 9000): string {
    const re = DETAILS.find(d => d.id === g)!.re;
    const score = (it: LoreItem) => { const head = `${it.title} ${it.keys.join(' ')}`; const hits = (it.text.match(new RegExp(re.source, 'gi')) ?? []).length; return (re.test(head) ? 20 : 0) + Math.min(hits, 15) + (it.bucket === 'rules' ? 3 : 0); };
    const ranked = items.map(it => ({ it, s: score(it) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    const out: string[] = [];
    let len = 0;
    for (const { it } of ranked) {
        const room = max - len; if (room < 300) break;
        const body = it.text.length > Math.min(room, 2500) ? `${it.text.slice(0, Math.min(room, 2500))}…` : it.text;
        const part = `### ${it.title}\n${body}`;
        out.push(part); len += part.length + 2;
    }
    return out.join('\n\n');
}

// What the world has, so the AI uses its names.
function digest(w: WorldDef): string {
    const list = (l: string[], n = 50) => l.slice(0, n).join(', ') || '(none)';
    const places = w.places.filter(p => !p.link).slice(0, 60).map(p => `${p.name}${p.tags?.length ? ` [${p.tags.join('/')}]` : ''}`);
    return `World: "${w.name}" (${w.style ?? w.kind} style). ${w.setting || w.description}
Money: ${w.currency.name} (${w.currency.symbol}). A first job pays about ${round(15 * moneyUnit(w))} ${w.currency.symbol} an hour here.
Maps: ${list(w.maps.map(m => m.name))}
Places: ${list(places, 60)}
Jobs: ${list(w.occupations.map(o => o.name))}
Groups: ${list((w.factions ?? []).map(f => f.name))}`;
}
const rows = <T>(l: T[] | undefined, f: (x: T) => string, n = 30) => (l ?? []).slice(0, n).map(f).join('\n') || '(none)';

const WORDS = ['device', 'journal', 'msgNoun', 'writeMessage', 'send', 'yourJob', 'jobApply', 'openings', 'noJob', 'balance', 'statement', 'courses', 'coursesShort', 'takeCourse',
    'bill_rent', 'bill_water', 'bill_power', 'myHome', 'homesForRent', 'letter', 'apprentice', 'festival', 'factions', 'healer', 'seeHealer', 'guards', 'guardsTitle', 'mercs',
    'spellNoun', 'spellsNoun', 'castBtn', 'castVerb', 'magicMenu', 'schoolsWord', 'gems', 'profile'].filter(k => k in LEXICON);
const GOV: Government[] = ['monarchy', 'fractured', 'empire', 'republic', 'theocracy', 'council'];
const POWER: PowerAffinity[] = ['balanced', 'military', 'arcane', 'trade', 'faith'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const CLIMATES = ['temperate', 'cold', 'hot', 'coastal'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const RULES = `Rules:
- Only what the notes state or clearly imply; leave out what they do not say (an empty list keeps the game's usual one).
- Use the names of the world's maps, places, jobs and groups exactly as listed.
- "like" is always one of the ids listed for that list: the closest one. It decides how the thing works in the game.
- Reply with ONE JSON object, nothing else (no code fences, no comments).`;

/** The prompt for one group of tabs (the RPG has its own maker, see rpgfromlore.ts). */
export function detailPrompt(g: Exclude<DetailGroup, 'rpg'>, w: WorldDef, lore: string): string {
    const head = `You are helping fill in the details of a life-simulation game world from lorebook notes.\n\n${digest(w)}\n\n`;
    const tail = `\n\n${RULES}\n\nNotes:\n${lore || '(the notes say little about this: keep the lists short)'}`;
    if (g === 'society') return `${head}The game's own words and lists for this part of the world:
Needs (id: name): ${(w.statuses ?? []).map(s => `${s.id}: ${s.name}`).join(', ')}
Apps of the ${lexDefault(w, 'device')} (id: name): ${appsOf(w).map(a => `${a.id}: ${a.name}`).join(', ')}
Words (key: the game's word now):
${WORDS.map(k => `${k}: ${lexDefault(w, k)}`).join('\n')}

Reply with:
{"tone":"realistic|fantasy (fantasy: magic, monsters or powers exist)",
 "realm":{"name":"the country or realm","government":"${GOV.join('|')}","leadership":"who rules, one line","power":"${POWER.join('|')} (what the realm leans on)","gods":[{"name":"","domain":"what they rule over","symbol":"one emoji"}]},
 "factions":[{"name":"one of the groups","beats":"another group it is stronger than, or empty","dues":"none|low|high","open":"anyone|selective|closed"}],
 "needs":{"<need id>":"the world's name for it, only if the notes name it differently"},
 "apps":{"<app id>":"the world's name for this app, only if the notes give one"},
 "words":{"<key>":"the world's word or line, only for the terms the notes have their own word for; keep {0}, {1} where the game's word has them"}}${tail}`;
    if (g === 'living') return `${head}The game's lists for this part of the world:
Kinds of home (id: name: what it is): ${rows(Object.entries(w.homes.kinds), ([id, k]) => `${id}: ${k.name}: ${k.desc}`)}
Housing areas (id: name, on map): ${rows(w.homes.zones, z => `${z.id}: ${z.name}, on ${w.maps.find(m => m.id === z.map)?.name ?? z.map}`)}
Bills besides the rent (id: name): ${rows(w.homes.expenses, e => `${e.id}: ${e.name || lexDefault(w, `bill_${e.id}`)}`)}
Origins a player can pick (id: name: what it is): ${rows(w.catalogs.origins, o => `${o.id}: ${o.name}: ${o.desc ?? ''}`)}
Skills an origin can train (ids): ${(w.rpg?.skills ?? []).map(s => s.id).join(', ') || '(none)'}
Appearance a player picks: ${rows(w.sheet.appearance, a => `${a.label}: ${a.options.join(', ')}`)}

Reply with:
{"homes":[{"name":"a kind of home people live in here","desc":"one line: what it is like inside","like":"<kind of home id>"}],
 "areas":[{"area":"<housing area id>","name":"what the homes there are called","home":"the name of one of your homes","wealth":"poor|modest|middle|rich|luxury"}],
 "bills":[{"name":"a bill paid every week besides the rent (power, water, firewood, mana fees…)","like":"<bill id>"}],
 "rentEvery":7,
 "origins":[{"name":"a background a newcomer could have here","desc":"one line, to the player (you…)","lives":"the map or place they start in","money":"poor|modest|middle|rich|luxury","knows":0,"feature":"one line: what it gives you","skills":["two skill ids"]}],
 "appearance":[{"label":"Hair, Eyes, Race, Rank…","options":["4 to 8 choices"]}]}
"rentEvery": 7 for weekly rent, 30 for monthly. "knows": how many locals they already know (0 to 3).${tail}`;
    if (g === 'work') return `${head}The game's lists for this part of the world:
Jobs (id: name, at place, ranks): ${rows(w.occupations, o => `${o.id}: ${o.name}, at ${w.places.find(p => p.id === o.place)?.name ?? o.place}, ${o.ranks.map(r => r.name).join(' > ')}`, 40)}
Courses now (name: what it grants): ${rows((w.catalogs as any).courses as Course[], c => `${c.name}: ${c.grants.join(', ')}`)}
Traits people have (a course grants them, a job asks for them): ${traitsOf(w).join(', ')}

Reply with:
{"jobs":[{"job":"<job id>","pay":"low|modest|middle|high|very high","hours":"day|early|evening|night","needs":["a trait you must have to be hired, rarely"],"likes":["traits that get you promoted faster"]}],
 "courses":[{"name":"a class, training or licence you can take here","area":"its field in a word","desc":"one line: what you learn and what it opens","days":3,"cost":"cheap|normal|dear|very dear","grants":["one or two traits"],"icon":"one emoji"}],
 "schools":[{"name":"a school, academy or university","place":"the place it is at","ranks":["lowest","…","highest"],"tuition":"cheap|normal|dear","trait":"the trait its students gain","clubs":["clubs or circles"],"desc":"one line"}]}
"days": 1 to 10 days of lessons. A school must be at one of the places listed above.${tail}`;
    if (g === 'market') return `${head}The game's lists for this part of the world (id: name, price in ${w.currency.symbol}):
Shop (things a player owns): ${rows((w.catalogs as any).shop as ShopItem[], s => `${s.id}: ${s.name}, ${s.price}: ${s.desc}`)}
Goods (traded, cheap in some maps, dear in others): ${rows(w.goods, x => `${x.id}: ${x.name}, ${x.price}${x.kind ? ` (${x.kind})` : ''}${x.illegal ? ', illegal' : ''}`)}
Businesses a player can open: ${rows(w.businesses, b => `${b.id}: ${b.name}, ${b.cost}`)}
Animals a player can keep: ${rows(w.pets, p => `${p.id}: ${p.name}, ${p.price}${p.mount ? ', a mount' : ''}${p.familiar ? ', a familiar' : ''}`)}

Reply with:
{"shop":[{"name":"something people here buy to own","desc":"one line: what it does for you","like":"<shop id>","price":100,"icon":"one emoji"}],
 "goods":[{"name":"something traded here","like":"<good id>","price":10,"cheap":["maps where it is made"],"dear":["maps where it is scarce"],"illegal":false,"icon":"one emoji"}],
 "businesses":[{"name":"a business a player could open here","like":"<business id>","icon":"one emoji"}],
 "pets":[{"name":"an animal, beast or familiar people keep","desc":"one line","like":"<animal id>","price":100,"where":["places that sell it"],"icon":"one emoji"}]}
Prices are in ${w.currency.name}, about what the notes say or what fits the lists above.${tail}`;
    return `${head}The game's lists for this part of the world:
Festivals (a season has 14 days): ${rows(w.festivals, f => `${f.name}: ${f.season} day ${f.day}`)}
Weekly events: ${rows(w.cityEvents, e => `${e.name} at ${w.places.find(p => p.id === e.place)?.name ?? e.place}`)}
Events in the sky (id: name, effect): ${rows(w.skies?.events, e => `${e.id}: ${e.name}, ${e.effect}`)}
Extreme weather (id: name, climate, season): ${rows(w.skies?.hazards, h => `${h.id}: ${h.name}, ${h.climate}${h.season ? `, ${h.season}` : ''}`)}
Things to do (id: what it says): ${rows(w.actions, a => `${a.id}: ${a.label}${a.place ? ` (at ${w.places.find(p => p.id === a.place)?.name ?? 'a place this world lacks'})` : ''}`, 40)}

Reply with:
{"festivals":[{"name":"","season":"spring|summer|autumn|winter","day":7,"days":1,"place":"a place, or empty","mood":"small|big","prices":"lower|same|higher","desc":"one line"}],
 "events":[{"name":"something that happens every week or few weeks","place":"a place","weekday":"monday…sunday","every":1,"from":20,"hours":3,"price":"free|cheap|normal|dear","outdoor":false,"action":"what the button says","desc":"one line","icon":"one emoji"}],
 "skies":[{"name":"something that happens in the sky or to the world now and then","desc":"one line","every":40,"days":1,"effect":"mana|monsters|omen"}],
 "weather":[{"name":"","desc":"one line","climate":"${CLIMATES.join('|')}","season":"a season, or empty","like":"<weather id>"}],
 "climates":{"<map name>":"${CLIMATES.join('|')}"},
 "towers":[{"name":"a dungeon, gate, tower or deep place with floors of foes","place":"the place it is at","floors":30,"desc":"one line"}],
 "actions":[{"label":"something people do at one place (pray at the shrine, train at the gym)","place":"a place","like":"<thing to do id>"}]}
"every" for events: every 1 to 4 weeks; "from": the hour it starts. "every" for the sky: every 10 to 120 days. Effects: mana (powers are stronger), monsters (more foes), omen (people are uneasy).${tail}`;
}
const traitsOf = (w: WorldDef) => [...new Set([...(w.sheet.traits ?? []).filter(t => /prof|skill|talent/i.test(`${t.id} ${t.label}`)).flatMap(t => t.options), ...w.occupations.flatMap(o => [...(o.needs ?? []), ...(o.likes ?? [])]), ...((w.catalogs as any).courses as Course[] ?? []).flatMap(c => c.grants)])].slice(0, 60);

/* ---------- putting the answers into the world ---------- */

/** Puts one group's answer into the world; returns a short line of what changed (empty: nothing). */
export function applyDetail(w: WorldDef, g: Exclude<DetailGroup, 'rpg'>, raw: any): string {
    const r = raw && typeof raw === 'object' ? raw : {};
    const done: string[] = [];
    const used = ids(w);
    const unit = moneyUnit(w);
    const note = (n: number, what: string) => { if (n) done.push(`${n} ${what}`); };

    if (g === 'society') {
        const tone = norm(r.tone);
        if (tone === 'fantasy' || tone === 'realistic') w.tags = [...(w.tags ?? ['lifesim']).filter(t => t !== 'fantasy' && t !== 'realistic'), tone];
        const rl = r.realm && typeof r.realm === 'object' ? r.realm : null;
        if (rl) {
            const realm = (w.realm ??= {});
            if (str(rl.name, 80)) realm.name = str(rl.name, 80);
            realm.government = one(rl.government, GOV, realm.government ?? 'monarchy') as Government;
            realm.power = one(rl.power, POWER, realm.power ?? 'balanced') as PowerAffinity;
            if (str(rl.leadership)) realm.leadership = str(rl.leadership, 160);
            if (Array.isArray(rl.gods)) {
                const gu = new Set<string>();
                realm.pantheon = arr(rl.gods).slice(0, 8).map((x): God | null => (str(x.name, 60) ? { id: uniq(gu, idOf(str(x.name, 60))), name: str(x.name, 60), domain: str(x.domain, 80) || 'the world', symbol: emoji(x.symbol, '✦') } : null)).filter((x): x is God => !!x);
            }
            const gods = realm.pantheon?.length ? ` Its gods: ${realm.pantheon.map(x => `${x.name} (${x.domain})`).join(', ')}.` : '';
            const text = `${realm.name ?? w.name}: ${realm.leadership ?? realm.government}.${gods}`;
            w.lore = [...(w.lore ?? []).filter(e => !e.keys.includes(realm.name ?? '') || e.constant), { keys: [realm.name ?? w.name, 'realm'], content: text }];
            done.push('the realm');
        }
        let nf = 0;
        for (const x of arr(r.factions)) {
            const f = (w.factions ?? []).find(y => norm(y.name) === norm(x.name)); if (!f) continue;
            const beats = (w.factions ?? []).find(y => y !== f && norm(y.name) === norm(x.beats));
            if (beats) f.beats = beats.id;
            const dues = norm(x.dues); if (dues) f.dues = dues === 'high' ? round(40 * unit) : dues === 'low' ? round(10 * unit) : 0;
            const open = norm(x.open); if (open) f.joinRep = open === 'closed' ? 40 : open === 'selective' ? 15 : 0;
            nf++;
        }
        note(nf, nf === 1 ? 'faction' : 'factions');
        let nn = 0;
        for (const [id, v] of Object.entries(r.needs && typeof r.needs === 'object' ? r.needs : {})) { const s = w.statuses.find(x => x.id === id); if (s && str(v, 30)) { s.name = str(v, 30); nn++; } }
        note(nn, nn === 1 ? 'need renamed' : 'needs renamed');
        const apps = r.apps && typeof r.apps === 'object' ? r.apps : {};
        if (Object.keys(apps).length) {
            const list = appsOf(w).map(a => ({ ...a }));
            let na = 0;
            for (const a of list) if (str(apps[a.id], 24)) { a.name = str(apps[a.id], 24); na++; }
            if (na) { w.features = { ...(w.features ?? {}), apps: list }; note(na, na === 1 ? 'app renamed' : 'apps renamed'); }
        }
        const lex = ((w as any).lexicon ??= {}) as Record<string, string>;
        let nw = 0;
        const holes = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join('');
        for (const [k, v] of Object.entries(r.words && typeof r.words === 'object' ? r.words : {})) {
            const s = str(v, 200);
            if (!WORDS.includes(k) || !s || s === lexDefault(w, k) || holes(s) !== holes(lexDefault(w, k))) continue;
            lex[k] = s; nw++;
        }
        note(nw, nw === 1 ? 'word' : 'words');
    }

    if (g === 'living') {
        // kinds of home: each like one of the world's kinds (its pictures and bills)
        const kinds = Object.entries(w.homes.kinds).map(([id, k]) => ({ id, ...k }));
        const homes = arr(r.homes).filter(x => str(x.name, 40)).slice(0, 8);
        if (homes.length) {
            const out = remap(kinds, homes, used, (tpl, x) => ({ ...(tpl ? structuredClone(tpl) : { bills: {} }), id: '', name: str(x.name, 40), desc: str(x.desc) || tpl?.desc || '' }), homes.length >= 2);
            w.homes.kinds = Object.fromEntries(out.map(({ id, ...k }) => [id, k]));
            note(homes.length, homes.length === 1 ? 'kind of home' : 'kinds of home');
        }
        const kindIds = Object.keys(w.homes.kinds);
        const kindBy = (name: unknown) => kindIds.find(id => norm(w.homes.kinds[id].name) === norm(name) || id === str(name, 40));
        const every = Number(r.rentEvery) === 30 ? 30 : Number(r.rentEvery) === 14 ? 14 : 7;
        const was = w.rent?.everyDays ?? 7;
        if (r.rentEvery !== undefined && every !== was) { w.rent = { ...(w.rent ?? {}), everyDays: every }; for (const z of w.homes.zones) z.rent = round(z.rent * every / was); done.push(`rent every ${every} days`); }
        let nz = 0;
        for (const x of arr(r.areas)) {
            const z = w.homes.zones.find(y => y.id === str(x.area, 40) || norm(y.name) === norm(x.area)); if (!z) continue;
            if (str(x.name, 50)) z.name = str(x.name, 50);
            z.kind = kindBy(x.home) ?? z.kind;
            if (x.wealth) z.rent = round(120 * unit * level(x.wealth) * (w.rent?.everyDays ?? 7) / 7);
            nz++;
        }
        for (const z of w.homes.zones) if (!w.homes.kinds[z.kind]) z.kind = kindIds[0];
        note(nz, nz === 1 ? 'housing area' : 'housing areas');
        // bills: renamed, or the ones the world does not pay dropped
        const bills = arr(r.bills).filter(x => str(x.name, 30));
        if (bills.length && w.homes.expenses?.length) {
            const copyOf = new Map<object, string>();   // a copied bill costs what the bill it copies costs
            const out = remap(w.homes.expenses.map(e => ({ ...e })), bills, used, (tpl, x) => { if (!tpl) return null; const e = { ...structuredClone(tpl), name: str(x.name, 30) }; copyOf.set(e, tpl.id); return e; }, true);
            const keepIds = new Set(out.map(e => e.id));
            for (const k of Object.values(w.homes.kinds)) {
                if (!k.bills) continue;
                for (const e of out) { const src = copyOf.get(e); if (src && src !== e.id && k.bills[src] !== undefined) k.bills[e.id] = k.bills[src]; }
                for (const b of Object.keys(k.bills)) if (!keepIds.has(b)) delete k.bills[b];
            }
            w.homes.expenses = out;
            note(out.length, out.length === 1 ? 'bill' : 'bills');
        }
        // origins: where you start, with how much, knowing whom
        const skills = new Set((w.rpg?.skills ?? []).map(s => s.id));
        const origins = arr(r.origins).filter(x => str(x.name, 40)).slice(0, 8);
        if (origins.length >= 2) {
            const old = w.catalogs.origins ?? [];
            const ou = new Set<string>();
            w.catalogs.origins = origins.map((x, i): Origin => {
                const tpl = old[i % Math.max(1, old.length)];
                const map = findMap(w, x.lives);
                const zone = (map && w.homes.zones.find(z => z.map === map.id)) || w.homes.zones[0];
                const sk = strs(x.skills, 2, 30).filter(s => skills.has(s));
                const o: Origin = { id: uniq(ou, idOf(str(x.name, 40))), name: str(x.name, 40), desc: str(x.desc, 200), money: round(2000 * unit * level(x.money)) };
                if (zone) o.home = zone.id;
                const knows = num(x.knows, 0, 3, 0); if (knows) o.knows = knows;
                if (str(x.feature)) o.feature = str(x.feature, 160); else if (tpl?.feature) o.feature = tpl.feature;
                o.skills = sk.length ? sk : tpl?.skills ? [...tpl.skills] : undefined;
                if (!o.skills) delete o.skills;
                if (tpl?.attributes) o.attributes = { ...tpl.attributes };
                return o;
            });
            note(origins.length, 'origins');
        }
        const looks = arr(r.appearance).filter(x => str(x.label, 30) && strs(x.options, 10, 30).length >= 2).slice(0, 8);
        if (looks.length >= 2) {
            const au = new Set<string>();
            w.sheet.appearance = looks.map(x => ({ id: uniq(au, idOf(str(x.label, 30))), label: str(x.label, 30), options: strs(x.options, 10, 30) }));
            note(looks.length, 'appearance choices');
        }
    }

    if (g === 'work') {
        let nj = 0;
        const hours: Record<string, [number, number]> = { day: [8, 18], early: [6, 15], evening: [14, 23], night: [18, 26] };
        for (const x of arr(r.jobs)) {
            const o = w.occupations.find(y => y.id === str(x.job, 40) || norm(y.name) === norm(x.job)); if (!o) continue;
            if (x.pay) { const k = level(x.pay); o.ranks = o.ranks.map((rk, i) => ({ ...rk, pay: round((15 + i * 6) * unit * k) })); }
            const h = hours[norm(x.hours)]; if (h) o.hours = [h[0], Math.min(24, h[1])];
            const needs = strs(x.needs, 2, 30), likes = strs(x.likes, 4, 30);
            if (needs.length) o.needs = needs; else if (Array.isArray(x.needs)) delete o.needs;
            if (likes.length) o.likes = likes;
            nj++;
        }
        note(nj, nj === 1 ? 'job' : 'jobs');
        const courses = arr(r.courses).filter(x => str(x.name, 50)).slice(0, 20);
        if (courses.length >= 3) {
            const cu = new Set<string>(used);
            const cost: Record<string, number> = { cheap: 120, normal: 300, dear: 700, 'very dear': 1800 };
            (w.catalogs as any).courses = courses.map((x): Course => ({ id: uniq(cu, idOf(str(x.name, 50))), name: str(x.name, 50), area: str(x.area, 24) || 'Training', days: num(x.days, 1, 10, 3),
                cost: round((cost[norm(x.cost)] ?? 300) * unit), grants: strs(x.grants, 2, 30).length ? strs(x.grants, 2, 30) : ['Fast learner'], icon: emoji(x.icon, '📘'), desc: str(x.desc, 200) }));
            note(courses.length, 'courses');
        }
        const schools: InstitutionDef[] = [];
        for (const x of arr(r.schools).slice(0, 6)) {
            const p = findPlace(w, x.place); const ranks = strs(x.ranks, 6, 30);
            if (!p || !str(x.name, 60) || ranks.length < 2) continue;
            const tuition = ({ cheap: 50, normal: 120, dear: 300 } as Record<string, number>)[norm(x.tuition)] ?? 120;
            const s: InstitutionDef = { id: uniq(used, idOf(str(x.name, 60))), name: str(x.name, 60), place: p.id, ranks, tuition: round(tuition * unit), examEvery: 7, desc: str(x.desc, 160) };
            if (str(x.trait, 30)) s.trait = str(x.trait, 30);
            const clubs = strs(x.clubs, 5, 40); if (clubs.length) s.clubs = clubs;
            if (!p.tags?.includes('study')) p.tags = [...(p.tags ?? []), 'study'];
            schools.push(s);
        }
        if (schools.length) { w.institutions = [...schools, ...(w.institutions ?? []).filter(s => !schools.some(x => x.place === s.place))]; note(schools.length, schools.length === 1 ? 'school' : 'schools'); }
    }

    if (g === 'market') {
        const priced = <T extends { price: number }>(tpl: T | undefined, v: unknown, fb: number) => { const base = tpl?.price ?? fb; const n = Number(v); return round(Number.isFinite(n) && n > 0 ? Math.min(base * 10, Math.max(base / 10, n)) : base); };
        const shopIn = arr(r.shop).filter(x => str(x.name, 50)).slice(0, 16);
        if (shopIn.length) {
            const list = ((w.catalogs as any).shop ?? []) as ShopItem[];
            (w.catalogs as any).shop = remap(list, shopIn, used, (tpl, x) => ({ ...(tpl ? structuredClone(tpl) : {}), id: '', name: str(x.name, 50), desc: str(x.desc, 160) || tpl?.desc || '', icon: emoji(x.icon, tpl?.icon ?? '🛍️'), price: priced(tpl, x.price, 300 * unit) }), shopIn.length >= 3);
            note(shopIn.length, 'shop items');
        }
        const goodsIn = arr(r.goods).filter(x => str(x.name, 50)).slice(0, 20);
        if (goodsIn.length && w.goods) {
            const needed = new Set([...(w.crops ?? []).map(c => c.good), ...(w.recipes ?? []).flatMap(x => [x.makes, ...Object.keys(x.needs)])]);
            const maps = (l: unknown) => strs(l, 4, 60).map(n => findMap(w, n)?.id).filter((x): x is string => !!x);
            w.goods = remap(w.goods, goodsIn, used, (tpl, x): GoodDef => {
                const gd: GoodDef = { ...(tpl ? structuredClone(tpl) : { kind: 'goods' }), id: '', name: str(x.name, 50), icon: emoji(x.icon, tpl?.icon ?? '📦'), price: priced(tpl, x.price, 20 * unit) };
                const cheap = maps(x.cheap), dear = maps(x.dear);
                if (cheap.length) gd.cheap = cheap; else if (tpl) delete gd.cheap;
                if (dear.length) gd.dear = dear; else if (tpl) delete gd.dear;
                if (x.illegal === true) gd.illegal = true; else if (x.illegal === false) delete gd.illegal;
                return gd;
            }, goodsIn.length >= 4, t => needed.has(t.id));
            note(goodsIn.length, 'goods');
        }
        const busIn = arr(r.businesses).filter(x => str(x.name, 50)).slice(0, 8);
        if (busIn.length && w.businesses?.length) {
            w.businesses = remap(w.businesses, busIn, used, (tpl, x): BusinessDef => ({ ...structuredClone(tpl ?? w.businesses![0]), id: '', name: str(x.name, 50), icon: emoji(x.icon, tpl?.icon ?? '🏪') }), busIn.length >= 2);
            note(busIn.length, 'businesses');
        }
        const petsIn = arr(r.pets).filter(x => str(x.name, 40)).slice(0, 8);
        if (petsIn.length && w.pets) {
            const fb = w.pets.find(p => !p.mount && !p.familiar) ?? w.pets[0];
            w.pets = remap(w.pets, petsIn, used, (tpl, x): PetDef => {
                const p: PetDef = { ...structuredClone(tpl ?? fb ?? { icon: '🐾', price: 0, mood: 3 }), id: '', name: str(x.name, 40), icon: emoji(x.icon, tpl?.icon ?? '🐾'), price: priced(tpl ?? fb, x.price, 300 * unit), desc: str(x.desc, 160) || tpl?.desc || '' };
                const where = strs(x.where, 3, 60).map(n => findPlace(w, n)?.id).filter((y): y is string => !!y);
                if (where.length) p.where = where;
                return p;
            }, petsIn.length >= 2);
            note(petsIn.length, 'animals');
        }
    }

    if (g === 'calendar') {
        const fest: FestivalDef[] = [];
        for (const x of arr(r.festivals).slice(0, 12)) {
            if (!str(x.name, 60)) continue;
            const f: FestivalDef = { id: uniq(used, idOf(str(x.name, 60))), name: str(x.name, 60), season: one(x.season, SEASONS, 'summer'), day: num(x.day, 1, 14, 7), days: num(x.days, 1, 3, 1),
                mood: norm(x.mood) === 'big' ? 20 : 10, desc: str(x.desc, 160) };
            const pr = norm(x.prices); if (pr === 'higher') f.prices = 1.15; else if (pr === 'lower') f.prices = 0.9;
            const p = findPlace(w, x.place); if (p) f.place = p.id;
            fest.push(f);
        }
        if (fest.length >= 2) { w.festivals = fest; note(fest.length, 'festivals'); }
        const evs: CityEventDef[] = [];
        for (const x of arr(r.events).slice(0, 10)) {
            const p = findPlace(w, x.place); if (!p || !str(x.name, 60)) continue;
            const day = DAYS.indexOf(one(x.weekday, DAYS, 'saturday'));
            const price = ({ free: 0, cheap: 15, normal: 40, dear: 100 } as Record<string, number>)[norm(x.price)] ?? 0;
            const every = num(x.every, 1, 4, 1);
            evs.push({ id: uniq(used, idOf(str(x.name, 60))), name: str(x.name, 60), icon: emoji(x.icon, '🎉'), place: p.id, weekday: day, every, week: evs.length % every, from: num(x.from, 0, 23, 19), hours: num(x.hours, 1, 10, 3),
                price: round(price * unit), mood: 15, minutes: 120, action: str(x.action, 40) || `Go to ${str(x.name, 40)}`, ...(x.outdoor === true ? { outdoor: true } : {}), crowd: 40, desc: str(x.desc, 160) });
        }
        if (evs.length) { w.cityEvents = evs; note(evs.length, evs.length === 1 ? 'weekly event' : 'weekly events'); }
        const skies = (w.skies ??= {});
        const sky: CelestialDef[] = [];
        for (const x of arr(r.skies).slice(0, 6)) {
            if (!str(x.name, 60)) continue;
            const effect = one(x.effect, ['mana', 'monsters', 'omen'], 'omen') as CelestialDef['effect'];
            const tpl = skies.events?.find(e => e.effect === effect);
            sky.push({ id: uniq(used, idOf(str(x.name, 60))), name: str(x.name, 60), desc: str(x.desc, 160), every: num(x.every, 10, 120, 40), days: num(x.days, 1, 3, 1), effect, ...(tpl?.amount !== undefined ? { amount: tpl.amount } : effect === 'omen' ? { amount: 3 } : {}) });
        }
        if (sky.length) { skies.events = sky; note(sky.length, 'sky events'); }
        for (const [name, c] of Object.entries(r.climates && typeof r.climates === 'object' ? r.climates : {})) { const m = findMap(w, name); const cl = one(c, CLIMATES, ''); if (m && cl) m.climate = cl; }
        const climates = new Set(w.maps.map(m => m.climate || 'temperate'));
        const hazIn = arr(r.weather).filter(x => str(x.name, 60)).slice(0, 8);
        if (hazIn.length && skies.hazards?.length) {
            skies.hazards = remap(skies.hazards, hazIn, used, (tpl, x): HazardDef | null => {
                const base = tpl ?? skies.hazards![0];
                const climate = one(x.climate, CLIMATES, base.climate);
                const h: HazardDef = { ...structuredClone(base), id: '', name: str(x.name, 60), desc: str(x.desc, 160) || base.desc, climate: climates.has(climate) ? climate : [...climates][0] ?? climate };
                const s = one(x.season, SEASONS, ''); if (s) h.season = s; else delete h.season;
                return h;
            }, true);
            note(hazIn.length, hazIn.length === 1 ? 'kind of extreme weather' : 'kinds of extreme weather');
        }
        const towers: TowerDef[] = [];
        for (const x of arr(r.towers).slice(0, 6)) {
            const p = findPlace(w, x.place); if (!p || !str(x.name, 60)) continue;
            towers.push({ id: uniq(used, idOf(str(x.name, 60))), name: str(x.name, 60), place: p.id, floors: num(x.floors, 5, 100, 30), tags: ['tower'], desc: str(x.desc, 160) });
        }
        if (towers.length) { w.towers = [...towers, ...(w.towers ?? []).filter(t => !towers.some(x => x.place === t.place))]; note(towers.length, towers.length === 1 ? 'tower or dungeon' : 'towers and dungeons'); }
        // things to do at a place: the ones tied to a place this world lacks move to one that fits (again, after
        // a redo); the lore adds its own
        const moved = retarget(w);
        let na = 0;
        for (const x of arr(r.actions).slice(0, 12)) {
            const p = findPlace(w, x.place); const label = str(x.label, 60);
            const tpl = w.actions.find(a => a.id === str(x.like, 40));
            if (!p || !label || !tpl) continue;
            const a: ActionDef = { ...structuredClone(tpl), id: uniq(used, `l_${idOf(label)}`), name: label.split(/\s+/).slice(0, 3).join(' '), label, place: p.id };
            delete a.home; delete a.anywhere; delete a.needsItem; delete a.hobby;
            w.actions.push(a); na++;
        }
        note(na, na === 1 ? 'thing to do' : 'things to do');
        if (moved) done.push(`${moved} moved to this world's places`);
    }
    return done.join(', ');
}
