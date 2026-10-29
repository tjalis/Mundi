// People from the story (sim/newcomers.ts): the card that offers to add someone who came to matter, the list of
// everyone the story brought in (This world › People), and their settings (Settings › Game).
import { notify, esc, game, toast, saveGame, saveSettings, type Save } from '../core/store.js';
import { getWorld, type WorldDef } from '../core/world.js';
import { peoplePrefs, newcomers, offerShown, offerText, notNow, never, restore, addNewcomer, findNewcomer, type Newcomer } from '../sim/newcomers.js';
import { syncScene } from '../sim/game.js';
import { refreshPrompt } from '../sim/prompt.js';
import { icon } from './icons.js';
import { ACT, INPUT } from './reg.js';

const NP = { open: false, busy: '', name: '' };
const initials = (n: string) => n.replace(/^the\s+/i, '').split(/\s+/).map(x => x[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
const face = (n: Newcomer) => `<span class="mu-np-face" aria-hidden="true">${esc(initials(n.name))}</span>`;
const unnamed = (n: Newcomer) => /^the\s/i.test(n.name);
const drawOn = async () => { const p = peoplePrefs(); if (p.draw !== null) return p.draw; const sg = await import('./spritegen.js'); return sg.sprPrefs().mode !== 'off'; };

// Adds them (the card, a home, a job, a start with you), then their sprites when drawing is on.
export async function addFromStory(g: Save, w: WorldDef, n: Newcomer, as = '') {
    if (NP.busy) return;
    NP.busy = n.key; notify();
    try {
        const r = await addNewcomer(g, w, n, as);
        NP.name = '';
        saveGame(); await syncScene(); refreshPrompt();
        toast(r.text, 'success');
        if (await drawOn()) { const sg = await import('./spritegen.js'); sg.drawEveryone([r.avatar]); }
    } catch (e: any) {
        console.error('[Mundi] people from the story', e);
        toast(`Could not add ${n.name}: ${String(e?.message ?? e)}`, 'error');
    } finally { NP.busy = ''; notify(); }
}
// After the story check: with "add straight away", whoever came to matter is added without asking.
export async function autoAdd(g: Save, w: WorldDef) {
    if (!peoplePrefs().auto) return;
    const n = offerShown(g); if (!n || unnamed(n)) return;
    await addFromStory(g, w, n);
}

/* ---------- the offer: one card, like a neighbor at the door ---------- */

export function offerHtml(g: Save): string {
    const n = offerShown(g); if (!n || !peoplePrefs().on) return '';
    const busy = NP.busy === n.key;
    return `<div class="mh-invite mh-happen mh-glass is-newcomer" role="dialog">${face(n)}
        <div><b data-notr>${esc(n.name)}</b>${n.role ? ` <small data-notr>· ${esc(n.role)}</small>` : ''}<p data-notr>${esc(offerText(n))}</p>
        ${unnamed(n) ? `<input class="mu-np-name" type="text" maxlength="40" placeholder="Their name" value="${esc(NP.name)}" data-input="np-name" data-focus="npname">` : ''}</div>
        <div class="mh-invite-btns"><button class="mu-primary" data-act="np-add" data-k="${esc(n.key)}" ${busy || (unnamed(n) && !NP.name.trim()) ? 'aria-disabled="true"' : ''}>${busy ? 'Adding…' : 'Add'}</button>
            <button data-act="np-later" data-k="${esc(n.key)}">Not now</button><button data-act="np-never" data-k="${esc(n.key)}">Never</button></div></div>`;
}

/* ---------- the list: everyone the story brought in ---------- */

export function storyListButton(g: Save): string {
    const n = newcomers(g).filter(x => x.state !== 'added').length;
    return peoplePrefs().on || n ? `<button data-act="np-open">${icon('users')}<span>People from the story${n ? ` (${n})` : ''}</span></button>` : '';
}
const STATE_LABEL: Record<string, string> = { watch: 'Noticed', later: 'Not now', never: 'Never', added: 'Added' };
export function storyListHtml(g: Save): string {
    if (!NP.open) return '';
    const list = [...newcomers(g)].sort((a, b) => Number(a.state === 'added') - Number(b.state === 'added') || b.last - a.last);
    const row = (n: Newcomer) => `<article class="mu-np-row is-${n.state}">${face(n)}
        <div><b data-notr>${esc(n.name)}</b>${n.role ? ` <small data-notr>· ${esc(n.role)}</small>` : ''} <em class="mu-chip">${STATE_LABEL[n.state]}</em>
            <small class="mu-muted">Came up on ${n.days.length} ${n.days.length === 1 ? 'day' : 'days'}${n.aka.length ? ` · also called ${esc(n.aka.join(', '))}` : ''}</small>
            ${n.looks ? `<p data-notr>${esc(n.looks)}</p>` : ''}
            ${[...n.moments.map(m => `★ ${m}`), ...n.notes.slice(-3)].map(t => `<p class="mu-muted" data-notr>${esc(t)}</p>`).join('')}</div>
        <div class="mu-np-acts">${n.state === 'added' ? ''
            : n.state === 'never' ? `<button data-act="np-restore" data-k="${esc(n.key)}">Bring back</button>`
            : `<button class="mu-primary" data-act="np-add" data-k="${esc(n.key)}" ${NP.busy ? 'aria-disabled="true"' : ''}>${NP.busy === n.key ? 'Adding…' : 'Add'}</button>`}</div></article>`;
    return `<div class="mu-dlg-veil" data-act="np-close"></div><div class="mu-panel mu-scpick mu-np-list" role="dialog"><header><h3>People from the story</h3><button class="mu-ibtn mu-ghost" data-act="np-close" aria-label="Close">${icon('x')}</button></header>
        <p class="mu-muted">People the story brought in who are not (yet) people of this world. Adding someone writes their card from what the story said, and gives them a home, a job and a routine.${peoplePrefs().on ? '' : ' Noticing new people is off in Settings › Game.'}</p>
        ${list.some(n => n.state !== 'added' && unnamed(n)) ? `<input class="mu-np-name" type="text" maxlength="40" placeholder="A name for someone without one (then Add)" value="${esc(NP.name)}" data-input="np-name" data-focus="npname">` : ''}
        <div class="mu-np-rows" data-keep="nplist">${list.map(row).join('') || '<p class="mu-muted">Nobody yet. They show up here as the story brings people in.</p>'}</div></div>`;
}

/* ---------- settings ---------- */

export function peopleSettingsHtml(): string {
    const p = peoplePrefs();
    const chk = (act: string, on: boolean, label: string, hint: string) => `<label class="mu-check"><input type="checkbox" data-input="${esc(act)}" ${on ? 'checked' : ''}><span>${esc(label)}<small>${esc(hint)}</small></span></label>`;
    return `<section><h3>People from the story</h3>
        ${chk('np-on', p.on, 'Notice new people in the story', 'Someone the story brings in (a party\'s tank, a nurse, a stranger) is noted after each reply. In the same AI call as scene looks, or a short one of its own.')}
        ${p.on ? `${chk('np-recurring', p.recurring, 'Also offer people who keep coming up', `Besides a real moment with you (a life saved, an invitation to team up…), someone who comes up on ${3} different days.`)}
        ${chk('np-auto', p.auto, 'Add them straight away', 'Without the card asking first. Someone without a name still asks.')}
        <label class="mu-field"><span>Draw their sprites when they are added</span><select data-input="np-draw">${([['follow', 'As the sprite drawing is set'], ['yes', 'Yes'], ['no', 'No']] as const).map(([v, l]) => `<option value="${v}" ${(p.draw === null ? 'follow' : p.draw ? 'yes' : 'no') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}</section>`;
}

const ctxGW = () => { const g = game(); const w = g && getWorld(g.world); return g && w ? { g, w } : null; };
Object.assign(ACT, {
    'np-add': async (el) => {
        const c = ctxGW(); if (!c) return;
        const n = findNewcomer(c.g, el.dataset.k!); if (!n) return;
        if (unnamed(n) && !NP.name.trim()) { toast(`Give ${n.name} a name first.`, 'info'); return; }
        await addFromStory(c.g, c.w, n, unnamed(n) ? NP.name : '');
    },
    'np-later': (el) => { const c = ctxGW(); const n = c && findNewcomer(c.g, el.dataset.k!); if (!c || !n) return; notNow(c.g, n); saveGame(); notify(); },
    'np-never': (el) => { const c = ctxGW(); const n = c && findNewcomer(c.g, el.dataset.k!); if (!c || !n) return; never(c.g, n); saveGame(); toast(`${n.name} won't be offered again. You can bring them back from This world › People.`, 'info'); notify(); },
    'np-restore': (el) => { const c = ctxGW(); const n = c && findNewcomer(c.g, el.dataset.k!); if (!c || !n) return; restore(c.g, n); saveGame(); notify(); },
    'np-open': () => { NP.open = true; notify(); },
    'np-close': () => { NP.open = false; notify(); },
});
Object.assign(INPUT, {
    'np-name': (el) => { const had = !!NP.name.trim(); NP.name = el.value; if (had !== !!NP.name.trim()) notify(); },
    'np-on': (el) => { peoplePrefs().on = el.checked; saveSettings(); notify(); },
    'np-recurring': (el) => { peoplePrefs().recurring = el.checked; saveSettings(); },
    'np-auto': (el) => { peoplePrefs().auto = el.checked; saveSettings(); },
    'np-draw': (el) => { peoplePrefs().draw = el.value === 'follow' ? null : el.value === 'yes'; saveSettings(); },
});
