// "Fill from my persona": the new game's sheet filled in by your AI from what your persona already is: its
// description, its lorebook (your powers, your limits, the people you know), lorebooks you add (a campaign ledger), and
// optionally the end of a chat you played it in (where the latest status panel says you are now: stats, gear, money).
// The AI picks the world's closest origin (or names your own background), writes "about you in this world", picks or
// makes your class, sets your attributes in the system's range, your weapon, gear and money, the people of this game
// who already know you, and your own meters (Warmth, Weariness…). Everything stays editable before the game starts.
import type { WorldDef } from '../core/world.js';
import type { RpgDef } from '../core/rpgdef.js';
import { personas, personaLore, loadLore, quiet } from '../st/bridge.js';
import { parseJson } from './fromlore.js';
import { makeMeters, type Meter } from './meters.js';

export interface FillInput {
    file: string; world: WorldDef;
    /** the RPG system chosen (none: the game is not played as an RPG) */
    rpg?: RpgDef | null; range?: { min: number; max: number };
    /** the people who can be in this game (cards chosen, cards you have, the world's own people) */
    people: { key: string; name: string }[];
    /** more lorebooks to read (a campaign ledger, the series' lorebook) */
    books?: string[];
    /** the end of a chat you played the persona in (its messages) */
    chat?: any[];
}
export interface Fill {
    origin?: string; background: string; bio: string; traits: Record<string, string[]>;
    cls?: string; newClass?: { name: string; desc: string; key: string };
    attrs: Record<string, number>; skills: string[];
    weapon?: string; newWeapon?: { name: string; dice: number; sides: number; attr: string };
    gear: string[]; money?: number;
    /** where you live, when it is inside one of the world's places (a room in a guild tower) */
    home?: { place: string; room: string };
    people: { key: string; name: string; approval: number; how: string }[];
    /** people the AI found who are not in this game (shown, not added) */
    missing: string[];
    meters: Meter[];
}

const LORE_MAX = 32000, CHAT_MAX = 9000;
const clean = (s: any, n: number) => String(s ?? '').replace(/\r/g, '').trim().slice(0, n);
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// A lorebook's text: the entries switched on, in the book's own order (always-on ones first), cut to `max`.
async function bookText(name: string, max: number): Promise<string> {
    let data: any; try { data = await loadLore(name); } catch { return ''; }
    const es = Object.values<any>(data?.entries ?? {}).filter(e => e && !e.disable && String(e.content ?? '').trim())
        .sort((a, b) => Number(!!b.constant) - Number(!!a.constant));
    let out = '';
    for (const e of es) {
        const t = `### ${clean(e.comment || (e.key ?? [])[0] || 'Entry', 80)}\n${clean(e.content, 4000)}\n\n`;
        if (out.length + t.length > max) { out += t.slice(0, Math.max(0, max - out.length)); break; }
        out += t;
    }
    return out.trim();
}
// The chat's last replies (where the status panel is), newest last.
export function chatTail(msgs: any[], max = CHAT_MAX): string {
    const out: string[] = []; let size = 0;
    for (const m of [...msgs].reverse()) {
        if (m?.is_system || typeof m?.mes !== 'string' || !m.mes.trim()) continue;
        const t = `${m.is_user ? '[Player]' : `[${clean(m.name, 40) || 'Narrator'}]`}\n${m.mes.trim()}`;
        if (size + t.length > max) { if (!out.length) out.push(t.slice(-max)); break; }
        out.push(t); size += t.length;
        if (out.length >= 4) break;
    }
    return out.reverse().join('\n\n');
}

export function fillPrompt(name: string, desc: string, lore: string, chat: string, inp: FillInput): string {
    const w = inp.world, r = inp.rpg;
    const origins = (w.catalogs.origins ?? []).map(o => `- ${o.id}: ${o.name}${o.desc ? ` (${clean(o.desc, 140)})` : ''}`).join('\n');
    const places = w.places.filter(p => !p.link && !p.hidden).map(p => p.in ? `${p.name} (${p.floor ?? 'part'} of ${w.places.find(b => b.id === p.in)?.name ?? p.in})` : p.name).join('; ');
    const traits = (w.sheet.traits ?? []).map(t => `- ${t.id} (${t.label}, up to ${t.max ?? 3}): ${t.options.join(', ')}`).join('\n');
    const rpg = r ? `
The game's RPG system${r.name ? ` (${r.name})` : ''}:
Attributes (each from ${inp.range?.min ?? 3} to ${inp.range?.max ?? 18}): ${r.attributes.map(a => `${a.id} = ${a.name}`).join(', ')}
Classes: ${r.classes.map(c => `${c.id} = ${c.name}${c.desc ? ` (${clean(c.desc, 90)})` : ''}`).join('; ')}
Skills: ${r.skills.map(s => s.id).join(', ')}
Weapons: ${(r.weapons ?? []).map(x => `${x.id} = ${x.name} ${x.dice}d${x.sides}`).join('; ') || 'none listed'}` : '';
    return `You are setting up ${name}, the player's own character, for a new game in the world "${w.name}". Read what is known about ${name} below and fill in the game's character sheet so ${name} starts as who they already are${chat ? ', where the chat at the end left them' : ''}.

The world: ${clean(w.setting, 1200)}
Currency: ${w.currency.name ?? w.currency.symbol ?? 'money'}.
Origins (backgrounds) of this world:
${origins || '- none'}
${traits ? `Traits to choose from:\n${traits}\n` : ''}${rpg}
Places of this world: ${places || 'none'}
People who can be in this game: ${inp.people.map(p => p.name).join(', ') || 'none'}

Reply with ONE JSON object, nothing else (no code fences):
{
 "origin": "the id of the origin above that fits ${name} best",
 "background": "if no origin fits exactly: who ${name} is in this world in a few words (e.g. a guild's provisional healer, officially E-rank); else empty",
 "bio": "about ${name} in this world: 3 to 6 sentences on their situation, work or role, standing, what others know about them and what they hide. No physical description.",
 "traits": {"trait id": ["options from its list"]},${r ? `
 "class": "a class id above that fits, or empty when none does",
 "newClass": {"name": "only when no class fits: a class made for ${name}", "desc": "one sentence", "key": "the attribute id their powers use"},
 "attributes": {"attribute id": a number in the range, converted from ${name}'s own numbers when they have them (their highest stays the highest)},
 "skills": ["skill ids ${name} is good at, up to 6"],
 "weapon": "a weapon id above, or empty",
 "newWeapon": {"name": "only when ${name} carries a weapon not listed", "dice": 1, "sides": 6, "attr": "attribute id"},` : ''}
 "gear": ["what ${name} owns and carries that matters, one short line each, up to 12"],
 "home": {"place": "if ${name} lives inside one of the places above (a room in a guild tower, a dorm): its name; else empty", "room": "the room or flat (e.g. Floor 9, Room 918)"},
 "money": the money ${name} has in this world's currency as a number, or null,
 "people": [{"name": "someone who already knows ${name}", "approval": -100 to 100, "how": "how they know ${name}, one line"}],
 "meters": [{"name": "a number ${name}'s own rules track (a power pool, exhaustion, corruption, experience…)", "value": current, "max": maximum or 0, "note": "how it fills and empties, one short line"}]
}
Rules: use only the facts below; leave a field empty when nothing says it. "people" lists everyone who already knows ${name}, in this game or not. At most 6 meters, only ones the facts below really track (not hit points or money).

## ${name}'s description
${clean(desc, 6000) || 'None.'}
${lore ? `\n## ${name}'s lorebooks\n${lore}\n` : ''}${chat ? `\n## The end of a chat with ${name} (the latest status there is where ${name} is now)\n${chat}\n` : ''}`;
}

/** Reads the AI's answer into a fill that fits this world and system (what does not fit is dropped). */
export function readFill(raw: any, inp: FillInput): Fill {
    const w = inp.world, r = inp.rpg;
    const s = (v: any, n = 200) => clean(typeof v === 'string' ? v : '', n);
    const f: Fill = { background: s(raw?.background, 160), bio: s(raw?.bio, 1500), traits: {}, attrs: {}, skills: [], gear: [], people: [], missing: [], meters: makeMeters(raw?.meters) };
    const oid = s(raw?.origin, 60);
    f.origin = (w.catalogs.origins ?? []).find(o => o.id === oid || norm(o.name) === norm(oid))?.id;
    for (const t of w.sheet.traits ?? []) {
        const got: any[] = Array.isArray(raw?.traits?.[t.id]) ? raw.traits[t.id] : [];
        const ok = got.map(x => t.options.find(o => norm(o) === norm(String(x)))).filter((x): x is string => !!x);
        if (ok.length) f.traits[t.id] = [...new Set(ok)].slice(0, t.max ?? 3);
    }
    if (r) {
        const cid = s(raw?.class, 60);
        f.cls = r.classes.find(c => c.id === cid || norm(c.name) === norm(cid))?.id;
        const nc = raw?.newClass;
        if (!f.cls && s(nc?.name, 40)) f.newClass = { name: s(nc.name, 40), desc: s(nc.desc, 200), key: r.attributes.some(a => a.id === nc.key) ? nc.key : r.attributes[0].id };
        const lim = inp.range ?? { min: 3, max: 18 };
        for (const a of r.attributes) { const v = Number(raw?.attributes?.[a.id]); if (Number.isFinite(v)) f.attrs[a.id] = Math.max(lim.min, Math.min(lim.max, Math.round(v))); }
        f.skills = [...new Set((Array.isArray(raw?.skills) ? raw.skills : []).map((x: any) => r.skills.find(k => k.id === x || norm(k.name) === norm(String(x)))?.id).filter(Boolean) as string[])].slice(0, 8);
        const wid = s(raw?.weapon, 60);
        f.weapon = (r.weapons ?? []).find(x => x.id === wid || norm(x.name) === norm(wid))?.id;
        const nw = raw?.newWeapon;
        if (!f.weapon && s(nw?.name, 40)) f.newWeapon = { name: s(nw.name, 40), dice: Math.max(1, Math.min(4, Math.round(Number(nw.dice) || 1))), sides: [4, 6, 8, 10, 12].includes(Number(nw.sides)) ? Number(nw.sides) : 6, attr: r.attributes.some(a => a.id === nw.attr) ? nw.attr : r.attributes[0].id };
    }
    f.gear = (Array.isArray(raw?.gear) ? raw.gear : []).map((x: any) => s(x, 140)).filter(Boolean).slice(0, 12);
    const hp = s(raw?.home?.place, 80);
    const hit = hp ? w.places.find(p => !p.link && norm(p.name) === norm(hp)) ?? w.places.find(p => !p.link && norm(hp).includes(norm(p.name)) && norm(p.name).length > 3) : undefined;
    if (hit) { const b = hit.in ? w.places.find(p => p.id === hit.in) ?? hit : hit; f.home = { place: b.id, room: s(raw?.home?.room, 60) || (hit !== b ? hit.floor ?? hit.name : '') }; }
    const m = Number(raw?.money); if (raw?.money !== null && Number.isFinite(m) && m >= 0) f.money = Math.round(m);
    for (const p of Array.isArray(raw?.people) ? raw.people : []) {
        const n = s(p?.name, 60); if (!n) continue;
        const k = norm(n), words = k.split(' ');
        // the same person: the whole name, or both ways round (Korean names), or a card named by part of the name
        // ("Jae-Won" for Shin Jae-Won; the longest such card wins)
        const hit = inp.people.find(x => norm(x.name) === k) ?? inp.people.find(x => norm(x.name).split(' ').sort().join(' ') === [...words].sort().join(' '))
            ?? inp.people.filter(x => { const ws = norm(x.name).split(' '); return ws.join('').length >= 3 && ws.every(y => words.includes(y)); }).sort((a, b) => b.name.length - a.name.length)[0];
        const ap = Math.max(-100, Math.min(100, Math.round(Number(p?.approval) || 0)));
        if (hit) { if (!f.people.some(x => x.key === hit.key)) f.people.push({ key: hit.key, name: hit.name, approval: ap, how: s(p?.how, 160) }); }
        else if (!f.missing.includes(n)) f.missing.push(n);
    }
    return f;
}

/** Asks the AI. Throws when there is nothing to read or the answer cannot be read. */
export async function fillFromPersona(inp: FillInput): Promise<Fill> {
    const p = personas().find(x => x.file === inp.file);
    if (!p) throw new Error('This persona no longer exists.');
    const books = [...new Set([personaLore(inp.file), ...(inp.books ?? [])].filter(Boolean))];
    const parts: string[] = []; let left = LORE_MAX;
    for (const b of books) { if (left < 500) break; const t = await bookText(b, left); if (t) { parts.push(`# ${b}\n${t}`); left -= t.length; } }
    const lore = parts.join('\n\n');
    const chat = inp.chat?.length ? chatTail(inp.chat) : '';
    if (!p.description.trim() && !lore && !chat) throw new Error(`There is nothing to read about ${p.name}: no description, lorebook or chat.`);
    const out = await quiet(fillPrompt(p.name, p.description.replace(/\{\{user\}\}/gi, p.name), lore, chat, inp), 3000);
    return readFill(parseJson(out), inp);
}

/** The words for "about you in this world": the AI's own, your background, your gear and the people not in this game. */
export function fillBio(f: Fill): string {
    return [
        f.background ? `Background: ${f.background}.` : '',
        f.bio,
        f.gear.length ? `Carries and owns: ${f.gear.join('; ')}.` : '',
        f.people.length ? `Already knows: ${f.people.map(p => `${p.name}${p.how ? ` (${p.how})` : ''}`).join('; ')}.` : '',
        f.missing.length ? `Also knows (not in this game): ${f.missing.join(', ')}.` : '',
    ].filter(Boolean).join('\n').slice(0, 3000);
}
