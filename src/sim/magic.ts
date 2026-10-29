// Magic (RPG mode): schools of magic, a grimoire of the spells you know, and the ones you have prepared. Spells are
// prepared after a long rest (as many as your level plus your casting modifier) and cost focus to cast. What a spell
// does is the engine's: it heals, gives the next check advantage or a bonus, calms a town, finds a rumor; the AI is
// told the spell was cast and narrates it.
import { spellFails, addStress, cleanse } from './afflictions.js';
import { setWeather } from './elements.js';
import type { Save } from '../core/store.js';
import type { WorldDef } from '../core/world.js';
import { rpgOf, type RpgSpell } from '../core/rpgdef.js';
import { sheetOf, maxPrepared, changeHp, hpMax, count, isRpg } from './rpg.js';
import { regionState, regionOf } from './worldstate.js';
import { note } from './facts.js';

export const spellOf = (w: WorldDef, id: string) => rpgOf(w)?.spells.find(s => s.id === id) ?? null;
export const knownSpells = (g: Save, w: WorldDef): RpgSpell[] => (sheetOf(g)?.known ?? []).map(id => spellOf(w, id)).filter((x): x is RpgSpell => !!x);
export const canPrepare = (g: Save) => !!sheetOf(g)?.prepOpen;

export function togglePrepared(g: Save, w: WorldDef, id: string): string {
    const s = sheetOf(g); if (!s || !s.known.includes(id)) return '';
    if (!s.prepOpen) return 'Spells are prepared after a long rest (a night\'s sleep or a night at camp).';
    if (s.prepared.includes(id)) { s.prepared = s.prepared.filter(x => x !== id); return ''; }
    if (s.prepared.length >= maxPrepared(w, s)) return `You can prepare ${maxPrepared(w, s)} spells.`;
    s.prepared.push(id); return '';
}

export interface Cast { ok: boolean; text: string; scene?: string; msgs: string[] }
export function cast(g: Save, w: WorldDef, id: string): Cast {
    const s = sheetOf(g); const sp = spellOf(w, id);
    if (!s || !sp || !isRpg(w)) return { ok: false, text: '', msgs: [] };
    if (!s.prepared.includes(id)) return { ok: false, text: `${sp.name} is not prepared.`, msgs: [] };
    if (sp.effect.kind === 'revive') return { ok: false, text: `${sp.name} only works in the minute after someone dies: it is cast for you then, if you have it prepared and the ${rpgOf(w)?.focusName?.toLowerCase() ?? 'focus'} for it.`, msgs: [] };
    if (s.focus < sp.cost) return { ok: false, text: `Not enough ${rpgOf(w)?.focusName?.toLowerCase() ?? 'focus'} (${sp.name} takes ${sp.cost}).`, msgs: [] };
    const fizzle = spellFails(g, w);
    if (fizzle && /too frayed/.test(fizzle)) return { ok: false, text: fizzle, msgs: [] };
    s.focus -= sp.cost; s.prepOpen = false; addStress(g, w, sp.cost);
    if (fizzle) return { ok: false, text: fizzle, msgs: [] };
    const e = sp.effect; let what = '';
    if (e.kind === 'heal') { const before = s.hp; changeHp(g, w, (hpMax(w, s) * e.amount) / 100); what = `You recover ${s.hp - before} hit points.`; }
    else if (e.kind === 'advantage') { s.next = { ...(s.next ?? {}), advantage: e.skills }; what = 'Your next check of the right kind will roll twice (keep the best).'; }
    else if (e.kind === 'bonus') { s.next = { ...(s.next ?? {}), bonus: { amount: e.amount, skills: e.skills } }; what = `+${e.amount} to your next check.`; }
    else if (e.kind === 'calm') { const r = regionState(g, w, regionOf(g, w, g.player.loc)); r.tension = Math.max(0, r.tension - e.amount); what = 'Tempers cool around you.'; }
    else if (e.kind === 'weather') { setWeather(g, w, e.to); what = e.to === 'rain' ? 'Clouds gather and rain begins to fall.' : 'The clouds part.'; }
    else if (e.kind === 'cleanse') { const gone = cleanse(g); what = gone.length ? `You are no longer ${gone.join(', ')}.` : 'A clean light washes over you.'; }
    else if (e.kind === 'rumor') {
        const pool: any[] = (g as any).living?.rumors ?? [];
        const r = pool.find(x => !x.knownBy.includes('__you'));
        if (r) { r.knownBy.push('__you'); r.heard = Date.now(); what = `You learn what people whisper: “${r.text}”`; } else what = 'The signs are quiet: nothing new is being said.';
    }
    note(g, '{u} cast {0}.', [sp.name], [], g.player.loc, 'skill');
    const msgs = count(g, w, 'casts');
    return { ok: true, text: `${sp.name}: ${what || sp.desc}`, scene: `[{{user}} just cast a spell: ${sp.name} (${sp.desc}). Describe it happening and how the people here react.]`, msgs };
}
