// Quests born from the simulation (RPG mode): a friend is sick and needs medicine, a town is tense and needs calming,
// a rumor needs looking into, a worker needs something delivered, a gloomy tavern needs a song. Each comes from the
// state of the world, from one of its people (a card), and is done at real places, with d20 checks.
import { nowAbs, type Save, type Resident } from '../core/store.js';
import { placeIs, type WorldDef } from '../core/world.js';
import { onDay } from './hooks.js';
import { note } from './facts.js';
import { bump } from './social.js';
import { breakOf } from './daylife.js';
import { regionState, regionOf } from './worldstate.js';
import { isRpg, sheetOf, rollCheck, checkWon, addXp, addRenown, count, gradeWord, type Check } from './rpg.js';
import { book } from './ledger.js';
import { addRep } from './standing.js';
import { pleaseBlade } from './artifacts.js';
import { startCombat, afterFight, inCombat } from './combat.js';
import { rpgOf } from '../core/rpgdef.js';

export interface QuestStep { place: string; what: string; check?: { skill: string; dc: number }; fight?: string[] }
export interface Quest {
    id: string; kind: string; title: string; giver: string; text: string;
    steps: QuestStep[]; step: number; reward: { xp: number; money: number; renown: number };
    due: number; state: 'offered' | 'active' | 'done' | 'failed'; tried?: number; region?: string;
}
const H = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const rnd = (g: Save, salt: string) => H(`${g.world}|${g.day}|${salt}`);
export const quests = (g: Save): Quest[] => (((g as any).quests ??= []) as Quest[]);
export const activeQuests = (g: Save) => quests(g).filter(q => q.state === 'active');
export const offeredQuests = (g: Save) => quests(g).filter(q => q.state === 'offered');

const publicPlaces = (w: WorldDef, region?: string, tags?: string[]) => w.places.filter(p => !p.link && !p.hidden && !p.restricted && (!region || p.map === region) && (!tags || (p.tags ?? []).some(t => tags.includes(t))));
const pick = <T>(g: Save, list: T[], salt: string) => list[Math.floor(rnd(g, salt) * list.length)];

// What the world needs today (at most one new quest a day, three waiting at a time).
function makeQuest(g: Save, w: WorldDef): Quest | null {
    const people = Object.values(g.cast).filter(r => !((g as any).family?.kids ?? []).some((k: any) => k.avatar === r.avatar));
    if (!people.length) return null;
    const ideas: (() => Quest | null)[] = [
        // a sick friend needs medicine (from a healer, a hospital…)
        () => {
            const sick = people.find(r => breakOf(g, w, r, g.day)?.kind === 'sick');
            const heal = publicPlaces(w, undefined, ['health', 'service']).find(p => placeIs(p, 'healer')) ?? publicPlaces(w, undefined, ['service'])[0];
            if (!sick || !heal) return null;
            return quest(g, 'medicine', `Medicine for ${sick.name}`, sick, `${sick.name} is sick in bed. Fetch medicine at ${heal.name} and bring it to them.`,
                [{ place: heal.id, what: `Get the medicine (Medicine check)`, check: { skill: 'medicine', dc: 11 } }, { place: `home:${sick.avatar}`, what: `Bring it to ${sick.name}` }], { xp: 60, money: 0, renown: 3 }, 2);
        },
        // a tense town needs calming
        () => {
            const tense = w.maps.find(m => regionState(g, w, m.id).tension >= 50);
            const spot = tense && pick(g, publicPlaces(w, tense.id, ['food', 'leisure', 'shop']), 'calm');
            const giver = tense && people.find(r => regionOf(g, w, `home:${r.avatar}`) === tense.id);
            if (!tense || !spot || !giver) return null;
            return quest(g, 'calm', `Unrest in ${tense.name}`, giver, `${tense.name} is on edge. Go to ${spot.name} and talk people down before it turns ugly.`,
                [{ place: spot.id, what: 'Calm the crowd (Persuasion check)', check: { skill: 'persuasion', dc: 14 } }], { xp: 100, money: 0, renown: 8 }, 3, tense.id);
        },
        // a rumor needs looking into
        () => {
            const r = ((g as any).living?.rumors ?? []).find((x: any) => x.world);
            const spot = pick(g, publicPlaces(w, undefined, ['leisure', 'food']), 'rumor');
            const giver = r && people.find(p => r.knownBy.includes(p.avatar));
            if (!r || !spot || !giver) return null;
            return quest(g, 'rumor', 'The truth of a rumor', giver, `${giver.name} keeps hearing: “${r.text}” Find out what is behind it, around ${spot.name}.`,
                [{ place: spot.id, what: 'Ask around (Investigation check)', check: { skill: 'investigation', dc: 13 } }], { xp: 80, money: 0, renown: 5 }, 4);
        },
        // a worker needs something delivered
        () => {
            const giver = pick(g, people.filter(r => r.occupation), 'courier');
            const job = giver && w.occupations.find(o => o.id === giver.occupation);
            const to = job && pick(g, publicPlaces(w).filter(p => p.id !== job.place), 'to');
            if (!giver || !job || !to) return null;
            return quest(g, 'deliver', `A delivery for ${giver.name}`, giver, `${giver.name} needs a parcel taken from ${w.places.find(p => p.id === job.place)?.name ?? 'their work'} to ${to.name}.`,
                [{ place: job.place, what: 'Pick up the parcel' }, { place: to.id, what: 'Deliver it' }], { xp: 40, money: 30, renown: 2 }, 2);
        },
        // a gloomy region needs cheering up
        () => {
            const sad = w.maps.find(m => regionState(g, w, m.id).mood <= -15);
            const spot = sad && pick(g, publicPlaces(w, sad.id, ['food', 'leisure']), 'song');
            const giver = sad && people.find(r => regionOf(g, w, `home:${r.avatar}`) === sad.id);
            if (!sad || !spot || !giver) return null;
            return quest(g, 'song', `Spirits are low in ${sad.name}`, giver, `People in ${sad.name} could use some cheer. Lift the spirits at ${spot.name}.`,
                [{ place: spot.id, what: 'Entertain them (Performance check)', check: { skill: 'performance', dc: 12 } }], { xp: 70, money: 15, renown: 5 }, 3, sad.id);
        },
        // bandits on the road (needs a bestiary): drive them off
        () => {
            if (!(rpgOf(w)?.bestiary ?? []).some(f => (f.tags ?? []).includes('road'))) return null;
            const road = publicPlaces(w).filter(p => w.places.some(l => l.link && l.map === p.map));
            const spot = pick(g, road.length ? road : publicPlaces(w), 'bandits');
            const giver = pick(g, people.filter(r => r.occupation), 'bandits-giver') ?? pick(g, people, 'bandits-giver');
            if (!spot || !giver) return null;
            return quest(g, 'bandits', 'Bandits on the road', giver, `Travelers are being robbed near ${spot.name}. ${giver.name} asks you to drive the bandits off.`,
                [{ place: spot.id, what: 'Fight the bandits', fight: ['road'] }], { xp: 120, money: 40, renown: 8 }, 4);
        },
    ];
    const order = ideas.map((f, i) => [f, rnd(g, `idea|${i}`)] as const).sort((a, b) => a[1] - b[1]);
    for (const [f] of order) { const q = f(); if (q && !quests(g).some(x => x.state !== 'done' && x.state !== 'failed' && x.kind === q.kind && x.giver === q.giver)) return q; }
    return null;
}
function quest(g: Save, kind: string, title: string, giver: Resident, text: string, steps: QuestStep[], reward: Quest['reward'], days: number, region?: string): Quest {
    return { id: `q${nowAbs(g)}_${kind}`, kind, title, giver: giver.avatar, text, steps, step: 0, reward, due: g.day + days, state: 'offered', ...(region ? { region } : {}) };
}

onDay.push((g, w) => {
    if (!isRpg(w) || !sheetOf(g)) return [];
    const out: string[] = [];
    for (const q of quests(g)) {
        if ((q.state === 'active' || q.state === 'offered') && g.day > q.due) {
            if (q.state === 'active') { q.state = 'failed'; note(g, '{u} did not finish a quest in time: {0}.', [q.title], [q.giver], g.player.loc, 'goal'); out.push(`Quest failed (out of time): ${q.title}.`); bump(g, q.giver, -3); }
            else q.state = 'failed';
        }
    }
    (g as any).quests = quests(g).filter(q => q.state === 'active' || q.state === 'offered' || g.day - q.due < 14).slice(-30);
    if (offeredQuests(g).length + activeQuests(g).length < 3 && rnd(g, 'quest') < 0.6) {
        const q = makeQuest(g, w);
        if (q) { quests(g).push(q); const r = g.cast[q.giver]; out.push(`New quest: ${q.title}${r?.met ? ` (from ${r.name})` : ''}.`); }
    }
    return out;
});

export function acceptQuest(g: Save, id: string): string {
    const q = quests(g).find(x => x.id === id && x.state === 'offered'); if (!q) return '';
    q.state = 'active'; if (g.cast[q.giver]) g.cast[q.giver].met = true;
    note(g, '{u} took on a quest: {0}.', [q.title], [q.giver], g.player.loc, 'goal');
    return `Quest accepted: ${q.title}.`;
}
export function declineQuest(g: Save, id: string) { const q = quests(g).find(x => x.id === id && x.state === 'offered'); if (q) q.state = 'failed'; }
// What can be done for a quest where you are now.
export const questsHere = (g: Save) => activeQuests(g).filter(q => q.steps[q.step]?.place === g.player.loc);

export interface StepResult { text: string; check?: Check; done?: boolean; fight?: boolean; msgs: string[] }
export function doStep(g: Save, w: WorldDef, id: string): StepResult | null {
    const q = activeQuests(g).find(x => x.id === id); const st = q?.steps[q.step];
    if (!q || !st || st.place !== g.player.loc) return null;
    const msgs: string[] = [];
    let check: Check | undefined;
    if (st.fight && !(q as any).won) {
        if (inCombat(g)) return { text: 'You are already fighting.', msgs };
        if (q.tried === g.day) return { text: 'Not today: catch your breath and come back tomorrow.', msgs };
        const c = startCombat(g, w, { why: 'The bandits come at you:', tags: st.fight, quest: q.id });
        return { text: c ? 'To arms!' : 'There is no one to fight here.', fight: !!c, msgs };
    }
    if (st.check) {
        if (q.tried === g.day) return { text: 'You already tried today. Try again tomorrow.', msgs };
        check = rollCheck(g, w, st.check.skill, st.check.dc);
        if (!checkWon(check)) {
            q.tried = g.day;
            if (check.grade === 'critical-fail') { q.state = 'failed'; note(g, '{u} failed a quest: {0}.', [q.title], [q.giver], g.player.loc, 'goal'); return { text: `${gradeWord(check)}: the quest is lost (${q.title}).`, check, msgs }; }
            return { text: `${gradeWord(check)}. It did not work this time; you can try again tomorrow.`, check, msgs };
        }
    }
    q.step++; delete (q as any).won;
    if (q.step < q.steps.length) return { text: `${st.what}: done. Next: ${q.steps[q.step].what}.`, check, msgs };
    // finished
    q.state = 'done';
    const crit = check?.grade === 'critical-success' ? 1.5 : 1;
    if (q.reward.money) { g.player.money += q.reward.money; book(g, q.title, q.reward.money); }
    msgs.push(...addXp(g, w, q.reward.xp * crit, q.title), ...addRenown(g, w, q.reward.renown), ...count(g, w, 'quests'));
    bump(g, q.giver, 6);
    if (q.kind === 'calm' && q.region) regionState(g, w, q.region).tension = Math.max(0, regionState(g, w, q.region).tension - 25);
    if (q.kind === 'song' && q.region) regionState(g, w, q.region).mood = Math.min(100, regionState(g, w, q.region).mood + 20);
    note(g, '{u} finished a quest: {0}.', [q.title], [q.giver], g.player.loc, 'goal');
    { const m = addRep(g, w, Math.max(2, q.reward.renown), q.title); if (m) msgs.push(m); }
    pleaseBlade(g, w, 'quests', 8);
    return { text: `Quest complete: ${q.title}! +${Math.round(q.reward.xp * crit)} XP${q.reward.money ? `, +${q.reward.money}` : ''}.`, check, done: true, msgs };
}
// For the AI: the quests that bring {{user}} here.
export function questLines(g: Save): string[] {
    return questsHere(g).map(q => `{{user}} is here on a quest: ${q.title} — ${q.steps[q.step].what.replace(/ \(.*\)$/, '')}.`);
}

// A fight for a quest: won, the step is done (and the quest, if it was the last one); lost or fled, try another day.
afterFight.push((g, w, c) => {
    const q = c.quest ? activeQuests(g).find(x => x.id === c.quest) : null;
    if (!q) return [];
    if (c.over !== 'won') { q.tried = g.day; return [`${q.title}: not this time.`]; }
    (q as any).won = true;
    const r = doStep(g, w, q.id);
    return r ? [r.text, ...r.msgs] : [];
});
