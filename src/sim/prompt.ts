// What the AI knows about the scene right now. Injected as an extension prompt before every reply, so it works
// with SillyTavern's normal generation (and with any preset). The world's lore lives in its lorebook instead.
import { homeJobsLine } from './hometime.js';
import { dressLine } from './dress.js';
import { lookLine } from './looks.js';
import { approvalLine, couplesLine, rumorLines, activeWorldLore } from './living.js';
import './longlife.js';   // people's lives over the weeks (runs by itself, day by day)
import { feelingLine, physiqueLine, aspirationOf } from './life.js';
import { game, settings } from '../core/store.js';
import { getWorld, homeNeedsOn } from '../core/world.js';
import { aiLangNote } from '../core/i18n.js';
import { setPrompt, nameOf } from '../st/bridge.js';
import { weekday, hm, period, seasonOf } from './time.js';
import { placeOf, floorName } from './places.js';
import { presentAt, whereNow, OUT } from './people.js';
import { partyLine as houseLine } from './houseparty.js';
import { feelings } from './needs.js';
import { planLines } from './plans.js';
import { memoryLines } from './facts.js';
import { diaryLines } from './diary.js';
import { tiesLine } from './living.js';
import { romanceLine } from './romance.js';
import { familyLine } from './family.js';
import { social, livePlan } from './social.js';
import { personaName } from '../st/bridge.js';
import { nowAbs, type Save, type Resident } from '../core/store.js';
import { worldLine, weatherHere } from './worldstate.js';
import { placeMemoryLines, whyHereLines } from './daylife.js';
import { openNow } from './daynight.js';
import { neighbors } from './happenings.js';
import { sheetLine } from './rpg.js';
import { mortalLine } from './mortal.js';
import { questLines } from './quests.js';
import { partyLine } from './party.js';
import { combatLine } from './combat.js';
import { festivalLine } from './festivals.js';
import { eventLine } from './cityevents.js';
import { hobbyLine } from './hobbies.js';
import { realmLine } from './realm.js';
import { legendLines } from './legends.js';
import { skiesLine } from './skies.js';
import { bountyLine } from './crime.js';
import { guestLine } from './guests.js';
import { tradeLine } from './economy.js';
import { holdingsLine } from './holdings.js';
import { afflictionLine } from './afflictions.js';
import { artifactLines } from './artifacts.js';
import { towerLines } from './towers.js';
import { buildingLines, lockedHereLine } from './discovery.js';
import { gateLines } from './gates.js';
import { contractLines } from './contracts.js';
import { prisonLine } from './prison.js';
import { institutionLines } from './institutions.js';
import { factionLines } from './factions.js';
import { standingLine } from './standing.js';
import { habitLine } from './habits.js';
import { petLine } from './pets.js';
import { mentorLine } from './mentors.js';
import './letters.js';
import './journey.js';
import { systemOn, blockSystem, isScenario, SCENARIO_STARTS, type WorldDef } from '../core/world.js';

export const PROMPT_KEY = 'mundi_scene';

// The blocks Mundi can send. `cut`: the order in which they are dropped when the text is over the token budget
// (1 first); blocks without `cut` are always sent (where and when we are, who is here, safety lines).
export interface Block { id: string; name: string; desc: string; cut?: number }
export const BLOCKS: Block[] = [
    { id: 'core', name: 'Scene basics', desc: 'World, day and time, weather, place, who is here, and the rules of the scene.' },
    { id: 'world', name: 'The mood around', desc: 'How busy it is here, the public mood and tension of the region, and its prices.', cut: 4 },
    { id: 'memories', name: 'Memories', desc: 'What the people here remember about you, and what happened earlier in this place.', cut: 9 },
    { id: 'plans', name: 'Plans', desc: 'Plans you made with the people here.', cut: 8 },
    { id: 'focus', name: 'Scene focus', desc: 'Why you are here: a date, a meet-up, someone who came along.', cut: 8 },
    { id: 'solo', name: 'Talking alone', desc: 'Who you are talking to when you talk only with one person.' },
    { id: 'romance', name: 'Friendship and romance', desc: 'Where you stand with each person here.', cut: 7 },
    { id: 'family', name: 'Your children', desc: 'Your children\'s age and how to treat them. Always sent when they are here.' },
    { id: 'ties', name: 'Family and ties', desc: 'Who is whose sister, parent, roommate…', cut: 6 },
    { id: 'needs', name: 'How you feel', desc: 'Hunger, tiredness… only what stands out.', cut: 6 },
    { id: 'diary', name: 'Diary', desc: 'The last two days of your diary.', cut: 5 },
    { id: 'lore', name: 'World lore', desc: 'World lore that switches on with weather, time or place.', cut: 5 },
    { id: 'feelings', name: 'Their feelings', desc: 'Feelings with an end date, like "upset: you stood them up".', cut: 4 },
    { id: 'you', name: 'About you', desc: 'How fit you look and your life goal (RPG: level, class, titles, hit points).', cut: 3 },
    { id: 'approval', name: 'Approval', desc: 'What people here think of how you behave.', cut: 2 },
    { id: 'couples', name: 'Their relationships', desc: 'Who is dating whom among the people here.', cut: 2 },
    { id: 'rumors', name: 'Rumors', desc: 'Gossip the people here have heard.', cut: 1 },
    { id: 'extra', name: 'Your own instructions', desc: 'Whatever you write here, sent with every reply (empty: nothing).' },
];
// The scene's rules, sent last (the game handles travel and time). Editable: an empty text means this one.
export const DEFAULT_RULES = 'Write only what happens in this place and at this moment. Do not move the story to another place or skip time; the game handles travel and time.';
// A block's own text: `{text}` is where Mundi puts what it wrote for the block; without it, the text replaces it
// (sent only when the block has something to say). SillyTavern's macros ({{user}}, {{char}}…) work as usual.
export const applyTemplate = (tpl: string | undefined, text: string) => (!tpl?.trim() || !text.trim() ? text : tpl.includes('{text}') ? tpl.split('{text}').join(text) : tpl);
// The blocks this world has: those of a system turned off in it are gone.
export const blocksOf = (w: WorldDef | null | undefined, g?: unknown) => BLOCKS.filter(b => !blockSystem(b.id) || systemOn(w, blockSystem(b.id)!) || (b.id === 'needs' && !!w && isScenario(w) && homeNeedsOn(g)));   // (Home: needs turned on for this game)
// off: blocks switched off; budget: tokens (0 = no limit); text: each block's own text (see applyTemplate);
// rules: the scene's rules (empty = DEFAULT_RULES); extra: your own instructions.
export interface PromptCfg { off: string[]; budget: number; text: Record<string, string>; rules: string; extra: string }
export const promptCfg = (): PromptCfg => {
    const s = settings() as any; s.promptCfg ??= {};
    const c = s.promptCfg; c.off ??= []; c.budget ??= 0; c.text ??= {}; c.rules ??= ''; c.extra ??= '';
    return c;
};
// A quick token estimate (about 3.6 characters per token in English); the screen shows SillyTavern's own count.
export const estTokens = (t: string) => Math.ceil(t.length / 3.6);

export interface Built { id: string; text: string; state: 'sent' | 'off' | 'cut' | 'empty' }
// The premise of this game: your own (custom), or the scenario's with how you fit in it.
export function scenarioPremise(g: any, w: WorldDef): string {
    const st = g?.cfg?.start; if (st?.text) return st.text;
    const how = SCENARIO_STARTS.find(s => s.id === st?.id)?.premise ?? '';
    return [w.scenario?.premise ?? '', how].filter(Boolean).join(' ');
}
// A scenario: the house is the whole stage; the premise, and who is out of the house right now (off-screen).
export function scenarioLines(g: any, w: WorldDef): string[] {
    if (!isScenario(w)) return [];
    const out = Object.values(g.cast ?? {}).filter((r: any) => whereNow(g, w, r) === OUT).map((r: any) => r.name);
    const premise = scenarioPremise(g, w);
    return [`Home: everything happens in and around this one house; when someone goes out (work, errands, nights out) it is off-screen and only told afterwards.${premise ? ` Premise: ${premise}` : ''}`,
        ...(out.length ? [`Out of the house right now (not in any scene): ${out.join(', ')}.`] : []), homeJobsLine(g), dressLine(g, w), houseLine(g, w)].filter(Boolean);
}
export function sceneBlocks(): Built[] {
    const g = game();
    const w = g && getWorld(g.world);
    if (!g || !w) return [];
    const here = placeOf(g, w, g.player.loc);
    const present = presentAt(g, w, g.player.loc);
    const met = present.filter(r => r.met);
    const names = present.map(r => r.name);
    const pc = promptCfg();
    const raw: Record<string, string[]> = {
        core: [
            `[World state — ${w.name}]`,
            ...scenarioLines(g, w),
            `Now: ${weekday(g.day)}, day ${g.day}, ${hm(g.minutes)} (${period(w, g.minutes).name.toLowerCase()}). Weather: ${weatherHere(g, w).name.toLowerCase()}. Season: ${seasonOf(g).name.toLowerCase()}.`,
            `Place: ${here ? floorName(here) : 'somewhere'}${here?.in && placeOf(g, w, here.in) ? ` (in ${placeOf(g, w, here.in)!.name})` : ''}${here?.desc ? ` — ${here.desc}` : ''}${here && !here.home && systemOn(w, 'living') && !openNow(g, w, here.id) ? ' (closed at this hour: the doors are shut; only staff, if anyone, is around)' : ''}`,
            names.length ? `Here with {{user}}: ${names.join(', ')}. Only they are in this scene; nobody else speaks or appears.` : 'Nobody else is here right now.',
            ...(guestLine(g, present) ? [guestLine(g, present)] : []),
            lookLine(g, w, present),
            ...(present.some(r => !r.met) ? [`Strangers to {{user}}: ${present.filter(r => !r.met).map(r => r.name).join(', ')}. They and {{user}} have never met: they do not know each other's names until they talk and introduce themselves.`] : []),
        ],
        // only the people in this scene and this place: nobody else's memories, nobody else's whereabouts
        world: [worldLine(g, w), festivalLine(g, w), realmLine(g, w), skiesLine(g, w), ...legendLines(g, w)],
        diary: diaryLines(g),
        memories: [...memoryLines(g, w, met, personaName()), ...placeMemoryLines(g, w, present)],
        plans: planLines(g, present, w),
        focus: [eventLine(g, w), combatLine(g, w), prisonLine(g, w), ...towerLines(g, w), ...gateLines(g, w), ...buildingLines(g, w), lockedHereLine(g, w), ...contractLines(g, w), ...institutionLines(g, w), focusLine(g, w, present), ...whyHereLines(g, w, present), ...questLines(g)],
        feelings: [feelingLine(g, met)],
        you: [(g.player as any).bio ? `About {{user}} in this world: ${(g.player as any).bio}` : '', sheetLine(g, w), mortalLine(g, w), afflictionLine(g, w), ...artifactLines(g, w), partyLine(g, w), standingLine(g, w), bountyLine(g, w), tradeLine(g, w), holdingsLine(g, w), habitLine(g, w), hobbyLine(g, w), petLine(g, w), mentorLine(g, w, present.map(r => r.avatar)), physiqueLine(g), aspirationOf(g) && systemOn(w, 'goals') ? `{{user}}'s life goal: ${aspirationOf(g)!.name.toLowerCase()}.` : ''],
        solo: [soloLine(g, present)],
        approval: [approvalLine(g, met)],
        couples: [couplesLine(g, present)],
        ties: [...factionLines(g, w, present), tiesLine(g, present), (() => { const n = new Set(neighbors(g).map(r => r.avatar)); const near = present.filter(r => n.has(r.avatar)).map(r => r.name); return near.length && systemOn(w, 'neighbors') ? `Neighbors of {{user}} (they live in the same area): ${near.join(', ')}.` : ''; })()],
        romance: [romanceLine(g, met)],
        family: [familyLine(g, present)],
        rumors: rumorLines(g, met),
        lore: activeWorldLore(g, w),
        needs: [feelings(g, w)],
        extra: [pc.extra],
    };
    const tail = [pc.rules.trim() || DEFAULT_RULES, aiLangNote()].filter(Boolean).join('\n');
    // a block whose system is off in this world is not there at all (not even as "off")
    const out: Built[] = blocksOf(w, g).map(b => {
        const own = (raw[b.id] ?? []).filter(Boolean).join('\n');
        const text = b.id === 'core' ? `${own}\n${tail}` : applyTemplate(pc.text[b.id], own);
        return { id: b.id, text, state: !text.trim() ? 'empty' : b.cut && pc.off.includes(b.id) ? 'off' : 'sent' };
    });
    // over the budget: drop the least important blocks first
    if (pc.budget > 0) {
        const size = () => estTokens(out.filter(x => x.state === 'sent').map(x => x.text).join('\n'));
        const order = blocksOf(w, g).filter(b => b.cut).sort((a, b) => a.cut! - b.cut!);
        for (const b of order) {
            if (size() <= pc.budget) break;
            const x = out.find(o => o.id === b.id)!;
            if (x.state === 'sent') x.state = 'cut';
        }
    }
    return out;
}

export function sceneText(): string {
    const list = sceneBlocks();
    const core = list.find(b => b.id === 'core');
    // the basics first and the scene's rules last, the rest in between (as before)
    const mid = list.filter(b => b.id !== 'core' && b.state === 'sent').map(b => b.text);
    if (!core) return '';
    const [head, ...rest] = core.text.split('\n');
    const basics = [head, ...rest.slice(0, 3)].join('\n'), rules = rest.slice(3).join('\n');
    return [basics, ...mid, rules].filter(Boolean).join('\n');
}

export function refreshPrompt() { setPrompt(PROMPT_KEY, sceneText()); }
export const clearPrompt = () => setPrompt(PROMPT_KEY, '');
export const speakerName = (avatar: string) => nameOf(avatar);

// The scene's focus (a short directive so the story does not wander): the plan or company that brought you here.
function focusLine(g: Save, w: WorldDef, present: Resident[]): string {
    const now = nowAbs(g);
    const s = social(g);
    const here = new Set(present.map(r => r.avatar));
    const plan = s.appts.find(a => here.has(a.avatar) && a.place === g.player.loc && (a.state === 'met' || livePlan(a)) && a.from <= now + 30 && a.to >= now);
    if (plan) return `Scene focus: ${plan.kind === 'date' ? 'a date' : plan.kind === 'party' ? "{{user}}'s party" : 'meeting up'} with ${g.cast[plan.avatar]?.name}${plan.title ? `: "${plan.title}" (play the scene around this)` : ''}.`;
    const along = s.with.map(c => g.cast[c.avatar]?.name).filter(Boolean);
    if (along.length) return `Scene focus: ${along.join(' and ')} came along with {{user}}.`;
    if (!present.length) return `Scene focus: {{user}} is alone here. Describe the place, the passing moment and how {{user}} feels; nobody else appears.`;
    void w;
    return '';
}

function soloLine(g: Save, present: Resident[]) {
    const solo = String((g as any).social?.solo ?? '');
    const r = present.find(x => x.avatar === solo);
    if (!r || present.length < 2) return '';
    return `{{user}} is talking only with ${r.name}; the others here (${present.filter(x => x !== r).map(x => x.name).join(', ')}) give them space and stay out of the conversation.`;
}
