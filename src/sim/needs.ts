// Statuses (life, energy, hunger…) and the actions that change them. Everything comes from the world's data:
// which statuses exist, how fast they drop, what happens at zero and what each action costs and gives.
import { eventActions } from './cityevents.js';
import { onAction, decayMods } from './hooks.js';
import { nowAbs, cfg, type Save } from '../core/store.js';
import { billNews, cutReason, priceOf } from './bills.js';
import { priceHere } from './worldstate.js';
import { openNow } from './daynight.js';
import { sheetOf, isRpg, changeHp, hpMax, mortalOn, tooHurt } from './rpg.js';
import { activeStatuses, systemOn, type WorldDef, type ActionDef, type StatusDef, isScenario } from '../core/world.js';
import { presentAt } from './people.js';
import { approve } from './living.js';
import { note } from './facts.js';
import { placeOf, playerHomeId } from './places.js';
import { book } from './ledger.js';
import { extraActions, isBlocked, brokenThings, hasItem } from './life.js';

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
export const statusDef = (w: WorldDef, id: string) => w.statuses.find(s => s.id === id);
// One currency per world: "$120", "40 g", "300 Berries". (Coins of several metals were dropped: an old world that still
// lists `tiers` just shows its smallest coin, which is what amounts were always counted in.)
export function money(w: WorldDef, v: number): string {
    const n = Math.round(v).toLocaleString('en-US'), sym = w.currency.symbol ?? '';
    return w.currency.after ? `${n}${sym ? ` ${sym}` : ''}` : `${sym}${n}`;
}
// How cheap this world's economy is: the usual pay of a first job, for prices the engine sets itself (a party…).
export const usualPay = (w: WorldDef) => { const p = w.occupations.map(o => o.ranks?.[0]?.pay ?? 0).filter(x => x > 0).sort((a, b) => a - b); return p.length ? p[Math.floor(p.length / 2)] : 16; };

export function addStatus(g: Save, w: WorldDef, id: string, delta: number) {
    const d = statusDef(w, id);
    if (!d) return;
    // in the RPG, "life" is your hit points (the need shows the share left): a change goes to the hit points
    if ((id === 'life' || id === 'health') && sheetOf(g) && isRpg(w)) { changeHp(g, w, (delta / d.max) * hpMax(w, sheetOf(g)!)); return; }
    g.player.stats[id] = clamp((g.player.stats[id] ?? d.start) + delta, d.max);
}

// How many whole periods of `every` minutes passed since the rule last ran (and moves its mark forward).
function periods(g: Save, key: string, every: number): number {
    const now = nowAbs(g);
    const last = g.tick[key] ?? now;
    if (g.tick[key] === undefined) { g.tick[key] = now; return 0; }
    const n = Math.floor((now - last) / every);
    if (n > 0) g.tick[key] = last + n * every;
    return n;
}

// Runs after every slice of time: decay, damage at zero, passing out, rent.
export function applyTimedRules(g: Save, w: WorldDef): string[] {
    const out: string[] = [];
    g.tick ??= {};   // (a Home game that never had needs on)
    if ((g as any).mortal?.dead) return out;   // the dead need nothing
    const mortal = mortalOn(g, w);
    // the risen (a ghost, undead) neither eat nor drink
    if ((g as any).mortal?.form) for (const id of ['hunger', 'thirst']) { const st = w.statuses.find(x => x.id === id); if (st) g.player.stats[id] = st.max; }
    for (const s of activeStatuses(w, g)) {
        if (s.decay) {
            const n = periods(g, `decay:${s.id}`, s.decay.everyMinutes);
            // (walking the map costs no energy)
            if (n > 0 && !(s.decay.awakeOnly && g.asleep) && !(s.id === 'energy' && (g as any).traveling)) addStatus(g, w, s.id, -s.decay.amount * n * (cfg(g).decay ?? 1) * decayMods.reduce((m, f) => m * f(g, w, s.id), 1));
        }
        const v = g.player.stats[s.id] ?? s.start;
        // (Home: an empty need only shows, and the AI is told; nobody faints)
        // (the drain's clock starts again too: it would otherwise charge every hour since the need was last empty)
        if (v > 0 || !s.zero || isScenario(w)) { delete g.tick[`zero:${s.id}`]; delete g.tick[`crisis0:${s.id}`]; delete g.tick[`drain:${s.id}`]; continue; }
        out.push(...crisisCheck(g, w, s));
        if (s.zero.drain) {
            const n = periods(g, `drain:${s.id}`, s.zero.drain.everyMinutes);
            // when death is real, starving eats your hit points slowly and thirst about three times as fast
            const toLife = /^(life|health)$/.test(s.zero.drain.status);
            const amount = mortal && toLife && (s.id === 'hunger' || s.id === 'thirst') ? (s.id === 'thirst' ? 6 : 2) * (s.zero.drain.everyMinutes / 60) : s.zero.drain.amount;
            if (n > 0) { if (mortal && toLife) (g as any)._hurtBy = s.id; addStatus(g, w, s.zero.drain.status, -amount * n); delete (g as any)._hurtBy; }
        }
        // at zero life when death is real, there is no waking up at the hospital: sim/mortal.ts decides
        if (mortal && /^(life|health)$/.test(s.id)) continue;
        if ((s.zero.place || s.zero.text) && g.tick[`zero:${s.id}`] === undefined) {
            g.tick[`zero:${s.id}`] = nowAbs(g);
            const cost = s.zero.cost ?? 0;
            if (cost) g.player.money = Math.max(0, g.player.money - cost);
            if (s.zero.place) g.player.loc = s.zero.place === 'home' ? playerHomeId : s.zero.place;
            if (s.zero.restore) addStatus(g, w, s.id, s.zero.restore);
            if (s.zero.text) out.push(s.zero.text.replace('{cost}', money(w, cost)));
        }
    }
    // the bills of your home (rent, water, power): due each week, paid in the Homes app, cut off after a week
    out.push(...billNews(g, w));
    return out;
}

// A need left at zero long enough becomes a crisis, once per time it hits zero: you faint, people see it, it costs.
// The people who saw it remember it (and may gossip); for a few hours the AI knows it just happened.
function crisisCheck(g: Save, w: WorldDef, s: StatusDef): string[] {
    const c = s.zero?.crisis;
    if (!c) return [];
    const now = nowAbs(g);
    const start = (g.tick[`crisis0:${s.id}`] ??= now);
    if (now - start < (c.after ?? 0) || g.tick[`crisisDone:${s.id}`] === start || g.tick[`crisisDay:${s.id}`] === g.day) return [];   // once a time, and once a day
    const where = g.player.loc;
    const placeName = placeOf(g, w, where)?.name ?? 'home';
    const saw = presentAt(g, w, where).filter(r => r.met);
    if (c.shame && !saw.length) return [];   // a crisis about what people think (the smell) needs someone to see it
    // when death is real, nobody hands you food or water unless somebody is actually there
    const alone = mortalOn(g, w) && (s.id === 'hunger' || s.id === 'thirst') && !presentAt(g, w, where).length && !((g as any).party?.members ?? []).length;
    if (alone) return [];
    g.tick[`crisisDone:${s.id}`] = start; g.tick[`crisisDay:${s.id}`] = g.day;
    const cost = priceOf(g, c.cost ?? 0);
    if (cost) { g.player.money = Math.max(0, g.player.money - cost); book(g, s.name, -cost); }
    if (c.restore) addStatus(g, w, s.id, c.restore);
    if (c.mood && s.id !== 'mood') addStatus(g, w, 'mood', c.mood);
    for (const r of saw) if (c.shame) approve(g, r.avatar, -c.shame);
    if (c.seen) note(g, c.seen, [placeName], saw.map(r => r.avatar), where, 'crisis');
    if (c.place) g.player.loc = c.place === 'home' ? playerHomeId : c.place;
    (g as any).lastCrisis = { need: s.id, at: now, text: (c.seen ?? '').replace('{u}', '{{user}}').replace('{0}', placeName) };
    return c.text ? [c.text.replace('{cost}', money(w, cost)).replace('{place}', placeName)] : [];
}
// For the AI, for a few hours after a crisis: what just happened.
export function crisisLine(g: Save): string {
    const c = (g as any).lastCrisis;
    return c && c.text && nowAbs(g) - c.at < 180 ? `Just now: ${c.text} {{user}} is still shaken.` : '';
}

// Actions available where the player is (a café sells coffee; at home you can cook).
export function actionsHere(g: Save, w: WorldDef): ActionDef[] {
    const atHome = g.player.loc === playerHomeId;
    const tags = placeOf(g, w, g.player.loc)?.tags ?? [];
    const on = new Set(activeStatuses(w, g).map(s => s.id));
    // an action only about needs that are not in play (seeing a doctor in Life-Sim) is left out
    // (a scenario keeps them all: in one house, what you do is part of the scene even with needs off)
    const useful = (a: ActionDef) => { const ids = Object.keys(a.effects ?? {}); return !!a.outing || isScenario(w) || !ids.length || ids.some(id => on.has(id)); };
    const broken = brokenThings(g, w).length > 0;
    const closed = !atHome && systemOn(w, 'living') && !openNow(g, w, g.player.loc);   // a closed place: only what can be done anywhere
    // a scenario: the actions chosen for this room when the game started (instead of those its tags bring)
    const chosen: string[] | undefined = isScenario(w) ? (g as any).cfg?.roomActs?.[g.player.loc] : undefined;
    // Home: no money, so nothing to earn or pay, and going out has its own button (Go out)
    const homeMode = isScenario(w);
    const earns = (a: ActionDef) => a.cost < 0 || ((a.roll as any)?.success?.money ?? 0) > 0 || !!a.outing;
    // barely standing (death being real): nothing that earns money or works the body (sport, training)
    const hurt = !!tooHurt(g, w) || (g as any).mortal?.form === 'ghost';   // (a ghost cannot hold a tool)
    const strains = (a: ActionDef) => earns(a) || (a.tags ?? []).some(t => t === 'sport' || t === 'work') || !!a.hobby;
    const base = w.actions.filter(useful).filter(a => !homeMode || !earns(a)).filter(a => !isBlocked(g, a, w)).filter(a => a.id !== 'fix' || broken)
        .filter(a => homeMode || !a.needsItem || hasItem(g, a.needsItem)).filter(a => chosen || !(a.notTags ?? []).some(t => tags.includes(t))).filter(a => chosen ? (a.anywhere || chosen.includes(a.id)) : (a.home && atHome)
        || (a.place && a.place === g.player.loc)
        || (!a.home && !a.place && (a.anywhere || (a.tags ?? []).some(t => tags.includes(t))))).filter(a => !closed || a.anywhere).filter(a => !hurt || !strains(a));
    // prices after the difficulty; at home, what a cut-off service stops is left out
    // out and about, what you buy costs what it costs in this region now (the living world)
    const here = atHome ? 1 : priceHere(g, w);
    const all = [...base, ...(closed ? [] : extraActions(g, w)), ...eventActions(g, w)].filter(a => !atHome || !cutReason(g, a.id, w));
    // Home: a bathroom or a shower room is not where you grab a snack (what can be done anywhere stays out of it,
    // unless it was chosen for that room)
    const pl = placeOf(g, w, g.player.loc);
    const wet = homeMode && !!pl && /bath|shower|wash|toilet|restroom|banheiro|lavabo|chuveiro|ba[nñ]o|aseo|ducha/i.test(`${pl.id} ${pl.name}`);
    if (homeMode) {
        const list = all.filter(a => !earns(a)).filter(a => !wet || !a.anywhere || !!chosen?.includes(a.id));
        const pool = w.actions.filter(useful).filter(a => !earns(a)).filter(a => !isBlocked(g, a, w));
        return homeRoomActions(pl, list, pool, chosen, wet).map(a => (a.cost ? { ...a, cost: 0 } : a));
    }
    return all.map(a => (a.cost ? { ...a, cost: a.cost > 0 ? Math.round(priceOf(g, a.cost) * here) : priceOf(g, a.cost) } : a));
}

// Water, power… of a kind of home, paid with the rent.
export const billsOf = (w: WorldDef, kind: string) => Object.values(w.homes.kinds[kind]?.bills ?? {}).reduce((a, b) => a + b, 0);

export function canAfford(g: Save, a: ActionDef) { return g.player.money >= a.cost; }

export function applyAction(g: Save, w: WorldDef, a: ActionDef) {
    g.player.money -= a.cost;
    if (a.cost) book(g, a.name, -a.cost);
    for (const [id, v] of Object.entries(a.effects)) addStatus(g, w, id, v);
    for (const f of onAction) f(g, w, a);
}

// A short line for the AI about how the player feels (only what stands out).
export function feelings(g: Save, w: WorldDef): string {
    const low = activeStatuses(w, g).filter(s => (g.player.stats[s.id] ?? s.start) <= 25).map(s => `${s.name.toLowerCase()} is low (${g.player.stats[s.id]}/${s.max})`);
    return [low.length ? `How {{user}} feels: ${low.join(', ')}.` : '', crisisLine(g)].filter(Boolean).join('\n');
}

// Is there enough energy for this? `drain` is how much each need goes down (positive numbers). Returns the reason
// it cannot be done, or '' when it can. Only energy stops you; the other needs simply drop.
export function tooTired(g: Save, w: WorldDef, drain: Record<string, number>, what: string): string {
    const s = activeStatuses(w, g).find(x => x.id === 'energy');
    const need = s ? drain[s.id] ?? 0 : 0;
    if (!s || need <= 0) return '';
    const have = Math.round(g.player.stats[s.id] ?? s.start);
    return have < need ? `Not enough ${s.name.toLowerCase()} to ${what} (it takes ${Math.round(need)}, you have ${have}). Sleep or rest first.` : '';
}

// Home: what fits each room. Eating and drinking happen in the kitchen (everything) and the dining room (a meal, a
// coffee, a drink, a snack: not cooking); the TV and video games are in the living room; washing up (a shower,
// brushing your teeth…) is in the bathrooms; working out (the treadmill too) is in the gym. What you chose for a room
// in the Home creator stays as you chose it.
const FOODY = (a: ActionDef) => (a.effects?.hunger ?? 0) > 0 || (a.effects?.thirst ?? 0) > 0;
const SCREEN = (a: ActionDef) => /^x-(tv|games)$/.test(a.id) || /\b(tv|video ?games?)\b/i.test(a.label ?? '');
const WASHY = (a: ActionDef) => (a.effects?.hygiene ?? 0) > 0;
// Home: an action made for one room of a Home (the pool, the garage…) also fits the same kind of room in any other
// Home, by its name (a pool you added and called "Piscina" gets swimming and sunbathing too).
const ROOM_KINDS = [/pool|piscina/i, /garage|garagem|garaje/i, /laundry|lavander/i, /front ?yard|porch|varanda|porche|jard[ií]n?|garden|quintal|yard/i, /storage|dep[oó]sito|trastero|despensa|attic|s[oó]t[aã]o/i, /dining|jantar|comedor/i, /gym|academia|gimnasio/i, /kitchen|cozinha|cocina/i, /living|sala de estar|sal[oó]n|lounge/i, /bath|banheiro|ba[nñ]o|shower|chuveiro|lavabo|toilet|washroom/i];
export function placeFits(place: string, room: { id: string; name?: string } | null | undefined): boolean {
    if (!room) return false;
    if (place === room.id) return true;
    const who = `${room.id} ${room.name ?? ''}`;
    return ROOM_KINDS.some(re => re.test(place) && re.test(who));
}
const SPORTY = (a: ActionDef) => (!WASHY(a) && (a.tags ?? []).includes('sport')) || a.id === 'x-treadmill';
const KITCHEN_ONLY = new Set(['cook', 'water', 'x-coffee']);
function homeRoomActions(pl: { id: string; name: string; tags?: string[] } | null | undefined, list: ActionDef[], pool: ActionDef[], chosen: string[] | undefined, wet: boolean): ActionDef[] {
    const who = `${pl?.id ?? ''} ${pl?.name ?? ''}`;
    const food = (pl?.tags ?? []).includes('food');
    const kitchen = /kitchen|cozinha|cocina/i.test(who);
    const living = /living|lounge|family room|tv room|sala de estar|sal[oó]n/i.test(who);
    const gym = /gym|academia|gimnasio/i.test(who);
    const fits = (a: ActionDef) => (SPORTY(a) ? gym : WASHY(a) ? wet : FOODY(a) ? food && (kitchen || !KITCHEN_ONLY.has(a.id)) : SCREEN(a) ? living : true);
    const keep = list.filter(a => !!chosen?.includes(a.id) || fits(a));
    const have = new Set(keep.map(a => a.id));
    const add = chosen ? [] : pool.filter(a => !have.has(a.id) && (FOODY(a) || SCREEN(a) || WASHY(a) || SPORTY(a) || (!!a.place && placeFits(a.place, pl))) && fits(a) && (!!a.place || a.home || a.anywhere || !a.tags?.length || a.tags.some(t => (pl?.tags ?? []).includes(t))) && (!a.place || placeFits(a.place, pl)));
    return [...keep, ...add];
}
