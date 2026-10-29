import { festivalsHtml } from './lifeplus.js';
import { cityEventsHtml, cityBadge } from './cityui.js';
import { romanceButtons, relBar } from './relui.js';
import { lex } from '../core/lexicon.js';
import { stayButton, tidyEvent } from './events.js';
import { friendTier, romanceTier } from '../sim/romance.js';
// Plans on screen: the card of a person in the scene ("come with me", "make plans"), the plan form and the
// Calendar app on the phone, and the toasts the clock produces (reminders, arrivals, missed plans).
import { housePartyHtml, partyForm } from './lifeui.js';
import { CAL, calendarTabs, visitsTab, bgButton, guestButtons } from './guestsui.js';
import { rememberOutingBg } from '../sim/outing.js';
import { guestTick } from '../sim/guests.js';
import { notify, esc, game, toast, saveGame, nowAbs, state } from '../core/store.js';
import { getWorld, type WorldDef, isScenario, styleOf } from '../core/world.js';
import { outingId } from '../sim/places.js';
import type { Save } from '../core/store.js';
import { tr } from '../core/tr.js';
import { thumb, sendCanned, addUserLine, replyAs, personaName, setAsk } from '../st/bridge.js';
import { weekday } from '../sim/time.js';
import { fmtClock as hm } from '../core/fmt.js';
import { placeOf, playerHomeId, pins, lockedNow } from '../sim/places.js';
import { bondOf, isPartner, social, isWith, type PlanKind } from '../sim/social.js';
import { invite, inviteFace, callOver, askAlong, letGo, cancelPlan, upcoming, planTick, earliest, isWorking, ALONG_BOND, HANGOUT_BOND, DATE_BOND } from '../sim/plans.js';
import { whereNow } from '../sim/people.js';
import { dating } from '../sim/feed.js';
import { icon } from './icons.js';
import { featureOn } from '../sim/creator.js';
import { ACT, INPUT } from './reg.js';

export const PL = { card: '', kind: 'hangout' as PlanKind, place: '', day: 0, time: 0, busy: '', face: '', title: '', out: '', bg: '' };   // bg: the background of a plan out of the house (Home)
// Home: a plan can be somewhere out of the house, in your words ("__out" in the list, then the place you type)
const OUT_PICK = '__out';
const planPlace = () => (PL.place === OUT_PICK ? (PL.out.trim() ? outingId(PL.out) : '') : PL.place);

// A sentence in the interface language, with its variable parts filled in afterwards (they are already translated).
const fmt = (t: string, ...a: string[]) => tr(t).replace(/\{(\d)\}/g, (_, n) => a[Number(n)] ?? '');
export function whenText(g: Save, at: number) {
    const d = Math.floor(at / 1440);
    return d === g.day ? fmt('today at {0}', hm(at % 1440)) : d === g.day + 1 ? fmt('tomorrow at {0}', hm(at % 1440)) : fmt('on {0} at {1}', tr(weekday(d)), hm(at % 1440));
}
const placeName = (g: Save, w: WorldDef, id: string) => (id === playerHomeId ? tr(isScenario(w) ? 'your room' : 'your home') : tr(placeOf(g, w, id)?.name ?? ''));

/* ---------- the clock ---------- */

export function runPlans() {
    const g = game(); const w = g && getWorld(g.world);
    if (!g || !w) return false;
    const news = [...planTick(g, w), ...guestTick(g, w).map(text => ({ text, kind: /door/.test(text) ? 'success' : 'info' }) as any)];   // visitors: on time, like plans
    tidyEvent(g);
    news.forEach(n => toast(n.text, n.kind));
    if (news.length) saveGame();
    return news.length > 0;
}

/* ---------- the person card in the scene ---------- */

// a bar that fills inside its tier, in the tier's color
export function sceneCard(g: Save, w: WorldDef): string {
    const r = PL.card && g.cast[PL.card];
    if (!r || !featureOn(w, 'plans')) return '';
    const b = bondOf(g, r.avatar);
    const along = isWith(g, r.avatar);
    const working = isWorking(w, r, nowAbs(g));
    return `<div class="mu-pcard" role="dialog" aria-label="${esc(r.name)}">
        <header><img src="${esc(thumb(r.avatar))}" alt=""><span><b data-notr>${esc(r.met ? r.name : 'Someone')}</b><small>${friendTier(b).name}${romanceTier(g, r.avatar).id !== 'none' ? ` · <span class="mu-love-tag">${romanceTier(g, r.avatar).name}</span>` : ''}</small>${relBar(r.avatar)}</span>
            <button class="mu-ibtn mu-ghost" data-act="pc-close" aria-label="Close">${icon('x')}</button></header>
        ${r.met ? '' : `<p class="mu-muted">You don't know them yet. Talk to them, or:</p><button class="mu-primary" data-act="pc-intro" data-who="${esc(r.avatar)}">${icon('chat')}<span>Introduce yourself</span></button>`}
        ${along ? `<p class="mu-muted">${esc(fmt('{0} is with you.', r.name))}</p>
            <button data-act="pc-bye" data-who="${esc(r.avatar)}">${icon('back')}<span>Say goodbye</span></button>`
            : `<button class="mu-primary" data-act="pc-along" data-who="${esc(r.avatar)}" ${b >= ALONG_BOND || isPartner(g, r.avatar) ? '' : 'aria-disabled="true"'}>${icon('users')}<span>Come with me</span></button>
            <small class="mu-muted">${b >= ALONG_BOND || isPartner(g, r.avatar) ? (working ? 'They are working now.' : 'They go with you from place to place for a few hours.') : esc(fmt('Get closer first ({0}/{1}).', String(b), String(ALONG_BOND)))}</small>`}
        <button data-act="pc-plan" data-who="${esc(r.avatar)}">${icon('pin')}<span>Make plans</span></button>
        ${String((social(g) as any).solo ?? '') === r.avatar ? `<button data-act="solo-off">${icon('users')}<span>Talk with everyone again</span></button>`
            : `<button data-act="solo-on" data-who="${esc(r.avatar)}">${icon('chat')}<span>Talk only with them</span></button>`}
        ${stayButton(r.avatar)}
        ${guestButtons(g, r.avatar).join('')}
        ${romanceButtons(r.avatar)}
        ${!isScenario(getWorld(g.world)) && (along || isPartner(g, r.avatar) || b >= 60) ? `<button class="mu-ghost" data-act="swap-to" data-who="${esc(r.avatar)}">${icon('user')}<span>Play as them</span></button>` : ''}
    </div>`;
}

/* ---------- the plan form (phone, on her page) ---------- */

function slots(g: Save) {
    const first = earliest(g);
    const base = (g.day + PL.day) * 1440;
    const out: number[] = [];
    for (let m = 7 * 60; m <= 22 * 60 + 30; m += 30) if (base + m >= first) out.push(base + m);
    return out;
}
export function planForm(g: Save, w: WorldDef, avatar: string, face = false): string {
    const r = g.cast[avatar];
    const b = bondOf(g, avatar);
    const canDate = isPartner(g, avatar) || b >= DATE_BOND || (dating(g).matches.includes(avatar) && b >= 10);
    if (b < HANGOUT_BOND && !isPartner(g, avatar) && !dating(g).matches.includes(avatar))
        return `<section><h4>Plans</h4><p class="mu-muted">${esc(fmt('Get closer before making plans ({0}/{1}).', String(b), String(HANGOUT_BOND)))}</p></section>`;
    if (PL.kind === 'date' && !canDate) PL.kind = 'hangout';
    // a scenario: plans are made in a room of the house (the rooms of this game, and your room)
    const places = isScenario(w) ? [...pins(g, w).filter(p => !p.link && !p.home), { id: playerHomeId, name: 'Your room' }, { id: OUT_PICK, name: 'Somewhere out… (write where)' }]
        : [...pins(g, w).filter(p => !p.link && !p.home && !lockedNow(g, w, p)), ...(placeOf(g, w, playerHomeId) ? [{ id: playerHomeId, name: 'Your home' }] : [])];
    if (!places.some(p => p.id === PL.place)) PL.place = places.find(p => ((p as any).tags ?? []).includes('leisure'))?.id ?? places[0]?.id ?? '';
    const times = slots(g);
    while (!times.length && PL.day < 6) { PL.day++; times.push(...slots(g)); }
    if (!times.includes((g.day + PL.day) * 1440 + PL.time)) PL.time = (times[0] ?? 0) % 1440;
    const here = g.player.loc;
    const sheHere = whereNow(g, w, r) === here;
    const plans = upcoming(g, avatar);
    return `<section class="mu-ph-plan"><h4>Make plans</h4>
            <div class="mu-chips"><button class="mu-chip ${PL.kind === 'hangout' ? 'is-on' : ''}" data-act="pl-kind" data-v="hangout">Hang out</button>
                <button class="mu-chip ${PL.kind === 'date' ? 'is-on' : ''}" data-act="pl-kind" data-v="date" ${canDate ? '' : `aria-disabled="true" title="${esc(lex(w, 'dateNeeds', String(b), String(DATE_BOND)))}"`}>Date</button></div>
            <label class="mu-field"><span>Name (optional)</span><input type="text" maxlength="80" data-input="pl-title" data-focus="pltitle" placeholder="${esc(tr(lex(w, 'planTitleEg')))}" value="${esc(PL.title)}"><small class="mu-muted">Tells the story what this event is about.</small></label>
            <label class="mu-field"><span>Where</span><select data-input="pl-place">${places.map(p => `<option value="${esc(p.id)}" ${PL.place === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
            ${PL.place === OUT_PICK ? `<label class="mu-field"><span>Where out</span><input type="text" maxlength="80" data-input="pl-out" data-focus="plout" placeholder="${styleOf(w) === 'medieval' ? 'the market square, the village tavern, the riverbank…' : 'the beach, a café downtown, the cinema…'}" value="${esc(PL.out)}"></label>${bgButton('date', PL.bg)}` : ''}
            <div class="mu-row2"><label class="mu-field"><span>Day</span><select data-input="pl-day">${[0, 1, 2, 3, 4, 5, 6].map(d => `<option value="${d}" ${PL.day === d ? 'selected' : ''}>${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : weekday(g.day + d)}</option>`).join('')}</select></label>
                <label class="mu-field"><span>Time</span><select data-input="pl-time">${times.map(t => `<option value="${t % 1440}" ${PL.time === t % 1440 ? 'selected' : ''}>${hm(t % 1440)}</option>`).join('') || '<option>—</option>'}</select></label></div>
            <button class="mu-primary" data-act="${face ? 'pl-invite-face' : 'pl-invite'}" data-who="${esc(avatar)}" ${PL.busy || !times.length ? 'disabled' : ''}>${icon(face ? 'chat' : 'send')}<span>${face ? 'Ask them' : 'Invite'}</span></button>
        </section>
        ${face ? '' : `<section class="mu-ph-plan"><h4>Right now</h4>
            <button data-act="pl-come" data-who="${esc(avatar)}" ${PL.busy || sheHere ? 'disabled' : ''}>${icon('pin')}<span>Ask them to come over</span></button>
            <small class="mu-muted">${sheHere ? 'They are here with you.' : esc(fmt('To where you are: {0}.', placeName(g, w, here)))}</small>
        </section>`}
        ${plans.length ? `<section><h4>Coming up</h4>${plans.map(a => planRow(g, w, a, false)).join('')}</section>` : ''}`;
}

function planRow(g: Save, w: WorldDef, a: { id: string; avatar: string; place: string; from: number; kind: PlanKind; come?: boolean; title?: string }, withName = true) {
    return `<div class="mu-ph-job mu-plan-row">${withName ? `<img src="${esc(thumb(a.avatar))}" alt="">` : ''}<span>
        <b>${withName ? `<span data-notr>${esc(g.cast[a.avatar]?.name ?? '')}</span> · ` : ''}${a.title ? `<span data-notr>${esc(a.title)}</span>` : a.come ? 'Coming over' : a.kind === 'date' ? 'Date' : a.kind === 'party' ? 'Party' : 'Hang out'}</b>
        <small>${esc(placeName(g, w, a.place))} · ${esc(whenText(g, a.from))}</small></span>
        <button class="mu-ghost" data-act="pl-cancel" data-id="${esc(a.id)}">Cancel</button></div>`;
}

// The Calendar app: every plan coming up, and the people with you.
export function calendarApp(g: Save, w: WorldDef, head: string): string {
    const list = upcoming(g);
    const s = social(g);
    const past = s.appts.filter(a => a.state === 'missed').slice(-3).reverse();
    if (isScenario(w) && CAL.tab === 'visits') return `${head}${visitsTab(g, w, calendarTabs(w))}`;
    return `${head}<div class="mu-ph-body">${calendarTabs(w)}
        ${s.with.length ? `<section><h4>With you</h4>${s.with.map(c => `<div class="mu-ph-job mu-plan-row"><img src="${esc(thumb(c.avatar))}" alt=""><span><b data-notr>${esc(g.cast[c.avatar]?.name ?? '')}</b>${isScenario(getWorld(g.world)!) ? '' : `<small>${esc(fmt('Until {0}', hm(c.until % 1440)))}</small>`}</span>
            <button class="mu-ghost" data-act="pc-bye" data-who="${esc(c.avatar)}">Say goodbye</button></div>`).join('')}</section>` : ''}
        ${isScenario(w) ? housePartyHtml(g, w) : `${partyForm(g, w)}
        ${cityEventsHtml(g, w)}
        ${festivalsHtml(g, w)}`}
        <section><h4>Coming up</h4>${list.length ? list.map(a => planRow(g, w, a)).join('') : '<p class="mu-muted">No plans. Open someone in People to invite them out.</p>'}</section>
        ${past.length ? `<section><h4>Missed</h4>${past.map(a => `<p class="mu-muted"><span data-notr>${esc(g.cast[a.avatar]?.name ?? '')}</span> · ${esc(placeName(g, w, a.place))} · ${esc(whenText(g, a.from))}</p>`).join('')}</section>` : ''}
    </div>`;
}
export const plansBadge = (g: Save) => { const w = getWorld(g.world); return upcoming(g).filter(a => a.from - nowAbs(g) <= 120).length + (w ? cityBadge(g, w) : 0); };

/* ---------- actions ---------- */

const gw = () => { const g = game(); const w = g && getWorld(g.world); return g && w ? { g, w } : null; };
Object.assign(ACT, {
    'pc-open': (el) => { PL.card = PL.card === el.dataset.who ? '' : el.dataset.who!; notify(); },
    'pc-close': () => { PL.card = ''; notify(); },
    // walking up to a stranger: your line in the scene, and they answer (their answer is what makes you know each other)
    'pc-intro': async (el) => {
        const g = game(); const who = el.dataset.who!; if (!g || !g.cast[who] || state.generating) return;
        PL.card = ''; notify();
        setAsk(`[{{user}} walks up to this person and introduces themself. ${g.cast[who].name} answers and says their name.]`);
        await addUserLine(`*walks up with a friendly smile* Hi, I'm ${personaName()}.`);
        await replyAs(who);
    },
    'pc-along': (el) => {
        const c = gw(); if (!c) return;
        const who = el.dataset.who!;
        const ans = askAlong(c.g, c.w, who);
        if (!ans.ok) { toast(ans.why, 'info'); return; }
        toast(fmt('{0} comes with you.', c.g.cast[who]?.name ?? ''), 'success');
        PL.card = ''; saveGame(); notify();
    },
    'pc-bye': async (el) => {
        const c = gw(); if (!c) return;
        const who = el.dataset.who!;
        letGo(c.g, who);
        toast(fmt('{0} went back to their day.', c.g.cast[who]?.name ?? ''), 'info');
        PL.card = ''; saveGame();
        const { syncScene } = await import('../sim/game.js');
        await syncScene(); notify();
    },
    'pc-plan': async (el) => {
        const c = gw(); const who = el.dataset.who!;
        // she is right here: you ask her in person, in the scene (the phone is for people who are elsewhere)
        if (c && state.view === 'scene' && whereNow(c.g, c.w, c.g.cast[who]) === c.g.player.loc) { PL.card = ''; PL.face = who; notify(); return; }
        const { P } = await import('./phone.js');
        PL.card = ''; P.open = true; P.app = 'person'; P.who = who; notify();
    },
    'pl-face-close': () => { PL.face = ''; notify(); },
    'pl-invite-face': (el) => {
        const c = gw(); if (!c || PL.busy) return;
        if (PL.place === OUT_PICK && PL.out.trim() && PL.bg) rememberOutingBg(c.g, PL.out, PL.bg);
        const who = el.dataset.who!; const r = c.g.cast[who]; if (!r) return;
        const at = (c.g.day + PL.day) * 1440 + PL.time;
        if (at < earliest(c.g)) { toast('Pick a later time.', 'info'); return; }
        if (!planPlace()) { toast('Write where.', 'info'); return; }
        const title = PL.title.trim(); const ans = inviteFace(c.g, c.w, who, planPlace(), at, PL.kind, title); if (ans.ok) PL.title = '';
        PL.face = ''; saveGame();
        const what = PL.kind === 'date' ? 'go on a date' : 'hang out';
        // the scene plays it: your words go into the chat, and the engine's answer guides her reply
        setAsk(`[{{user}} is asking ${r.name} (a new invitation: it replaces any earlier one in this conversation) to ${what}${title ? ` ("${title}")` : ''}, ${ans.where}, ${ans.when}. ${ans.ok ? `${r.name} says yes to THIS one (it is decided; earlier refusals were about other times), happily, in their own way.` : `${r.name} says no to this one, kindly. Reason: ${ans.why}`} Answer only this invitation, with its time (${ans.when}). Write ${r.name}'s reply.]`);
        sendCanned(PL.kind === 'date' ? `"Would you like to go on a date with me?${title ? ` ${title}:` : ''} ${ans.where}, ${ans.when}."` : `"${title ? `${title}, want to come?` : 'Want to hang out?'} ${ans.where}, ${ans.when}."`);
        toast(ans.ok ? `${r.name} said yes: ${ans.where}, ${ans.when}.` : ans.why, ans.ok ? 'success' : 'info');
        notify();
    },
    'pl-kind': (el) => { if (el.getAttribute('aria-disabled')) return; PL.kind = el.dataset.v as PlanKind; notify(); },
    'pl-invite': async (el) => {
        const c = gw(); if (!c || PL.busy) return;
        if (PL.place === OUT_PICK && PL.out.trim() && PL.bg) rememberOutingBg(c.g, PL.out, PL.bg);
        const who = el.dataset.who!;
        const at = (c.g.day + PL.day) * 1440 + PL.time;
        if (at < earliest(c.g)) { toast('Pick a later time.', 'info'); return; }
        if (!planPlace()) { toast('Write where.', 'info'); return; }
        const where = PL.place === playerHomeId ? tr('my place') : placeName(c.g, c.w, planPlace());
        const mine = PL.kind === 'date' ? fmt('Would you like to go on a date with me? {0}, {1}.', where, whenText(c.g, at)) : fmt('Want to hang out? {0}, {1}.', where, whenText(c.g, at));
        PL.busy = who;
        // the conversation opens on the phone: your invitation, then their answer
        { const { P } = await import('./phone.js'); P.open = true; P.app = 'thread'; P.who = who; P.typing = who; }
        notify();
        try {
            const title = PL.title.trim(); const ans = await invite(c.g, c.w, who, planPlace(), at, PL.kind, title ? `${title}! ${mine}` : mine, title); if (ans.ok) PL.title = '';
            toast(ans.ok ? fmt('{0} said yes: {1}, {2}.', c.g.cast[who]?.name ?? '', where, whenText(c.g, at)) : ans.why, ans.ok ? 'success' : 'info');
        } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        { const { P } = await import('./phone.js'); P.typing = ''; }
        PL.busy = ''; saveGame(); notify();
    },
    'pl-come': async (el) => {
        const c = gw(); if (!c || PL.busy) return;
        const who = el.dataset.who!;
        PL.busy = who;
        { const { P } = await import('./phone.js'); P.open = true; P.app = 'thread'; P.who = who; P.typing = who; }
        notify();
        try {
            const ans = await callOver(c.g, c.w, who, c.g.player.loc === playerHomeId ? fmt('Can you come over to my place? I\'m home.') : fmt('Can you come over? I\'m at {0}.', placeName(c.g, c.w, c.g.player.loc)));
            toast(ans.ok ? fmt('{0} is on the way (about {1} min).', c.g.cast[who]?.name ?? '', String((ans.at ?? 0) - nowAbs(c.g))) : ans.why, ans.ok ? 'success' : 'info');
        } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        { const { P } = await import('./phone.js'); P.typing = ''; }
        PL.busy = ''; saveGame(); notify();
    },
    'pl-cancel': (el) => {
        const c = gw(); if (!c) return;
        const a = cancelPlan(c.g, el.dataset.id!);
        if (a) toast(fmt('You canceled with {0}.', c.g.cast[a.avatar]?.name ?? ''), 'info');
        saveGame(); notify();
    },
});
Object.assign(INPUT, {
    'pl-place': (el) => { PL.place = el.value; notify(); },
    'pl-out': (el) => { PL.out = el.value; },
    'pl-day': (el) => { PL.day = Number(el.value); notify(); },
    'pl-time': (el) => { PL.time = Number(el.value); },
    'pl-title': (el) => { PL.title = el.value; },
});

// Making plans with someone who is right here (in the scene, not by phone).
export function facePlanHtml(): string {
    const g = game(); const w = g && getWorld(g.world);
    if (!PL.face || !g || !w || !g.cast[PL.face]) return '';
    const r = g.cast[PL.face];
    return `<div class="mu-recap-veil" data-act="pl-face-bg"><section class="mu-recap mu-faceplan mh-glass" role="dialog"><header><small>In person</small><h3>Make plans with <span data-notr>${esc(r.name)}</span></h3></header>
        ${planForm(g, w, PL.face, true)}<button class="mu-ghost" data-act="pl-face-close">Cancel</button></section></div>`;
}
Object.assign(ACT, { 'pl-face-bg': (el, e) => { if (e.target === el) { PL.face = ''; notify(); } } });
