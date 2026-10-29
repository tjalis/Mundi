// Places: the world's public places plus homes (the player's and each resident's). Distances and travel time.
import { travelFactor } from './life.js';
import { cfg, nowAbs, type Save } from '../core/store.js';
import { isScenario, type WorldDef, type Place } from '../core/world.js';

export const playerHomeId = 'home:player';
export const isHome = (id: string) => id.startsWith('home:');
// "North Suburbs, House 4": every home spot of the map has a fixed number.
// The kind of home is named by the world (Apartment, House / Cottage, Manor…).
export const homeKindName = (w: WorldDef, kind: string) => w.homes.kinds[kind]?.name ?? (kind === 'house' ? 'House' : 'Apartment');
export function homeAddress(w: WorldDef, h: { zone: string; x: number; y: number; n?: number; kind?: string; unit?: number }) {
    const zone = w.homes.zones.find(z => z.id === h.zone);
    if (!zone) return '';
    const n = h.n ?? (zone.spots.findIndex(s => s[0] === h.x && s[1] === h.y) + 1);
    return `${zone.name}, ${homeKindName(w, h.kind ?? zone.kind)} ${n || 1}${h.unit ? String.fromCharCode(65 + h.unit) : ''}`;
}

export function placeOf(g: Save, w: WorldDef, id: string): (Place & { home?: boolean; owner?: string }) | null {
    if (id === playerHomeId) {
        const h = g.player.home, kind = w.homes.kinds[h.kind];
        // a home inside a building (a room in a guild tower): one of its floors, at its pin
        const b = h.in ? [...w.places, ...addedPlaces(g)].find(p => p.id === h.in) : null;
        if (b) return { id, name: 'My home', map: b.map, x: b.x, y: b.y, tags: ['home'], desc: `${h.room || 'A room'} in ${b.name}, where {{user}} lives`, home: true, in: b.id, floor: h.room || 'Your room' };
        const zone = w.homes.zones.find(z => z.id === h.zone);
        return { id, name: 'My home', map: zone?.map ?? w.maps[0].id, x: h.x, y: h.y, tags: ['home'], desc: `${homeAddress(w, h)}: ${kind?.desc ?? ''}`, home: true };
    }
    if (isHome(id)) {
        const r = g.cast[id.slice(5)];
        if (!r) {
            // a guest who just left the room you are in (you said goodbye there): it stays, empty, until you walk out
            const v = (g as any).vacated as { id: string; home: { zone: string; x: number; y: number } } | undefined;
            if (!v || v.id !== id || g.player.loc !== id) return null;
            const zone = w.homes.zones.find(z => z.id === v.home.zone);
            return { id, name: 'Empty bedroom', map: zone?.map ?? w.maps[0].id, x: v.home.x, y: v.home.y, tags: ['home'], desc: zone?.desc ?? '', home: true };
        }
        // someone who lives with another person is at that person's home (or yours)
        const w2 = (r as any).homeWith as string | undefined;
        if (w2 === '__you') return placeOf(g, w, playerHomeId);
        if (w2 && w2 !== r.avatar && g.cast[w2]) return placeOf(g, w, `home:${w2}`);
        const zone = w.homes.zones.find(z => z.id === r.home.zone);
        const mates = Object.values(g.cast).filter(x => x.home.zone === r.home.zone && x.home.x === r.home.x && x.home.y === r.home.y && (x.home.unit ?? 0) === (r.home.unit ?? 0) && (x.met || x === r)).map(x => x.name);
        const label = mates.length <= 1 ? r.name : mates.length === 2 ? `${mates[0]} & ${mates[1]}` : `${r.name} & family`;
        return { id, name: `${label}'s home`, map: zone?.map ?? w.maps[0].id, x: r.home.x, y: r.home.y, tags: ['home'], desc: `${homeAddress(w, r.home)}: ${zone?.desc ?? ''}`, home: true, owner: r.avatar };
    }
    if (isOuting(id)) return { id, name: outingName(id), map: w.maps[0]?.id ?? '', x: 50, y: 50, tags: ['outing'], desc: `out of the house: ${outingName(id)}` };
    return w.places.find(p => p.id === id) ?? extraRooms(g).find(p => p.id === id) ?? addedPlaces(g).find(p => p.id === id) ?? null;
}
/* ---------- places found, opened or added in this game (they live in the save, so each playthrough finds its own) ---------- */
const found = (g: Save | null | undefined): { found?: string[]; open?: string[]; added?: Place[] } => (g as any)?.discovery ?? {};
/** Places this game added: found in the story ("a place we just found"), and gates. */
export const addedPlaces = (g: Save | null | undefined): Place[] => found(g).added ?? [];
/** Hidden and not found yet in this game (the floors of a hidden building are hidden with it). */
export function hiddenNow(g: Save | null | undefined, w: WorldDef, p: Place): boolean {
    const seen = found(g).found ?? [];
    if (p.hidden && !seen.includes(p.id)) return true;
    const b = p.in ? w.places.find(x => x.id === p.in) : null;
    return !!b && b.id !== p.id && !!b.hidden && !seen.includes(b.id);
}
/** Why you cannot go in ('' when you can): restricted and not opened in this game, or in a building that is. */
export function lockedNow(g: Save | null | undefined, w: WorldDef, p: Place): string {
    const open = found(g).open ?? [];
    // let in for this visit (knocked, or sneaked in: sim/moreacts.ts), until you leave or the hours run out
    const guest = (g as any)?.discovery?.guest as { id: string; until: number } | undefined;
    if (guest && g && guest.until > nowAbs(g) && (guest.id === p.id || guest.id === p.in)) return '';
    if (p.restricted && !open.includes(p.id)) return p.restricted;
    const b = p.in ? w.places.find(x => x.id === p.in) : null;
    return b && b.id !== p.id && b.restricted && !open.includes(b.id) ? b.restricted : '';
}
/** The floors of a building that this game knows of (in the world's order). */
export const floorsOf = (g: Save, w: WorldDef, id: string): Place[] => [...[...w.places, ...addedPlaces(g)].filter(p => p.in === id && p.id !== id && !hiddenNow(g, w, p)),
    ...(g.player?.home?.in === id ? [placeOf(g, w, playerHomeId)!] : [])];   // your home, when it is in this building
/** The building a place is part of: its own id when it has floors, the building's for a floor, else ''. */
export function buildingOf(g: Save, w: WorldDef, id: string): string {
    const p = placeOf(g, w, id);
    if (p?.in && placeOf(g, w, p.in)) return p.in;
    return p && floorsOf(g, w, id).length ? id : '';
}
/** "Floor 4 · Infirmary": a floor's name with its floor (just the name for any other place). */
export const floorName = (p: Place) => (p.floor && p.in ? `${p.floor} · ${p.name}` : p.name);
/** Home: a place out of the house, named by the player ("out:the beach"). Going out, or a plan made somewhere out. */
export const OUTING = 'out:';
export const isOuting = (id: string | null | undefined) => !!id && id.startsWith(OUTING);
export const outingName = (id: string) => id.slice(OUTING.length);
export const outingId = (name: string) => `${OUTING}${name.trim().replace(/\s+/g, ' ').slice(0, 80)}`;
/** A scenario: rooms the player added for this game (a name, a picture, what it is for). */
export const extraRooms = (g: Save | null | undefined): Place[] => ((g as any)?.cfg?.extraRooms ?? []) as Place[];

// Every point on the map: public places, your home, and the homes of people you know.
// A scenario's rooms are chosen per game (cfg.rooms); without a choice, every room but those off by default.
// A room the Home got after the game began (an update of the world) is on, unless it is off by default.
export const roomsOn = (g: Save | null | undefined, w: WorldDef): string[] => {
    const own = (g as any)?.cfg?.rooms as string[] | undefined;
    const seen = (g as any)?.cfg?.roomsSeen as string[] | undefined;
    const fresh = own && seen ? w.places.filter(p => !p.scenarioOff && !p.link && !seen.includes(p.id) && !own.includes(p.id)).map(p => p.id) : [];
    return [...(own ?? w.places.filter(p => !p.scenarioOff && !p.link).map(p => p.id)), ...fresh, ...extraRooms(g).map(p => p.id)];
};
export const placeOn = (g: Save | null | undefined, w: WorldDef, id: string) => !isScenario(w) || !w.places.some(p => p.id === id) || roomsOn(g, w).includes(id);
export function pins(g: Save, w: WorldDef) {
    const out: (Place & { home?: boolean; owner?: string })[] = [...w.places.filter(p => placeOn(g, w, p.id) && !hiddenNow(g, w, p)), ...(isScenario(w) ? extraRooms(g) : addedPlaces(g))];
    const mine = placeOf(g, w, playerHomeId);
    if (mine) out.push(mine);
    // (a guest with no bedroom of their own, zone '__guest', has no room to show)
    for (const r of Object.values(g.cast)) if (r.met && r.home.zone !== '__guest') { const p = placeOf(g, w, `home:${r.avatar}`); if (p && !out.some(x => x.id === p.id)) out.push(p); }
    return out;
}

// Travel time, rounded to the world's steps (15, 20, 30…), so the clock stays readable. Between maps (two cities
// on a region map), the trip goes through the link pins on the bigger map.
// Travel takes a fixed time: 30 minutes inside a town (a local map), 2 hours between towns or across a region map
// (a map that other maps hang from), 10 hours between realms (in a world of realms: a top map whose maps have towns
// of their own, like the Three Crowns). The world's "travel" rule (advanced settings) scales them all.
export const LOCAL_TRIP = 30, GLOBAL_TRIP = 120, REALM_TRIP = 600;
// The realm a map belongs to: the map right under the top one, when it has maps of its own ('' otherwise).
export function realmOf(w: WorldDef, mapId?: string): string {
    let m = w.maps.find(x => x.id === mapId);
    for (let i = 0; m && m.parent && i < 10; i++) {
        const up = w.maps.find(x => x.id === m!.parent);
        if (!up) break;
        if (!up.parent) return w.maps.some(x => x.parent === m!.id) ? m.id : '';
        m = up;
    }
    return '';
}
export function travelMinutes(g: Save, w: WorldDef, from: string, to: string): number {
    if (from === to) return 0;
    if (isScenario(w)) return 0;   // Home: from one room to another takes no time
    const a = placeOf(g, w, from), b = placeOf(g, w, to);
    // up or down the stairs of one building: a few minutes, not a trip
    if (a && b && (a.in === b.id || b.in === a.id || (!!a.in && a.in === b.in))) return 5;
    const isRegion = (mapId?: string) => !!mapId && w.maps.some(m => m.parent === mapId) && !w.maps.find(m => m.id === mapId)?.town;
    const local = !!a && !!b && a.map === b.map && !isRegion(a.map);
    // districts and nearby villages: their own trip time to the town they hang from (siblings: the longer of the two)
    if (a && b && a.map !== b.map) {
        const ma = w.maps.find(m => m.id === a.map), mb = w.maps.find(m => m.id === b.map);
        const near = ma && mb && (ma.parent === mb.id || mb.parent === ma.id || (!!ma.parent && ma.parent === mb.parent));
        const t = near ? Math.max(ma.parent === mb.id || ma.parent === mb.parent ? ma.trip ?? 0 : 0, mb.parent === ma.id || ma.parent === mb.parent ? mb.trip ?? 0 : 0) : 0;
        if (t) return Math.max(5, Math.round(t * (cfg(g).travel ?? 1) * travelFactor(g, w) / 5) * 5);
    }
    const ra = realmOf(w, a?.map), rb = realmOf(w, b?.map);
    if (ra && rb && ra !== rb) return Math.max(5, Math.round(REALM_TRIP * (cfg(g).travel ?? 1) * travelFactor(g, w) / 5) * 5);
    return Math.max(5, Math.round((local ? LOCAL_TRIP : GLOBAL_TRIP) * (cfg(g).travel ?? 1) * travelFactor(g, w) / 5) * 5);
}
