import { relOverlays, endConfirmHtml } from './relui.js';
// Screens for the Life-Sim systems: the elevator of apartment buildings, invitations from people, the shop and
// goals apps, throwing a party, talking with only one person, and playing as someone else.
import { currentHappening, answer } from '../sim/happenings.js';
import { offerHtml } from './storypeople.js';
import { esc, game, toast, notify, saveGame, nowAbs, state, type Save } from '../core/store.js';
import { countUp } from '../sim/skills.js';
import { getWorld, type WorldDef } from '../core/world.js';
import { styleOf } from '../core/world.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';
import { money, usualPay } from '../sim/needs.js';
import { placeOf, playerHomeId } from '../sim/places.js';
import { residents, whereNow } from '../sim/people.js';
import { social, bondOf, bump } from '../sim/social.js';
import { add, check, earliest, HANGOUT_BOND } from '../sim/plans.js';
import { note } from '../sim/facts.js';
import { syncScene } from '../sim/game.js';
import { houseParty, partyRooms, throwHouseParty, cancelHouseParty, PARTY_HOURS } from '../sim/houseparty.js';
import { partyExtraHtml, partyCardExtra, partyCardButtons } from './guestsui.js';
import { rememberOutingBg } from '../sim/outing.js';
import { shopPrice, shopItems, hasItem, buy, ASPIRATIONS, aspirationOf, setAspiration, lifeOf, pendingInvite, clearInvite, activeFeelings } from '../sim/life.js';
import { thumb, charOf, personaName, personaThumb } from '../st/bridge.js';
import { swapOf, switchTo, roster, isGone } from '../sim/playas.js';
import { refreshPrompt } from '../sim/prompt.js';
import { weekday } from '../sim/time.js';
import { fmtClock as hm } from '../core/fmt.js';

/* ---------- the elevator (41) ---------- */

export const ELEV = { on: false, floors: 0, floor: 0, door: 0, at: 1 };
export function startElevator(g: Save, w: WorldDef, loc: string) {
    const home = loc === playerHomeId ? g.player.home : loc.startsWith('home:') ? g.cast[loc.slice(5)]?.home : null;
    if (!home) return;
    const zone = w.homes.zones.find(z => z.id === home.zone);
    const kind = loc === playerHomeId ? g.player.home.kind : zone?.kind;
    if (!String(kind ?? '').startsWith('apartment') || !zone) return;   // any kind of apartment has an elevator
    const n = home.n ?? 1;
    Object.assign(ELEV, { on: true, floors: Math.max(2, Math.ceil(zone.spots.length / 2)), floor: Math.ceil(n / 2), door: n, at: 1 });
}
function elevatorHtml() {
    if (!ELEV.on || state.view !== 'scene') return '';
    return `<div class="mh-modal-veil"><div class="mh-elev mh-glass" role="dialog" aria-label="Elevator">
        <header>${icon('up')}<b>Elevator</b><small>Floor ${ELEV.at}</small></header>
        <p>Apartment ${ELEV.door} is on floor ${ELEV.floor}.</p>
        <div class="mh-elev-btns">${Array.from({ length: ELEV.floors }, (_, i) => ELEV.floors - i).map(f => `<button class="${f === ELEV.at ? 'is-on' : ''}" data-act="elev" data-f="${esc(f)}">${f}</button>`).join('')}</div>
        <button class="mu-ghost" data-act="elev-skip">Take the stairs</button></div></div>`;
}

/* ---------- an invitation from someone (45) ---------- */

function inviteHtml(g: Save, w: WorldDef) {
    const inv = pendingInvite(g);
    const r = inv && g.cast[inv.avatar];
    if (!inv || !r) return '';
    const d = Math.floor(inv.from / 1440);
    const when = `${d === g.day ? 'today' : d === g.day + 1 ? 'tomorrow' : weekday(d)} at ${hm(inv.from % 1440)}`;
    return `<div class="mh-invite mh-glass" role="dialog"><img src="${esc(thumb(r.avatar))}" alt="">
        <div><b data-notr>${esc(r.name)}</b><p>${inv.kind === 'date' ? 'Asks you out on a date' : 'Invites you to meet up'}: <b data-notr>${esc(placeOf(g, w, inv.place)?.name ?? '')}</b>, ${esc(when)}.</p></div>
        <div class="mh-invite-btns"><button class="mu-primary" data-act="inv-yes">Accept</button><button data-act="inv-no">Decline</button></div></div>`;
}

/* ---------- something comes to you: a neighbor at the door, a friend asking advice, a big moment (phase 4) ---------- */

function happeningHtml(g: Save) {
    const h = currentHappening(g); const r = h && g.cast[h.avatar];
    if (!h || !r) return '';
    return `<div class="mh-invite mh-happen mh-glass is-${h.kind}" role="dialog"><img src="${esc(thumb(r.avatar))}" alt="">
        <div><b data-notr>${esc(r.met ? r.name : 'Someone')}</b><p data-notr>${esc(h.text)}</p></div>
        <div class="mh-invite-btns">${h.choices.map(([c, label], i) => `<button class="${i ? '' : 'mu-primary'}" data-act="hap" data-id="${esc(h.id)}" data-c="${esc(c)}">${esc(label)}</button>`).join('')}</div></div>`;
}

/* ---------- sleeping, or a day going by (25) ---------- */

const FX = { title: '', sub: '', kind: 'night', until: 0 };
export function showTransition(title: string, sub: string, kind: 'night' | 'time' | 'work' = 'night') {
    Object.assign(FX, { title, sub, kind, until: Date.now() + 2800 });
    setTimeout(notify, 2900);
}
function transitionHtml() {
    if (Date.now() > FX.until) return '';
    const orb = FX.kind === 'work' ? '<span class="mh-fx-work"><i></i><i></i></span>' : '<span class="mh-fx-orb"></span>';
    return `<div class="mh-fx is-${FX.kind}" style="animation-delay:-${2800 - (FX.until - Date.now())}ms">${orb}<b>${esc(FX.title)}</b><small>${esc(FX.sub)}</small></div>`;
}

export function lifeOverlays() {
    const g = game(); const w = g && getWorld(g.world);
    if (!g || !w) return '';
    return `${elevatorHtml()}${inviteHtml(g, w) || happeningHtml(g) || offerHtml(g)}${playAsHtml(g)}${transitionHtml()}${relOverlays()}${endConfirmHtml()}`;
}

/* ---------- phone apps: shop and goals ---------- */

export function shopApp(g: Save, w: WorldDef, head: string) {
    return `${head}<div class="mu-ph-body mu-shop">${shopItems(w).map(it => `<article class="mu-shop-item">
        <i>${it.icon}</i><span><b>${esc(it.name)}</b><small>${esc(it.desc)}</small><small class="mu-shop-price">${money(w, shopPrice(g, w, it))}</small></span>
        ${hasItem(g, it.id) ? '<em>Owned</em>' : `<button data-act="shop-buy" data-id="${esc(it.id)}" ${g.player.money >= shopPrice(g, w, it) ? '' : 'aria-disabled="true"'}>Buy</button>`}</article>`).join('')}</div>`;
}
export function goalsApp(g: Save, w: WorldDef, head: string) {
    const cur = aspirationOf(g); const l = lifeOf(g);
    const bar = (have: number, need: number) => `<span class="mu-bond"><i style="width:${Math.max(0, Math.min(100, (have / need) * 100))}%"></i></span>`;
    return `${head}<div class="mu-ph-body">
        ${cur ? (() => { const [h, n] = cur.check(g, w); const done = (l.aspDone ?? []).includes(cur.id); return `<section class="mu-ph-card"><small>Your life goal</small><b>${cur.icon} ${esc(cur.name)}</b><small>${esc(cur.desc)}</small>${bar(h, n)}<small>${done ? 'Reached!' : `${Math.min(h, n).toLocaleString('en-US')} / ${n.toLocaleString('en-US')}`}</small></section>`; })() : '<p class="mu-muted">Pick a life goal. It guides your days, and the story knows about it.</p>'}
        <h4>Life goals</h4>
        ${ASPIRATIONS.map(a => `<button class="mu-goal ${cur?.id === a.id ? 'is-on' : ''}" data-act="goal-set" data-id="${esc(a.id)}"><i class="mu-goal-ic">${a.icon}</i><b>${esc(a.name)}</b><small>${esc(a.desc)}</small>${(l.aspDone ?? []).includes(a.id) ? '<em>✓</em>' : ''}</button>`).join('')}
        <section class="mu-ph-card"><small>You</small><small>Fitness: ${l.fitness}/100${l.study.degree ? ' · Graduated' : l.study.enrolled ? ` · Studying (${l.study.passed}/3 exams)` : ''}</small></section>
    </div>`;
}
// feelings someone has toward you, for her page in People
export const feelingsHtml = (g: Save, avatar: string) => { const f = activeFeelings(g, avatar); return f.length ? `<div class="mu-chips">${f.map(x => `<span class="mu-chip">${esc(x.tag)}</span>`).join('')}</div>` : ''; };

/* ---------- throwing a party ---------- */

export const PARTY = { open: false, day: 0, time: 20 * 60, guests: [] as string[], title: '' };
export function partyForm(g: Save, w: WorldDef) {
    if (!PARTY.open) return `<button class="mu-primary" data-act="party-open">${icon('users')}<span>Throw a party at home</span></button>`;
    const fee = Math.max(1, Math.round(usualPay(w) * 3.75));   // food and drinks: about four hours of a first job
    const people = residents(g).filter(r => r.met && bondOf(g, r.avatar) >= HANGOUT_BOND);
    return `<section class="mu-ph-card mu-party"><h4>A party at your place</h4>
        <label class="mu-field"><span>Name (optional)</span><input type="text" maxlength="80" data-input="party-title" data-focus="partytitle" placeholder="e.g. My birthday, Game night" value="${esc(PARTY.title)}"></label>
        <div class="mu-row"><select data-input="party-day">${[0, 1, 2, 3].map(d => `<option value="${d}" ${PARTY.day === d ? 'selected' : ''}>${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : weekday(g.day + d)}</option>`).join('')}</select>
            <select data-input="party-time">${[18, 19, 20, 21].map(h => `<option value="${h * 60}" ${PARTY.time === h * 60 ? 'selected' : ''}>${h}:00</option>`).join('')}</select></div>
        <small>Guests (friends and acquaintances):</small>
        ${people.length ? `<div class="mu-chips">${people.map(r => `<button class="mu-chip ${PARTY.guests.includes(r.avatar) ? 'is-on' : ''}" data-act="party-guest" data-who="${esc(r.avatar)}">${esc(r.name)}</button>`).join('')}</div>` : '<p class="mu-muted">Get to know people first.</p>'}
        <small>Food and drinks: ${money(w, fee)}</small>
        <div class="mu-row"><button class="mu-primary" data-act="party-go" ${PARTY.guests.length ? '' : 'aria-disabled="true"'}>Send the invitations</button><button class="mu-ghost" data-act="party-close">Cancel</button></div></section>`;
}

/* ---------- a scenario's house party ---------- */

// Everyone in the house is there: while it lasts they leave their rooms and routines for the common rooms.
// guests: people from outside invited to it; where: at home or out of the house (place, background, who of the house comes)
export const HP = { day: 0, time: 21 * 60, title: '', guests: [] as string[], where: 'home' as 'home' | 'out', place: '', bg: '', people: [] as string[] };
export function housePartyHtml(g: Save, w: WorldDef): string {
    const p = houseParty(g); const now = nowAbs(g);
    const old = styleOf(w) === 'medieval';   // a medieval Home holds a feast
    const rooms = partyRooms(g, w).map(id => placeOf(g, w, id)?.name).filter(Boolean);
    if (p && p.until > now) return `<section class="mu-ph-card mu-party"><h4>🎉 ${esc(p.title || (old ? 'A feast' : 'House party'))}</h4>
        <small>${now >= p.from ? 'Going on now' : `${p.from - now < 1440 && Math.floor(p.from / 1440) === g.day ? 'Today' : weekday(Math.floor(p.from / 1440))} at ${hm(p.from % 1440)}`} · ${PARTY_HOURS} hours</small>
        ${p.out ? '' : `<small>Everyone in the house comes out of their rooms: ${esc(rooms.join(', '))}.</small>`}
        ${partyCardExtra(g, w)}
        ${partyCardButtons(now < p.from)}</section>`;
    return `<section class="mu-ph-card mu-party"><h4>🎉 ${old ? 'A feast in the house' : 'A party at home'}</h4>
        <label class="mu-field"><span>Name (optional)</span><input type="text" maxlength="80" data-input="hp-title" data-focus="hptitle" placeholder="${old ? 'e.g. Harvest feast, a name day' : 'e.g. Welcome party, Pool night'}" value="${esc(HP.title)}"></label>
        <div class="mu-row"><select data-input="hp-day">${[0, 1, 2, 3].map(d => `<option value="${d}" ${HP.day === d ? 'selected' : ''}>${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : weekday(g.day + d)}</option>`).join('')}</select>
            <select data-input="hp-time">${[18, 19, 20, 21, 22].map(h => `<option value="${h * 60}" ${HP.time === h * 60 ? 'selected' : ''}>${h}:00</option>`).join('')}</select></div>
        ${partyExtraHtml(g, w)}
        <button class="mu-primary" data-act="hp-go">${icon('users')}<span>${old ? 'Hold the feast' : 'Throw the party'}</span></button></section>`;
}

/* ---------- playing as someone else (50) ---------- */

export function swapBadge(g: Save) {
    const s = swapOf(g);
    if (!s?.avatar) return '';
    return `<button class="mh-swapback mh-glass" data-act="pa-go" data-who="" title="Go back to ${esc(s.origName)}">${icon('back')}<span>Back to ${esc(s.origName)}</span></button>`;
}

/* ---------- "Play as": your photo opens who you can play (and the choice of who that is) ---------- */

const PA = { open: false, edit: false, q: '' };
function playAsHtml(g: Save): string {
    if (!PA.open) return '';
    const s = swapOf(g);
    const cur = s?.avatar ?? '';
    const origName = s?.origName || personaName();
    const origPic = s?.orig ? personaThumb(s.orig) : personaThumb();
    const list = roster(g).filter(a => g.cast[a] && charOf(a));
    const card = (who: string, name: string, pic: string, sub: string) => `<button class="mu-pa-card ${who === cur ? 'is-on' : ''}" data-act="pa-go" data-who="${esc(who)}" ${who === cur ? 'aria-disabled="true"' : ''}>
        <img src="${esc(pic)}" alt=""><b data-notr>${esc(name)}</b><small>${who === cur ? 'Playing now' : esc(sub)}</small></button>`;
    const q = PA.q.trim().toLowerCase();
    const pool = Object.values(g.cast).filter(r => r.avatar !== s?.origCard && charOf(r.avatar) && (!q || r.name.toLowerCase().includes(q)))
        .sort((a, b) => Number(roster(g).includes(b.avatar)) - Number(roster(g).includes(a.avatar)) || a.name.localeCompare(b.name));
    return `<div class="mu-recap-veil" data-act="pa-bg"><section class="mu-recap mh-glass mu-pa" role="dialog" aria-label="Play as">
        <header class="mu-row"><div><small>Play as</small><h3>Who do you want to be?</h3></div><button class="mu-ibtn mu-ghost mu-right" data-act="pa-close" aria-label="Close">${icon('x')}</button></header>
        ${PA.edit ? `<div class="mu-pa-edit"><p class="mu-muted">Choose who you can play in this world. They stay ready here; you switch only when you click one.</p>
            <input class="mu-search" type="search" placeholder="Search people" data-input="pa-q" data-focus="pa-q" value="${esc(PA.q)}">
            <div class="mu-pa-pool">${pool.map(r => `<button class="mu-chip ${roster(g).includes(r.avatar) ? 'is-on' : ''}" data-act="pa-pick" data-who="${esc(r.avatar)}"><img src="${esc(thumb(r.avatar))}" alt=""><span data-notr>${esc(r.name)}</span></button>`).join('') || '<p class="mu-muted">Nobody found.</p>'}</div>
            <footer class="mu-row"><button class="mu-primary mu-right" data-act="pa-edit">${icon('check')}<span>Done</span></button></footer></div>`
        : `<div class="mu-pa-grid">${isGone(g, '') ? '' : card('', origName, origPic, 'Your character')}${list.map(a => card(a, g.cast[a].name, thumb(a), placeOf(g, getWorld(g.world)!, whereNow(g, getWorld(g.world)!, g.cast[a]))?.name ?? '')).join('')}</div>
            <p class="mu-muted mu-pa-note">You take their place and their home. The one you were stays where they are (or with you, if they were your company). Energy, needs and money stay the same; each person keeps their own relationships, diary and job.</p>
            <footer class="mu-row"><button data-act="pa-edit">${icon('edit')}<span>Choose who you can play (${list.length})</span></button><button data-act="pa-persona"><img class="mu-pa-me" src="${esc(personaThumb())}" alt=""><span>Use another persona</span></button></footer>`}
    </section></div>`;
}
export const openPlayAs = () => { PA.open = true; PA.edit = false; notify(); };

Object.assign(ACT, {
    // your SillyTavern persona: the same picker as in a Home or a chat (the one you play as keeps their card)
    'pa-persona': () => { PA.open = false; const el = document.createElement('button'); el.dataset.v = 'persona'; ACT['sc-open'](el, new Event('click')); },
    elev: (el) => {
        const f = Number(el.dataset.f);
        ELEV.at = f;
        if (f === ELEV.floor) { ELEV.on = false; toast(`Floor ${f}: apartment ${ELEV.door}.`, 'info'); }
        notify();
    },
    'elev-skip': () => { ELEV.on = false; notify(); },
    'inv-yes': async () => {
        const g = game(); const w = g && getWorld(g.world); const inv = g && pendingInvite(g);
        if (!g || !w || !inv) return;
        const r = g.cast[inv.avatar];
        add(g, inv.avatar, inv.place, inv.from, inv.kind);
        (social(g).threads[inv.avatar] ??= []).push({ me: true, text: 'Sure, see you there!', at: nowAbs(g) });
        note(g, '{0} invited {u} to {1}, and {u} said yes.', [r?.name ?? '', placeOf(g, w, inv.place)?.name ?? ''], [inv.avatar], g.player.loc, 'plan');
        clearInvite(g); saveGame(); toast('It is in your calendar.', 'success'); notify();
    },
    hap: async (el) => {
        const g = game(); const w = g && getWorld(g.world); if (!g || !w) return;
        const msg = answer(g, w, el.dataset.id!, el.dataset.c!);
        if (msg) toast(msg, 'info');
        saveGame(); await syncScene(); notify();
    },
    'inv-no': () => {
        const g = game(); const inv = g && pendingInvite(g);
        if (!g || !inv) return;
        (social(g).threads[inv.avatar] ??= []).push({ me: true, text: 'Sorry, I can\'t make it this time.', at: nowAbs(g) });
        bump(g, inv.avatar, -1);
        clearInvite(g); saveGame(); notify();
    },
    'shop-buy': (el) => {
        const g = game(); const w = g && getWorld(g.world); if (!g || !w) return;
        const err = buy(g, w, el.dataset.id!);
        if (err) { toast(err, 'info'); return; }
        toast('Bought!', 'success'); saveGame(); notify();
    },
    'goal-set': (el) => { const g = game(); if (!g) return; setAspiration(g, el.dataset.id!); saveGame(); notify(); },
    'hp-go': () => {
        const g = game(); const w = g && getWorld(g.world); if (!g || !w) return;
        const from = Math.max(nowAbs(g), (g.day + HP.day) * 1440 + HP.time);
        if (HP.where === 'out' && !HP.place.trim()) { toast('Write where the party is first.', 'warn'); return; }
        const err = throwHouseParty(g, w, from, HP.title, { guests: HP.guests, out: HP.where === 'out' ? { place: HP.place, bg: HP.bg, people: HP.people.filter(a => g.cast[a]) } : undefined }); if (err) { toast(err, 'info'); return; }
        if (HP.where === 'out') rememberOutingBg(g, HP.place, HP.bg);
        countUp(g, 'parties'); Object.assign(HP, { title: '', guests: [], where: 'home', place: '', bg: '', people: [] }); saveGame();
        toast('The house knows: party on!', 'success'); notify();
    },
    'hp-cancel': () => { const g = game(); if (!g) return; cancelHouseParty(g); saveGame(); notify(); },
    'party-open': () => { const g = game(); PARTY.open = true; PARTY.guests = []; PARTY.day = 0; PARTY.time = 20 * 60; if (g && (g.minutes >= 21 * 60)) PARTY.day = 1; notify(); },
    'party-close': () => { PARTY.open = false; notify(); },
    'party-guest': (el) => { const a = el.dataset.who!; const i = PARTY.guests.indexOf(a); i >= 0 ? PARTY.guests.splice(i, 1) : PARTY.guests.push(a); notify(); },
    'party-go': () => {
        const g = game(); const w = g && getWorld(g.world); if (!g || !w || !PARTY.guests.length) return;
        const fee = Math.max(1, Math.round(usualPay(w) * 3.75));   // food and drinks: about four hours of a first job
        if (g.player.money < fee) { toast('Not enough money for food and drinks.', 'info'); return; }
        const from = Math.max(earliest(g), (g.day + PARTY.day) * 1440 + PARTY.time);
        const yes: string[] = [], no: string[] = [];
        for (const a of PARTY.guests) {
            const ans = check(g, w, a, playerHomeId, from, from + 120, 'party', HANGOUT_BOND);
            const name = g.cast[a]?.name ?? '';
            if (ans.ok) { add(g, a, playerHomeId, from, 'party', false, PARTY.title); yes.push(name); } else no.push(name);
        }
        if (!yes.length) { toast('Nobody can make it then. Try another day or time.', 'info'); notify(); return; }
        g.player.money -= fee;
        const whenTxt = PARTY.day === 0 ? 'tonight' : PARTY.day === 1 ? 'tomorrow' : `on ${weekday(g.day + PARTY.day)}`;
        note(g, PARTY.title.trim() ? '{u} invited {0} to a party at home {1}: "{2}".' : '{u} invited {0} to a party at home {1}.', [yes.join(', '), whenTxt, PARTY.title.trim()], yes.map(n => Object.values(g.cast).find(r => r.name === n)?.avatar ?? '').filter(Boolean), playerHomeId, 'party');
        countUp(g, 'parties');
        PARTY.open = false; PARTY.title = ''; saveGame();
        toast(yes.length ? `Coming: ${yes.join(', ')}.${no.length ? ` Can't make it: ${no.join(', ')}.` : ''}` : 'Nobody can make it then.', yes.length ? 'success' : 'info');
        notify();
    },
    // 47: talk only with one person in the scene (the others stay, quietly)
    'solo-on': async (el) => { const g = game(); if (!g) return; (social(g) as any).solo = el.dataset.who; saveGame(); await syncScene(); notify(); },
    'solo-off': async () => { const g = game(); if (!g) return; (social(g) as any).solo = ''; saveGame(); await syncScene(); notify(); },
    'swap-to': async (el) => { await goPlay(el.dataset.who ?? ''); },
    'swap-back': async () => { await goPlay(''); },
    'pa-go': async (el) => { if (el.getAttribute('aria-disabled')) return; PA.open = false; await goPlay(el.dataset.who ?? ''); },
    'pa-open': () => openPlayAs(),
    'pa-close': () => { PA.open = false; notify(); },
    'pa-bg': (el, e) => { if (e.target === el) { PA.open = false; notify(); } },
    'pa-edit': () => { PA.edit = !PA.edit; PA.q = ''; notify(); },
    'pa-pick': (el) => { const g = game(); if (!g) return; const list = roster(g); const a = el.dataset.who!; const i = list.indexOf(a); if (i >= 0) list.splice(i, 1); else list.push(a); saveGame(); notify(); },
});
Object.assign(INPUT, {
    'hp-title': (el) => { HP.title = el.value; },
    'hp-day': (el) => { HP.day = Number(el.value); },
    'hp-time': (el) => { HP.time = Number(el.value); },
'pa-q': (el) => { PA.q = el.value; notify(); } });
async function goPlay(who: string) {
    const g = game(); const w = g && getWorld(g.world); if (!g || !w || state.busy) return;
    try {
        state.busy = 'Switching'; notify();
        if (who && !roster(g).includes(who)) roster(g).push(who);
        const name = await switchTo(g, w, who);
        saveGame(); await syncScene(); refreshPrompt();
        if (name) toast(`You are playing as ${name}.`, 'success');
    } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
    state.busy = ''; notify();
}
export const soloOf = (g: Save) => String((social(g) as any).solo ?? '');
void whereNow;

Object.assign(INPUT, {
    'party-day': (el) => { PARTY.day = Number(el.value); },
    'party-time': (el) => { PARTY.time = Number(el.value); },
    'party-title': (el) => { PARTY.title = el.value; },
});
