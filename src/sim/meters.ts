// Your own meters: numbers a character's own rules give them (Warmth, Weariness, Blight, Remembrance…), made at the
// start of a game from a persona's lorebook or by hand. The AI is told them with every reply and keeps them up to date:
// when the story changes one, it ends its reply with a tag like [Warmth: 133/200], which Mundi reads back.
import type { Save } from '../core/store.js';
import { game, saveGame } from '../core/store.js';
import { on, chat } from '../st/bridge.js';

export interface Meter { id: string; name: string; value: number; max: number; /** how it fills and empties, told to the AI */ note?: string; color?: string }
export const metersOf = (g: Save | null | undefined): Meter[] => (g ? ((g as any).meters ??= []) : []);
const COLORS = ['#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#f87171'];
const clean = (s: any, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Meters as given (by the AI or by hand), cleaned: a name, a whole value, a max (0 for none). */
export function makeMeters(list: any[]): Meter[] {
    const out: Meter[] = [];
    for (const x of Array.isArray(list) ? list : []) {
        const name = clean(x?.name, 30); if (!name || out.some(m => m.name.toLowerCase() === name.toLowerCase())) continue;
        const max = Math.max(0, Math.round(Number(x?.max) || 0));
        let value = Math.round(Number(x?.value) || 0); if (max) value = Math.min(max, value);
        out.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `m${out.length}`, name, value, max, ...(clean(x?.note, 200) ? { note: clean(x?.note, 200) } : {}), color: COLORS[out.length % COLORS.length] });
        if (out.length >= 6) break;
    }
    return out;
}
export const meterWord = (m: Meter) => (m.max ? `${m.value}/${m.max}` : `${m.value}`);

/** What the AI is told about your meters (nothing without any). */
export function meterLines(g: Save): string[] {
    listen();
    const list = metersOf(g); if (!list.length) return [];
    return [`{{user}}'s own meters: ${list.map(m => `${m.name} ${meterWord(m)}${m.note ? ` (${m.note})` : ''}`).join('; ')}. When something in this reply changes one of them, end the reply with one tag per changed meter, like [${list[0].name}: ${list[0].max ? `${Math.max(0, list[0].value - 5)}/${list[0].max}` : Math.max(0, list[0].value - 5)}].`];
}

/** Reads the meter tags in a reply ([Warmth: 133/200], [Weariness: 50]) and sets those meters. True when one changed. */
export function readMeterTags(g: Save, text: string): boolean {
    const list = metersOf(g); if (!list.length || !text) return false;
    let changed = false;
    for (const t of text.matchAll(/\[\s*([^\[\]:\n]{1,40}?)\s*:\s*(-?\d+)\s*(?:\/\s*(\d+))?\s*\]/g)) {
        const m = list.find(x => x.name.toLowerCase() === t[1].trim().toLowerCase()); if (!m) continue;
        const max = t[3] !== undefined ? Number(t[3]) : m.max;
        const value = max ? Math.max(0, Math.min(Number(t[2]), max)) : Number(t[2]);
        if (value !== m.value || max !== m.max) { m.value = value; m.max = max; changed = true; }
    }
    return changed;
}
/** Sets one meter by hand. */
export function setMeter(g: Save, id: string, value: number, max?: number) {
    const m = metersOf(g).find(x => x.id === id); if (!m) return;
    if (max !== undefined && Number.isFinite(max)) m.max = Math.max(0, Math.round(max));
    m.value = Math.round(m.max ? Math.min(value, m.max) : value);
}

// The replies are read as they come (once, after the first prompt is built: SillyTavern is up by then).
let listening = false;
function listen() {
    if (listening) return; listening = true;
    on('MESSAGE_RECEIVED', (id: number) => {
        const g = game(); const m = chat()[id];
        if (!g || !m || m.is_user || m.is_system) return;
        if (readMeterTags(g, String(m.mes ?? ''))) saveGame();
    });
}
