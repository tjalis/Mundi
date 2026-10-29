// "Attach a world" (in a chat) and "Detach world" (in a game attached to one of your chats). The work is in sim/attach.ts.
import { state, notify, esc, busy, toast, game, hostOf } from '../core/store.js';
import { worlds, worldLocked, isScenario, getWorld } from '../core/world.js';
import { scenarioTitle } from '../st/bridge.js';
import { canAttach, detachedSave, attachWorld, detachWorld, reattachWorld } from '../sim/attach.js';
import { inWorld } from './styles.js';
import { ACT } from './reg.js';
import { icon } from './icons.js';

export const ATT = { open: false, world: '', detach: false };

// Opens the attach dialog on the chat open now (from the chat's drawer, or SillyTavern's Extensions menu).
export function openAttach() {
    if (!canAttach()) { toast(game() ? 'This chat already has a world.' : 'Open one of your own chats first.', 'info'); return; }
    ATT.open = true; ATT.world = ''; state.view = 'chat'; notify();
}

export function attachHtml(): string {
    if (!ATT.open || !canAttach()) return '';
    const list = worlds().filter(w => !worldLocked(w)).sort((a, b) => Number(isScenario(a)) - Number(isScenario(b)) || a.name.localeCompare(b.name));
    const old = detachedSave(); const oldW = old && getWorld(old.world);
    return `<div class="mu-dlg-veil" data-act="att-close"></div><div class="mu-panel mu-scpick is-lore mu-attach" role="dialog"><header><h3>Attach a world</h3><button class="mu-ibtn mu-ghost" data-act="att-close" aria-label="Close">${icon('x')}</button></header>
        <p class="mu-muted">The world's clock, map, needs, money and relationships start running in <b data-notr>${esc(scenarioTitle())}</b>. Its characters become the people of the world and you play your current persona. The chat keeps its messages, its lorebook and its Author's Note, and you can detach the world later.</p>
        ${old && oldW ? `<div class="mu-row"><button class="mu-primary" data-act="att-back">${icon('undo')}<span>Bring back <span data-notr>${esc(inWorld(oldW, oldW.name))}</span> (day ${old.day})</span></button></div><p class="mu-muted">Or start a new world:</p>` : ''}
        <div class="mu-lorepick" data-keep="attpick">${list.map(w => `<button class="${ATT.world === w.id ? 'is-on' : ''}" data-act="att-world" data-id="${esc(w.id)}" title="${esc(w.name)}">${icon(isScenario(w) ? 'home' : 'globe')}<span data-notr>${esc(inWorld(w, w.name))}</span>${ATT.world === w.id ? icon('check') : ''}</button>`).join('') || '<p class="mu-muted">No worlds found.</p>'}</div>
        <div class="mu-row mu-dlg-btns"><button data-act="att-close">Cancel</button><button class="mu-primary" data-act="att-yes" ${ATT.world ? '' : 'disabled'}>${icon('globe')}<span>Attach</span></button></div></div>`;
}

export function detachHtml(): string {
    if (!ATT.detach || !hostOf(game())) return '';
    return `<div class="mu-dlg-veil" data-act="det-no"></div><div class="mu-panel mu-dlg mu-glassdlg mu-outback" role="dialog"><h3>Detach the world?</h3>
        <p class="mu-muted">The chat goes back to a normal chat: its lorebooks, Author's Note and muted members are put back, and the scenes Mundi hid from the AI are shown again. Every message stays. The world is kept in the chat, so you can bring it back from "Attach a world".</p>
        <div class="mu-row mu-dlg-btns"><button data-act="det-no">Not now</button><button class="mu-danger" data-act="det-yes">Detach</button></div></div>`;
}

Object.assign(ACT, {
    'att-open': () => openAttach(),
    'att-close': () => { ATT.open = false; notify(); },
    'att-world': (el) => { ATT.world = el.dataset.id ?? ''; notify(); },
    'att-yes': async () => {
        const id = ATT.world; if (!id) return;
        ATT.open = false;
        try { await busy('Attaching the world', () => attachWorld(id)); toast('The world is attached to this chat.', 'success'); }
        catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        notify();
    },
    'att-back': async () => {
        ATT.open = false;
        try { await busy('Bringing the world back', () => reattachWorld()); toast('The world is back in this chat.', 'success'); }
        catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        notify();
    },
    'det-open': () => { ATT.detach = true; notify(); },
    'det-no': () => { ATT.detach = false; notify(); },
    'det-yes': async () => {
        ATT.detach = false;
        try { await busy('Detaching the world', () => detachWorld()); toast('The world is detached. This is a normal chat again.', 'success'); }
        catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        notify();
    },
});
