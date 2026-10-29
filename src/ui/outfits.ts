// Outfits: subfolders of a character's Expressions folder (Frieren/pajamas). SillyTavern cannot list folders, so
// Mundi looks for the usual names by itself and remembers the ones you add (Library › Expressions).
import { settings, saveSettings, notify } from '../core/store.js';
import { fetchSprites, outfitOf } from '../st/bridge.js';

const COMMON = ['pajamas', 'pyjamas', 'pijama', 'sleepwear', 'casual', 'formal', 'dress', 'swimsuit', 'bikini', 'biquini', 'uniform', 'school', 'work', 'gym', 'sport', 'winter', 'summer', 'party', 'date', 'home', 'outdoor', 'armor', 'costume'];
const found = new Map<string, string[] | null>();   // null: still looking

const store = (): Record<string, string[]> => ((settings() as any).outfits ??= {});
export const savedOutfits = (avatar: string): string[] => store()[avatar] ?? [];
export function addOutfit(avatar: string, name: string) {
    const n = name.trim().replace(/[\\/:*?"<>|]+/g, '');
    if (!n) return '';
    const l = (store()[avatar] ??= []);
    if (!l.some(x => x.toLowerCase() === n.toLowerCase())) l.push(n);
    saveSettings(); return n;
}
export function removeOutfit(avatar: string, name: string) { store()[avatar] = savedOutfits(avatar).filter(x => x !== name); saveSettings(); }
export const forgetOutfits = (avatar: string) => { found.delete(avatar); for (const k of [...probed.keys()]) if (k.startsWith(`${avatar}|`)) probed.delete(k); };

async function look(avatar: string) {
    found.set(avatar, null);
    const hits: string[] = [];
    await Promise.all(COMMON.map(async n => { if ((await fetchSprites(avatar, n)).length) hits.push(n); }));
    found.set(avatar, COMMON.filter(n => hits.includes(n)));
    notify();
}
// The outfits a character has (null while Mundi is still looking).
export function outfitsOf(avatar: string): string[] | null {
    if (!found.has(avatar)) void look(avatar);
    const f = found.get(avatar);
    const all = [...savedOutfits(avatar), ...(f ?? [])];
    const cur = outfitOf(avatar); if (cur) all.unshift(cur);
    const seen = new Set<string>(); const out = all.filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    return f === null && !out.length ? null : out;
}
export const outfitLabel = (n: string) => n.charAt(0).toUpperCase() + n.slice(1).replace(/[-_]+/g, ' ');

// Does this character have an outfit with this name? (null while it is being checked; then the scene syncs again)
const probed = new Map<string, boolean | null>();
export function hasOutfit(avatar: string, name: string): boolean | null {
    const n = name.trim(); if (!n) return false;
    if ((outfitsOf(avatar) ?? []).some(x => x.toLowerCase() === n.toLowerCase())) return true;
    const key = `${avatar}|${n.toLowerCase()}`;
    if (!probed.has(key)) {
        probed.set(key, null);
        void fetchSprites(avatar, n).then(l => { probed.set(key, l.length > 0); if (l.length) void import('../sim/game.js').then(m => m.syncScene()).then(notify); });
    }
    return probed.get(key) ?? null;
}
