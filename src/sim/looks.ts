// Scene looks: what each person in the scene wears now and how they look (soaked, muddy, hurt…), decided by the
// scene (rules on the place, the hour, plans and the weather), by the story (after each reply the AI is asked who
// changed) and by a Home's dress codes. The look is shown with the outfit folder that matches it in their
// Expressions ("Bianca/swimsuit"), a condition with a variant folder ("Bianca/swimsuit+wet", "Bianca/usual+wet");
// a folder that does not exist yet is drawn on ComfyUI (ui/spritegen.ts) and worn once its first picture is in.
// The AI is told what everyone here looks like, so the story and the pictures agree.
import { settings, saveSettings, nowAbs, type Save, type Resident } from '../core/store.js';
import { isScenario, type WorldDef } from '../core/world.js';
import { quiet, chat } from '../st/bridge.js';
import { presentAt, outdoors } from './people.js';
import { dressAt } from './dress.js';
import { isHome } from './places.js';
import { isWorking } from './plans.js';
import { appointmentNow } from './social.js';
import { festivalSpot } from './festivals.js';
import { weatherAt } from './worldstate.js';

/* ---------- preferences (Settings › Add-ons › Sprites › Scene looks) ---------- */

export interface LookRule { id: string; on: boolean; outfit?: string; state?: string; places?: string }
export interface LookPrefs {
    on: boolean; story: boolean; draw: boolean;
    /** also draw new looks for people whose sprites were not drawn here (their new pictures get a ComfyUI face) */
    others: boolean;
    /** new looks drawn per day at most (0: no limit) */
    cap: number; used: { day: string; n: number };
    rules: LookRule[]; states: Record<string, string>;
    /** the outfit folder Mundi put on each character last (SillyTavern's outfit is the same in every chat, so this is
     *  kept here, not in the save): an outfit you pick yourself is left alone */
    worn: Record<string, string>;
}
export const RULES: LookRule[] = [
    { id: 'swim', on: true, outfit: 'swimsuit', places: 'pool, beach, seaside, onsen, hot spring, spa, bathhouse, water park, swimming' },
    { id: 'gym', on: true, outfit: 'gym', places: 'gym, fitness, dojo, training ground, workout' },
    { id: 'work', on: true, outfit: 'work' },
    { id: 'sleep', on: true, outfit: 'pajamas' },
    { id: 'date', on: true, outfit: 'date' },
    { id: 'party', on: true, outfit: 'party' },
    { id: 'rain', on: true, state: 'wet' },
];
export const RULE_LABELS: Record<string, string> = {
    swim: 'At a place whose name has one of these words', gym: 'At a place whose name has one of these words',
    work: 'At their workplace during their shift', sleep: 'At home at night (22:00–7:00)',
    date: 'On a date with you', party: 'At a party or a festival', rain: 'Outdoors in the rain',
};
// Conditions: what is added to the picture (Danbooru tags) and to the AI's line, and how long they last (minutes).
export const STATES: Record<string, { tags: string; minutes: number; say: string }> = {
    wet: { tags: 'wet, wet_clothes, wet_hair, water_drop', minutes: 60, say: 'soaked' },
    muddy: { tags: 'dirty, mud, dirty_clothes, dirty_face', minutes: 120, say: 'muddy' },
    sweaty: { tags: 'sweat, sweaty_clothes, steaming_body', minutes: 60, say: 'sweaty' },
    messy: { tags: 'messy_hair, disheveled', minutes: 120, say: 'disheveled' },
    injured: { tags: 'injury, bandages, bandaid_on_face, bruise', minutes: 3 * 1440, say: 'hurt, bandaged' },
    bloody: { tags: 'blood, blood_on_clothes, blood_on_face, injury', minutes: 240, say: 'bloodied' },
    tired: { tags: 'tired, eye_bags, half-closed_eyes', minutes: 240, say: 'exhausted' },
    drunk: { tags: 'drunk, blush, half-closed_eyes', minutes: 240, say: 'tipsy' },
};

export function lookPrefs(): LookPrefs {
    const s = settings() as any;
    const p = (s.looks ??= {}) as LookPrefs;
    p.on ??= true; p.story ??= true; p.draw ??= true; p.others ??= false;
    p.cap ??= 12; p.used ??= { day: '', n: 0 }; p.states ??= {}; p.worn ??= {};
    p.rules ??= RULES.map(r => ({ ...r }));
    for (const r of RULES) if (!p.rules.some(x => x.id === r.id)) p.rules.push({ ...r });   // rules added in later versions
    return p;
}
export const looksOn = () => lookPrefs().on;
export const stateNames = () => [...new Set([...Object.keys(STATES), ...Object.keys(lookPrefs().states)])];
export const stateTags = (id: string) => lookPrefs().states[id] ?? STATES[id]?.tags ?? id.replace(/\s+/g, '_');
const stateSay = (id: string) => STATES[id]?.say ?? id;
const stateMinutes = (id: string) => STATES[id]?.minutes ?? 120;

/* ---------- what each person looks like (kept in the save) ---------- */

export interface Look {
    /** an outfit the story put on, until a time (absolute minutes) */
    outfit?: string; until?: number;
    /** conditions, newest first, each until a time */
    states?: { id: string; until: number }[];
}
export const looksOf = (g: Save): Record<string, Look> => (((g as any).looks ??= {}) as Record<string, Look>);
const lookOf = (g: Save, a: string) => (looksOf(g)[a] ??= {});

// Outfit names that mean the same thing (a "swimsuit" rule finds a "bikini" folder).
const SYN = [
    ['swimsuit', 'swimwear', 'swim', 'bikini', 'biquini', 'one-piece', 'one_piece_swimsuit'],
    ['pajamas', 'pyjamas', 'pijama', 'pijamas', 'sleepwear', 'nightwear', 'nightgown', 'sleep'],
    ['gym', 'pe', 'sport', 'sports', 'sportswear', 'workout', 'athletic', 'training'],
    ['work', 'uniform', 'office', 'job', 'work_clothes'],
    ['date', 'formal', 'dress', 'evening', 'elegant'],
    ['party', 'festive', 'festival', 'costume'],
];
const USUAL = ['usual', 'default', 'normal', 'casual', 'everyday', 'regular', 'same_as_always'];
export const normOutfit = (s: string) => s.toLowerCase().replace(/["'`]/g, '').replace(/[^\p{L}\p{N}+-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 30);
/** The folder in `have` that fits the outfit wanted ('' none). */
export function matchOutfit(want: string, have: string[]): string {
    const w = normOutfit(want); if (!w) return '';
    const exact = have.find(h => normOutfit(h) === w); if (exact) return exact;
    const group = SYN.find(gr => gr.includes(w)); if (!group) return '';
    return have.find(h => group.includes(normOutfit(h))) ?? '';
}
export const isUsual = (o: string) => !o || USUAL.includes(normOutfit(o));
/** The variant folder of an outfit with a condition ("swimsuit+wet"; the usual sprites: "usual+wet"). */
export const variantName = (outfit: string, state: string) => `${outfit || 'usual'}+${state}`;

const hourOf = (g: Save) => Math.floor(g.minutes / 60);
const words = (s = '') => s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// whole words only ("spa" is not in "space", "lake" not in "Lakeside")
const hasWord = (text: string, k: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(k)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
// The scene's own rules, in order: the first that fits gives the outfit; a rule with a condition adds it.
function ruleLook(g: Save, w: WorldDef, r: Resident, loc: string): { outfit: string; state: string } {
    const p = placeOfLoc(w, loc); const name = `${p?.name ?? ''} ${loc}`.toLowerCase();
    const now = nowAbs(g); let outfit = '', state = '';
    for (const rule of lookPrefs().rules) {
        if (!rule.on) continue;
        let fits = false;
        switch (rule.id) {
            case 'swim': case 'gym': fits = !isHome(loc) && words(rule.places).some(k => hasWord(name, k)); break;
            case 'work': { const job = w.occupations.find(o => o.id === r.occupation); fits = !!job && job.place === loc && isWorking(w, r, now); break; }
            case 'sleep': fits = isHome(loc) && (hourOf(g) >= 22 || hourOf(g) < 7); break;
            case 'date': { const a = appointmentNow(g, r.avatar); fits = !!a && a.kind === 'date' && a.place === loc; break; }
            case 'party': { const a = appointmentNow(g, r.avatar); fits = (!!a && a.kind === 'party' && a.place === loc) || festivalSpot(g, w, now) === loc; break; }
            case 'rain': fits = !isHome(loc) && outdoors(w, loc) && !!weatherAt(g, w, loc).rain; break;
        }
        if (!fits) continue;
        if (rule.outfit && !outfit) outfit = rule.outfit;
        if (rule.state && !state) state = rule.state;
    }
    return { outfit, state };
}
const placeOfLoc = (w: WorldDef, loc: string) => w.places.find(p => p.id === loc);

/** What someone should look like now: the outfit ('' their usual clothes) and their conditions (newest first). */
export function wantedLook(g: Save, w: WorldDef, r: Resident, loc = g.player.loc): { outfit: string; states: string[]; why: string } {
    const L = looksOf(g)[r.avatar]; const now = nowAbs(g);
    const rule = ruleLook(g, w, r, loc);
    // a rule's condition sticks for a while (still wet a little after coming in from the rain)
    if (rule.state) addState(g, r.avatar, rule.state, now);
    const states = (L?.states ?? lookOf(g, r.avatar).states ?? []).filter(s => s.until > now).map(s => s.id);
    if (L?.outfit && (L.until ?? 0) > now) return { outfit: L.outfit, states, why: 'story' };
    const code = isScenario(w) ? dressAt(g, loc) : '';
    if (code) return { outfit: code, states, why: 'dress code' };
    return { outfit: rule.outfit, states, why: rule.outfit ? 'scene' : '' };
}
function addState(g: Save, a: string, id: string, now: number) {
    const L = lookOf(g, a);
    const until = now + stateMinutes(id);
    L.states = [{ id, until }, ...(L.states ?? []).filter(s => s.id !== id && s.until > now)].slice(0, 3);
}
/** Clears what has run out (outfits the story put on, conditions). */
function tidy(g: Save) {
    const now = nowAbs(g);
    for (const [a, L] of Object.entries(looksOf(g))) {
        if (L.outfit && (L.until ?? 0) <= now) { delete L.outfit; delete L.until; }
        if (L.states) { L.states = L.states.filter(s => s.until > now); if (!L.states.length) delete L.states; }
        if (!L.outfit && !L.states) delete looksOf(g)[a];
    }
}

/* ---------- showing it ---------- */

export interface LookDeps {
    /** the outfit folders someone has (null: still looking) */
    outfits(avatar: string): string[] | null;
    /** has a folder of this name (null: still checking; the scene syncs again when the answer comes) */
    has(avatar: string, folder: string): boolean | null;
    /** the outfit folder worn now ('' the usual sprites) */
    current(avatar: string): string;
    wear(avatar: string, folder: string): void;
    /** a folder that does not exist yet: draw it (the drawer decides whether it may) */
    draw(avatar: string, v: { outfit: string; state: string; folder: string }): void;
}
/** Puts on each present person's look. Returns whether a sprite changed. */
export function applyLooks(g: Save, w: WorldDef, d: LookDeps): boolean {
    tidy(g);
    const worn = lookPrefs().worn;
    let changed = false, dirty = false;
    for (const r of presentAt(g, w, g.player.loc)) {
        const a = r.avatar;
        const want = wantedLook(g, w, r);
        const list = d.outfits(a); if (list === null) continue;
        let base = '', missing = '';
        if (!isUsual(want.outfit)) {
            base = matchOutfit(want.outfit, list);
            if (!base) {
                const h = d.has(a, normOutfit(want.outfit)); if (h === null) continue;
                if (h) base = normOutfit(want.outfit); else missing = normOutfit(want.outfit);
            }
        }
        let target = base;
        const st = want.states[0];
        if (missing) d.draw(a, { outfit: missing, state: '', folder: missing });   // the condition follows once the outfit is in
        else if (st) {
            const v = variantName(base, st);
            const h = d.has(a, v);
            if (h) target = v; else if (h === false) d.draw(a, { outfit: base, state: st, folder: v });
        }
        // an outfit you picked yourself (not the one Mundi put on) stays until you pick "Usual" again
        const cur = d.current(a);
        if (!worn[a] && cur && cur.toLowerCase() === String((g as any).dressed?.[a] ?? '').toLowerCase()) worn[a] = cur;   // put on by a Home's dress code before
        if (cur && cur.toLowerCase() !== (worn[a] ?? '').toLowerCase()) continue;
        if (cur.toLowerCase() !== target.toLowerCase()) { d.wear(a, target); changed = true; }
        if ((worn[a] ?? '') !== target) { if (target) worn[a] = target; else delete worn[a]; dirty = true; }
    }
    tidy(g);
    if (dirty) saveSettings();
    return changed;
}

/** For the AI: how the people here look now (only those not in their usual clothes, or with a condition). */
// What someone always wears whatever the outfit (a hijab, glasses…), from their drawn look, in plain words.
export const keepsOf = (avatar: string): string => String((settings() as any).sprites?.sheets?.[avatar]?.keeps ?? '').replace(/_/g, ' ').replace(/\s*,\s*/g, ', ').trim();
export function lookLine(g: Save, w: WorldDef, present: Resident[]): string {
    if (!looksOn()) return '';
    const parts = present.map(r => {
        const l = wantedLook(g, w, r);
        if (isUsual(l.outfit) && !l.states.length) return '';
        const clothes = isUsual(l.outfit) ? 'usual clothes' : l.outfit.replace(/[_-]+/g, ' ');
        const keeps = keepsOf(r.avatar);
        return `${r.name}: ${clothes}${keeps ? `, still wearing ${keeps}` : ''}${l.states.length ? `, ${l.states.map(stateSay).join(', ')}` : ''}`;
    }).filter(Boolean);
    return parts.length ? `How they look right now (keep to it until the story changes it): ${parts.join('; ')}.` : '';
}

/* ---------- the story: after each reply, who changed clothes or got wet, hurt… ---------- */

export interface StoryChange { avatar: string; outfit?: string; state?: string | null }
export function storyPrompt(g: Save, w: WorldDef, present: Resident[], lines: string[], outfitsOf: (a: string) => string[]): string {
    const now = present.map(r => { const l = wantedLook(g, w, r); return `- ${r.name}: ${isUsual(l.outfit) ? 'usual clothes' : l.outfit}${l.states.length ? ` (${l.states.join(', ')})` : ''}; outfits they have: ${['usual', ...outfitsOf(r.avatar)].join(', ')}`; });
    return `[You keep track of how people look in a role-play. You do not write the story.]
People in the scene and how they look now:
${now.join('\n')}
Conditions: ${stateNames().join(', ')}.

The story just now:
${lines.join('\n')}

Did the latest lines clearly show any of these people change clothes, or become (or stop being) ${stateNames().slice(0, 4).join(', ')}…? Only what the story shows, no guesses.
Answer one line per person who changed, and nothing else:
Name: outfit=<one of their outfits, usual, or a short name of the new clothes (1 to 3 words)>; condition=<one condition, or none>
Write "same" for a part that did not change. Leave out anyone who did not change. If nobody changed, answer: none`;
}
export function parseStory(out: string, present: Resident[]): StoryChange[] {
    const res: StoryChange[] = [];
    const known = new Set(stateNames());
    for (const line of out.split('\n')) {
        const m = line.match(/^\s*[-*]?\s*([^:=\n]+?)\s*:\s*(.+)$/); if (!m) continue;
        const who = m[1].trim().toLowerCase();
        const r = present.find(p => p.name.toLowerCase() === who) ?? present.find(p => p.name.toLowerCase().split(/\s+/)[0] === who.split(/\s+/)[0]);
        if (!r || res.some(c => c.avatar === r.avatar)) continue;
        const get = (k: string) => (m[2].match(new RegExp(`${k}\\s*=\\s*([^;\\n]+)`, 'i'))?.[1] ?? '').trim().replace(/^["'<]+|["'>.]+$/g, '').trim();
        const c: StoryChange = { avatar: r.avatar };
        const o = get('outfit'), s = get('condition').toLowerCase();
        if (o && !/^same$/i.test(o)) c.outfit = isUsual(o) ? '' : normOutfit(o);
        if (s && s !== 'same') c.state = /^(none|no|nothing|clean|dry)$/.test(s) ? null : known.has(s) ? s : undefined;
        if (c.outfit !== undefined || c.state !== undefined) res.push(c);
    }
    return res;
}
// An outfit the story put on lasts six hours of game time (or until the story changes it again).
export const STORY_OUTFIT_MINUTES = 360;
export function applyStory(g: Save, changes: StoryChange[]): boolean {
    const now = nowAbs(g);
    for (const c of changes) {
        const L = lookOf(g, c.avatar);
        if (c.outfit !== undefined) {
            if (c.outfit) { L.outfit = c.outfit; L.until = now + STORY_OUTFIT_MINUTES; }
            else { L.outfit = 'usual'; L.until = now + STORY_OUTFIT_MINUTES; }   // back in their usual clothes, even where a rule says otherwise
        }
        if (c.state === null) delete L.states;
        else if (c.state) addState(g, c.avatar, c.state, now);
    }
    return changes.length > 0;
}
let lastAsked = '';
/** After a reply: asks the AI who changed. Returns whether anything did. */
export async function storyLooks(g: Save, w: WorldDef, outfitsOf: (a: string) => string[]): Promise<boolean> {
    const p = lookPrefs(); if (!p.on || !p.story) return false;
    const present = presentAt(g, w, g.player.loc); if (!present.length) return false;
    const list = chat().filter((m: any) => m && !m.is_system && m.mes);
    const last = list.at(-1); if (!last || last.is_user) return false;
    const lines = list.slice(-3).map((m: any) => `${m.name ?? ''}: ${String(m.mes).replace(/\s+/g, ' ').slice(0, 900)}`);
    // once per new line of the story (a judge's own call ends a generation too)
    const key = `${g.world}|${list.length}|${lines.at(-1)}`;
    if (key === lastAsked) return false;
    lastAsked = key;
    const out = await quiet(storyPrompt(g, w, present, lines, outfitsOf), 120);
    if (/^\s*none\b/i.test(out)) return false;
    return applyStory(g, parseStory(out, present));
}
