// Click a character's sprite: a radial menu around them. On the right, what you can do with them (the same as their
// card in "Here", except "Play as them"); on the left, the outfits they have (subfolders of their Expressions folder),
// shown only when they have any.
import { esc, game, notify, state, toast, type Save, type Resident } from '../core/store.js';
import { getWorld, type WorldDef } from '../core/world.js';
import { ACT } from './reg.js';
import { icon } from './icons.js';
import { isWith, bondOf, isPartner, social } from '../sim/social.js';
import { ALONG_BOND } from '../sim/plans.js';
import { featureOn } from '../sim/creator.js';
import { stayButton } from './events.js';
import { romanceButtons } from './relui.js';
import { outfitOf, wearOutfit, charOf } from '../st/bridge.js';
import { outfitsOf, outfitLabel } from './outfits.js';
import { guestButtons } from './guestsui.js';
import { spriteMenuButtons } from './spritegen.js';

export const RAD = { who: '' };

const btn = (act: string, who: string, ic: string, label: string, extra = '') => `<button data-act="${esc(act)}" data-who="${esc(who)}" ${extra}>${icon(ic)}<span>${esc(label)}</span></button>`;
// The buttons of an HTML snippet (romance, stay), so they sit on the arc like the others.
const buttonsIn = (html: string) => html.match(/<button[\s\S]*?<\/button>/g) ?? [];

function actions(g: Save, w: WorldDef, r: Resident): string[] {
    if (!featureOn(w, 'plans')) return [];
    const b = bondOf(g, r.avatar), along = isWith(g, r.avatar), solo = String((social(g) as any).solo ?? '') === r.avatar;
    const out: string[] = [];
    if (!r.met) out.push(btn('pc-intro', r.avatar, 'chat', 'Introduce yourself'));
    out.push(along ? btn('pc-bye', r.avatar, 'back', 'Say goodbye')
        : btn('pc-along', r.avatar, 'users', 'Come with me', b >= ALONG_BOND || isPartner(g, r.avatar) ? '' : `aria-disabled="true" title="Get closer first (${b}/${ALONG_BOND})"`));
    out.push(btn('pc-plan', r.avatar, 'pin', 'Make plans'));
    out.push(solo ? `<button data-act="solo-off">${icon('users')}<span>Talk with everyone</span></button>` : btn('solo-on', r.avatar, 'chat', 'Talk only with them'));
    out.push(...buttonsIn(stayButton(r.avatar)), ...guestButtons(g, r.avatar), ...buttonsIn(romanceButtons(r.avatar)));
    out.push(btn('pc-open', r.avatar, 'user', 'Their card'));
    return out;
}
function outfits(avatar: string): string[] {
    const list = outfitsOf(avatar); if (!list?.length) return [];
    const cur = outfitOf(avatar);
    return [`<button data-act="spr-outfit" data-who="${esc(avatar)}" data-o="" class="${cur ? '' : 'is-on'}">👕<span>Default</span></button>`,
        ...list.map(o => `<button data-act="spr-outfit" data-who="${esc(avatar)}" data-o="${esc(o)}" class="${cur.toLowerCase() === o.toLowerCase() ? 'is-on' : ''}">👗<span>${esc(outfitLabel(o))}</span></button>`)];
}
// Puts the buttons on an arc: angle from top to bottom on each side.
const arc = (items: string[], side: 'l' | 'r') => {
    const n = items.length, step = n > 1 ? Math.min(17, 100 / (n - 1)) : 0;
    return items.map((h, k) => h.replace('<button', `<button style="--a:${((k - (n - 1) / 2) * step).toFixed(1)}deg;--k:${k}" data-rad="${esc(side)}"`)).join('');
};

// The menu for one sprite (empty when closed). `r` is null for someone who is not one of the world's people (a scenario's card).
export function radialHtml(avatar: string, r: Resident | null): string {
    if (RAD.who !== avatar) return '';
    const g = game(); const w = g && getWorld(g.world); if (!g || !w) return '';
    const right = r ? actions(g, w, r) : [], left = [...outfits(avatar), ...spriteMenuButtons(avatar)];
    if (!right.length && !left.length) return '';
    return `<div class="mu-radial" role="menu" aria-label="${esc(r?.name ?? String(charOf(avatar)?.name ?? ''))}">
        <div class="mu-rad-side is-left">${arc(left, 'l')}</div><div class="mu-rad-side is-right">${arc(right, 'r')}</div></div>`;
}

Object.assign(ACT, {
    'spr-menu': (el, e) => {
        if ((e?.target as HTMLElement)?.closest?.('.mu-radial')) return;
        const who = el.dataset.who ?? '';
        RAD.who = RAD.who === who ? '' : who; notify();
    },
    'spr-close': () => { if (RAD.who) { RAD.who = ''; notify(); } },
    'spr-outfit': async (el) => {
        const who = el.dataset.who!; const o = el.dataset.o ?? '';
        wearOutfit(who, o);
        delete (state.sprites as any)[who];   // the sprites of the new outfit are loaded again
        toast(o ? `${String(charOf(who)?.name ?? '')} is wearing: ${outfitLabel(o)}.` : `${String(charOf(who)?.name ?? '')} is back in the usual outfit.`, 'success');
        RAD.who = ''; notify();
    },
});
// Any choice in the menu closes it.
document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!RAD.who) return;
    if (t.closest?.('[data-rad]')) { setTimeout(() => { if (RAD.who) { RAD.who = ''; notify(); } }, 0); return; }
    if (!t.closest?.('.mu-sprite')) { RAD.who = ''; notify(); }
}, true);
