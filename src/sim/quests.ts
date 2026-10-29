// Quests (RPG mode). Nobody hands you one out of the blue: you find them. Read a quest board (a guild hall, a notice
// board, a hunters' lodge), ask the people where you are whether anyone needs help, or listen to someone you know who
// has a favor to ask. What they ask comes from the state of the world (a friend is sick and needs medicine, a town is
// tense, a rumor needs looking into, a worker needs something delivered, a gloomy town needs a song, bandits on the
// road), from the lorebooks (sim/lorequests.ts: quests written into the world's, the characters' and your persona's
// lorebooks) and from the story itself (someone asks {{user}} for help in the chat). Steps are done at real places,
// with d20 checks and fights; a step "in the story" is done when the story does it (or you mark it done).
import { nowAbs, type Save, type Resident } from '../core/store.js';
import { placeIs, type WorldDef, type Place } from '../core/world.js';
import { onDay } from './hooks.js';
import { note } from './facts.js';
import { bump } from './social.js';
import { breakOf } from './daylife.js';
import { regionState, regionOf } from './worldstate.js';
import { isRpg, sheetOf, rollCheck, checkWon, addXp, addRenown, count, gradeWord, tooHurt, type Check } from './rpg.js';
import { book } from './ledger.js';
import { addRep } from './standing.js';
import { pleaseBlade } from './artifacts.js';
import { startCombat, afterFight, inCombat } from './combat.js';
import { rpgOf } from '../core/rpgdef.js';
import { placeOf, isHome } from './places.js';
import { presentAt } from './people.js';
import { waiting, unlock } from './discovery.js';
import { hiddenNow } from './places.js';

/** A step. `place` '' : it happens in the story (anywhere), done when the story tells it or you mark it done. */
export interface QuestStep { place: string; what: string; check?: { skill: string; dc: number }; fight?: string[]; foes?: string[] }
export interface Quest {
    id: string; kind: string; title: string; giver: string; text: string;
    steps: QuestStep[]; step: number; reward: { xp: number; money: number; renown: number };
    /** The last day to finish it (0: no deadline). Set when you take it on (`days` later). */
    due: number; state: 'offered' | 'active' | 'done' | 'failed'; tried?: number; region?: string;
    /** Days you have once you take it on (0: no deadline). */
    days?: number;
    /** Where it came from: the world's state, a lorebook, or the story. */
    from?: 'world' | 'lore' | 'story'; lore?: string;
    /** The giver's name when they are not one of the world's people (a lorebook's or the story's). */
    giverName?: string;
    /** Where you found it (a board, the place you asked), and the day it was offered. */
    at?: string; offered?: number;
    /** What changes when it is done (for the AI), and when it was finished (absolute minutes). */
    outcome?: string; finished?: number;
    /** medicine: who is sick; rumor: the rumor's id. */
    target?: string; rumor?: string;
}
const H = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const rnd = (g: Save, salt: string) => H(`${g.world}|${g.day}|${salt}`);
export const quests = (g: Save): Quest[] => (((g as any).quests ??= []) as Quest[]);
/** Quests the lorebooks and the story hold that you have not come across yet (found at boards, by asking, or from their giver). */
export const questPool = (g: Save): Quest[] => (((g as any).questPool ??= []) as Quest[]);
export const activeQuests = (g: Save) => quests(g).filter(q => q.state === 'active');
export const offeredQuests = (g: Save) => quests(g).filter(q => q.state === 'offered');
export const OPEN_MAX = 5;          // offered and active at a time
export const OFFER_DAYS = 3;        // an offer you leave alone goes away (a lorebook's goes back to wait for you)
export const giverOf = (g: Save, q: Quest) => g.cast[q.giver]?.name ?? q.giverName ?? '';

const publicPlaces = (w: WorldDef, region?: string, tags?: string[]) => w.places.filter(p => !p.link && !p.hidden && !p.restricted && (!region || p.map === region) && (!tags || (p.tags ?? []).some(t => tags.includes(t))));
const pick = <T>(g: Save, list: T[], salt: string) => list[Math.floor(rnd(g, salt) * list.length)];
const kidsOf = (g: Save) => ((g as any).family?.kids ?? []).map((k: any) => k.avatar);

/** A place where requests for help are posted: a quest or notice board, a guild hall, a contracts board. */
export const isQuestBoard = (p: Place | null | undefined) => !!p && !isHome(p.id) && (placeIs(p, 'quests') || placeIs(p, 'contracts'));

/* ---------- what the world needs ---------- */

/** Where a quest is being looked for: a board (anyone's request), or the people here (only theirs, or this town's). */
export interface Looking { how: 'board' | 'ask'; place: string; here: Resident[] }

function ideasFor(g: Save, w: WorldDef, l: Looking): (() => Quest | null)[] {
    const kids = kidsOf(g);
    const all = Object.values(g.cast).filter(r => !kids.includes(r.avatar));
    const here = l.here.filter(r => !kids.includes(r.avatar));
    const askers = l.how === 'ask' ? here : all;
    const region = regionOf(g, w, l.place);
    const local = (r: Resident) => regionOf(g, w, `home:${r.avatar}`) === region;
    return [
        // a sick friend needs medicine (from a healer, a hospital…)
        () => {
            const tended = new Set(openOnes(g).filter(q => q.kind === 'medicine').map(q => q.target ?? q.giver));
            const sick = all.find(r => !tended.has(r.avatar) && breakOf(g, w, r, g.day)?.kind === 'sick' && (l.how === 'board' || here.includes(r) || here.some(h => local(h) && local(r))));
            const heal = publicPlaces(w, undefined, ['health', 'service']).find(p => placeIs(p, 'healer')) ?? publicPlaces(w, undefined, ['service'])[0];
            if (!sick || !heal) return null;
            const giver = l.how === 'ask' ? (here.find(r => r !== sick && local(r)) ?? sick) : sick;
            const by = giver === sick ? `${sick.name} is sick in bed.` : `${giver.name} is worried: ${sick.name} is sick in bed.`;
            return { ...quest(g, 'medicine', `Medicine for ${sick.name}`, giver, `${by} Fetch medicine at ${heal.name} and bring it to them.`,
                [{ place: heal.id, what: `Get the medicine (Medicine check)`, check: { skill: 'medicine', dc: 11 } }, { place: `home:${sick.avatar}`, what: `Bring it to ${sick.name}` }], { xp: 60, money: 0, renown: 3 }, 2),
                target: sick.avatar, outcome: `${sick.name} gets the medicine and is back on their feet.` };
        },
        // a tense town needs calming
        () => {
            const tense = w.maps.find(m => regionState(g, w, m.id).tension >= 50 && (l.how === 'board' || m.id === region));
            const spot = tense && pick(g, publicPlaces(w, tense.id, ['food', 'leisure', 'shop']), 'calm');
            const giver = tense && askers.find(r => regionOf(g, w, `home:${r.avatar}`) === tense.id);
            if (!tense || !spot || !giver) return null;
            return { ...quest(g, 'calm', `Unrest in ${tense.name}`, giver, `${tense.name} is on edge. Go to ${spot.name} and talk people down before it turns ugly.`,
                [{ place: spot.id, what: 'Calm the crowd (Persuasion check)', check: { skill: 'persuasion', dc: 14 } }], { xp: 100, money: 0, renown: 8 }, 3, tense.id),
                outcome: `The mood in ${tense.name} cools down; people breathe easier.` };
        },
        // a rumor needs looking into
        () => {
            const r = ((g as any).living?.rumors ?? []).find((x: any) => x.world && askers.some(p => x.knownBy.includes(p.avatar)));
            const spot = pick(g, publicPlaces(w, l.how === 'ask' ? region : undefined, ['leisure', 'food']), 'rumor') ?? pick(g, publicPlaces(w, undefined, ['leisure', 'food']), 'rumor');
            const giver = r && askers.find(p => r.knownBy.includes(p.avatar));
            if (!r || !spot || !giver) return null;
            return { ...quest(g, 'rumor', 'The truth of a rumor', giver, `${giver.name} keeps hearing: “${r.text}” Find out what is behind it, around ${spot.name}.`,
                [{ place: spot.id, what: 'Ask around (Investigation check)', check: { skill: 'investigation', dc: 13 } }], { xp: 80, money: 0, renown: 5 }, 4), rumor: r.id };
        },
        // a worker needs something delivered
        () => {
            const giver = pick(g, askers.filter(r => r.occupation), 'courier');
            const job = giver && w.occupations.find(o => o.id === giver.occupation);
            const to = job && pick(g, publicPlaces(w).filter(p => p.id !== job.place), 'to');
            if (!giver || !job || !to) return null;
            return { ...quest(g, 'deliver', `A delivery for ${giver.name}`, giver, `${giver.name} needs a parcel taken from ${w.places.find(p => p.id === job.place)?.name ?? 'their work'} to ${to.name}.`,
                [{ place: job.place, what: 'Pick up the parcel' }, { place: to.id, what: 'Deliver it' }], { xp: 40, money: 30, renown: 2 }, 2),
                outcome: `The parcel reaches ${to.name}, and ${giver.name} pays as promised.` };
        },
        // a gloomy region needs cheering up
        () => {
            const sad = w.maps.find(m => regionState(g, w, m.id).mood <= -15 && (l.how === 'board' || m.id === region));
            const spot = sad && pick(g, publicPlaces(w, sad.id, ['food', 'leisure']), 'song');
            const giver = sad && askers.find(r => regionOf(g, w, `home:${r.avatar}`) === sad.id);
            if (!sad || !spot || !giver) return null;
            return { ...quest(g, 'song', `Spirits are low in ${sad.name}`, giver, `People in ${sad.name} could use some cheer. Lift the spirits at ${spot.name}.`,
                [{ place: spot.id, what: 'Entertain them (Performance check)', check: { skill: 'performance', dc: 12 } }], { xp: 70, money: 15, renown: 5 }, 3, sad.id),
                outcome: `${sad.name} cheers up; people smile again.` };
        },
        // bandits on the road (needs a bestiary): drive them off
        () => {
            if (!(rpgOf(w)?.bestiary ?? []).some(f => (f.tags ?? []).includes('road'))) return null;
            const road = publicPlaces(w).filter(p => w.places.some(x => x.link && x.map === p.map));
            const spot = pick(g, road.length ? road : publicPlaces(w), 'bandits');
            const giver = pick(g, askers.filter(r => r.occupation), 'bandits-giver') ?? pick(g, askers, 'bandits-giver');
            if (!spot || !giver) return null;
            return { ...quest(g, 'bandits', 'Bandits on the road', giver, `Travelers are being robbed near ${spot.name}. ${giver.name} asks you to drive the bandits off.`,
                [{ place: spot.id, what: 'Fight the bandits', fight: ['road'] }], { xp: 120, money: 40, renown: 8 }, 4),
                outcome: `The road near ${spot.name} is safe again.` };
        },
    ];
}
const openOnes = (g: Save) => quests(g).filter(x => x.state === 'offered' || x.state === 'active');
const clash = (g: Save, q: Quest) => openOnes(g).some(x => x.kind === q.kind && x.giver === q.giver && (q.kind !== 'lore' && q.kind !== 'story' || x.title === q.title));
const salt = (l: Looking) => `${l.how}|${l.place}`;
/** A request from the world's state that fits where you are looking (null: nothing today). */
export function worldQuest(g: Save, w: WorldDef, l: Looking): Quest | null {
    const order = ideasFor(g, w, l).map((f, i) => [f, rnd(g, `idea|${salt(l)}|${i}`)] as const).sort((a, b) => a[1] - b[1]);
    for (const [f] of order) { const q = f(); if (q && !clash(g, q)) return q; }
    return null;
}
/** Lorebook and story quests waiting to be found here: a board shows anyone's (and those posted at this board); the
 *  people here only their own. */
export function poolHere(g: Save, w: WorldDef, l: Looking): Quest[] {
    const here = new Set(l.here.map(r => r.avatar));
    const region = regionOf(g, w, l.place);
    return questPool(g).filter(q => (q.giver && here.has(q.giver)) || q.at === l.place
        || (l.how === 'board' && (!q.giver || !g.cast[q.giver]) && (!q.at || regionOf(g, w, q.at) === region || !placeOf(g, w, q.at))));
}
function quest(g: Save, kind: string, title: string, giver: Resident, text: string, steps: QuestStep[], reward: Quest['reward'], days: number, region?: string): Quest {
    return { id: `q${nowAbs(g)}_${kind}_${giver.avatar.length}${Math.floor(H(`${title}|${nowAbs(g)}`) * 1e4)}`, kind, title, giver: giver.avatar, text, steps, step: 0, reward, due: 0, days, state: 'offered', from: 'world', ...(region ? { region } : {}) };
}

/** Puts a quest in front of you (it waits in your Quests until you take it on or turn it down). */
export function offer(g: Save, q: Quest, at = g.player.loc): Quest {
    const i = questPool(g).indexOf(q); if (i >= 0) questPool(g).splice(i, 1);
    q.state = 'offered'; q.at = at; q.offered = g.day; q.step = 0; delete q.tried;
    quests(g).push(q);
    return q;
}
export const roomForMore = (g: Save) => openOnes(g).length < OPEN_MAX;

/* ---------- looking for work ---------- */

const tries = (g: Save): Record<string, number> => ((g as any).questTries ??= {});
export const searchedToday = (g: Save, key: string) => tries(g)[key] === g.day;
const mark = (g: Save, key: string) => { const t = tries(g); t[key] = g.day; for (const k of Object.keys(t)) if (t[k] < g.day - 1) delete t[k]; };
export const ASK_DC = 12;
export interface Found { text: string; minutes: number; quests: Quest[]; check?: Check; story?: string }

/** A quest board: what is posted today (up to two new requests). Once a day per board. */
export function readBoard(g: Save, w: WorldDef): Found {
    const p = placeOf(g, w, g.player.loc);
    if (!isQuestBoard(p)) return { text: 'There is no board here.', minutes: 0, quests: [] };
    if (searchedToday(g, `board:${p!.id}`)) return { text: 'Nothing new on the board since you last looked.', minutes: 0, quests: [] };
    mark(g, `board:${p!.id}`);
    const l: Looking = { how: 'board', place: p!.id, here: presentAt(g, w, p!.id) };
    const found: Quest[] = [];
    for (const q of poolHere(g, w, l)) { if (found.length >= 2 || !roomForMore(g)) break; found.push(offer(g, q)); }
    if (found.length < 2 && roomForMore(g)) { const q = worldQuest(g, w, l); if (q) found.push(offer(g, q)); }
    if (!found.length) return { text: roomForMore(g) ? 'Nothing on the board you could take on today.' : 'You already have your hands full.', minutes: 15, quests: [] };
    return { text: `On the board: ${found.map(q => q.title).join('; ')}.`, minutes: 15, quests: found, story: `{{user}} read the requests posted at ${p!.name}: ${found.map(q => q.title).join('; ')}.` };
}
/** Asking the people here whether anyone needs a hand (a Persuasion check). Once a day per place. */
export function askForWork(g: Save, w: WorldDef): Found {
    const p = placeOf(g, w, g.player.loc); if (!p) return { text: '', minutes: 0, quests: [] };
    if (searchedToday(g, `help:${p.id}`)) return { text: 'You have asked here today already.', minutes: 0, quests: [] };
    mark(g, `help:${p.id}`);
    if (!roomForMore(g)) return { text: 'You already have your hands full.', minutes: 0, quests: [] };
    const l: Looking = { how: 'ask', place: p.id, here: presentAt(g, w, p.id) };
    const check = rollCheck(g, w, 'persuasion', ASK_DC);
    if (!checkWon(check)) return { text: `${gradeWord(check)}: nobody here needs anything from you today.`, minutes: 30, quests: [], check };
    const q = poolHere(g, w, l)[0] ?? worldQuest(g, w, l);
    if (!q) return { text: 'People are friendly, but nobody here needs help today.', minutes: 30, quests: [], check };
    offer(g, q);
    const who = giverOf(g, q);
    if (g.cast[q.giver]) g.cast[q.giver].met = true;
    return { text: `${who || 'Someone'} needs a hand: ${q.title}.`, minutes: 30, quests: [q], check, story: `{{user}} asked around at ${p.name} whether anyone needed help. ${who || 'Someone'} did: ${q.text}` };
}
/** Someone here has a favor to ask (a lorebook's or the story's quest whose giver is with you). */
export const favorsHere = (g: Save, w: WorldDef) => {
    const here = new Set(presentAt(g, w, g.player.loc).map(r => r.avatar));
    return questPool(g).filter(q => q.giver && here.has(q.giver));
};
export function hearOut(g: Save, w: WorldDef, id: string): Found {
    const q = favorsHere(g, w).find(x => x.id === id); if (!q) return { text: '', minutes: 0, quests: [] };
    if (!roomForMore(g)) return { text: 'You already have your hands full.', minutes: 0, quests: [] };
    offer(g, q);
    const who = giverOf(g, q);
    return { text: `${who} asks for your help: ${q.title}.`, minutes: 10, quests: [q], story: `${who} asked {{user}} for help: ${q.text}` };
}
/** Offers you can take on right here: found here, or their giver is with you. */
export function offersHere(g: Save, w: WorldDef): Quest[] {
    const here = new Set(presentAt(g, w, g.player.loc).map(r => r.avatar));
    return offeredQuests(g).filter(q => q.at === g.player.loc || here.has(q.giver));
}

/* ---------- the days go by ---------- */

onDay.push((g, w) => {
    if (!isRpg(w) || !sheetOf(g)) return [];
    const out: string[] = [];
    for (const q of quests(g)) {
        if (q.state === 'active' && q.due && g.day > q.due) { q.state = 'failed'; note(g, '{u} did not finish a quest in time: {0}.', [q.title], q.giver ? [q.giver] : [], g.player.loc, 'goal'); out.push(`Quest failed (out of time): ${q.title}.`); if (q.giver) bump(g, q.giver, -3); }
        else if (q.state === 'offered' && g.day - (q.offered ?? (q.due ? q.due - 4 : g.day)) > OFFER_DAYS) {
            // left alone: a lorebook's or the story's goes back to wait (someone may ask again); the world's is gone
            if (q.from === 'lore' || q.from === 'story') { q.state = 'offered'; delete q.at; delete q.offered; questPool(g).push(q); (q as any)._gone = true; }
            else q.state = 'failed';
        }
    }
    (g as any).quests = quests(g).filter(q => !(q as any)._gone && (q.state === 'active' || q.state === 'offered' || g.day - (q.due || (q.finished ? Math.floor(q.finished / 1440) : g.day)) < 14)).slice(-30);
    questPool(g).forEach(q => delete (q as any)._gone);
    return out;
});

export function acceptQuest(g: Save, id: string): string {
    const q = quests(g).find(x => x.id === id && x.state === 'offered'); if (!q) return '';
    q.state = 'active'; if (g.cast[q.giver]) g.cast[q.giver].met = true;
    q.due = q.days ? g.day + q.days : 0;
    note(g, '{u} took on a quest: {0}.', [q.title], q.giver ? [q.giver] : [], g.player.loc, 'goal');
    return `Quest accepted: ${q.title}.`;
}
export function declineQuest(g: Save, id: string) { const q = quests(g).find(x => x.id === id && x.state === 'offered'); if (q) q.state = 'failed'; }
// What can be done for a quest where you are now.
// (a step in the story with a roll or a fight can be done anywhere; one without, the story does or you mark it done)
export const questsHere = (g: Save) => activeQuests(g).filter(q => { const s = q.steps[q.step]; return !!s && (s.place === g.player.loc || (!s.place && !plainStep(s))); });
/** The step is told by the story (no place): done when the story does it, or when you say so. */
export const storyStep = (q: Quest) => !!q.steps[q.step] && !q.steps[q.step].place;
/** A step the story may do by itself: no roll and no fight (those the game plays). */
export const plainStep = (s: QuestStep | undefined) => !!s && !s.check && !s.fight;

export interface StepResult { text: string; check?: Check; done?: boolean; fight?: boolean; msgs: string[] }
/** `by`: 'story' (the story told it, or you marked a story step done): no place, no roll. */
export function doStep(g: Save, w: WorldDef, id: string, by: 'here' | 'story' = 'here'): StepResult | null {
    const q = activeQuests(g).find(x => x.id === id); const st = q?.steps[q.step];
    if (!q || !st) return null;
    if (by === 'here' && st.place && st.place !== g.player.loc) return null;
    if (by === 'story' && !plainStep(st) && !(q as any).won) return null;
    const msgs: string[] = [];
    let check: Check | undefined;
    if (st.fight && !(q as any).won) {
        if (inCombat(g)) return { text: 'You are already fighting.', msgs };
        { const hurt = tooHurt(g, w); if (hurt) return { text: hurt, msgs }; }
        if (q.tried === g.day) return { text: 'Not today: catch your breath and come back tomorrow.', msgs };
        const c = startCombat(g, w, { why: q.kind === 'bandits' ? 'The bandits come at you:' : `${q.title}:`, tags: st.fight, foes: st.foes, quest: q.id });
        return { text: c ? 'To arms!' : 'There is no one to fight here.', fight: !!c, msgs };
    }
    if (st.check) {
        if (q.tried === g.day) return { text: 'You already tried today. Try again tomorrow.', msgs };
        check = rollCheck(g, w, st.check.skill, st.check.dc);
        if (!checkWon(check)) {
            q.tried = g.day;
            if (check.grade === 'critical-fail') { q.state = 'failed'; note(g, '{u} failed a quest: {0}.', [q.title], q.giver ? [q.giver] : [], g.player.loc, 'goal'); return { text: `${gradeWord(check)}: the quest is lost (${q.title}).`, check, msgs }; }
            return { text: `${gradeWord(check)}. It did not work this time; you can try again tomorrow.`, check, msgs };
        }
    }
    q.step++; delete (q as any).won;
    if (q.step < q.steps.length) return { text: `${st.what}: done. Next: ${q.steps[q.step].what}.`, check, msgs };
    const r = finishQuest(g, w, q, check?.grade === 'critical-success' ? 1.5 : 1);
    return { text: r.text, check, done: true, msgs: r.msgs };
}
/** The story finished the whole quest: every step left must be one the story may do. */
export function storyFinish(g: Save, w: WorldDef, id: string): StepResult | null {
    const q = activeQuests(g).find(x => x.id === id);
    if (!q || !q.steps.slice(q.step).every(plainStep)) return null;
    q.step = q.steps.length;
    const r = finishQuest(g, w, q, 1);
    return { text: r.text, done: true, msgs: r.msgs };
}
export function failQuest(g: Save, id: string, why = ''): string {
    const q = quests(g).find(x => x.id === id && (x.state === 'active' || x.state === 'offered')); if (!q) return '';
    q.state = 'failed';
    note(g, '{u} failed a quest: {0}.', [q.title], q.giver ? [q.giver] : [], g.player.loc, 'goal');
    return `Quest failed: ${q.title}${why ? ` (${why})` : ''}.`;
}

// Done: the reward, and what it changes in the world.
function finishQuest(g: Save, w: WorldDef, q: Quest, crit: number): { text: string; msgs: string[] } {
    const msgs: string[] = [];
    q.state = 'done'; q.finished = nowAbs(g);
    if (q.reward.money) { g.player.money += q.reward.money; book(g, q.title, q.reward.money); }
    msgs.push(...addXp(g, w, q.reward.xp * crit, q.title), ...addRenown(g, w, q.reward.renown), ...count(g, w, 'quests'));
    if (q.giver && g.cast[q.giver]) bump(g, q.giver, 6);
    if (q.kind === 'calm' && q.region) regionState(g, w, q.region).tension = Math.max(0, regionState(g, w, q.region).tension - 25);
    if (q.kind === 'song' && q.region) regionState(g, w, q.region).mood = Math.min(100, regionState(g, w, q.region).mood + 20);
    if (q.kind === 'medicine') {
        const who = q.target ?? q.giver;
        ((g as any).cured ??= {})[who] = g.day;   // up and about today (sim/daylife.ts)
        if (who !== q.giver && g.cast[who]) bump(g, who, 6);
        if (g.cast[who]) msgs.push(`${g.cast[who].name} is feeling better.`);
    }
    if (q.kind === 'rumor') { const m = rumorTruth(g, w, q); if (m) msgs.push(m); }
    note(g, '{u} finished a quest: {0}.', [q.title], q.giver && g.cast[q.giver] ? [q.giver] : [], g.player.loc, 'goal');
    { const m = addRep(g, w, Math.max(2, q.reward.renown), q.title); if (m) msgs.push(m); }
    pleaseBlade(g, w, 'quests', 8);
    return { text: `Quest complete: ${q.title}! +${Math.round(q.reward.xp * crit)} XP${q.reward.money ? `, +${q.reward.money}` : ''}.`, msgs };
}
// The rumor looked into: you know it now, and when a hidden place lies near where you asked, it leads you there.
function rumorTruth(g: Save, w: WorldDef, q: Quest): string {
    const r = ((g as any).living?.rumors ?? []).find((x: any) => x.id === q.rumor);
    if (r && !r.knownBy.includes('__you')) { r.knownBy.push('__you'); r.heard = nowAbs(g); }
    const here = placeOf(g, w, g.player.loc);
    const lead = here && waiting(g, w).filter(p => hiddenNow(g, w, p) && !isHome(p.id) && p.map === here.map && !p.opens?.who && !p.opens?.faction)[0];
    if (lead) {
        const m = unlock(g, w, lead.id, { find: true });
        q.outcome = `The rumor${r ? ` (“${r.text}”)` : ''} leads {{user}} to ${lead.name}, a place few know about.`;
        return m || `The rumor leads you to ${lead.name}: it is on your map now.`;
    }
    q.outcome = `{{user}} found out what is really behind the rumor${r ? ` “${r.text}”` : ''}: tell what they learned.`;
    return '';
}

/* ---------- for the AI ---------- */

const where = (g: Save, w: WorldDef, s: QuestStep) => (s.place ? placeOf(g, w, s.place)?.name ?? '' : '');
/** The quests that bring {{user}} here (the scene's focus). */
export function questLines(g: Save): string[] {
    return questsHere(g).map(q => `{{user}} is here on a quest: ${q.title} — ${q.steps[q.step].what.replace(/ \(.*\)$/, '')}.`);
}
/** Everything the story should know: the quests {{user}} is on, favors waiting to be asked, quests just finished. */
export function questAware(g: Save, w: WorldDef): string[] {
    if (!isRpg(w) || !sheetOf(g)) return [];
    const out: string[] = [];
    const on = activeQuests(g).map(q => {
        const s = q.steps[q.step]; const who = giverOf(g, q); const at = s && where(g, w, s);
        return `${q.title}${who ? ` (for ${who})` : ''}${s ? `: next, ${s.what.replace(/ \(.*\)$/, '').toLowerCase()}${at ? ` at ${at}` : ''}` : ''}${q.due ? `, by day ${q.due}` : ''}`;
    });
    if (on.length) out.push(`{{user}}'s quests: ${on.join('; ')}.`);
    const here = new Set(presentAt(g, w, g.player.loc).map(r => r.avatar));
    for (const q of [...offeredQuests(g).filter(x => here.has(x.giver)), ...questPool(g).filter(x => here.has(x.giver))].slice(0, 2))
        out.push(`${giverOf(g, q)} has something to ask of {{user}} and may bring it up: ${q.text}`);
    for (const q of quests(g).filter(x => x.state === 'done' && x.finished && nowAbs(g) - x.finished <= 180))
        out.push(`{{user}} just finished a quest: ${q.title}${giverOf(g, q) ? ` (for ${giverOf(g, q)})` : ''}.${q.outcome ? ` ${q.outcome}` : ''}`);
    return out;
}

// A fight for a quest: won, the step is done (and the quest, if it was the last one); lost or fled, try another day.
afterFight.push((g, w, c) => {
    const q = c.quest ? activeQuests(g).find(x => x.id === c.quest) : null;
    if (!q) return [];
    if (c.over !== 'won') { q.tried = g.day; return [`${q.title}: not this time.`]; }
    (q as any).won = true;
    const r = doStep(g, w, q.id, g.player.loc === q.steps[q.step]?.place ? 'here' : 'story');
    return r ? [r.text, ...r.msgs] : [];
});
