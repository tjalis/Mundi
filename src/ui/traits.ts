// Traits: ready-made descriptions picked as chips (e.g. Proficiency: strong, smart), as many as you like unless the
// group has a limit, plus your own words ("write your own").
import { esc } from '../core/store.js';
import type { TraitGroup } from '../core/world.js';
import { traitMax } from '../core/traitlib.js';
import { icon } from './icons.js';

export function traitsHtml(groups: TraitGroup[], picked: Record<string, string[]>, act: string) {
    return groups.map(g => {
        const mine = picked?.[g.id] ?? [], max = traitMax(g);
        const own = mine.filter(x => !g.options.includes(x));
        const full = !!max && mine.length >= max;
        return `<div class="mu-field mu-traits"><span>${esc(g.label)} <small>${max ? `${mine.length}/${max}` : mine.length ? `${mine.length} picked` : 'pick any'}</small></span>
            <div class="mu-chips">${[...g.options, ...own].map(o => {
                const on = mine.includes(o);
                return `<button class="mu-chip ${on ? 'is-on' : ''}" data-act="${esc(act)}" data-k="${esc(g.id)}" data-v="${esc(o)}" ${!on && full ? 'aria-disabled="true"' : ''}>${esc(o)}</button>`;
            }).join('')}</div>
            <div class="mu-row mu-trait-own"><input data-focus="tro-${esc(g.id)}" data-enter="${esc(act)}-own" data-k="${esc(g.id)}" maxlength="40" placeholder="Write your own (${esc(g.label.toLowerCase())})" ${full ? 'disabled' : ''}>
                <button class="mu-ghost" data-act="${esc(act)}-own" data-k="${esc(g.id)}" ${full ? 'aria-disabled="true"' : ''}>${icon('plus')}<span>Add</span></button></div></div>`;
    }).join('');
}

export function toggleTrait(groups: TraitGroup[], picked: Record<string, string[]>, id: string, value: string) {
    const g = groups.find(x => x.id === id);
    if (!g) return;
    const mine = (picked[id] ??= []);
    const i = mine.indexOf(value);
    if (i >= 0) mine.splice(i, 1);
    else if (!traitMax(g) || mine.length < traitMax(g)) mine.push(value);
}

// "Write your own": the text next to the button (or the field itself, on Enter) becomes a picked trait.
export function addOwnTrait(groups: TraitGroup[], picked: Record<string, string[]>, el: HTMLElement): boolean {
    const id = el.dataset.k!;
    const input = (el.tagName === 'INPUT' ? el : el.parentElement?.querySelector('input')) as HTMLInputElement | null;
    const v = (input?.value ?? '').replace(/\s+/g, ' ').trim().replace(/^./, c => c.toUpperCase());
    const g = groups.find(x => x.id === id);
    if (!v || !g) return false;
    const mine = (picked[id] ??= []);
    const same = [...g.options, ...mine].find(x => x.toLowerCase() === v.toLowerCase());
    if (same) { if (!mine.includes(same)) toggleTrait(groups, picked, id, same); }
    else if (!traitMax(g) || mine.length < traitMax(g)) mine.push(v);
    if (input) input.value = '';
    return true;
}

export const traitLines = (groups: TraitGroup[], picked: Record<string, string[]>) =>
    groups.filter(g => picked?.[g.id]?.length).map(g => `${g.label}: ${picked[g.id].join(', ')}`);
