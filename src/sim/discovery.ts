// Places that open up as the story goes: a hidden place is not on the map until it is found (someone gives you an
// address, takes you to a secret base), a restricted one is on the map with a lock until you are let in (a pass, a
// rank, a membership). Both open in three ways: the story (after a reply that names one, a short AI check asks if
// {{user}} just learned where it is or got the right to go in), the place's own rules (a bond with someone, a rank in
// a faction, a level, a reputation), or by hand. A place the story made up can be added to the map too ("a place we
// just found"). All of it lives in the save: every playthrough finds its own way.
import type { Save } from '../core/store.js';
import type { WorldDef, Place, PlaceOpens } from '../core/world.js';
import { quiet, personaName, chat } from '../st/bridge.js';
import { onHour } from './hooks.js';
import { note } from './facts.js';
import { bondOf } from './social.js';
import { memberOf, factionDef } from './factions.js';
import { sheetOf, isRpg } from './rpg.js';
import { repIn } from './standing.js';
import { placeOf, hiddenNow, lockedNow, addedPlaces, floorsOf, buildingOf, floorName } from './places.js';

interface Discovery { found: string[]; open: string[]; added: Place[]; asked?: Record<string, number> }
export const discovery = (g: Save): Discovery => {
    const d = ((g as any).discovery ??= { found: [], open: [], added: [] }) as Discovery;
    d.found ??= []; d.open ??= []; d.added ??= [];
    return d;
};
const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const bare = (s: string) => norm(s).replace(/^(the|a|an) /, '');

/** Every place of the world or of this game that is still hidden or locked. */
export function waiting(g: Save, w: WorldDef): Place[] {
    return [...w.places, ...addedPlaces(g)].filter(p => !p.link && (hiddenNow(g, w, p) || !!lockedNow(g, w, p)));
}

/** Finds a place (it goes on the map) and/or opens it (you can go in). Returns what to tell the player. */
export function unlock(g: Save, w: WorldDef, id: string, how: { find?: boolean; open?: boolean }): string {
    const p = placeOf(g, w, id); if (!p) return '';
    const d = discovery(g);
    const wasHidden = hiddenNow(g, w, p), wasLocked = !!lockedNow(g, w, p);
    // a floor found or opened finds (and opens) its building too: you can't get to floor 7 without the front door
    const b = p.in ? placeOf(g, w, p.in) : null;
    if (how.find || how.open) for (const x of [p, b]) if (x?.hidden && !d.found.includes(x.id)) d.found.push(x.id);
    if (how.open) for (const x of [p, b]) if (x?.restricted && !d.open.includes(x.id) && (x === p || lockedNow(g, w, p))) d.open.push(x.id);
    const name = floorName(p);
    const found = wasHidden && !hiddenNow(g, w, p), opened = wasLocked && !lockedNow(g, w, p);
    if (found) note(g, '{u} found out where {0} is.', [name], [], g.player.loc, 'goal');
    if (opened) note(g, '{u} can go into {0} now.', [name], [], g.player.loc, 'goal');
    return found && opened ? `New place on your map, and you can go in: ${name}.` : found ? `New place on your map: ${name}${lockedNow(g, w, p) ? ` (${lockedNow(g, w, p)})` : ''}.` : opened ? `${name} is open to you now.` : '';
}

/* ---------- the place's own rules ---------- */

/** Whether a place's rules hold now (every condition set must hold; a place with none never opens by itself). */
export function rulesHold(g: Save, w: WorldDef, p: Place, o: PlaceOpens | undefined = p.opens): boolean {
    if (!o) return false;
    const checks: boolean[] = [];
    if (o.who) {
        const want = norm(o.who);
        const r = Object.values(g.cast).find(x => norm(x.name) === want) ?? Object.values(g.cast).find(x => norm(x.name).includes(want) || want.includes(norm(x.name)));
        checks.push(!!r && r.met && bondOf(g, r.avatar) >= (o.bond ?? 30));
    }
    if (o.faction) { const m = memberOf(g, o.faction); checks.push(!!m && m.rank + 1 >= (o.rank ?? 1)); }
    if (o.level) checks.push(isRpg(w) && (sheetOf(g)?.level ?? 0) >= o.level);
    if (o.rep) checks.push(repIn(g, w, p.map) >= o.rep);
    return checks.length > 0 && checks.every(Boolean);
}
/** The rules in words ("Know Cha Hae-In well (bond 40) · Rank 3 in the Hunters Association"). */
export function rulesText(g: Save, w: WorldDef, o: PlaceOpens | undefined): string {
    if (!o) return '';
    const f = o.faction ? factionDef(g, w, o.faction) : null;
    return [o.who ? `Know ${o.who} well (bond ${o.bond ?? 30})` : '', f ? (o.rank && o.rank > 1 ? `Rank ${f.ranks[o.rank - 1] ?? o.rank} in ${f.name}` : `Join ${f.name}`) : '',
        o.level ? `Level ${o.level}` : '', o.rep ? `Reputation ${o.rep} in the area` : ''].filter(Boolean).join(' · ');
}
export function checkRules(g: Save, w: WorldDef): string[] {
    const out: string[] = [];
    for (const p of waiting(g, w)) if (p.opens && rulesHold(g, w, p)) { const m = unlock(g, w, p.id, { find: true, open: true }); if (m) out.push(m); }
    return out;
}
onHour.push((g, w) => checkRules(g, w));

/* ---------- the story ---------- */

/** The hidden or locked places a text names (by their name or another name, at least 4 letters). */
export function named(g: Save, w: WorldDef, text: string): Place[] {
    const t = ` ${norm(text)} `;
    return waiting(g, w).filter(p => [p.name, ...(p.aka ?? [])].map(bare).some(n => n.length >= 4 && t.includes(` ${n} `)));
}
export function judgePrompt(g: Save, w: WorldDef, lines: string[], list: Place[]): string {
    const me = personaName();
    const what = (p: Place) => {
        const lock = lockedNow(g, w, p); const b = p.in ? placeOf(g, w, p.in) : null;
        return `"${floorName(p)}"${b ? ` (in ${b.name})` : ''}: ${[hiddenNow(g, w, p) ? `${me} does not know where it is yet` : '', lock ? `${me} may not go in yet (${lock})` : ''].filter(Boolean).join('; ')}`;
    };
    return `[You are the rules judge of a role-play game. You do not write the story.]
The last lines of the story:
${lines.join('\n')}

Places ${me} does not have yet:
${list.map((p, i) => `${i + 1}. ${what(p)}`).join('\n')}

For each place, did these lines just give ${me} the way there (an address, directions, a map, being taken there) or the right to go in (a pass, a key, a membership, a rank, being let in)? Only hearing about the place is not enough.
Answer one line per place, nothing else: "1: found" (now knows where it is), "1: allowed" (may go in now), "1: both", or "1: no".`;
}
export function parseJudge(out: string, n: number): ('found' | 'allowed' | 'both' | 'no')[] {
    const res = Array.from({ length: n }, () => 'no' as 'found' | 'allowed' | 'both' | 'no');
    for (const m of out.matchAll(/(\d+)\s*[:.)\-]\s*\**\s*(found|allowed|both|no)\b/gi)) {
        const i = Number(m[1]) - 1; if (i >= 0 && i < n) res[i] = m[2].toLowerCase() as any;
    }
    return res;
}
/** The last lines of the chat, for the judge (the newest last). */
export function lastLines(n = 4): string[] {
    return chat().filter((m: any) => m && !m.is_system && m.mes).slice(-n).map((m: any) => `${m.name ?? ''}: ${String(m.mes).replace(/\s+/g, ' ').slice(0, 700)}`);
}
/** After a line of the story: asks the judge about the hidden or locked places it names. Returns what opened. */
let lastAsked = '', asking = false;
export async function storyCheck(g: Save, w: WorldDef): Promise<string[]> {
    const lines = lastLines();
    // once per new line of the story (the judge's own call ends a generation too), one at a time
    const key = `${g.world}|${chat().length}|${lines.at(-1) ?? ''}`;
    if (!lines.length || asking || key === lastAsked) return [];
    lastAsked = key;
    const list = named(g, w, lines.slice(-2).join('\n')).slice(0, 6);
    if (!list.length) return [];
    asking = true;
    let ans: ReturnType<typeof parseJudge>;
    try { ans = parseJudge(await quiet(judgePrompt(g, w, lines, list), 60), list.length); } finally { asking = false; }
    const out: string[] = [];
    list.forEach((p, i) => {
        const a = ans[i]; if (a === 'no') return;
        const m = unlock(g, w, p.id, { find: true, open: a !== 'found' });
        if (m) out.push(m);
    });
    return out;
}

/* ---------- a place the story made up ---------- */

const slug = (s: string) => norm(s).replace(/ /g, '_').slice(0, 30) || 'place';
/** Adds a place to this game's map: next to `near` (or as a new floor of the building `inside`). */
export function addFound(g: Save, w: WorldDef, o: { name: string; desc?: string; near: string; inside?: string; floor?: string; tags?: string[] }): Place | null {
    const name = o.name.trim().replace(/\s+/g, ' ').slice(0, 60); if (!name) return null;
    const host = placeOf(g, w, o.inside || o.near) ?? placeOf(g, w, g.player.loc);
    const map = host?.map ?? w.maps[0]?.id ?? ''; if (!map) return null;
    const d = discovery(g);
    const n = d.added.length + 1;
    const jig = (v: number, k: number) => Math.max(3, Math.min(97, v + (o.inside ? 0 : k)));
    const p: Place = { id: `found:${slug(name)}_${n}`, name, map, x: jig(host?.x ?? 50, 4), y: jig(host?.y ?? 50, 3), tags: o.tags?.length ? o.tags : ['leisure'],
        ...(o.desc ? { desc: o.desc.trim().slice(0, 400) } : {}), ...(host?.bg && o.inside ? { bg: host.bg } : {}), closed: [],
        ...(o.inside ? { in: o.inside, floor: (o.floor ?? '').trim().slice(0, 30) || `Floor ${floorsOf(g, w, o.inside).length + 2}` } : {}) };
    d.added.push(p);
    note(g, '{u} found a new place: {0}.', [floorName(p)], [], g.player.loc, 'goal');
    return p;
}
export function removeFound(g: Save, id: string) { const d = discovery(g); d.added = d.added.filter(p => p.id !== id && p.in !== id); }
/** One line on the place, from the story (the AI); '' when it says nothing useful. */
export async function describeFound(name: string): Promise<string> {
    const out = await quiet(`[Write for a game's map card. Do not continue the story.]
The last lines of the story:
${lastLines(6).join('\n')}

In one short sentence (at most 25 words), what is the place "${name}", as the story shows it? Only the sentence.`, 80);
    return out.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0].slice(0, 300);
}

/* ---------- for the AI ---------- */

/** The building you are in: its floors (and which ones you may not go into), so the story knows the layout. */
export function buildingLines(g: Save, w: WorldDef): string[] {
    const bid = buildingOf(g, w, g.player.loc); const b = bid ? placeOf(g, w, bid) : null;
    if (!b) return [];
    const floors = floorsOf(g, w, bid);
    const me = personaName();
    return [`${b.name} has these floors: ${[b.name, ...floors.map(p => `${floorName(p)}${lockedNow(g, w, p) ? ` (${me} may not go in: ${lockedNow(g, w, p)})` : ''}`)].join('; ')}.`];
}
/** Where you are, if you may not be here (brought in by the story without the right to be here): nothing for now. */
export const lockedHereLine = (g: Save, w: WorldDef): string => { const p = placeOf(g, w, g.player.loc); return p && lockedNow(g, w, p) ? `${personaName()} is not supposed to be here (${lockedNow(g, w, p)}).` : ''; };
