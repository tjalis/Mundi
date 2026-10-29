// Combat on screen: the fight screen (monster-battle style) and the Party app (formation, companions, sellswords).
import { lex } from '../core/lexicon.js';
import { safeUrl } from '../core/safe.js';
import { esc, game, notify, saveGame, toast, type Save } from '../core/store.js';
import { getWorld, worldFile, type WorldDef } from '../core/world.js';
import { rpgOf } from '../core/rpgdef.js';
import { ACT } from './reg.js';
import { thumb, setPrompt, personaThumb } from '../st/bridge.js';
import { placeOf } from '../sim/places.js';
import { pictureAt } from '../sim/daynight.js';
import { money } from '../sim/needs.js';
import { presentAt } from '../sim/people.js';
import { sheetOf, isRpg } from '../sim/rpg.js';
import { isDown } from '../sim/wounds.js';
import {
    combatOf, current, yourTurn, targetsFor, standing, healable, chooseMode, act, combatSpells, closeCombat, type Combat, type Fighter,
} from '../sim/combat.js';
import {
    partyOf, friends, mercs, memberName, memberKey, canJoin, join, leave, setRow, forHire, hire, dismissMerc, hiringHere,
    MAX_FRIENDS, MAX_MERCS, type Row,
} from '../sim/party.js';

// The fight screen, like a monster-battle game: the place as the backdrop, the foes on their ground up and to the
// right (back row further away), your party down and to the left, name / level / HP boxes, a text box that tells
// what happens one line at a time (with the bars moving), and a 2×2 menu on your turn.
type Menu = 'main' | 'fight' | 'magic';
const UI = { id: '', seen: 0, menu: 'main' as Menu, pick: '' as '' | 'attack' | 'ability' | `cast:${string}` };
const FOE_ICON: Record<string, string> = { wolf: '🐺', bandit: '🗡️', archer: '🏹', thug: '👊', boar: '🐗', captain: '⚔️', cultist: '🕯️', bear: '🐻' };
const hpPct = (hp: number, max: number) => Math.max(0, Math.min(100, (hp / Math.max(1, max)) * 100));
const hpTone = (p: number) => (p > 50 ? 'is-ok' : p > 20 ? 'is-mid' : 'is-low');

function backdrop(g: Save, w: WorldDef, where: string): string {
    const p = placeOf(g, w, where);
    let img = p ? pictureAt(w, g.minutes, p.bg, w.places.find(x => x.id === p.id)?.bgs) ?? '' : '';
    if (!img && p?.home) { const k = w.homes.kinds[p.id === 'home:player' ? g.player.home.kind : (w.homes.zones.find(z => z.id === g.cast[p.id.slice(5)]?.home.zone)?.kind ?? '')]; img = (k && pictureAt(w, g.minutes, k.image, k.images)) ?? ''; }
    if (!img && p) { const m = w.maps.find(x => x.id === p.map); img = m ? pictureAt(w, g.minutes, m.image, m.images) ?? '' : ''; }
    return img ? `background-image:url('${safeUrl(worldFile(w, img))}')` : '';
}
function sprite(g: Save, w: WorldDef, c: Combat, f: Fighter, hp: number, hit: boolean, targets: Set<string>): string {
    const foe = f.who === 'foe' ? rpgOf(w)?.bestiary?.find(x => x.id === f.ref) : null;
    const face = f.who === 'foe' ? `<i>${esc(foe?.icon || FOE_ICON[f.ref] || '☠️')}</i>`
        : f.who === 'friend' ? `<img src="${esc(thumb(f.ref))}" alt="">` : f.icon ? `<i>${esc(f.icon)}</i>` : f.who === 'you' && personaThumb() ? `<img src="${esc(personaThumb())}" alt="">` : `<i>${f.who === 'merc' ? '⚔️' : '★'}</i>`;
    const now = current(c)?.id === f.id && !c.over;
    const can = targets.has(f.id);
    return `<button class="mu-pkb-sprite is-${f.side} ${(c.mortal ? isDown(hp, f.max) : hp <= 0) ? 'is-down' : ''} ${c.mortal && hp <= 0 ? 'is-dead' : ''} ${now ? 'is-now' : ''} ${hit ? 'is-hit' : ''} ${can ? 'is-target' : ''}" ${can ? `data-act="fight-target" data-id="${esc(f.id)}"` : 'tabindex="-1"'} title="${esc(f.name)}">${face}<span></span></button>`;
}
function infoBox(c: Combat, f: Fighter, hp: number, targets: Set<string>): string {
    const p = hpPct(hp, f.max); const can = targets.has(f.id);
    const chips = [f.defend ? '🛡️' : '', f.shield ? '✨' : '', f.hidden ? '👤' : '', c.mark?.on === f.id ? '🎯' : '', f.inspired ? '🎵' : '', f.rage ? '🔥' : ''].join('');
    return `<${can ? `button data-act="fight-target" data-id="${esc(f.id)}"` : 'div'} class="mu-pkb-info ${(c.mortal ? isDown(hp, f.max) : hp <= 0) ? 'is-down' : ''} ${can ? 'is-target' : ''} ${current(c)?.id === f.id && !c.over ? 'is-now' : ''}">
        <b data-notr>${esc(f.name)}${chips ? ` <em>${chips}</em>` : ''}</b><small>Lv${f.level}</small>
        <span class="mu-pkb-hp"><i>HP</i><span><s class="${hpTone(p)}" style="width:${p}%"></s></span></span>
        ${f.side === 'us' ? `<small class="mu-pkb-num">${Math.max(0, hp)}/${f.max}</small>` : ''}</${can ? 'button' : 'div'}>`;
}

export function combatHtml(): string {
    const g = game(); const w = g && getWorld(g.world); const c = combatOf(g);
    if (!g || !w || !c) return '';
    if (UI.id !== c.id) { UI.id = c.id; UI.seen = 0; UI.menu = 'main'; UI.pick = ''; }
    const frames = c.frames ?? [];
    const queue = frames.filter(f => f.n > UI.seen);
    const shown = queue[0];
    const prev = shown ? [...frames].reverse().find(f => f.n < shown.n) : null;
    const hpOf = (f: Fighter) => (shown ? shown.hp[f.id] ?? f.hp : f.hp);
    const hitNow = (f: Fighter) => !!shown && !!prev && (shown.hp[f.id] ?? 0) < (prev.hp[f.id] ?? 0);
    const me = c.list.find(f => f.id === 'you')!;
    const mine = yourTurn(c) && !shown;
    let targets = new Set<string>();
    if (mine && UI.pick) {
        if (UI.pick === 'attack') targets = new Set(targetsFor(c, me).map(f => f.id));
        else if (UI.pick === 'ability') targets = new Set(targetsFor(c, me, true).map(f => f.id));
        else {
            const sp = combatSpells(g, w).find(x => `cast:${x.id}` === UI.pick);
            targets = new Set((sp?.effect.kind === 'heal' ? healable(c, 'us') : sp?.school === 'abjuration' ? standing(c, 'us') : targetsFor(c, me, true)).map(f => f.id));
        }
    }
    const side = (s: 'us' | 'them', row: Row) => c.list.filter(f => f.side === s && f.row === row).map(f => sprite(g, w, c, f, hpOf(f), hitNow(f), targets)).join('');
    const field = `<div class="mu-pkb-field">
        <div class="mu-pkb-ground is-them"><div class="mu-pkb-row is-back">${side('them', 'back')}</div><div class="mu-pkb-row is-front">${side('them', 'front')}</div></div>
        <div class="mu-pkb-ground is-us"><div class="mu-pkb-row is-front">${side('us', 'front')}</div><div class="mu-pkb-row is-back">${side('us', 'back')}</div></div>
        <div class="mu-pkb-box is-them">${c.list.filter(f => f.side === 'them').map(f => infoBox(c, f, hpOf(f), targets)).join('')}</div>
        <div class="mu-pkb-box is-us">${c.list.filter(f => f.side === 'us').map(f => infoBox(c, f, hpOf(f), targets)).join('')}</div>
        ${c.mode ? `<small class="mu-pkb-round">Round ${c.round}</small>` : ''}</div>`;
    // the text box and the menu
    const s = sheetOf(g)!; const focusName = rpgOf(w)?.focusName ?? 'Focus';
    const B = (act: string, label: string, extra = '', sub = '') => `<button data-act="${esc(act)}" ${extra}>${label}${sub ? `<small>${sub}</small>` : ''}</button>`;
    let text = ''; let menu = '';
    if (shown) {
        text = `<p>${esc(shown.text)}</p><button class="mu-pkb-next" data-act="pkb-next" title="Next">▼</button>`;
        menu = queue.length > 1 ? `<div class="mu-pkb-menu is-one">${B('pkb-skip', 'SKIP ▶▶', '', `${queue.length} more`)}</div>` : '';
    } else if (c.over) {
        const head = c.over === 'won' ? '🏆 Victory!' : c.over === 'fled' ? '🏃 You got away.' : c.mortal ? '☠️ You lost the fight…' : '☠️ You were defeated…';
        text = `<p><b>${head}</b> ${(c.msgs ?? []).map(m => esc(m)).join(' ')}</p>`;
        menu = `<div class="mu-pkb-menu is-one">${B('fight-close', 'CONTINUE')}</div>`;
    } else if (!c.mode) {
        text = '<p>How do you want to fight?</p>';
        menu = `<div class="mu-pkb-menu">${B('fight-mode', 'TURN BY TURN', 'data-v="tactical"', 'you choose every move')}${B('fight-mode', 'AS A STORY', 'data-v="quick"', 'the AI tells it')}</div>`;
    } else if (mine && UI.pick) {
        text = `<p>${UI.pick === 'attack' ? 'Who do you attack?' : UI.pick === 'ability' ? `${esc(me.ability?.name ?? '')}: on whom?` : 'On whom?'}${UI.pick === 'attack' && !me.ranged ? ' <small>(a blade reaches only the front row while it stands)</small>' : ''}</p>`;
        menu = `<div class="mu-pkb-menu is-one">${B('pkb-back', 'BACK')}</div>`;
    } else if (mine && UI.menu === 'fight') {
        text = `<p>${esc(me.weapon)}: ${me.dice}d${me.sides}${me.dmg ? `${me.dmg > 0 ? '+' : ''}${me.dmg}` : ''} · ${me.ranged ? 'reaches anyone' : 'melee'}</p>`;
        menu = `<div class="mu-pkb-menu">${B('fight-pick', `⚔️ ${esc(me.weapon.toUpperCase())}`, 'data-v="attack"', 'attack')}${B('fight-defend', '🛡️ DEFEND', '', '+2 armor')}${B('pkb-back', 'BACK', 'class="is-back"')}</div>`;
    } else if (mine && UI.menu === 'magic') {
        const spells = combatSpells(g, w);
        text = `<p>${esc(focusName)}: ${s.focus}. ${spells.length ? lex(w, 'whichSpell') : lex(w, 'noFightSpell')}</p>`;
        menu = `<div class="mu-pkb-menu is-list">${spells.map(sp => B('fight-pick', `${lex(w, 'spellIcon')} ${esc(sp.name)}`, `data-v="cast:${esc(sp.id)}" ${s.focus >= sp.cost ? '' : 'aria-disabled="true"'} title="${esc(sp.desc)}"`, `${sp.cost} ${esc(focusName.toLowerCase())}`)).join('')}${B('pkb-back', 'BACK', 'class="is-back"')}</div>`;
    } else if (mine) {
        text = `<p>What will <b>you</b> do?</p>`;
        const casts = combatSpells(g, w).length > 0;
        menu = `<div class="mu-pkb-menu">${B('pkb-menu', 'FIGHT', 'data-v="fight" class="is-fight"')}${me.ability ? B('fight-ability', esc(me.ability.name.toUpperCase()), `class="is-ability" title="${esc(me.ability.desc ?? '')}" ${me.used ? 'aria-disabled="true"' : ''}`, me.used ? 'used' : 'once a fight') : B('fight-defend', 'DEFEND', 'class="is-ability"')}${B('pkb-menu', lex(w, 'magicMenu'), `data-v="magic" class="is-magic" ${casts ? '' : 'aria-disabled="true"'}`)}${B('fight-flee', 'RUN', 'class="is-run"')}</div>
            <button class="mu-pkb-story" data-act="fight-mode" data-v="quick" title="Let the engine play out the rest">📜 Finish as a story</button>`;
    } else text = '<p>…</p>';
    return `<div class="mu-pkb-veil"><section class="mu-pkb" role="dialog" aria-label="Fight" style="${backdrop(g, w, c.where)}">
        ${field}<div class="mu-pkb-bottom"><div class="mu-pkb-text" ${shown ? 'data-act="pkb-next"' : ''}>${text}</div>${menu}</div></section></div>`;
}

const S = () => { const g = game(); const w = g && getWorld(g.world); return g && w ? { g, w } : null; };
const after = (lines: string[]) => { UI.pick = ''; UI.menu = 'main'; void lines; saveGame(); notify(); };
Object.assign(ACT, {
    'pkb-next': () => { const c = combatOf(game()); const next = (c?.frames ?? []).find(f => f.n > UI.seen); if (next) UI.seen = next.n; notify(); },
    'pkb-skip': () => { const c = combatOf(game()); UI.seen = c?.fn ?? UI.seen; notify(); },
    'pkb-menu': (el) => { UI.menu = (el.dataset.v as Menu) || 'main'; UI.pick = ''; notify(); },
    'pkb-back': () => { if (UI.pick) UI.pick = ''; else UI.menu = 'main'; notify(); },
    'fight-mode': (el) => { const c = S(); if (c) after(chooseMode(c.g, c.w, el.dataset.v as 'tactical' | 'quick')); },
    'fight-pick': (el) => {
        const c = S(); if (!c) return;
        UI.pick = (el.dataset.v ?? '') as typeof UI.pick;
        notify();
    },
    'fight-target': (el) => {
        const c = S(); if (!c || !UI.pick) return;
        const id = el.dataset.id!;
        const r = UI.pick === 'attack' ? act(c.g, c.w, { kind: 'attack', target: id })
            : UI.pick === 'ability' ? act(c.g, c.w, { kind: 'ability', target: id })
                : act(c.g, c.w, { kind: 'cast', spell: UI.pick.slice(5), target: id });
        after(r);
    },
    'fight-defend': () => { const c = S(); if (c) after(act(c.g, c.w, { kind: 'defend' })); },
    'fight-ability': () => {
        const c = S(); if (!c) return; const f = combatOf(c.g)?.list.find(x => x.id === 'you');
        if (!f?.ability || f.used) return;
        if (f.ability.kind === 'mark') { UI.pick = 'ability'; notify(); return; }
        after(act(c.g, c.w, { kind: 'ability' }));
    },
    'fight-flee': () => { const c = S(); if (c) after(act(c.g, c.w, { kind: 'flee' })); },
    'fight-close': () => {
        const c = S(); if (!c) return;
        const fight = combatOf(c.g);
        const story = fight?.mode === 'quick' ? ` What happened, blow by blow: ${fight.log.slice(1, 14).join(' ')}` : '';
        const sum = closeCombat(c.g);
        if (sum) setPrompt('mundi_roll', `[Rules — a fight just ended. ${sum}${story} Narrate it from {{user}}'s point of view; do not change the outcome.]`, 0);
        saveGame(); notify();
    },
});

/* ---------- the Party app ---------- */

export function partyApp(g: Save, w: WorldDef, head: string): string {
    if (!isRpg(w) || !sheetOf(g)) return `${head}<div class="mu-ph-body"><p class="mu-muted">Only in the RPG.</p></div>`;
    const cls = (id: string) => rpgOf(w)?.classes.find(c => c.id === id)?.name ?? '';
    const list = partyOf(g).members.filter(m => !m.avatar || g.cast[m.avatar]);
    const row = (key: string, r: Row) => `<span class="mu-row mu-party-rows"><small>${r === 'front' ? 'Front row' : 'Back row'}</small><button class="mu-ghost" data-act="party-row" data-id="${esc(key)}" data-v="${r === 'front' ? 'back' : 'front'}">Move to the ${r === 'front' ? 'back' : 'front'} row</button></span>`;
    const members = list.length ? list.map(m => `<div class="mu-ph-job mu-party-m">${m.avatar ? `<img src="${esc(thumb(m.avatar))}" alt="">` : '<i class="mu-party-merc">⚔</i>'}
        <span><b data-notr>${esc(memberName(g, m))}</b><small>${esc(cls(m.cls))}${m.merc ? ` · level ${m.merc.level} · ${esc(money(w, m.merc.wage))}/day` : ''}${m.hp !== undefined ? ' · wounded' : ''}</small>${row(memberKey(m), m.row)}</span>
        <button class="mu-ghost" data-act="${m.merc ? 'party-dismiss' : 'party-leave'}" data-id="${esc(memberKey(m))}">${m.merc ? 'Dismiss' : 'Part ways'}</button></div>`).join('')
        : '<p class="mu-muted">You travel alone. People who trust you (bond 40+) can join you; sellswords can be hired at a tavern or an inn.</p>';
    const here = presentAt(g, w, g.player.loc).filter(r => r.met && !list.some(m => m.avatar === r.avatar));
    const invite = here.length ? `<section><h4>Ask to join (here)</h4>${here.map(r => { const why = canJoin(g, w, r.avatar); return `<div class="mu-ph-job"><img src="${esc(thumb(r.avatar))}" alt=""><span><b data-notr>${esc(r.name)}</b><small>${why ? esc(why) : 'Ready to follow you'}</small></span>
        <button class="mu-primary" data-act="party-join" data-id="${esc(r.avatar)}" ${why ? 'aria-disabled="true"' : ''}>Invite</button></div>`; }).join('')}</section>` : '';
    const hireList = hiringHere(w, g.player.loc) ? forHire(g, w) : [];
    const hireHtml = hireList.length ? `<section><h4>${esc(lex(w, 'mercs'))}</h4><small class="mu-muted">Not people of the world: hired hands. Paid every day; unpaid, they leave; fallen, they are gone for good.</small>${hireList.map(m => `<div class="mu-ph-job"><i class="mu-party-merc">⚔</i><span><b data-notr>${esc(m.name)}</b><small>${esc(cls(m.cls))} · level ${m.level} · ${esc(money(w, m.wage))}/day</small></span>
        <button class="mu-primary" data-act="party-hire" data-id="${esc(m.id)}" ${mercs(g).length >= MAX_MERCS || g.player.money < m.wage ? 'aria-disabled="true"' : ''}>Hire</button></div>`).join('')}</section>` : '';
    return `${head}<div class="mu-ph-body mu-party">
        <section class="mu-ph-card"><small>Companions ${friends(g).length}/${MAX_FRIENDS} · Sellswords ${mercs(g).length}/${MAX_MERCS}</small>
            <small class="mu-muted">Front row: takes the blows, reaches with blades. Back row: bows and spells, safe while the front row stands. A heavily armored front row covers the back (+1 armor); friends close to you (bond 60+) fight as one (+1 to hit on the same foe); a bard quickens everyone.</small></section>
        <section><h4>Your party</h4>${members}</section>${invite}${hireHtml}</div>`;
}
const done = (m: string, kind: 'info' | 'success' | 'warn' = 'success') => { if (m) toast(m, kind); saveGame(); notify(); };
Object.assign(ACT, {
    'party-row': (el) => { const c = S(); if (c) { setRow(c.g, el.dataset.id!, el.dataset.v as Row); done(''); } },
    'party-join': (el) => { const c = S(); if (!c) return; const why = join(c.g, c.w, el.dataset.id!); done(why || `${c.g.cast[el.dataset.id!]?.name} joins your party.`, why ? 'warn' : 'success'); },
    'party-leave': (el) => { const c = S(); if (c) { leave(c.g, el.dataset.id!); done('You part ways.', 'info'); } },
    'party-dismiss': (el) => { const c = S(); if (c) { dismissMerc(c.g, el.dataset.id!); done(lex(c.w, 'mercLeaves'), 'info'); } },
    'party-hire': (el) => { const c = S(); if (c) { const m = hire(c.g, c.w, el.dataset.id!); done(m, /Not enough|at a time/.test(m) ? 'warn' : 'success'); } },
});
