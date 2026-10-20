// What the AI knows about the scene right now. Injected as an extension prompt before every reply, so it works
// with SillyTavern's normal generation (and with any preset). The world's lore lives in its lorebook instead.
import { approvalLine, couplesLine, rumorLines, activeWorldLore } from './living.js';
import { feelingLine, physiqueLine, aspirationOf } from './life.js';
import { game, settings } from '../core/store.js';
import { getWorld } from '../core/world.js';
import { aiLangNote } from '../core/i18n.js';
import { setPrompt, nameOf } from '../st/bridge.js';
import { weekday, hm, period, seasonOf } from './time.js';
import { placeOf } from './places.js';
import { presentAt, routineStep } from './people.js';
import { feelings } from './needs.js';
import { planLines } from './plans.js';
import { memoryLines } from './facts.js';
import { diaryLines } from './diary.js';
import { tiesLine } from './living.js';
import { romanceLine } from './romance.js';
import { familyLine } from './family.js';
import { weatherOf } from './weather.js';
import { social, livePlan } from './social.js';
import { personaName } from '../st/bridge.js';
import { nowAbs } from '../core/store.js';
export const PROMPT_KEY = 'mundi_scene';
export const BLOCKS = [
    { id: 'core', name: 'Scene basics', desc: 'World, day and time, weather, place, who is here and why, and the rules of the scene.' },
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
    { id: 'you', name: 'About you', desc: 'How fit you look and your life goal.', cut: 3 },
    { id: 'approval', name: 'Approval', desc: 'What people here think of how you behave.', cut: 2 },
    { id: 'couples', name: 'Their relationships', desc: 'Who is dating whom among the people here.', cut: 2 },
    { id: 'rumors', name: 'Rumors', desc: 'Gossip the people here have heard.', cut: 1 },
];
export const promptCfg = () => { const s = settings(); s.promptCfg ??= { off: [], budget: 0 }; s.promptCfg.off ??= []; s.promptCfg.budget ??= 0; return s.promptCfg; };
// A quick token estimate (about 3.6 characters per token in English); the screen shows SillyTavern's own count.
export const estTokens = (t) => Math.ceil(t.length / 3.6);
export function sceneBlocks() {
    const g = game();
    const w = g && getWorld(g.world);
    if (!g || !w)
        return [];
    const here = placeOf(g, w, g.player.loc);
    const present = presentAt(g, w, g.player.loc);
    const met = present.filter(r => r.met);
    const now = nowAbs(g);
    const raw = {
        core: [
            `[World state — ${w.name}]`,
            `Now: ${weekday(g.day)}, day ${g.day}, ${hm(g.minutes)} (${period(w, g.minutes).name.toLowerCase()}). Weather: ${weatherOf(g).name.toLowerCase()}. Season: ${seasonOf(g).name.toLowerCase()}.`,
            `Place: ${here?.name ?? 'somewhere'}${here?.desc ? ` — ${here.desc}` : ''}`,
            present.length ? `Here with {{user}}: ${present.map(r => `${r.name} - ${hereLabel(w, r, now)}`).join(', ')}. Only they are in this scene; nobody else speaks or appears.` : 'Nobody else is here right now.',
            ...(present.some(r => !r.met) ? [`Strangers to {{user}}: ${present.filter(r => !r.met).map(r => r.name).join(', ')}. They and {{user}} have never met: they do not know each other's names until they talk and introduce themselves.`] : []),
        ],
        // only the people in this scene and this place: nobody else's memories, nobody else's whereabouts
        diary: diaryLines(g),
        memories: memoryLines(g, w, met, personaName()),
        plans: planLines(g, present, w),
        focus: [focusLine(g, w, present)],
        feelings: [feelingLine(g, met)],
        you: [physiqueLine(g), aspirationOf(g) ? `{{user}}'s life goal: ${aspirationOf(g).name.toLowerCase()}.` : ''],
        solo: [soloLine(g, present)],
        approval: [approvalLine(g, met)],
        couples: [couplesLine(g, present)],
        ties: [tiesLine(g, present)],
        romance: [romanceLine(g, met)],
        family: [familyLine(g, present)],
        rumors: rumorLines(g, met),
        lore: activeWorldLore(g, w),
        needs: [feelings(g, w)],
    };
    const tail = ['Write only what happens in this place and at this moment. Do not move the story to another place or skip time; the game handles travel and time.', aiLangNote()].filter(Boolean).join('\n');
    const pc = promptCfg();
    const out = BLOCKS.map(b => {
        const text = (raw[b.id] ?? []).filter(Boolean).join('\n') + (b.id === 'core' ? `\n${tail}` : '');
        return { id: b.id, text, state: !text.trim() ? 'empty' : b.cut && pc.off.includes(b.id) ? 'off' : 'sent' };
    });
    // over the budget: drop the least important blocks first
    if (pc.budget > 0) {
        const size = () => estTokens(out.filter(x => x.state === 'sent').map(x => x.text).join('\n'));
        const order = BLOCKS.filter(b => b.cut).sort((a, b) => a.cut - b.cut);
        for (const b of order) {
            if (size() <= pc.budget)
                break;
            const x = out.find(o => o.id === b.id);
            if (x.state === 'sent')
                x.state = 'cut';
        }
    }
    return out;
}
export function sceneText() {
    const list = sceneBlocks();
    const core = list.find(b => b.id === 'core');
    // the basics first and the scene's rules last, the rest in between (as before)
    const mid = list.filter(b => b.id !== 'core' && b.state === 'sent').map(b => b.text);
    if (!core)
        return '';
    const [head, ...rest] = core.text.split('\n');
    const basics = [head, ...rest.slice(0, 3)].join('\n'), rules = rest.slice(3).join('\n');
    return [basics, ...mid, rules].filter(Boolean).join('\n');
}
export function refreshPrompt() { setPrompt(PROMPT_KEY, sceneText()); }
export const clearPrompt = () => setPrompt(PROMPT_KEY, '');
export const speakerName = (avatar) => nameOf(avatar);
// The scene's focus (a short directive so the story does not wander): the plan or company that brought you here.
function focusLine(g, w, present) {
    const now = nowAbs(g);
    const s = social(g);
    const here = new Set(present.map(r => r.avatar));
    const plan = s.appts.find(a => here.has(a.avatar) && a.place === g.player.loc && (a.state === 'met' || livePlan(a)) && a.from <= now + 30 && a.to >= now);
    if (plan)
        return `Scene focus: ${plan.kind === 'date' ? 'a date' : plan.kind === 'party' ? "{{user}}'s party" : 'meeting up'} with ${g.cast[plan.avatar]?.name}${plan.title ? `: "${plan.title}" (play the scene around this)` : ''}.`;
    const along = s.with.map(c => g.cast[c.avatar]?.name).filter(Boolean);
    if (along.length)
        return `Scene focus: ${along.join(' and ')} came along with {{user}}.`;
    if (!present.length)
        return `Scene focus: {{user}} is alone here. Describe the place, the passing moment and how {{user}} feels; nobody else appears.`;
    void w;
    return '';
}
// Why each person here is around, from their own routine: student, work, home or free time.
function hereLabel(w, r, now) {
    const target = routineStep(r, now)[1];
    if (target === 'campus')
        return 'attending classes';
    if (target === 'work') {
        const job = w.features?.jobs !== false ? w.occupations.find(o => o.id === r.occupation) : null;
        if (!job)
            return 'Leisure'; // no job: the routine sends her to free time instead
        return job.name ? `Working as ${job.name}` : 'Working';
    }
    if (target === 'leisure')
        return 'Leisure';
    if (target === 'home')
        return 'Home';
    return w.places.find(p => p.id === target)?.name || 'Home'; // a set stop of the routine; unknown place: she stays home
}
function soloLine(g, present) {
    const solo = String(g.social?.solo ?? '');
    const r = present.find(x => x.avatar === solo);
    if (!r || present.length < 2)
        return '';
    return `{{user}} is talking only with ${r.name}; the others here (${present.filter(x => x !== r).map(x => x.name).join(', ')}) give them space and stay out of the conversation.`;
}
