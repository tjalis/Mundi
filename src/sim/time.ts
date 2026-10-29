// Game time. Day 1 is a Monday. One "tick" path moves time for everything: travel, work, sleep and the
// running clock all call advance(), which also applies the world's timed rules (status decay, rent).
import type { Save } from '../core/store.js';
import type { WorldDef } from '../core/world.js';
import { applyTimedRules } from './needs.js';
import { onHour, onDay } from './hooks.js';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const weekday = (day: number) => WEEKDAYS[(day - 1) % 7];
export const isWeekend = (day: number) => (day - 1) % 7 >= 5;
export const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
export const hour = (g: Save) => Math.floor(g.minutes / 60);

// Seasons: the year starts in spring and each season lasts `seasonDays` days (14 by default, World → Rules).
// The pictures are emoji for now.
export const SEASONS = [{ id: 'spring', name: 'Spring', icon: '🌸' }, { id: 'summer', name: 'Summer', icon: '🌻' }, { id: 'autumn', name: 'Autumn', icon: '🍂' }, { id: 'winter', name: 'Winter', icon: '❄️' }] as const;
export const seasonDays = (g: Save) => Math.max(1, Math.round((g as any).cfg?.seasonDays ?? 14));
export const seasonOf = (g: Save) => SEASONS[Math.floor((Math.max(1, g.day) - 1) / seasonDays(g)) % 4];

export function period(w: WorldDef, minutes: number) {
    let cur = w.time.periods[0];
    for (const p of w.time.periods) if (minutes >= p.from) cur = p;
    return cur;
}

// Minutes until the next period starts (for "skip to the next period").
export function toNextPeriod(w: WorldDef, minutes: number) {
    const next = w.time.periods.find(p => p.from > minutes);
    return (next ? next.from : 1440 + w.time.periods[0].from) - minutes;
}

// Other systems hook in (hooks.ts): once per game hour, and once per new day (breakdowns, invitations, goals…).

// Moves time forward. Returns the messages the world's rules produced (rent, passing out…).
export function advance(g: Save, w: WorldDef, mins: number): string[] {
    const out: string[] = [];
    if ((g as any).mortal?.dead) return out;   // a dead hero's world stands still
    let left = Math.max(0, mins);
    while (left > 0) {
        const step = Math.min(left, 30);   // rules run at most every 30 game minutes, so long jumps stay correct
        const h0 = Math.floor(g.minutes / 60), d0 = g.day;
        g.minutes += step;
        while (g.minutes >= 1440) { g.minutes -= 1440; g.day += 1; }
        left -= step;
        out.push(...applyTimedRules(g, w));
        if (Math.floor(g.minutes / 60) !== h0 || g.day !== d0) for (const f of onHour) out.push(...f(g, w));
        if (g.day !== d0) for (const f of onDay) out.push(...f(g, w));
    }
    return out;
}
