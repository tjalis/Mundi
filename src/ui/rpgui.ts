// The RPG on screen: the character sheet, quests and the grimoire (as apps of the phone or pages of the journal),
// and a small level / hit points / focus badge by your portrait.
import { esc, game, notify, saveGame, toast, type Save } from '../core/store.js';
import { getWorld, type WorldDef } from '../core/world.js';
import { rpgOf } from '../core/rpgdef.js';
import { lex } from '../core/lexicon.js';
import { icon } from './icons.js';
import { ACT } from './reg.js';
import { placeOf } from '../sim/places.js';
import { money } from '../sim/needs.js';
import { setPrompt } from '../st/bridge.js';
import {
    isRpg, sheetOf, classOf, hpMax, focusMax, mod, prof, attr, skillBonus, trained, xpFor, maxLevel, pendingSubclass, chooseSubclass,
    spendPoint, spellsFor, learnSpell, learnSkill, weaponOf, attrCap, maxPrepared, titleNames, talentTree, talentsOf, talentPoints, tierOpen, canTake, takeTalent, respec,
} from '../sim/rpg.js';
import { quests, acceptQuest, declineQuest } from '../sim/quests.js';
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

export function questsApp(g: Save, w: WorldDef, head: string): string {
    const list = quests(g);
    const row = (q: ReturnType<typeof quests>[number]) => {
        const giver = g.cast[q.giver];
        const st = q.steps[q.step];
        return `<article class="mu-quest is-${q.state}"><header><b>${esc(q.title)}</b><small>${giver?.met ? esc(giver.name) : 'Someone'} · day ${q.due} at the latest</small></header>
            <p>${esc(q.text)}</p>
            ${q.state === 'active' && st ? `<small>Next: ${esc(st.what)} — at ${esc(placeOf(g, w, st.place)?.name ?? '?')}</small>` : ''}
            <small class="mu-muted">Reward: ${q.reward.xp} XP${q.reward.money ? ` · ${money(w, q.reward.money)}` : ''}${q.reward.renown ? ` · ${q.reward.renown} renown` : ''}</small>
            ${q.state === 'offered' ? `<div class="mu-row"><button class="mu-primary" data-act="rpg-q-yes" data-id="${esc(q.id)}">Accept</button><button class="mu-ghost" data-act="rpg-q-no" data-id="${esc(q.id)}">Turn down</button></div>` : ''}
            ${q.state === 'done' ? '<em class="mu-good">✓ Done</em>' : q.state === 'failed' ? '<em class="mu-bad">✗ Failed</em>' : ''}</article>`;
    };
    const order = ['offered', 'active', 'done', 'failed'];
    return `${head}<div class="mu-ph-body mu-quests">${list.length ? [...list].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)).map(row).join('')
        : `<p class="mu-muted">No ${esc(lex(w, 'quests').toLowerCase())} yet. They come from the world: someone sick, a tense town, a rumor, a delivery…</p>`}</div>`;
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
    'rpg-q-yes': (el) => { const c = S(); if (c) done(acceptQuest(c.g, el.dataset.id!)); },
    'rpg-q-no': (el) => { const c = S(); if (c) { declineQuest(c.g, el.dataset.id!); done(''); } },
});
