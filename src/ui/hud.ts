import { lookPanelHtml } from './chatlook.js';
import { lex, appRef } from '../core/lexicon.js';
import { fmtClock, is12h } from '../core/fmt.js';
import { missingCourses, interviewChance, triedToday } from '../sim/skills.js';
import { courseRow } from './courses.js';
import { payOf, lockedOut } from '../sim/bills.js';
// The in-game HUD (the same layout for every style; skins only tint it). Glass panels around the scene:
//   top left    — you: portrait, bar needs (health, energy) and round needs (hunger, thirst, mood, hygiene)
//   top centre  — the clock: time, weekday, weather, part of the day and game day
//   top right   — the menu button, and the map button below it (money is on your card)
//   left        — the people with you in this scene (bond, and how long they stay with you)
//   right       — things to do here (only inside a scene)
//   bottom      — the dialogue box (scene.ts); bottom right: the phone, peeking up when it is closed
import { needWord } from '../sim/life.js';
import { lifeOverlays, soloOf } from './lifeui.js';
import { game, esc, state, UI, saveSettings, notify, nowAbs, clockMode, onPhone, toast, saveGame, hostOf } from '../core/store.js';
import { getWorld, activeStatuses, systemOn, type StatusDef, type WorldDef, deviceLook, offScreenWork, isScenario, HOME_NEEDS, homeNeedsOn } from '../core/world.js';
import { levelChip } from './rpgui.js';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
import type { Save } from '../core/store.js';
import { personaThumb, personaName, thumb, setPrompt } from '../st/bridge.js';
import { personaPickHtml } from './scene.js';
import { detachHtml } from './attach.js';
import { outingHtml } from './outing.js';
import { residentsHtml } from './residents.js';
import { guestDialogsHtml } from './guestsui.js';
import { isOuting } from '../sim/places.js';
import { money, actionsHere, canAfford } from '../sim/needs.js';
import { placeOf, playerHomeId } from '../sim/places.js';
import { traitsOf, jobDef, isOpen } from '../sim/work.js';
import { presentAt } from '../sim/people.js';
import { period, weekday, seasonOf, toNextPeriod } from '../sim/time.js';
import { icon } from './icons.js';
import { featureOn } from '../sim/creator.js';
import { ACT } from './reg.js';
import { houseBar } from './house.js';
import { eventPanelHtml, stayOf } from './events.js';
const stayHere = (g: Save) => { const s = stayOf(g); return !!s && s.where === g.player.loc && s.where !== 'home:player'; };
import { customActionRow, customModalHtml } from './custom.js';
import { doingHtml } from './doing.js';
import { apptActions, apptReminderHtml, conflictHtml } from './appts.js';
import { social, isWith } from '../sim/social.js';
import { bumpHtml } from './bump.js';
import { P as phone, phoneUnread } from './phone.js';
import { PL, facePlanHtml } from './plans.js';
import { relBar } from './relui.js';
import { openNow } from '../sim/daynight.js';
import { questsHere, doStep } from '../sim/quests.js';
import { weatherHere, crowdLevel, crowdWord, regionState, regionOf, moodWord, tensionWord } from '../sim/worldstate.js';
import { chanceOf } from '../sim/dice.js';
import { isRpg, sheetOf, focusMax, hpMax } from '../sim/rpg.js';
import { lifeActs, festivalChip, schoolActs } from './lifeplus.js';
import { factionActs } from './factionsui.js';
import { holdingsActs } from './holdingsui.js';
import { adventureActs } from './adventureui.js';
import { rpgOf } from '../core/rpgdef.js';

/* ---------- you ---------- */

// Health and energy are bars; the other needs are round badges. A world can choose with `hudKind`.
const isBar = (s: StatusDef) => ((s as any).hudKind ? (s as any).hudKind === 'bar' : ['life', 'health', 'energy'].includes(s.id));
const NEED_ICON: Record<string, string> = { life: 'pulse', health: 'pulse', energy: 'bolt', hunger: 'utensils', thirst: 'drop', mood: 'happy', hygiene: 'sparkles' };
const needIcon = (s: StatusDef) => (NEED_ICON[s.id] ? icon(NEED_ICON[s.id]) : `<i>${esc(s.icon)}</i>`);

function personaCard(g: Save, w: WorldDef) {
    const img = personaThumb();
    const shown = activeStatuses(w, g).filter(s => s.hud);
    const v = (s: StatusDef) => Math.round(g.player.stats[s.id] ?? s.start);
    // the card keeps one size: more bars (or more needs) only make the round badges smaller
    // RPG: the focus (mana, chakra…: the world names it) is a bar too, under health and energy
    const sh = isRpg(w) ? sheetOf(g) : null;
    const fName = rpgOf(w)?.focusName ?? 'Focus';
    const focusBar = sh ? (() => { const fv = Math.round((sh.focus / Math.max(1, focusMax(w, sh))) * 100); return `<div class="mh-bar ${fv <= 20 ? 'is-low' : ''}" data-stat="focus" data-word="${esc(`${sh.focus}/${focusMax(w, sh)}`)}" style="--c:#7b5cff;--v:${fv}">
                <span class="mh-bar-ic">${icon('sparkles')}</span><span class="mh-bar-name">${esc(fName)}</span><span class="mh-bar-track"><i></i></span></div>`; })() : '';
    const bars = shown.filter(isBar).length + (sh ? 1 : 0), rings = shown.length - shown.filter(isBar).length;
    const size = bars >= 3 || rings >= 6 ? 'is-tight' : bars === 2 || rings === 5 ? 'is-snug' : '';
    const bare = !shown.length && !sh;   // nothing to look after (needs off): the money goes under the name
    return `<aside class="mh-persona mh-glass ${size} ${bare ? 'no-needs' : ''}" aria-label="${esc(personaName())}">
        <button class="mh-face" data-act="pa-open" title="Play as…">${img ? `<img src="${esc(img)}" alt="">` : icon('user')}<i class="mh-face-swap">${icon('users')}</i></button>
        <div class="mh-needs">
            <div class="mh-who"><b>${esc(personaName())}</b>${levelChip()}${isScenario(w) ? '' : `<span class="mu-cash">${esc(money(w, g.player.money))}</span>`}</div>
            ${shown.filter(isBar).map(s => `<div class="mh-bar ${v(s) <= 20 ? 'is-low' : ''}" data-stat="${esc(s.id)}" data-word="${esc(sh && (s.id === 'life' || s.id === 'health') ? `${sh.hp}/${hpMax(w, sh)} HP` : needWord(s, v(s)))}" style="--c:${esc(s.color)};--v:${v(s)}">
                <span class="mh-bar-ic">${needIcon(s)}</span><span class="mh-bar-name">${esc(s.name)}</span><span class="mh-bar-track"><i></i></span></div>`).join('')}${focusBar}
            <div class="mh-rings">${shown.filter(s => !isBar(s)).map(s => `<div class="mh-ring ${v(s) <= 20 ? 'is-low' : ''}" data-stat="${esc(s.id)}" data-word="${esc(`${s.name}: ${needWord(s, v(s))}`)}" aria-label="${esc(s.name)}" style="--c:${esc(s.color)};--v:${v(s)}">
                <span class="mh-ring-ic">${needIcon(s)}</span><small>${esc(s.name)}</small></div>`).join('')}</div>
        </div></aside>`;
}

/* ---------- the clock ---------- */

export const clock12 = (m: number) => fmtClock(m, false);
export const ampm = (m: number) => (!is12h() ? '' : Math.floor(m / 60) % 24 < 12 ? 'AM' : 'PM');

function clockCard(g: Save, w: WorldDef) {
    const wx = weatherHere(g, w);
    const here = placeOf(g, w, g.player.loc);
    const se = seasonOf(g);
    const where = esc(g.player.loc === playerHomeId ? 'Home' : here?.name ?? '');
    // how busy it is here, and the mood of the region (the living world)
    const reg = systemOn(w, 'living') && g.player.loc !== playerHomeId ? regionState(g, w, regionOf(g, w, g.player.loc)) : null;
    const shut = reg && !openNow(g, w, g.player.loc);
    const crowd = shut ? `<small class="mh-crowd is-closed">${icon('lock')}<span>Closed</span></small>` : reg ? `<small class="mh-crowd" title="${esc(`${cap(crowdWord(crowdLevel(g, w, g.player.loc)))} · Public mood: ${moodWord(reg.mood)} · People are ${tensionWord(reg.tension)}`)}">${icon('users')}<span>${esc(cap(crowdWord(crowdLevel(g, w, g.player.loc))))}</span>${reg.tension >= 50 ? '<i class="mh-tense">!</i>' : ''}</small>` : '';
    // inside a place: one bar across the top (time, day, part of the day, the place, weather and season)
    // (on a phone the clock stays a card beside yours, in a place too)
    if (state.view === 'scene' && !onPhone() && !isScenario(w)) return `<div class="mh-clock mh-glass is-bar" data-act="skip-ask" title="Let time pass" role="button">
        <div class="mh-time"><b data-clock>${clock12(g.minutes)}</b><small data-ampm>${ampm(g.minutes)}</small></div>
        <span class="mh-bar-day"><b data-weekday>${esc(weekday(g.day))}</b><small><span data-period>${esc(period(w, g.minutes).name)}</span> · Day ${g.day}</small></span>
        <span class="mh-bar-place">${icon('pin')}<span class="mh-bar-where"><b>${where}</b>${crowd}${festivalChip(g, w)}</span></span>
        <span class="mh-bar-sky"><span class="mh-weather" title="${esc(wx.name)}">${wx.icon}</span><small class="mh-season" title="Season">${se.name} ${se.icon}</small></span>
    </div>`;
    const home = isScenario(w) ? 'is-home' : '';   // Home: the clock sits at the top left (no card of yours there)
    return `<div class="mh-clock mh-glass ${home}" data-act="skip-ask" title="Let time pass" role="button">
        <div class="mh-clock-top"><div class="mh-time"><b data-clock>${clock12(g.minutes)}</b><small data-ampm>${ampm(g.minutes)}</small></div><span class="mh-sky"><span class="mh-weather" title="${esc(wx.name)}">${wx.icon}</span></span></div>
        <div class="mh-clock-row"><span class="mh-weekday" data-weekday>${esc(weekday(g.day))}</span><small class="mh-season" title="Season">${se.name} ${se.icon}</small></div>
        <div class="mh-clock-strip"><span data-period>${esc(period(w, g.minutes).name)}</span><span>Day ${g.day}</span></div>
        ${isScenario(w) && homeNeedsOn(g) ? clockNeeds(g, w) : ''}
    </div>
    <div class="mh-where ${home}">${icon('pin')}<span>${where}</span>${crowd}${festivalChip(g, w)}</div>`;
}

// Clicking the clock: let time pass (to the next part of the day), after asking.
const SKIP = { ask: false };
function skipAskHtml(g: Save, w: WorldDef) {
    if (!SKIP.ask) return '';
    const next = period(w, (g.minutes + toNextPeriod(w, g.minutes)) % 1440).name;
    return `<div class="mu-dlg-veil" data-act="skip-no"></div><div class="mu-panel mu-dlg mu-glassdlg mu-outback" role="dialog"><h3>Let time pass?</h3>
        <p class="mu-muted">Until the ${esc(next.toLowerCase())}.</p>
        <div class="mu-row mu-dlg-btns"><button data-act="skip-no">Not now</button><button class="mu-primary" data-act="skip-yes">${icon('skip')}<span>Let time pass</span></button></div></div>`;
}

/* ---------- wallet, menu, map ---------- */

let menuOpen = false;
let lookOpen = false;
function corner(g: Save, w: WorldDef) {
    return `<div class="mh-corner">
        <button class="mh-menu mh-glass ${menuOpen ? 'is-on' : ''}" data-act="hud-menu" title="Menu">${icon('menu')}</button>
        ${g.player.job && featureOn(w, 'jobs') && !offScreenWork(w) && g.player.loc !== jobDef(w, g.player.job.id)?.place ? `<button class="mh-mapbtn mh-glass" data-act="go-work" title="Go to work">${icon('briefcase')}<span>Work</span></button>` : ''}
        ${isScenario(w) && isOuting(g.player.loc) ? `<button class="mh-mapbtn mh-glass" data-act="out-move" title="Go on to another place">${icon('map')}<span>Go somewhere else</span></button><button class="mh-mapbtn mh-glass" data-act="out-back" title="Go back home">${icon('home')}<span>Back home</span></button>` : state.view === 'scene' ? `<button class="mh-mapbtn mh-glass" data-act="to-map" title="${state.generating ? 'Wait until they finish speaking' : 'Map'}" ${state.generating ? 'aria-disabled="true"' : ''}>${icon(isScenario(w) ? 'home' : 'map')}<span>${isScenario(w) ? 'Rooms' : 'Map'}</span></button>${isScenario(w) && exitRoom(g, w) ? `<button class="mh-mapbtn mh-glass" data-act="out-open" title="Leave the house for a while">${icon('map')}<span>Go out</span></button>` : ''}` : `<button class="mh-mapbtn mh-glass" data-act="go-home" title="${isScenario(w) ? 'Go to my room' : 'Go home'}">${icon('home')}<span>${isScenario(w) ? 'My room' : 'Home'}</span></button>${isScenario(w) ? `<button class="mh-mapbtn mh-glass" data-act="out-open" title="Leave the house for a while">${icon('map')}<span>Go out</span></button>` : ''}`}
        ${menuOpen ? `<nav class="mh-menu-pop mh-glass">
            <button data-act="open-world">${icon('globe')}<span>${isScenario(w) ? 'This Home' : 'This world'}</span></button>
            ${clockMode(g) === 'live' ? `<button data-act="speed">${icon('pause')}<span>Clock speed: ${g.speed ? `×${g.speed / 60}` : 'paused'}</span></button>` : ''}
            ${!isScenario(w) && g.player.loc !== playerHomeId ? `<button data-act="go-home">${icon('home')}<span>Go home</span></button>` : ''}
            ${isScenario(w) && isOuting(g.player.loc) ? `<button data-act="out-bg-open">${icon('image')}<span>Background</span></button>` : ''}
            ${isScenario(w) ? `<button data-act="res-open">${icon('users')}<span>Who lives here</span></button>` : ''}
            ${isScenario(w) ? `<button data-act="sc-open" data-v="persona"><span class="mh-drawer-mew"><img class="mh-drawer-me" src="${esc(personaThumb())}" alt=""></span><span>Your persona<small data-notr>${esc(personaName())}</small></span></button>` : ''}
            <button data-act="hud-look">${icon('palette')}<span>Chat look</span></button>
            ${hostOf(g) ? `<button data-act="det-open">${icon('undo')}<span>Detach world</span></button>` : ''}
            <button data-act="open-settings">${icon('gear')}<span>Settings</span></button>
            <button data-act="to-menu" data-sfx="back">${icon('back')}<span>Main menu</span></button></nav>` : ''}
        ${lookOpen ? `<div class="mh-lookpop mh-glass" data-keep="look"><header><b>Chat look</b><button class="mu-ibtn mu-ghost" data-act="hud-look">${icon('x')}</button></header>${lookPanelHtml()}</div>` : ''}
    </div>`;
}

/* ---------- people with you ---------- */

// Your party: the people who came along with you (in the scene and on the map). Who is simply in this place is
// shown at the top ("Here").
function peopleColumn(g: Save, w: WorldDef) {
    const list = Object.values(g.cast).filter(r => isWith(g, r.avatar));
    if (!list.length) return '';
    const now = nowAbs(g);
    return `<aside class="mh-people mh-glass" aria-label="With you">${list.map(r => {
        const c = social(g).with.find(x => x.avatar === r.avatar);
        const left = c && !isScenario(w) ? Math.max(0, Math.min(100, ((c.until - now) / 240) * 100)) : null;   // Home: no timer
        return `<button class="mh-person ${PL.card === r.avatar ? 'is-on' : ''} ${c ? 'is-with' : ''} ${soloOf(g) === r.avatar ? 'is-solo' : ''}" data-act="pc-open" data-who="${esc(r.avatar)}" title="${esc(r.met ? r.name : 'Someone')}">
            <img src="${esc(thumb(r.avatar))}" alt=""><b data-notr>${esc(r.met ? r.name : '?')}</b>
            <span class="mh-mini-rel">${relBar(r.avatar, false)}</span>
            ${left !== null ? `<span class="mh-mini is-time" title="With you for a while"><i style="width:${left}%"></i></span>` : ''}</button>`;
    }).join('')}</aside>`;
}

// Who is in this place (not in your party): their pictures under the place's name; a click opens their options.
function hereBar(g: Save, w: WorldDef) {
    if (state.view !== 'scene') return '';
    const list = presentAt(g, w, g.player.loc);   // everyone in the place, the people who came with you too
    if (!list.length) return '';
    return `<nav class="mh-here mh-glass" aria-label="Who is here"><small>Here</small>${list.map(r => `<button class="mh-here-p ${PL.card === r.avatar ? 'is-on' : ''} ${soloOf(g) === r.avatar ? 'is-solo' : ''} ${isWith(g, r.avatar) ? 'is-with' : ''}" data-act="pc-open" data-who="${esc(r.avatar)}" title="${esc(r.met ? r.name : 'Someone')}"><img src="${esc(thumb(r.avatar))}" alt=""><b data-notr>${esc(r.met ? r.name : '?')}</b></button>`).join('')}</nav>`;
}

/* ---------- things to do (inside a scene) ---------- */

function actsColumn(g: Save, w: WorldDef) {
    if (state.view !== 'scene') return '';
    const acts = actionsHere(g, w);
    const jobsOn = featureOn(w, 'jobs');
    const job = jobsOn && g.player.job && w.occupations.find(o => o.id === g.player.job!.id && (o.place === g.player.loc || offScreenWork(w)));
    const jobs = jobsOn && !g.player.job && !offScreenWork(w) ? w.occupations.filter(o => o.place === g.player.loc) : [];   // a scenario: apply on the phone
    const atHome = g.player.loc === playerHomeId;
    const rows = [
        ...apptActions(g, w),
        lifeActs(g, w),
        schoolActs(g, w),
        factionActs(g, w),
        holdingsActs(g, w),
        adventureActs(g, w),
        ...questsHere(g).map(q => `<button class="mh-act is-quest mh-glass" data-act="quest-step" data-id="${esc(q.id)}"><i>📜</i><b>${esc(q.steps[q.step].what)}</b><small>${esc(q.title)}</small></button>`),
        ...(job ? [`<button class="mh-act is-work mh-glass ${offScreenWork(w) ? 'is-outing' : ''}" data-act="work" ${isOpen(g, job) ? '' : 'aria-disabled="true"'}><i>${icon('briefcase')}</i><b>${offScreenWork(w) ? 'Go to work' : 'Work a shift'} · ${job.shift} h</b><small>${isOpen(g, job) ? `${money(w, payOf(g, job.ranks[g.player.job!.rank].pay * job.shift))}` : `Open ${String(job.hours?.[0] ?? 0).padStart(2, '0')}:00–${String(job.hours?.[1] ?? 24).padStart(2, '0')}:00`}</small></button>`] : []),
        ...jobs.map(o => `<button class="mh-act mh-glass" data-act="apply" data-id="${esc(o.id)}" ${missingCourses(g, w, o).length || triedToday(g, o.id) ? 'aria-disabled="true"' : ''}><i>${icon('briefcase')}</i><b>Apply: ${esc(o.name)}</b><small>${missingCourses(g, w, o).length ? `${lex(w, 'needsCourse')}: ${esc(missingCourses(g, w, o).join(', '))}` : `${money(w, payOf(g, o.ranks[0].pay))}/h · interview 🎲 ${interviewChance(g, o, traitsOf(g))}%`}</small></button>`),
        ...(atHome && lockedOut(g) ? [`<button class="mh-act mh-glass is-warn" data-act="ph-open-homes"><i>${icon('home')}</i><b>${lex(w, 'lockedOutShort')}</b><small>${lex(w, 'lockedOutHint', appRef(w, 'homes'))}</small></button>`] : []),
        ...((atHome && !lockedOut(g)) || stayHere(g) ? [`<button class="mh-act mh-glass" data-act="sleep"><i>${icon('moon')}</i><b>Sleep until morning</b><small>${atHome ? 'Rest' : 'Staying the night here'}</small></button>`] : []),
        ...acts.map(a => `<button class="mh-act mh-glass ${a.outing ? 'is-outing' : ''}" data-act="do" data-id="${esc(a.id)}" ${canAfford(g, a) ? '' : 'aria-disabled="true" title="Not enough money"'}><i>${a.icon ?? ''}</i><b>${esc(a.label)}</b><small>${isScenario(w) ? '' : `${a.cost < 0 ? `+${money(w, -a.cost)}` : a.cost ? money(w, a.cost) : 'Free'} · `}${a.minutes} min${a.roll && !isScenario(w) ? ` · 🎲 ${chanceOf(g, a)}% chance` : ''}</small></button>`),
    ];
    { const cr = courseRow(g, w); if (cr) rows.splice(rows.length, 0, cr); }
    rows.push(customActionRow());   // an action you name yourself
    const open = actsOpen();
    return `<aside class="mh-acts ${open ? '' : 'is-closed'}" aria-label="Things to do">
        <button class="mh-acts-head mh-glass" data-act="dock-toggle">${icon(open ? 'up' : 'down')}<span>Things to do</span>${onPhone() ? `<em>${rows.length}</em>` : ''}</button>
        ${open ? `<div class="mh-acts-list" data-keep="dock">${rows.join('')}</div>` : ''}</aside>`;
}

// On a phone the list is a sheet over the scene: closed until you open it, and it closes again after a choice.
let actsPhone = false;
const actsOpen = () => (onPhone() ? actsPhone : (UI() as any).actsOpen !== false);

/* ---------- the phone (or the journal), closed ---------- */

function phoneButton(w: WorldDef) {
    if (!w.features?.phone || phone.open) return '';
    const n = phoneUnread();
    if (deviceLook(w) === 'book') return `<button class="mh-bookbtn mh-glass" data-act="phone" title="${esc(w.features.device ?? 'Journal')}">${icon('book')}${n ? `<em>${n}</em>` : ''}</button>`;
    return `<button class="mh-peek" data-act="phone" title="${esc(w.features.device ?? 'Phone')}"><span class="mh-peek-notch"></span><span class="mh-peek-ic">${icon('phone')}</span><span class="mh-peek-screen">
        <i style="--c:#7fd3ff">${icon('chat')}</i><i style="--c:#ff9ac1">${icon('heart')}</i><i style="--c:#b6a6ff">${icon('users')}</i>
        <i style="--c:#9be7c4">${icon('wallet')}</i><i style="--c:#ffc58a">${icon('calendar')}</i><i style="--c:#ffd36e">${icon('briefcase')}</i></span>${n ? `<em>${n}</em>` : ''}</button>`;
}

export function hudHtml() {
    const g = game(); const w = g && getWorld(g.world);
    if (!g || !w) return '';
    // Home: no card of your own (no money, no needs); your persona is in the menu, as in a chat
    return `${isScenario(w) ? '' : personaCard(g, w)}${houseBar(g, w)}${clockCard(g, w)}${corner(g, w)}${eventPanelHtml(g, w)}${hereBar(g, w)}${peopleColumn(g, w)}${actsColumn(g, w)}${phoneButton(w)}${bumpHtml()}${apptReminderHtml(g, w)}${conflictHtml(g, w)}${facePlanHtml()}${customModalHtml()}${skipAskHtml(g, w)}${detachHtml()}${personaPickHtml()}${isScenario(w) ? `${outingHtml()}${residentsHtml()}${guestDialogsHtml()}` : ''}${doingHtml()}${lifeOverlays()}`;
}

Object.assign(ACT, {
    'quest-step': (el) => {
        const g = game(); const w = g && getWorld(g.world); if (!g || !w) return;
        const r = doStep(g, w, el.dataset.id!); if (!r) return;
        if (r.check) setPrompt('mundi_roll', `[Rules — a ${r.check.skill} check for a quest: d20 ${r.check.d20} ${r.check.bonus >= 0 ? '+' : '−'} ${Math.abs(r.check.bonus)} = ${r.check.total} vs DC ${r.check.dc}: ${r.check.grade.replace('-', ' ')}. Narrate {{user}} ${r.check.grade.includes('success') ? 'succeeding' : 'failing'} at it.]`, 0);
        toast(r.text, r.done ? 'success' : r.fight ? 'warn' : 'info'); r.msgs.forEach(m => toast(m, 'success'));
        saveGame(); notify();
    },
});
Object.assign(ACT, {
    'dock-toggle': () => { if (onPhone()) { actsPhone = !actsPhone; notify(); return; } (UI() as any).actsOpen = (UI() as any).actsOpen === false; saveSettings(); notify(); },
    'hud-menu': () => { menuOpen = !menuOpen; lookOpen = false; notify(); },   // the menu replaces Chat look
    'hud-look': () => { lookOpen = !lookOpen; notify(); },
    'skip-ask': () => { if (state.generating) { toast('Wait until they finish speaking.', 'info'); return; } SKIP.ask = true; notify(); },
    'skip-no': () => { SKIP.ask = false; notify(); },
    'skip-yes': async () => { SKIP.ask = false; notify(); await ACT.skip?.(document.body, undefined as any); },
});
// the menu closes after a choice in it, or a click anywhere else
document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (actsPhone && onPhone() && !t.closest?.('.mh-acts-head') && (t.closest?.('.mh-acts-list button') || !t.closest?.('.mh-acts'))) { actsPhone = false; setTimeout(notify, 0); }
    if (!menuOpen) return;
    if ((e.target as HTMLElement).closest?.('[data-act="hud-menu"]')) return;
    menuOpen = false;
    setTimeout(notify, 0);
}, true);

// Home: the garage and the front door are where you leave the house from (Go out there too, not only on the plan).
function exitRoom(g: Save, w: WorldDef): boolean {
    const p = placeOf(g, w, g.player.loc);
    return !!p && !p.link && /garage|garagem|garaje|entrance|entry|front ?yard|foyer|porch|vestib|entrada|recibidor/i.test(`${p.id} ${p.name}`);
}

// Home with needs on: their icons under the clock, each a ring that empties as it drops (the word on hover).
function clockNeeds(g: Save, w: WorldDef): string {
    const list = activeStatuses(w, g).filter(s => HOME_NEEDS.includes(s.id));
    return `<div class="mh-clock-needs" data-act="needs-info">${list.map(s => { const v = Math.round(g.player.stats[s.id] ?? s.start); return `<span class="mh-cneed ${v <= 20 ? 'is-low' : ''}" title="${esc(`${s.name}: ${needWord(s, v)}`)}" style="--c:${esc(s.color)};--v:${Math.max(0, Math.min(100, v))}">${needIcon(s)}</span>`; }).join('')}</div>`;
}
Object.assign(ACT, { 'needs-info': () => { /* (the needs under the clock: a tap does not let time pass) */ } });
