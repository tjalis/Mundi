// People from the story: someone the story brings in who is not one of the game's people (a party's tank, a nurse, a
// stranger at the bar). After each reply the story check notes them down; when one of them comes to matter (a moment
// with you: a life saved, an invitation to team up, numbers swapped… or they keep coming up on different days), a card
// offers to add them, and adding them makes them one of the world's people: a card written from what the story said,
// a home, a job, a routine and a start with you.
import { settings, nowAbs, type Save, type Resident } from '../core/store.js';
import { isScenario, type WorldDef } from '../core/world.js';
import { quiet, chat, personaName, characters, charOf, createCharacter } from '../st/bridge.js';
import { presentAt } from './people.js';
import { lookPrefs, storyPrompt, parseStory, applyStory } from './looks.js';
import { social, bump } from './social.js';
import { addRomance } from './romance.js';
import { note } from './facts.js';
import { inCombat } from './combat.js';
import { isRpg } from './rpg.js';
import { join } from './party.js';
import { STYLE_HEAD } from './mundify.js';
import { resident, addResident, exampleCards, initialsAvatar } from './game.js';
import { takenHomes, normalizeHomes } from './homes.js';

/* ---------- settings (per player) ---------- */

export interface PeoplePrefs { on: boolean; recurring: boolean; auto: boolean; draw: boolean | null }
export const peoplePrefs = (): PeoplePrefs => {
    const s = settings() as any;
    const p = (s.storyPeople ??= {}) as PeoplePrefs;
    p.on ??= true; p.recurring ??= true; p.auto ??= false; p.draw ??= null;   // draw null: as the sprite drawing is set
    return p;
};

/* ---------- the notes (per game) ---------- */

export type NewcomerState = 'watch' | 'later' | 'never' | 'added';
export interface Newcomer {
    key: string; name: string; aka: string[]; role: string; looks: string; notes: string[];
    days: number[]; first: number; last: number; place: string; moments: string[];
    state: NewcomerState; seenMoments?: number;   // moments already offered (Not now waits for a new one)
    avatar?: string;   // once added: their card
}
interface Book { list: Newcomer[]; offer?: string }
export const MAX_NEWCOMERS = 20, RECURRING_DAYS = 3, MAX_NOTES = 8;
const book = (g: Save): Book => { const b = ((g as any).newcomers ??= { list: [] }) as Book; b.list ??= []; return b; };
export const newcomers = (g: Save) => book(g).list;
export const keyOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const unnamed = (n: Newcomer) => /^the\s/i.test(n.name);
const words = (s: string) => keyOf(s).split(' ').filter(Boolean);

// The game's own people (and you): never new. A first name alone counts ("Ana" is Ana Ruiz).
function knownPerson(g: Save, name: string): boolean {
    const k = keyOf(name); if (!k) return true;
    const me = keyOf(personaName());
    if (k === me || (me && k === words(me)[0])) return true;
    return Object.values(g.cast).some(r => { const rk = keyOf(r.name); return rk === k || words(rk)[0] === k || words(k)[0] === rk; });
}
// A note already kept for this name (or one of the other names they went by).
export function findNewcomer(g: Save, name: string): Newcomer | null {
    const k = keyOf(name); if (!k) return null;
    const list = newcomers(g);
    return list.find(n => n.key === k || n.aka.some(a => keyOf(a) === k))
        ?? (k.includes(' ') ? null : list.find(n => !unnamed(n) && words(n.name)[0] === k)) ?? null;
}

/* ---------- the story check: one AI call for the looks and the people ---------- */

export interface PeopleSeen { kind: 'new' | 'seen' | 'moment' | 'named'; name: string; text: string; to?: string }

export function peoplePrompt(g: Save, w: WorldDef): string {
    const me = personaName();
    const cast = Object.values(g.cast).map(r => r.name);
    const noted = newcomers(g).filter(n => n.state !== 'added').map(n => `${n.name}${n.role ? ` (${n.role})` : ''}`);
    return `People of the game (already known, never new): ${[me, ...cast].join(', ') || 'none'}.
People noticed before: ${noted.join(', ') || 'none'}.

Did the latest lines bring in a PERSON who is not one of those, someone who is there with ${me} and does or says something (not only mentioned)? Leave out monsters, bosses, animals, crowds, gods, spirits, famous or historical figures, and anyone only talked about.
For each person, one line:
NEW Name: role; looks; what happened with ${me} (short)
For someone noticed before who is there again:
SEEN Name: what they did now (short)
If a person without a name so far is given one: NAMED the role = Name
A real moment between ${me} and someone noticed or new (a life saved, being saved, an invitation to team up or join them, numbers swapped, agreeing to meet again, becoming friends, a kiss, taken as an apprentice). Only a moment that happened in these lines:
MOMENT Name: one short sentence about it, to ${me} as "you" (Daniel asked you to be his party healer.)
Use their name; if they have none yet, their role with "the" (the tank).`;
}

export function parsePeople(out: string): PeopleSeen[] {
    const res: PeopleSeen[] = [];
    for (const line of out.split('\n')) {
        const m = line.match(/^\s*[-*]?\s*(NEW|SEEN|MOMENT|NAMED)\s*:?\s+(.+)$/i); if (!m) continue;
        const kind = m[1].toLowerCase() as PeopleSeen['kind'];
        if (kind === 'named') {
            const n = m[2].match(/^(.+?)\s*(?:=|→|->)\s*(.+)$/); if (!n) continue;
            res.push({ kind, name: clean(n[1]), to: clean(n[2]), text: '' });
            continue;
        }
        const c = m[2].match(/^([^:]{1,60}?)\s*:\s*(.*)$/); if (!c) continue;
        const name = clean(c[1]); if (!name || /^(none|nobody|no one)$/i.test(name)) continue;
        res.push({ kind, name, text: c[2].trim().replace(/^["']|["']$/g, '') });
    }
    return res;
}
const clean = (s: string) => s.trim().replace(/^["'*<]+|["'*>.]+$/g, '').replace(/\s+/g, ' ').trim();

// Notes what the story check saw. Returns the names that came to matter just now (an offer is queued for the first).
export function notePeople(g: Save, w: WorldDef, seen: PeopleSeen[]): string[] {
    const list = newcomers(g); const day = g.day; const now = nowAbs(g);
    const touched = new Set<Newcomer>();
    for (const s of seen) {
        if (s.kind === 'named') {
            const n = findNewcomer(g, s.name); const to = s.to ?? '';
            if (!n || !to || knownPerson(g, to) || findNewcomer(g, to)) continue;
            n.aka = [...new Set([...n.aka, n.name])]; n.name = to; n.key = keyOf(to); touched.add(n);
            continue;
        }
        if (knownPerson(g, s.name)) continue;
        let n = findNewcomer(g, s.name);
        if (!n) {
            if (s.kind === 'seen') continue;   // "seen" only for someone already noted
            const [role = '', looks = '', ...rest] = s.kind === 'new' ? s.text.split(';').map(x => x.trim()) : [];
            n = { key: keyOf(s.name), name: s.name, aka: [], role: role.slice(0, 80), looks: looks.slice(0, 200), notes: [], days: [], first: now, last: now, place: g.player.loc, moments: [], state: 'watch' };
            if (rest.join('; ')) n.notes.push(rest.join('; ').slice(0, 200));
            list.push(n);
        } else if (s.kind === 'new' && s.text) {
            const [role = '', looks = ''] = s.text.split(';').map(x => x.trim());
            if (!n.role && role) n.role = role.slice(0, 80);
            if (looks && !n.looks.includes(looks)) n.looks = [n.looks, looks].filter(Boolean).join(', ').slice(0, 300);
        }
        if (n.state === 'never' || n.state === 'added') continue;
        if (s.kind === 'seen' && s.text) n.notes.push(s.text.slice(0, 200));
        if (s.kind === 'moment' && s.text && !n.moments.includes(s.text)) n.moments.push(s.text.slice(0, 200));
        if (!n.days.includes(day)) n.days.push(day);
        n.last = now; n.place = g.player.loc;
        n.notes = n.notes.slice(-MAX_NOTES); n.moments = n.moments.slice(-MAX_NOTES);
        touched.add(n);
    }
    // a short list: the oldest who never mattered go first (never the ones you chose, added or turned down)
    while (list.length > MAX_NEWCOMERS) {
        const drop = [...list].filter(n => n.state === 'watch' && !n.moments.length && !touched.has(n)).sort((a, b) => a.last - b.last)[0];
        if (!drop) break;
        list.splice(list.indexOf(drop), 1);
    }
    const ready = [...touched].filter(n => mattersNow(n)).map(n => n.name);
    const b = book(g);
    if (ready.length && !offerOf(g)) b.offer = keyOf(ready[0]);
    return ready;
}
// Comes to matter: a moment (a new one, after Not now), or (when chosen) coming up on three different days.
export function mattersNow(n: Newcomer): boolean {
    if (n.state === 'never' || n.state === 'added') return false;
    const fresh = n.moments.length > (n.seenMoments ?? 0);
    if (fresh) return true;
    return n.state === 'watch' && peoplePrefs().recurring && n.days.length >= RECURRING_DAYS;
}

// After a reply: one AI call (the looks of the people here, and people new to the game). Returns what changed.
let lastAsked = '';
export async function storyAfterReply(g: Save, w: WorldDef, outfitsOf: (a: string) => string[]): Promise<{ looks: boolean; people: string[] }> {
    const lp = lookPrefs(), pp = peoplePrefs();
    const present = presentAt(g, w, g.player.loc);
    const doLooks = lp.on && lp.story && present.length > 0, doPeople = pp.on;
    if (!doLooks && !doPeople) return { looks: false, people: [] };
    const list = chat().filter((m: any) => m && !m.is_system && m.mes);
    const last = list.at(-1); if (!last || last.is_user) return { looks: false, people: [] };
    const lines = list.slice(-3).map((m: any) => `${m.name ?? ''}: ${String(m.mes).replace(/\s+/g, ' ').slice(0, 900)}`);
    // once per new line of the story (a judge's own call ends a generation too)
    const key = `${g.world}|${list.length}|${lines.at(-1)}`;
    if (key === lastAsked) return { looks: false, people: [] };
    lastAsked = key;
    const prompt = doLooks && doPeople ? combinedPrompt(storyPrompt(g, w, present, lines, outfitsOf), peoplePrompt(g, w))
        : doLooks ? storyPrompt(g, w, present, lines, outfitsOf)
        : `[You keep track of the people in a role-play. You do not write the story.]

The story just now:
${lines.join('\n')}

${peoplePrompt(g, w)}
Answer only with such lines. If there is nothing, answer: none`;
    const out = await quiet(prompt, doLooks && doPeople ? 260 : 160);
    if (/^\s*none\.?\s*$/i.test(out)) return { looks: false, people: [] };
    const looks = doLooks ? applyStory(g, parseStory(out.split('\n').map(l => l.replace(/^\s*[-*]?\s*LOOKS?\s*:?\s+/i, '')).filter(l => !/^\s*[-*]?\s*(NEW|SEEN|MOMENT|NAMED)\b/i.test(l)).join('\n'), present)) : false;
    const people = doPeople ? notePeople(g, w, parsePeople(out)) : [];
    return { looks, people };
}
// The looks question with the people question after it: the looks' answers start with "LOOK".
export function combinedPrompt(looks: string, people: string): string {
    const head = looks.replace(/\nAnswer one line per person who changed[\s\S]*$/, '');
    return `${head.replace('[You keep track of how people look in a role-play. You do not write the story.]', '[You keep track of a role-play for a game: how people look, and new people. You do not write the story.]')}
For each of them who changed, one line:
LOOK Name: outfit=<one of their outfits, usual, or a short name of the new clothes (1 to 3 words)>; condition=<one condition, or none>
Write "same" for a part that did not change. Leave out anyone who did not change.

${people}

Answer only with such lines (LOOK, NEW, SEEN, NAMED, MOMENT), nothing else. If there is nothing at all, answer: none`;
}

/* ---------- the offer ---------- */

export function offerOf(g: Save): Newcomer | null {
    const b = book(g); if (!b.offer) return null;
    const n = findNewcomer(g, b.offer);
    if (!n || !mattersNow(n)) { delete b.offer; return null; }
    return n;
}
// Not in the middle of a fight; the card waits.
export const offerShown = (g: Save): Newcomer | null => (inCombat(g) ? null : offerOf(g));
export function offerText(n: Newcomer): string {
    const m = n.moments.at(-1);
    const moment = n.moments.length > (n.seenMoments ?? 0) && m ? `${m.replace(/\s*$/, '').replace(/([^.!?])$/, '$1.')} ` : `${n.name} keeps coming up in your days. `;
    return `${moment}Add ${unnamed(n) ? 'them' : n.name} to your world?`;
}
export function notNow(g: Save, n: Newcomer) {
    n.state = 'later'; n.seenMoments = n.moments.length; delete book(g).offer;
    nextOffer(g);
}
export function never(g: Save, n: Newcomer) { n.state = 'never'; delete book(g).offer; nextOffer(g); }
export function restore(g: Save, n: Newcomer) { if (n.state === 'never') { n.state = 'later'; n.seenMoments = n.moments.length; } }
function nextOffer(g: Save) {
    const n = newcomers(g).find(mattersNow);
    if (n) book(g).offer = n.key;
}

/* ---------- adding them ---------- */

// Lines of the story where they appear (their name, or another name they went by), the newest last.
export function storyLinesOf(n: Newcomer, max = 12): string[] {
    const names = [n.name, ...n.aka].map(x => x.replace(/^the\s+/i, '')).filter(x => x.length > 1);
    const re = new RegExp(`\\b(${names.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    const out: string[] = [];
    const list = chat().filter((m: any) => m && !m.is_system && m.mes);
    for (const m of list.slice(-300)) {
        const t = String(m.mes).replace(/\s+/g, ' ');
        const i = t.search(re); if (i < 0) continue;
        out.push(`${m.name ?? ''}: ${t.slice(Math.max(0, i - 300), i + 500)}`);
    }
    return out.slice(-max);
}

export function cardPrompt(w: WorldDef, n: Newcomer, name: string): string {
    const jobs = w.occupations.map(o => o.name);
    return `A person from a role-play becomes a character of a life simulation game set in ${w.name}${w.setting ? ` (${w.setting.slice(0, 300)})` : ''}. Write their character card from what the story says about them.

Name: ${name}
Role: ${n.role || 'unknown'}
Looks: ${n.looks || 'unknown'}
Notes: ${[...n.notes, ...n.moments].join(' | ') || 'none'}

The story where they appear:
${storyLinesOf(n).join('\n') || '(no lines)'}

Answer with these sections, each starting with its tag on its own line:
[APPEARANCE] What ${name} looks like: body, face, hair, eyes, voice (not their clothes).
[CLOTHING] Their personal style in a few words, the clothes they usually wear (garments, colors, shoes), and anything they always wear whatever the outfit (a hijab, glasses, a necklace…).
[BACKSTORY] Who ${name} is: job, past, life, and how they met {{user}} (from the story).
[PERSONALITY] Traits, habits, how they speak and behave.
[GREETING] One short line ${name} would say when meeting {{user}} again, with an action in *asterisks*.
[JOB] ${jobs.length ? `The one of these that fits them best, or "none": ${jobs.join(', ')}` : 'none'}
Rules: keep every fact the story gives; where it says nothing, fill in briefly so it fits the role and the world. Third person, plain prose, short. Write ${name}, never {{char}}.`;
}
export interface CardParts { appearance: string; clothing: string; backstory: string; personality: string; greeting: string; job: string }
export function parseCard(out: string): CardParts | null {
    const p: CardParts = { appearance: '', clothing: '', backstory: '', personality: '', greeting: '', job: '' };
    const hits = [...out.matchAll(/\[(APPEARANCE|CLOTHING|BACKSTORY|PERSONALITY|GREETING|JOB)\]\s*:?/gi)];
    if (hits.length < 2) return null;
    hits.forEach((m, k) => {
        const end = k + 1 < hits.length ? hits[k + 1].index! : out.length;
        const body = out.slice(m.index! + m[0].length, end).trim();
        (p as any)[m[1].toLowerCase()] = /^none\.?$/i.test(body) ? '' : body;
    });
    return p.appearance || p.backstory || p.personality ? p : null;
}

// Where they stand with you, from the moment that brought them in.
export function startFrom(text: string): { bond: number; romance: number; party: boolean } {
    const t = text.toLowerCase();
    const party = /\b(party|team|squad|guild|join|raid|group|crew|partner)\b/.test(t);
    const romance = /\b(kiss|kissed|date|dating|flirt|confess)/.test(t) ? 15 : 0;
    const bond = /\b(saved|save|rescued|rescue|healed|heal|life|lives|protected)\b/.test(t) || party ? 40
        : /\b(friend|friends|apprentice|mentor)\b/.test(t) ? 35
        : romance ? 30 : /\b(number|numbers|meet again|see you|contact|call)\b/.test(t) ? 20 : t ? 25 : 10;
    return { bond, romance, party };
}

export interface Added { avatar: string; joined: boolean; text: string }
// Makes them one of the world's people. `as` names someone the story never named. A card of the same name you already
// have, or one of the world's own people, is used instead of writing a new one.
export async function addNewcomer(g: Save, w: WorldDef, n: Newcomer, as = ''): Promise<Added> {
    const name = (as.trim() || n.name).replace(/^the\s+(\w)/i, (_, c) => c.toUpperCase());
    if (knownPerson(g, name) && as) throw new Error(`${name} is already in this game.`);
    let avatar = '';
    const ex = w.cast.examples.find(e => keyOf(e.name) === keyOf(name) || words(e.name)[0] === keyOf(name));
    if (ex) avatar = (await exampleCards({ ...w, cast: { ...w.cast, examples: [ex] } }))[0];
    const own = !avatar && characters().find(c => keyOf(String(c.name ?? '')) === keyOf(name) && !Object.values(g.cast).some(r => r.avatar === c.avatar));
    if (own) avatar = own.avatar;
    let job = '';
    if (!avatar) {
        const p = parseCard(await quiet(cardPrompt(w, n, name), 1500));
        const description = p
            ? [['Appearance', p.appearance], [STYLE_HEAD, p.clothing], ['Backstory', p.backstory]].filter(([, v]) => v).map(([k, v]) => `${k}:\n${v}`).join('\n\n')
            : [`${name}${n.role ? `, ${n.role}` : ''}.`, n.looks, ...n.notes].filter(Boolean).join(' ');
        job = p?.job ?? '';
        avatar = await createCharacter({
            name, description, personality: p?.personality ?? '', first_mes: p?.greeting ?? '', scenario: w.setting,
            tags: ['Mundi', w.name], file: `mundi_${w.id.replace(/[^a-z0-9_-]/gi, '')}_story_${keyOf(name).replace(/[^a-z0-9]+/g, '_') || 'person'}_${Date.now() % 100000}`,
            extensions: { mundi: { world: w.id, story: true, role: n.role } },
        }, await initialsAvatar(name, ['#f59e0b', '#7c3aed']));
    }
    // a home, a routine and a job (the one the AI picked, or one that fits the role)
    let r: Resident | null;
    if (isScenario(w)) r = await addResident(g, w, avatar);
    else {
        r = resident(w, avatar, takenHomes(g), g.player.home);
        if (!ex) {
            const fit = (s: string) => w.occupations.find(o => keyOf(o.name) === keyOf(s)) ?? w.occupations.find(o => s && (keyOf(s).includes(keyOf(o.name)) || keyOf(o.name).includes(keyOf(s))));
            const o = fit(job) ?? fit(n.role);
            r.occupation = o?.id ?? (/^none$/i.test(job) ? null : r.occupation);
        }
        g.cast[avatar] = r;
        normalizeHomes(g);
    }
    if (!r) throw new Error(`${name} is already in this game.`);
    r = g.cast[avatar]; r.met = true;
    // where they stand with you, and here with you now
    const moment = n.moments.at(-1) ?? '';
    const st = startFrom(moment);
    bump(g, avatar, st.bond);
    if (st.romance) addRomance(g, avatar, st.romance);
    const s = social(g);
    if (!s.with.some(c => c.avatar === avatar)) s.with.push({ avatar, until: nowAbs(g) + 120 });
    note(g, '{u} got to know {0} ({1}).', [r.name, moment.replace(/[.!?]\s*$/, '') || n.role || 'from the story'], [avatar], g.player.loc, 'meet');
    const joined = st.party && isRpg(w) && !join(g, w, avatar);
    n.state = 'added'; n.avatar = avatar; n.name = name; n.key = keyOf(name);
    delete book(g).offer; nextOffer(g);
    const where = isScenario(w) ? 'moved into the house' : `now lives in ${w.name}`;
    return { avatar, joined, text: `${r.name} ${where}${joined ? ' and joined your party' : ''}.` };
}
export const storyCardOf = (avatar: string) => !!charOf(avatar)?.data?.extensions?.mundi?.story;
