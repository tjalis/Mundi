// State in three layers:
//  - settings(): Mundi's own settings, saved by SillyTavern (interface preferences, the list of games);
//  - game(): the current save, stored INSIDE the open group chat's metadata (the save is the chat itself);
//  - state: this session only (open screens, selection, drafts), never saved.
import { ctx } from '../st/bridge.js';
import type { Routine } from './world.js';

export const EXT = 'mundi';
export const ROOT_ID = 'mundi-root';
// Phones: 'port' (upright: the HUD stacks in rows over the dialogue box), 'land' (sideways: the HUD on the left half, the dialogue box on the right), '' (a computer).
export function deviceMode(): '' | 'port' | 'land' {
    const mq = (q: string) => !!globalThis.matchMedia?.(q).matches;
    if (mq('(max-width: 760px)')) return 'port';
    if (mq('(pointer: coarse) and (max-height: 520px)')) return 'land';
    return '';
}
// Mundi's screen is zoomed by the Overall scale: what the browser measures (mouse, getBoundingClientRect) is on the
// screen, while positions set inside Mundi are before the zoom. Divide screen pixels by this to place things inside.
export function uiZoom(): number {
    const m = document.getElementById('mundi-main');
    const z = m && m.offsetWidth ? m.getBoundingClientRect().width / m.offsetWidth : 1;
    return z > 0.2 && z < 5 ? z : 1;
}
export const onPhone = () => !!document.getElementById(ROOT_ID)?.dataset.mobile;

export interface UiPrefs {
    theme: 'dark'; scale: number; sceneText: number;
    sound: boolean; volume: number; music: boolean; musicVolume: number;
    /** weather sounds (the rain), apart from the interface sounds */ weatherSound: boolean; weatherVolume: number;
    /** a thing you do in a scene (shower, cook…): the AI narrates it right away */ narrateActions: boolean;
    /** characters' texts (answers to invitations, letters…) written by the AI; off: short ready-made replies */ aiTexts: boolean;
    hudAutoHide: boolean; dialogOpacity: number; accent: string;
    layout: 'vn' | 'classic' | 'cards'; vn: 'box' | 'nobox' | 'subtitle';   // how the scene shows the conversation
    dialogPos?: 'center' | 'left'; spriteSize?: number; spriteY?: number; spriteW?: number; cardMode?: boolean;
    font?: string; primary?: string; secondary?: string;
    chatSwap?: boolean; avatarShape?: 'none' | 'circle' | 'square' | 'rect'; imgLayout?: 'left' | 'center' | 'right' | 'wrap';
    dialogBlur?: number; colors?: Record<string, string>; dateFormat?: string; timeFormat?: '24' | '12';
    scalePhone?: number; scaleLand?: number; hudPhone?: number; hudLand?: number;   // hud*: the game HUD on a phone, on top of the overall scale
      // the overall scale on a phone (upright and sideways); `scale` is for computers
}
export interface LastPlayed { kind: 'world' | 'chat'; group?: string; avatar?: string; chatId?: string; /** a world attached to one of your own chats */ attached?: boolean }
export interface GameEntry { groupId: string; world: string; title: string; persona: string; created: number; last: number }
// A world attached to one of your own chats (one-on-one or group): the chat stays yours, the save lives in it.
export interface AttachedEntry extends GameEntry { chatId: string; avatar?: string; attached: true }
export interface Settings {
    lang: string; openOnStart: boolean; ui: UiPrefs; games: GameEntry[]; lastGame: string | null;
    last: LastPlayed | null;   // what "Continue" opens: the last world save or scenario chat played in Mundi
    uiLoc?: Record<string, Record<string, string>>;
    lib: LibPrefs;
    /** groups of people the player made in the Library (Presets): who, households, relations, how they see you */
    castPresets?: CastPreset[];
    /** worlds attached to your own chats (sim/attach.ts) */
    attached?: AttachedEntry[];
    /** RPG systems you made (from lorebooks, or saved from a world): chosen like the built-in ones */
    rpgSystems?: { id: string; name: string; desc: string; def: any }[];
}
export interface CastPreset { id: string; name: string; cast: string[]; hh: { members: string[]; ties: { a: string; b: string; type: string; tone: string }[] }[]; rels: { a: string; b: string; type: string; tone: string }[]; approval: Record<string, number> }
// Favorites and folders for personas and lorebooks (SillyTavern only has them for characters, as folder tags).
export interface LibFolder { id: string; name: string; items: string[] }
export interface LibPrefs { view: 'list' | 'grid'; fav: Record<string, string[]>; folders: Record<string, LibFolder[]> }

const UI_DEFAULTS: UiPrefs = {
    theme: 'dark', scale: 100, sceneText: 100, sound: true, volume: 50, music: true, musicVolume: 35, weatherSound: true, weatherVolume: 60, narrateActions: true, aiTexts: true,
    hudAutoHide: false, dialogOpacity: 80, accent: 'blue', layout: 'vn', vn: 'box',
    dialogPos: 'center', spriteSize: 100, spriteW: 100, spriteY: 0, cardMode: true, font: 'default', avatarShape: 'rect', imgLayout: 'left', dialogBlur: 12, dateFormat: 'DD/MM/YYYY', timeFormat: '24',
    scalePhone: 85, scaleLand: 80, hudPhone: 85, hudLand: 80,
};

let ready: Settings | null = null;
export function settings(): Settings {
    const all = ctx().extensionSettings;
    const s = (all[EXT] ??= {}) as Settings;
    if (ready === s) return s;
    s.lang ??= 'en';
    s.openOnStart ??= false;
    s.ui ??= { ...UI_DEFAULTS };
    for (const [k, v] of Object.entries(UI_DEFAULTS)) (s.ui as any)[k] ??= v;
    s.games ??= [];
    s.lastGame ??= null;
    s.last ??= s.lastGame ? { kind: 'world', group: s.lastGame } : null;
    s.lib ??= { view: 'list', fav: {}, folders: {} };
    s.lib.fav ??= {}; s.lib.folders ??= {}; s.lib.view ??= 'list';
    ready = s;
    return s;
}
export const UI = () => settings().ui;
export const saveSettings = () => ctx().saveSettingsDebounced();

/* ---------- the save, inside the chat ---------- */

export interface Resident {
    avatar: string; name: string; occupation: string | null;
    home: { zone: string; x: number; y: number; n?: number; /** a second (third…) flat at the same address, when every home is taken */ unit?: number };
    routine: Routine; leisure: string[]; met: boolean;
}
export interface Save {
    v: 1; world: string; lang: string; day: number; minutes: number; speed: number; asleep?: boolean;
    player: {
        loc: string; home: { zone: string; kind: string; x: number; y: number; n?: number };
        stats: Record<string, number>; money: number; traits: Record<string, string[]>; attrs?: Record<string, number>; origin: string;
        job: { id: string; rank: number; shifts: number; path?: string[]; referral?: string } | null; rentPaidDay: number;
    };
    cast: Record<string, Resident>;
    tick: Record<string, number>;   // last time (absolute minutes) each timed rule ran
    log: { day: number; minutes: number; text: string }[];
}

// The open chat's save, or null when the open chat is not a Mundi game.
// Per-save world settings (Globe → World → Advanced). Missing values mean the world's defaults.
export interface WorldCfg { /** Home: minutes pass with each message (default on) */ perMessage?: boolean; /** Home: the housemates leave the house (work, errands, nights out; default on) */ npcOut?: boolean; travel?: number; decay?: number; bondCap?: number; seasonDays?: number; lore?: string[]; clock?: 'action' | 'live'; /** open relationships: no jealousy, date several people freely */ poly?: boolean }
export const cfg = (g: Save): WorldCfg => (((g as any).cfg ??= {}) as WorldCfg);
// How time passes: "action" (default) only what you do moves the clock (eating, sleeping, working, travelling);
// "live" the clock also runs by itself in real time (World → Rules).
export const clockMode = (g: Save) => cfg(g).clock ?? 'action';
// The tutorial's practice world: a save kept only in memory (no chat, no group, nothing written to SillyTavern).
export const TUT = { save: null as Save | null };
// Save safety (core/saves.ts): the first time a save is seen it is checked once (migrated to the current format,
// backed up first, and its links to the world repaired). A save from a newer Mundi is never written: the game plays
// a detached copy of it (`SAVE.shadow`), so nothing, not even SillyTavern saving the chat, can overwrite the original.
export const SAVE = {
    hooks: [] as ((g: Save) => void)[],
    seen: new WeakSet<object>(),
    shadow: new WeakMap<object, Save>(),
    readOnly: false,
};
export function game(): Save | null {
    if (TUT.save) return TUT.save;
    const m = ctx().chatMetadata;
    const g = m?.mundi?.v === 1 ? (m.mundi as Save) : null;
    if (!g) return null;
    if (!SAVE.seen.has(g)) { SAVE.seen.add(g); SAVE.readOnly = false; for (const h of SAVE.hooks) h(g); }
    return SAVE.shadow.get(g) ?? g;
}
export function setGame(s: Save) { ctx().chatMetadata.mundi = s; }
export const saveGame = () => { if (!TUT.save && !SAVE.readOnly) ctx().saveMetadataDebounced(); };
export const nowAbs = (g: Save) => g.day * 1440 + g.minutes;
// A save attached to one of your own chats: which chat it is, where the world started in it, and what attaching
// changed in the chat (put back when the world is detached).
export interface Host {
    kind: 'solo' | 'group'; avatar?: string; group?: string; chatId: string;
    /** the chat's length when the world was attached: Mundi never hides or touches the lines before it */
    attachedAt: number;
    /** the world's lorebook, and the chat's lorebooks before attaching */
    lore: string; prevLore: string[];
    /** the world's Author's Note went in (the chat had none) */
    noteSet?: boolean;
    /** a group chat's muted members before attaching */
    prevDisabled?: string[];
}
export const hostOf = (g: Save | null | undefined): Host | null => ((g as any)?.host ?? null);

/* ---------- session ---------- */

export type View = 'menu' | 'load' | 'settings' | 'newgame' | 'map' | 'scene' | 'library' | 'gallery' | 'chat' | 'worldcfg' | 'creator';
export const state = {
    open: false,
    view: 'menu' as View,
    menuTab: 'main',
    settingsTab: 'game',
    sel: null as string | null,            // place selected on the map
    busy: '' as string,                    // a message while something slow happens ('' = idle)
    generating: false,
    wizard: null as any,                   // new game wizard data
    modal: null as any,
    sprites: {} as Record<string, any[] | null>,
    composer: '',
    impersonating: false,
    backTo: 'menu' as View,
    mapView: { z: 1, x: 0, y: 0 },
    saves: null as any[] | null,           // load screen cache
    lib: {                                 // library screen
        tab: 'characters', scope: '', q: '', sel: null as string | null, entry: null as string | null,
        edit: false, adv: false, draft: {} as Record<string, any>, lore: null as { name: string; data: any } | null,
        picked: [] as string[], anchor: null as string | null, picking: false, folder: null as string | null, favOnly: false,
        searching: false, expr: null as string | null, sprites: null as any[] | null, bgs: null as any,
    },
    gal: { albums: null as any[] | null, album: null as string | null, photo: null as number | null },   // gallery screen
};

/* ---------- drawing ---------- */

let renderFn: (() => void) | null = null;
let queued = false;
export const onRender = (fn: () => void) => { renderFn = fn; };
export function notify() {
    if (queued) return;
    queued = true;
    const run = () => { if (!queued) return; queued = false; renderFn?.(); };
    requestAnimationFrame(run);
    setTimeout(run, 120);   // the tab may be in the background, where animation frames stop
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!));
export const asset = (f: string) => new URL(`../../assets/${f}`, import.meta.url).href;

export function toast(msg: string, kind: 'info' | 'success' | 'error' | 'warn' = 'info', o: { source?: string; title?: string; ms?: number } = {}) {
    const host = document.getElementById('mundi-toasts');
    if (!host) { console.log('[Mundi]', msg); return; }
    const el = document.createElement('div');
    el.className = `mu-toast is-${kind} ${o.source ? 'is-ext' : ''}`;
    if (o.source) {
        // a message from SillyTavern itself (or one of its extensions): shown as it is, never translated by Mundi
        el.innerHTML = `<small class="mu-toast-src">(${esc(o.source)})</small>${o.title ? `<b data-notr>${esc(o.title)}</b>` : ''}<span data-notr>${esc(msg)}</span>`;
    } else el.textContent = msg;
    // a close button that shows when the mouse is over it; while the mouse is over it, it does not go away
    const x = document.createElement('button');
    x.className = 'mu-toast-x'; x.type = 'button'; x.title = 'Close'; x.setAttribute('aria-label', 'Close'); x.textContent = '✕';
    x.addEventListener('click', (e) => { e.stopPropagation(); el.remove(); });
    el.appendChild(x);
    host.appendChild(el);
    (globalThis as any).__muSfx?.(kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'info');
    const ms = o.ms ?? 3600;
    let t1 = 0, t2 = 0;
    const arm = (wait: number) => { t1 = window.setTimeout(() => el.classList.add('is-out'), wait); t2 = window.setTimeout(() => el.remove(), wait + 400); };
    el.addEventListener('mouseenter', () => { clearTimeout(t1); clearTimeout(t2); el.classList.remove('is-out'); });
    el.addEventListener('mouseleave', () => arm(1500));
    el.addEventListener('click', () => el.remove());
    arm(ms);
}

export function busy<T>(label: string, job: () => Promise<T>): Promise<T> {
    state.busy = label; notify();
    return job().finally(() => { state.busy = ''; notify(); });
}
