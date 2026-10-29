// The RPG on screen: the character sheet, quests and the grimoire (as apps of the phone or pages of the journal),
// and a small level / hit points / focus badge by your portrait.
import { esc, game, notify, saveGame, toast, state, type Save } from '../core/store.js';
import { getWorld, type WorldDef } from '../core/world.js';
import { rpgOf } from '../core/rpgdef.js';
import { lex } from '../core/lexicon.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';
import { placeOf } from '../sim/places.js';
import { money } from '../sim/needs.js';
import { setPrompt } from '../st/bridge.js';
import {
    isRpg, sheetOf, classOf, hpMax, focusMax, mod, prof, attr, skillBonus, trained, xpFor, maxLevel, pendingSubclass, chooseSubclass,
    spendPoint, spellsFor, learnSpell, learnSkill, weaponOf, attrCap, maxPrepared, titleNames, talentTree, talentsOf, talentPoints, tierOpen, canTake, takeTalent, respec,
} from '../sim/rpg.js';
import { quests, questPool, acceptQuest, declineQuest, failQuest, doStep, giverOf, plainStep, questsHere, offersHere, favorsHere, roomForMore, isQuestBoard, searchedToday, readBoard, askForWork, hearOut, ASK_DC, type Quest, type Found } from '../sim/quests.js';
import { questPrefs, setQuestPref, readLoreQuests } from '../sim/lorequests.js';
import { canAsk, chance } from '../sim/moreacts.js';
import { inCombat } from '../sim/combat.js';
import { doing, isDoing } from './doing.js';
import { advance } from '../sim/time.js';
import { runPlans } from './plans.js';
import { syncScene } from '../sim/game.js';
import { refreshPrompt } from '../sim/prompt.js';
import { knownSpells, togglePrepared, cast, canPrepare } from '../sim/magic.js';

const sign = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);
const bar = (v: number, max: number, cls: string) => `<span class="mu-rpg-bar ${cls}"><i style="width:${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100))}%"></i></span>`;

/* ---------- the character sheet ---------- */

export function sheetApp(g: Save, w: WorldDef, head: string): string {
    const s = sheetOf(g); const r = rpgOf(w);
    if (!s || !r || !isRpg(w)) return `${head}<div class="mu-ph-body"><p class="mu-muted">No character sheet in this world.</p></div>`;
    const c = classOf(w, s); const sub = c?.subclasses.find(x => x.id === s.sub);
    const next = s.level < maxLevel(w) ? xpFor(w, s.level) : 0;
    const t = titleNames(w, s);
    return `${head}<div class="mu-ph-body mu-sheet">
        <section class="mu-ph-card"><h4>Level ${s.level} · ${esc(sub ? `${sub.name} ` : '')}${esc(c?.name ?? '')}</h4>
            ${t.length ? `<small class="mu-sheet-titles">${esc(t.join(' · '))}</small>` : ''}
            <small>Hit points ${s.hp}/${hpMax(w, s)}</small>${bar(s.hp, hpMax(w, s), 'is-hp')}
            <small>${esc(r.focusName ?? 'Focus')} ${s.focus}/${focusMax(w, s)}</small>${bar(s.focus, focusMax(w, s), 'is-focus')}
            <small>Experience ${s.xp}${next ? ` / ${next} for level ${s.level + 1}` : ' (top level)'}</small>${next ? bar(s.xp, next, 'is-xp') : ''}
            <small>Proficiency ${sign(prof(s.level))} · Renown ${s.renown}</small></section>
        ${pendingSubclass(w, s) ? `<section class="mu-branch"><b>Choose your subclass</b>${c!.subclasses.map(x => `<button class="mu-branch-opt" data-act="rpg-sub" data-id="${esc(x.id)}"><b>${esc(x.name)}</b><small>${esc(x.desc ?? '')}</small></button>`).join('')}</section>` : ''}
        <section><h4>Attributes${s.points ? ` <small class="mu-good">${s.points} point${s.points === 1 ? '' : 's'} to spend</small>` : ''}</h4>
            <div class="mu-sheet-attrs">${r.attributes.map(a => `<div><small>${esc(a.short)}</small><b>${attr(s, a.id)}</b><em>${sign(mod(attr(s, a.id)))}</em>${s.points && attr(s, a.id) < attrCap(w) ? `<button class="mu-ibtn" data-act="rpg-point" data-id="${esc(a.id)}" title="+1 ${esc(a.name)}">${icon('plus')}</button>` : ''}</div>`).join('')}</div></section>
        <section><h4>Skills${s.skillPicks ? ` <small class="mu-good">${s.skillPicks} to learn: tap a skill</small>` : ''}</h4><div class="mu-sheet-skills">${r.skills.map(k => { const on = trained(w, s).includes(k.id); const inner = `<b>${sign(skillBonus(w, s, k.id))}</b> ${esc(k.name)}`;
                return s.skillPicks && !on ? `<button class="mu-sheet-learn" data-act="rpg-skill" data-id="${esc(k.id)}" title="Learn ${esc(k.name)}">${inner}</button>` : `<span class="${on ? 'is-trained' : ''}">${inner}</span>`; }).join('')}</div>
            <small class="mu-muted">● trained (adds your proficiency). Checks are d20 + the bonus against a difficulty (easy 10, medium 13, hard 16, very hard 19).</small>
            ${weaponLine(w, s)}</section>
        ${talentsHtml(w, s)}
        ${origin(g, w)}
    </div>`;
}
function weaponLine(w: WorldDef, s: NonNullable<ReturnType<typeof sheetOf>>) {
    const wp = weaponOf(w, s); if (!wp) return '';
    return `<small class="mu-muted">Weapon: ${esc(wp.name)} (${wp.dice}d${wp.sides}${wp.ranged ? ', ranged' : ''})${wp.trained ? ', trained' : ', not trained: no proficiency on attacks'}.</small>`;
}
function talentsHtml(w: WorldDef, s: NonNullable<ReturnType<typeof sheetOf>>) {
    if ((w.features as any)?.talents === false) return '';
    const tree = talentTree(w, s); if (!tree.length) return '';
    const mine = talentsOf(s); const pts = talentPoints(s);
    const tiers = [...new Set(tree.map(t => t.tier))].sort((a, b) => a - b);
    return `<section><h4>Talents${pts ? ` <small class="mu-good">${pts} point${pts === 1 ? '' : 's'} to spend</small>` : ''}</h4>
        ${tiers.map(t => `<div class="mu-talent-tier ${tierOpen(s, t) ? '' : 'is-locked'}"><small>Tier ${t}${tierOpen(s, t) ? '' : ` · level ${(t - 1) * 3 + 1}`}</small><div>${tree.filter(x => x.tier === t).map(x => { const has = mine.includes(x.id); const why = has ? '' : canTake(w, s, x.id); return `<button class="mu-talent ${has ? 'is-on' : ''}" data-act="rpg-talent" data-id="${esc(x.id)}" ${has || why ? `aria-disabled="true"` : ''} title="${esc(why || x.desc || '')}"><b>${esc(x.name)}</b><small>${esc(x.desc ?? '')}</small></button>`; }).join('')}</div></div>`).join('')}
        ${mine.length ? '<button class="mu-ghost" data-act="rpg-respec">Respec: get every point back</button>' : ''}</section>`;
}
function origin(g: Save, w: WorldDef) {
    const o = w.catalogs.origins?.find(x => x.id === g.player.origin);
    return o?.feature ? `<section><h4>Background · ${esc(o.name)}</h4><p class="mu-muted">${esc(o.feature)}</p></section>` : '';
}

/* ---------- quests ---------- */

const QS = { busy: false };
const from = (q: Quest) => (q.from === 'lore' ? `From the lorebook${q.lore ? ` “${esc(q.lore)}”` : ''}` : q.from === 'story' ? 'From the story' : '');
export function questsApp(g: Save, w: WorldDef, head: string): string {
    const list = quests(g);
    const row = (q: Quest) => {
        const who = giverOf(g, q);
        const st = q.steps[q.step];
        const when = q.state === 'offered' ? (q.days ? `${q.days} days once taken on` : 'no hurry') : q.due ? `day ${q.due} at the latest` : 'no hurry';
        const at = st ? (st.place ? `at ${esc(placeOf(g, w, st.place)?.name ?? '?')}` : 'in the story') : '';
        const acts = q.state === 'offered' ? `<button class="mu-primary" data-act="rpg-q-yes" data-id="${esc(q.id)}">Accept</button><button class="mu-ghost" data-act="rpg-q-no" data-id="${esc(q.id)}">Turn down</button>`
            : q.state === 'active' ? `${st && !st.place && plainStep(st) ? `<button class="mu-primary" data-act="rpg-q-step" data-id="${esc(q.id)}">Mark this step done</button>` : ''}${st && !st.place && !plainStep(st) ? `<button class="mu-primary" data-act="quest-step" data-id="${esc(q.id)}">${st.fight ? 'Fight' : 'Try it'}</button>` : ''}<button class="mu-ghost" data-act="rpg-q-drop" data-id="${esc(q.id)}">Give up</button>` : '';
        return `<article class="mu-quest is-${q.state}"><header><b data-notr>${esc(q.title)}</b><small>${who && (g.cast[q.giver]?.met !== false) ? `<span data-notr>${esc(who)}</span>` : 'Someone'} · ${when}</small></header>
            <p data-notr>${esc(q.text)}</p>
            ${q.state === 'active' && st ? `<small>Next: <span data-notr>${esc(st.what)}</span> — ${at}</small>` : ''}
            <small class="mu-muted">Reward: ${q.reward.xp} XP${q.reward.money ? ` · ${money(w, q.reward.money)}` : ''}${q.reward.renown ? ` · ${q.reward.renown} renown` : ''}${from(q) ? ` · ${from(q)}` : ''}</small>
            ${acts ? `<div class="mu-row">${acts}</div>` : ''}
            ${q.state === 'done' ? '<em class="mu-good">✓ Done</em>' : q.state === 'failed' ? '<em class="mu-bad">✗ Failed</em>' : ''}</article>`;
    };
    const order = ['offered', 'active', 'done', 'failed'];
    const p = questPrefs(); const waitingN = questPool(g).length;
    const chk = (k: string, on: boolean, label: string) => `<label class="mu-check"><input type="checkbox" data-input="rpg-q-pref" data-k="${esc(k)}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
    const how = `<p class="mu-muted">${esc(lex(w, 'quests'))} are found, not handed out: read a quest board (a guild hall, a notice board), ask around where people are, or listen when someone has a favor to ask. The story can give you some too.${waitingN ? ` ${waitingN} from your lorebooks ${waitingN === 1 ? 'is' : 'are'} waiting to be found.` : ''}</p>`;
    const tools = `<details class="mu-quest-tools"><summary>Where quests come from</summary>${chk('story', p.story, 'The story can give and finish quests (one more AI check after each reply)')}${chk('lore', p.lore, 'Quests from the lorebooks (the world\'s, the characters\' and your persona\'s)')}
        <button class="mu-ghost" data-act="rpg-q-lore" ${QS.busy ? 'aria-disabled="true"' : ''}>${QS.busy ? 'Reading the lorebooks…' : 'Read the lorebooks for quests again'}</button></details>`;
    return `${head}<div class="mu-ph-body mu-quests">${how}${list.length ? [...list].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)).map(row).join('') : ''}${tools}</div>`;
}

/** Rows for "Things to do": the quest steps here, offers to take on, someone with a favor, a board, asking for work. */
export function questActs(g: Save, w: WorldDef): string {
    if (!isRpg(w) || !sheetOf(g) || inCombat(g)) return '';
    const out: string[] = [];
    const row = (act: string, ic: string, title: string, small: string, extra = '') => `<button class="mh-act is-quest mh-glass" data-act="${esc(act)}" ${extra}><i>${ic}</i><b>${title}</b><small>${small}</small></button>`;
    for (const q of questsHere(g)) out.push(row('quest-step', '📜', `<span data-notr>${esc(q.steps[q.step].what)}</span>`, `<span data-notr>${esc(q.title)}</span>`, `data-id="${esc(q.id)}"`));
    for (const q of offersHere(g, w)) out.push(row('rpg-q-yes', '📜', `Take on: <span data-notr>${esc(q.title)}</span>`, `${giverOf(g, q) ? `<span data-notr>${esc(giverOf(g, q))}</span> · ` : ''}${q.reward.xp} XP${q.reward.money ? ` · ${money(w, q.reward.money)}` : ''}`, `data-id="${esc(q.id)}"`));
    if (roomForMore(g)) {
        for (const q of favorsHere(g, w).slice(0, 2)) out.push(row('q-hear', '💬', `<span data-notr>${esc(giverOf(g, q))}</span> has a favor to ask`, 'Hear them out · 10 min', `data-id="${esc(q.id)}"`));
        const here = placeOf(g, w, g.player.loc);
        if (isQuestBoard(here) && !searchedToday(g, `board:${here!.id}`)) out.push(row('q-board', '📋', 'Read the quest board', 'Requests for help · 15 min'));
        if (canAsk(g, w) && !searchedToday(g, `help:${g.player.loc}`)) out.push(row('q-ask', '🤝', 'Ask if anyone needs help', `30 min · 🎲 ${chance(g, w, { skill: 'persuasion', dc: ASK_DC, traits: ['Charming', 'Helpful', 'Kind', 'Outgoing', 'Persuasive', 'Talkative'] })}%`));
    }
    return out.join('');
}
// Looking for work takes a while on screen, then what was found; the AI hears it (to tell it if it comes up).
async function looked(label: string, ic: string, r: Found) {
    const c = S(); if (!c) return;
    if (r.minutes > 0) { await doing(label, ic, r.minutes); advance(c.g, c.w, r.minutes).forEach(m => toast(m, 'warn')); }
    if (r.check) setPrompt('mundi_roll', `[Rules — a ${r.check.skill} check, asking for work: d20 ${r.check.d20} ${r.check.bonus >= 0 ? '+' : '−'} ${Math.abs(r.check.bonus)} = ${r.check.total} vs DC ${r.check.dc}: ${r.check.grade.replace('-', ' ')}.]`, 0);
    if (r.text) toast(r.text, r.quests.length ? 'success' : 'info');
    runPlans(); saveGame(); await syncScene();
    if (r.story && state.view === 'scene') setPrompt('mundi_roll', `[Just now: ${r.story} Narrate it in that light if it comes up.]`);
    refreshPrompt(); notify();
}

/* ---------- the grimoire ---------- */

export function grimoireApp(g: Save, w: WorldDef, head: string): string {
    const s = sheetOf(g); const r = rpgOf(w);
    if (!s || !r) return `${head}<div class="mu-ph-body"></div>`;
    const c = classOf(w, s);
    if (!c?.schools?.length) return `${head}<div class="mu-ph-body"><p class="mu-muted">${esc(lex(w, 'notCaster', c?.name ?? 'Your class'))}</p></div>`;
    const known = knownSpells(g, w);
    const learnable = s.learn > 0 ? spellsFor(w, s).filter(x => !s.known.includes(x.id)) : [];
    const school = (id: string) => r.schools.find(x => x.id === id)?.name ?? id;
    return `${head}<div class="mu-ph-body mu-grimoire">
        <section class="mu-ph-card"><small>${esc(r.focusName ?? 'Focus')} ${s.focus}/${focusMax(w, s)}</small>${bar(s.focus, focusMax(w, s), 'is-focus')}
            <small>Prepared ${s.prepared.length}/${maxPrepared(w, s)} · ${canPrepare(g) ? 'you can change them now (after a long rest)' : 'change them after your next long rest'}</small></section>
        ${known.length ? Object.entries(groupBy(known, x => x.school)).map(([sc, list]) => `<section><h4>${esc(school(sc))}</h4>${list.map(sp => {
            const prep = s.prepared.includes(sp.id);
            return `<div class="mu-spell ${prep ? 'is-prep' : ''}"><span><b>${esc(sp.name)}</b><small>Level ${sp.level} · ${sp.cost} ${esc((r.focusName ?? 'focus').toLowerCase())} · ${esc(sp.desc)}</small></span>
                <button class="mu-ghost" data-act="rpg-prep" data-id="${esc(sp.id)}" ${canPrepare(g) ? '' : 'aria-disabled="true"'}>${prep ? 'Prepared' : 'Prepare'}</button>
                <button class="mu-primary" data-act="rpg-cast" data-id="${esc(sp.id)}" ${prep && s.focus >= sp.cost ? '' : 'aria-disabled="true"'}>${lex(w, 'castBtn')}</button></div>`; }).join('')}</section>`).join('') : `<p class="mu-muted">${lex(w, 'noSpells')}</p>`}
        ${learnable.length ? `<section class="mu-branch"><b>${esc(lex(w, 'learnSpells', String(s.learn)))}</b>${learnable.map(sp => `<button class="mu-branch-opt" data-act="rpg-learn" data-id="${esc(sp.id)}"><b>${esc(sp.name)}</b><small>${esc(school(sp.school))} · level ${sp.level} · ${esc(sp.desc)}</small></button>`).join('')}</section>` : ''}
    </div>`;
}
const groupBy = <T>(l: T[], k: (x: T) => string) => l.reduce((o, x) => ((o[k(x)] ??= []).push(x), o), {} as Record<string, T[]>);

/* ---------- the badge by your portrait ---------- */

// The level sits next to your name on your card (a "!" when there is something to choose); a click opens the sheet.
export function levelChip(): string {
    const g = game(); const w = g && getWorld(g.world); const s = sheetOf(g);
    if (!g || !w || !s || !isRpg(w)) return '';
    const ready = pendingSubclass(w, s) || s.points > 0 || s.learn > 0 || ((w.features as any)?.talents !== false && talentPoints(s) > 0 && talentTree(w, s).length > 0);
    return `<button class="mh-lv ${ready ? 'is-ready' : ''}" data-act="rpg-open" title="${esc(lex(w, 'sheet'))}">Lv ${s.level}${ready ? '<em>!</em>' : ''}</button>`;
}
export function rpgOverlays(): string { return ''; }

const S = () => { const g = game(); const w = g && getWorld(g.world); return g && w ? { g, w } : null; };
const done = (m: string, kind: 'info' | 'success' | 'warn' = 'success') => { if (m) toast(m, kind); saveGame(); notify(); };
Object.assign(ACT, {
    'rpg-open': async () => { const p = await import('./phone.js'); p.P.open = true; p.P.app = 'sheet' as any; notify(); },
    'rpg-sub': (el) => { const c = S(); if (c) done(chooseSubclass(c.g, c.w, el.dataset.id!)); },
    'rpg-point': (el) => { const c = S(); if (c && spendPoint(c.g, c.w, el.dataset.id!)) done(''); },
    'rpg-skill': (el) => { const c = S(); if (c && learnSkill(c.g, c.w, el.dataset.id!)) done('Skill learned.'); },
    'rpg-learn': (el) => { const c = S(); if (c && learnSpell(c.g, c.w, el.dataset.id!)) done(lex(c.w, 'spellLearned')); },
    'rpg-prep': (el) => { const c = S(); if (c) done(togglePrepared(c.g, c.w, el.dataset.id!), 'info'); },
    'rpg-cast': (el) => {
        const c = S(); if (!c) return;
        const r = cast(c.g, c.w, el.dataset.id!);
        if (!r.ok) return done(r.text, 'warn');
        if (r.scene) setPrompt('mundi_roll', r.scene, 0);
        r.msgs.forEach(m => toast(m, 'success'));
        done(r.text);
    },
    'rpg-talent': (el) => { const c = S(); if (!c) return; const m = takeTalent(c.g, c.w, el.dataset.id!); done(m, m ? 'warn' : 'success'); },
    'rpg-respec': () => { const c = S(); if (c) done(respec(c.g, c.w), 'info'); },
    'rpg-q-yes': (el) => { const c = S(); if (c) { done(acceptQuest(c.g, el.dataset.id!)); refreshPrompt(); } },
    'rpg-q-no': (el) => { const c = S(); if (c) { declineQuest(c.g, el.dataset.id!); done(''); } },
    'rpg-q-drop': (el) => { const c = S(); if (c) { done(failQuest(c.g, el.dataset.id!, 'you gave up'), 'info'); refreshPrompt(); } },
    'rpg-q-step': (el) => {
        const c = S(); if (!c) return;
        const r = doStep(c.g, c.w, el.dataset.id!, 'story'); if (!r) return;
        r.msgs.forEach(m => toast(m, 'success'));
        done(r.text, r.done ? 'success' : 'info'); refreshPrompt();
    },
    'rpg-q-lore': async () => {
        const c = S(); if (!c || QS.busy) return;
        QS.busy = true; notify();
        try { const m = await readLoreQuests(c.g, c.w, true); done(m || 'No new quests in your lorebooks.', m ? 'success' : 'info'); refreshPrompt(); }
        catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        finally { QS.busy = false; notify(); }
    },
    'q-board': async () => { const c = S(); if (!c || isDoing()) return; await looked('Reading the board', '📋', readBoard(c.g, c.w)); },
    'q-ask': async () => { const c = S(); if (!c || isDoing()) return; await looked('Asking around', '🤝', askForWork(c.g, c.w)); },
    'q-hear': async (el) => { const c = S(); if (!c || isDoing()) return; await looked('Listening', '💬', hearOut(c.g, c.w, el.dataset.id!)); },
});
Object.assign(INPUT, {
    'rpg-q-pref': (el) => { const k = el.dataset.k; if (k === 'story' || k === 'lore') { setQuestPref(k, el.checked); notify(); } },
});
