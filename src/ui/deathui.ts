// Death on screen (RPG, death being real): the card that tells what happened while you were out (who found you,
// where you woke up), and the screen when it is over: how you died, the people who died before you, and what is
// left to do (write what follows in the chat, carry on as someone else, rise if the dead do not rest here, or go back to
// the save from a moment before).
import { esc, game, notify, saveGame, state, toast } from '../core/store.js';
import { thumb } from '../st/bridge.js';
import { heirsOf, carryOn } from '../sim/afterlife.js';
import { getWorld } from '../core/world.js';
import { backups, restoreBackup } from '../core/saves.js';
import { ACT } from './reg.js';
import { combatOf } from '../sim/combat.js';
import { deathOf, toldOf, dismissTold, gravesOf, rise, FORM_WORD } from '../sim/mortal.js';
import { placeOf } from '../sim/places.js';
import { hm } from '../sim/time.js';
import { refreshPrompt } from '../sim/prompt.js';

const DS = { pick: false };
const lastWords = () => backups().map((b, i) => ({ b, i })).filter(x => x.b.reason === 'right before you died').pop() ?? null;

export function deathHtml(): string {
    const g = game(); const w = g && getWorld(g.world);
    if (!g || !w || combatOf(g)) return '';   // the fight screen first: it tells the end of the fight
    const d = deathOf(g);
    if (d) {
        if (state.view === 'chat') return '';
        const graves = gravesOf(g).filter(x => !x.you);
        const back = lastWords();
        const heirs = heirsOf(g);
        if (DS.pick && heirs.length) return `<div class="mu-death-veil"><section class="mu-death" role="dialog" aria-label="Carry on as someone else">
            <h2>Who carries on?</h2>
            <p class="mu-death-text">They take over from here, with your money and your things. A companion keeps the level they fought at; anyone else starts at level 1. You stay dead.</p>
            <div class="mu-death-heirs">${heirs.map(h => `<button data-act="death-heir" data-who="${esc(h.avatar)}"><img src="${esc(thumb(h.avatar))}" alt=""><b data-notr>${esc(h.name)}</b><small>${esc(h.why)}</small></button>`).join('')}</div>
            <div class="mu-death-btns"><button data-act="death-pick-off"><b>Back</b></button></div></section></div>`;
        return `<div class="mu-death-veil"><section class="mu-death" role="dialog" aria-label="You died">
            <h2>You died</h2>
            <p class="mu-death-when">Day ${d.day}, ${esc(hm(d.minutes))} · ${esc(placeOf(g, w, d.where)?.name ?? '')}</p>
            <p class="mu-death-text">${esc(d.text)}</p>
            ${graves.length ? `<div class="mu-death-graves"><h4>Gone before you</h4>${graves.map(x => `<span>${esc(x.name)} <small>${esc(x.cause)}, day ${x.day}</small></span>`).join('')}</div>` : ''}
            <div class="mu-death-btns">
                ${d.rise ? `<button class="mu-primary mu-death-rise" data-act="death-rise"><b>Rise as ${esc(FORM_WORD[d.rise])}</b><small>${d.rise === 'ghost' ? 'Something holds you here. You would be a ghost: unseen by most, no body, no second chance.' : 'Your body will not stay down. You would be undead: feared, turned away by healers, no second chance.'}</small></button>` : ''}
                ${heirs.length ? `<button data-act="death-pick"><b>Carry on as someone else</b><small>A companion or someone you knew takes over the story.</small></button>` : ''}
                <button class="${d.rise ? '' : 'mu-primary'}" data-act="death-chat"><b>Write what follows</b><small>The story goes on without you: the AI tells who finds you and who mourns.</small></button>
                ${back ? `<button data-act="death-undo"><b>Go back to a moment before</b><small>The save from just before it happened (also in Settings → Game → This save).</small></button>` : ''}
            </div></section></div>`;
    }
    const t = toldOf(g);
    if (!t) return '';
    return `<div class="mu-recap-veil"><section class="mu-recap mh-glass mu-told" role="dialog" aria-label="${esc(t.title)}">
        <header><small>While you were out</small><h3>${esc(t.title)}</h3></header><p>${esc(t.text)}</p>
        <div class="mu-row mu-dlg-btns"><button class="mu-primary" data-act="told-ok">Go on</button></div></section></div>`;
}

Object.assign(ACT, {
    'told-ok': () => { const g = game(); if (!g) return; dismissTold(g); saveGame(); refreshPrompt(); notify(); },
    'death-pick': () => { DS.pick = true; notify(); },
    'death-pick-off': () => { DS.pick = false; notify(); },
    'death-rise': async () => {
        const g = game(); const w = g && getWorld(g.world); if (!g || !w) return;
        const msg = rise(g, w); if (!msg) return;
        saveGame(); refreshPrompt();
        const { syncScene } = await import('../sim/game.js');
        await syncScene();
        toast(msg, 'info'); notify();
    },
    'death-heir': async (el) => {
        const g = game(); const w = g && getWorld(g.world); if (!g || !w || state.busy) return;
        try {
            state.busy = 'Switching'; notify();
            const name = await carryOn(g, w, el.dataset.who ?? '');
            DS.pick = false;
            saveGame();
            const { syncScene } = await import('../sim/game.js');
            await syncScene(); refreshPrompt();
            if (name) toast(`You carry on as ${name}.`, 'success');
        } catch (e: any) { toast(String(e?.message ?? e), 'error'); }
        state.busy = ''; notify();
    },
    'death-chat': () => { refreshPrompt(); state.view = 'chat'; notify(); },
    'death-undo': async () => {
        const b = lastWords(); if (!b) return;
        if (!restoreBackup(b.i)) { toast('That save could not be restored.', 'error'); return; }
        const { syncScene } = await import('../sim/game.js');
        await syncScene();
        refreshPrompt();
        toast('You are back, a moment before. The save where you died is kept as a backup too.', 'info');
        notify();
    },
});
