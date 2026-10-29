// Your own meters in the HUD (Warmth, Weariness…): bars under the others; a click sets one by hand.
import type { Save } from '../core/store.js';
import { game, esc, notify, saveGame } from '../core/store.js';
import { metersOf, meterWord, setMeter } from '../sim/meters.js';
import { refreshPrompt } from '../sim/prompt.js';
import { cssColor } from '../core/safe.js';
import { icon } from './icons.js';
import { ACT } from './reg.js';

export const meterBars = (g: Save) => metersOf(g).map(m => {
    const v = m.max ? Math.round((m.value / m.max) * 100) : 100;
    return `<button class="mh-bar mh-meter" data-act="mt-set" data-id="${esc(m.id)}" data-word="${esc(`${m.name}: ${meterWord(m)}${m.note ? ` · ${m.note}` : ''}`)}" title="${esc(`${m.name} ${meterWord(m)}. Click to change it.`)}" style="--c:${cssColor(m.color) || '#f59e0b'};--v:${v}">
                <span class="mh-bar-ic">${icon('sparkles')}</span><span class="mh-bar-name">${esc(m.name)} <small>${esc(meterWord(m))}</small></span><span class="mh-bar-track"><i></i></span></button>`;
}).join('');

Object.assign(ACT, {
    'mt-set': (el: HTMLElement) => {
        const g = game(); const m = metersOf(g).find(x => x.id === el.dataset.id); if (!g || !m) return;
        const raw = window.prompt(`${m.name}${m.max ? ' (value/max, or just the value)' : ''}`, meterWord(m));
        if (raw === null) return;
        const [v, mx] = raw.split('/').map(x => Number(x.trim()));
        if (!Number.isFinite(v)) return;
        setMeter(g, m.id, v, Number.isFinite(mx) ? mx : undefined);
        saveGame(); refreshPrompt(); notify();
    },
});
