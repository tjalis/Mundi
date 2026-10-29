import { drawThumbs } from './thumbs.js';
import { htmlText } from '../core/safe.js';
import { deliverAsk } from '../sim/happenings.js';
import { deliverLetter } from '../sim/letters.js';
import { isWith } from '../sim/social.js';
import { lex } from '../core/lexicon.js';
import { rainAmbience } from './sfx.js';
import { tutorialHtml, placeTutorial, tutorialTick } from './tutorial.js';
import { coursesHtml } from './courses.js';
import { weatherHere } from '../sim/worldstate.js';
import { ttsNoise } from './addons.js';
import { helpHtml } from './help.js';
import { whatsNewHtml, updateHtml } from './whatsnew.js';
import { onComposerInput, onComposerKey, closeMention } from './mention.js';
import { morph } from './morph.js';
import { applyColors, setLookApplier } from './chatlook.js';
// The shell: mounts Mundi's full-screen layer over SillyTavern, draws the current screen, dispatches clicks and
// inputs, and runs the game clock.
import { FONTS } from './settings.js';
import { needWord } from '../sim/life.js';
import { state, notify, onRender, ROOT_ID, game, saveGame, UI, toast, settings, clockMode, deviceMode, uiZoom, esc } from '../core/store.js';
import { getWorld } from '../core/world.js';
import { installTranslator } from '../core/tr.js';
import { ACT, INPUT } from './reg.js';
import { menuHtml } from './menu.js';
import { settingsHtml } from './settings.js';
import { newGameHtml } from './newgame.js';
import { mapHtml, applyMapView, mapInput, journeyHtml } from './map.js';
import { rpgOverlays } from './rpgui.js';
import { combatHtml } from './combatui.js';
import { deathHtml } from './deathui.js';
import { audienceHtml } from './factionsui.js';
import { diceHtml } from './dice.js';
import { arrestHtml } from './adventureui.js';
import { discoveryHtml } from './discoveryui.js';
import { sceneHtml, afterScene, chatHtml } from './scene.js';
import { worldCfgHtml } from './worldcfg.js';
import { styleOf } from '../core/world.js';
import { skinOf } from './skins.js';
import { creatorHtml, CW } from './creator.js';
const creatorWorld = () => CW.w ?? (CW.start ? getWorld(CW.start.base) ?? null : null);
import { hudHtml, clock12, ampm } from './hud.js';
import { libraryHtml, libraryEscape } from './library.js';
import { galleryHtml, closeLightbox } from './gallery.js';
import { refreshList, chat } from '../st/bridge.js';
import { runPlans, PL } from './plans.js';
import { syncNative, releaseNative, guardBackgrounds } from './native.js';
import { phoneHtml, P as phone, feedTick } from './phone.js';
import { advance, period, weekday } from '../sim/time.js';
import { presentAt, residents, whereNow } from '../sim/people.js';
import { syncScene } from '../sim/game.js';
import { refreshPrompt } from '../sim/prompt.js';

const root = () => document.getElementById(ROOT_ID);

const PALETTES: Record<string, string[]> = {
    blue: ['#66bbff', '#4fb0ff', '#1e88e5', '#1a72c8', '#12599c', '#fff'], green: ['#7fe06a', '#5fcf45', '#36a81c', '#2b8c14', '#1f6b0d', '#fff'],
    red: ['#ff8e8e', '#ff6b6b', '#e23b41', '#c22a31', '#941d23', '#fff'], purple: ['#c3a4ff', '#a57cff', '#7c4ddb', '#653bbd', '#4b2a91', '#fff'],
    pink: ['#ff9fd0', '#ff7abd', '#e7489a', '#c8327f', '#98235f', '#fff'], yellow: ['#ffe07a', '#ffd04d', '#f0ad13', '#d18f05', '#9c6a00', '#3a2800'],
};
export function applyUi() {
    const r = root();
    if (!r) return;
    const u = UI();
    r.dataset.theme = 'dark';   // Mundi has one look: dark
    r.dataset.accent = u.accent || 'blue';
    r.dataset.layout = u.layout || 'vn';
    r.dataset.vn = 'box';   // the visual novel shows its conversation in a box (the old no-box and subtitle styles are gone)
    r.classList.remove('hud-autohide');
    const dev = deviceMode();
    if (dev) r.dataset.mobile = dev; else delete r.dataset.mobile;
    const sc = dev === 'port' ? (u.scalePhone ?? 85) : dev === 'land' ? (u.scaleLand ?? 80) : (u.scale || 100);
    r.style.setProperty('--mu-scale', String(sc / 100));
    const hud = dev === 'port' ? (u.hudPhone ?? 85) : dev === 'land' ? (u.hudLand ?? 80) : 100;
    r.style.setProperty('--mu-hud', String(hud / 100));
    r.style.setProperty('--mu-scene-text', String((u.sceneText || 100) / 100));
    r.style.setProperty('--mu-dialog-blur', `${u.dialogBlur ?? 12}px`);
    r.style.setProperty('--mu-dlg-w', String(((u as any).dialogW ?? 100) / 100));
    r.style.setProperty('--mu-dlg-h', String(((u as any).dialogH ?? 100) / 100));
    r.dataset.swap = u.chatSwap && u.layout === 'cards' ? '1' : '';   // swapping sides is a Cards option
    r.dataset.avshape = u.avatarShape || 'rect';
    r.dataset.imglayout = u.imgLayout || 'left';
    applyColors(r);
    r.dataset.dialogpos = (u.layout || 'vn') === 'vn' ? u.dialogPos || 'center' : 'center';   // on the left (bottom): only in Visual novel
    r.style.setProperty('--mu-sprite-size', String((u.spriteSize ?? 100) / 100));
    r.style.setProperty('--mu-sprite-w', String((u.spriteW ?? 100) / 100));
    r.style.setProperty('--mu-sprite-y', `${u.spriteY ?? 0}vh`);
    r.classList.toggle('card-mode', u.cardMode !== false);
    const font = FONTS.find(f => f[0] === (u.font || 'default'));
    if (font && font[2]) r.style.setProperty('--mu-font', font[2]); else r.style.removeProperty('--mu-font');
    // a theme color you chose wins over the skin's own colors (the skin decides only while you have not chosen)
    const pal = (u as any).accentLocked ? PALETTES[u.accent || 'blue'] : null;
    for (const [i, k] of ['--a0', '--a1', '--a2', '--a3', '--a4', '--aon'].entries()) { if (pal) r.style.setProperty(k, pal[i]); else r.style.removeProperty(k); }
    if (pal) r.style.setProperty('--accent', pal[2]); else r.style.removeProperty('--accent');
    if (u.secondary) r.style.setProperty('--accent2', u.secondary); else r.style.removeProperty('--accent2');
}

setLookApplier(() => applyUi());
// turning the phone or resizing the window can switch between the phone and computer layouts
for (const q of ['(max-width: 760px)', '(pointer: coarse) and (max-height: 520px)']) globalThis.matchMedia?.(q).addEventListener?.('change', () => { applyUi(); notify(); });
const inGame = () => !!game() && (state.view === 'map' || state.view === 'scene');

function body(): string {
    switch (state.view) {
        case 'settings': return settingsHtml();
        case 'newgame': return newGameHtml();
        case 'library': return libraryHtml();
        case 'gallery': return galleryHtml();
        case 'map': return game() ? mapHtml() : menuHtml();
        case 'scene': return game() ? sceneHtml() : menuHtml();
        case 'chat': return chatHtml() || menuHtml();
        case 'worldcfg': return game() ? worldCfgHtml() : menuHtml();
        case 'creator': return creatorHtml() || menuHtml();
        default: return menuHtml();
    }
}

export function render() {
    const r = root();
    if (!r || !state.open) return;
    const main = r.querySelector('#mundi-main') as HTMLElement;
    // keeps focus, caret and scroll positions, since drawing recreates the elements
    const a = document.activeElement as HTMLInputElement | null;
    const focusKey = a?.dataset?.focus;
    const caret = focusKey ? [a!.selectionStart, a!.selectionEnd] : null;
    const keep: Record<string, { top: number; h: number; atEnd: boolean }> = {};
    main.querySelectorAll<HTMLElement>('[data-keep]').forEach(el => { keep[el.dataset.keep!] = { top: el.scrollTop, h: el.scrollHeight, atEnd: el.scrollHeight - el.scrollTop - el.clientHeight < 40 }; });

    // only what changed is redrawn (morph), so nothing else on screen "resets"
    morph(main, `${body()}${inGame() ? hudHtml() + phoneHtml() + helpHtml() + coursesHtml() + journeyHtml() + discoveryHtml() + rpgOverlays() + combatHtml() + deathHtml() + audienceHtml() + arrestHtml() + diceHtml() : ''}${updateHtml()}${whatsNewHtml()}${tutorialHtml()}${state.busy ? `<div class="mu-busy"><i></i><span>${state.busy}…</span></div>` : ''}`);
    { const g = game(); rainAmbience(!!g && inGame() && (state.view === 'map' || state.view === 'scene') && weatherHere(g, getWorld(g.world)).rain); }   // rain you can hear
    r.dataset.view = state.view;
    // the style of the world on screen (the medieval look, the modern one…)
    const g = game();
    const shown = state.view === 'creator' ? creatorWorld() : state.view === 'newgame' && state.wizard ? getWorld(state.wizard.world) : (inGame() || state.view === 'worldcfg') && g ? getWorld(g.world) : null;
    r.dataset.style = styleOf(shown);
    r.dataset.skin = skinOf(shown);

    placeTutorial(main); tutorialTick(); stackHud(main);
    // the picture by the side (a click on a name) fits in the room left of the dialogue box
    { const side = main.querySelector<HTMLElement>('.mu-sidepic'), dlg = main.querySelector<HTMLElement>('.mu-dialog');
      if (side) { const room = dlg ? (dlg.getBoundingClientRect().left - main.getBoundingClientRect().left) / uiZoom() - 10 : 0; if (room > 160) main.style.setProperty('--side-w', `${Math.round(room)}px`); else main.style.removeProperty('--side-w'); } }
    main.querySelectorAll<HTMLElement>('[data-keep]').forEach(el => {
        const k = el.dataset.keep!;
        const was = keep[k];
        // the conversation follows new lines, unless you scrolled up to read
        if (el.dataset.bottom !== undefined && (!was || was.atEnd || (el.scrollHeight !== was.h && was.atEnd))) el.scrollTop = el.scrollHeight;
        else if (was && el.scrollTop !== was.top) el.scrollTop = was.top;
    });
    if (focusKey) {
        const el = main.querySelector<HTMLInputElement>(`[data-focus="${esc(focusKey)}"]`);
        if (el) { el.focus(); try { el.setSelectionRange(caret![0], caret![1]); } catch { /* not a text field */ } }
    }
    syncNative(main);
    drawThumbs(main);
    if (state.view === 'map') applyMapView();
    if (state.view === 'scene' || state.view === 'chat') afterScene(main);
}

// The clock and HUD text, every game minute, without redrawing the screen.
function lightUpdate() {
    const r = root(); const g = game(); const w = g && getWorld(g.world);
    if (!r || !g || !w) return;
    const set = (sel: string, text: string) => { const el = r.querySelector(sel); if (el && el.textContent !== text) el.textContent = text; };
    set('[data-clock]', clock12(g.minutes));
    set('[data-ampm]', ampm(g.minutes));
    set('[data-weekday]', weekday(g.day));
    set('[data-period]', period(w, g.minutes).name);
    r.querySelectorAll<HTMLElement>('[data-stat]').forEach(el => {
        const v = Math.round(g.player.stats[el.dataset.stat!] ?? 0);
        el.style.setProperty('--v', String(v));
        const d = w.statuses.find(x => x.id === el.dataset.stat);
        if (d) el.dataset.word = needWord(d, v);
        el.classList.toggle('is-low', v <= 20);
    });
}

/* ---------- open and close ---------- */

export function openApp() {
    const r = root();
    if (!r) return;
    state.open = true;
    r.hidden = false;
    document.body.classList.add('mundi-open');
    hookSillyTavernToasts();
    applyUi();
    // opening always starts at the main menu; "Continue" goes back to the game
    state.view = 'menu';
    notify();
}

export function closeApp() {
    const r = root();
    state.open = false;
    rainAmbience(false);
    releaseNative();
    refreshList();
    if (r) r.hidden = true;
    document.body.classList.remove('mundi-open');
}

Object.assign(ACT, {
    exit: () => closeApp(),
    'to-menu': () => { state.view = 'menu'; state.menuTab = 'main'; state.sel = null; notify(); },
    'to-map': () => { if (state.generating) { toast('Wait until they finish speaking.', 'info'); return; } state.view = 'map'; notify(); },
    'to-scene': () => { state.view = 'scene'; notify(); },
});

/* ---------- input ---------- */

function attach(r: HTMLElement) {
    // the focus ring is for the keyboard: a click (after which Mundi redraws and keeps the focus) shows none
    r.addEventListener('pointerdown', () => { r.dataset.pointer = '1'; }, true);
    r.addEventListener('keydown', (e) => { if (e.key === 'Tab') delete r.dataset.pointer; }, true);
    r.addEventListener('click', (e) => {
        if (mapInput.click(e)) return;
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
        if (!el || (el as any).disabled || el.getAttribute('aria-disabled') === 'true') return;
        const fn = ACT[el.dataset.act!];
        if (fn) Promise.resolve(fn(el, e)).catch(err => { console.error('[Mundi]', err); toast(String(err?.message ?? err), 'error'); });
    });
    const onInput = (e: Event) => {
        const el = e.target as HTMLInputElement;
        if (e.type === 'input' && el.tagName === 'SELECT') return;   // a list fires "input" and "change": handled once, on "change"
        if (el.dataset?.focus === 'composer') { state.composer = el.value; onComposerInput(el as unknown as HTMLTextAreaElement); }
        const name = el.dataset?.input;
        if (name) INPUT[name]?.(el, e);
    };
    r.addEventListener('input', onInput);
    r.addEventListener('focusout', (e) => { if ((e.target as HTMLElement).dataset?.focus === 'composer') setTimeout(closeMention, 150); });
    r.addEventListener('change', (e) => { if ((e.target as HTMLElement).matches('select, input[type=checkbox], input[type=file]')) onInput(e); });
    r.addEventListener('keydown', (e) => {
        const t = e.target as HTMLElement;
        if (t.dataset?.focus === 'composer' && onComposerKey(t as HTMLTextAreaElement, e as KeyboardEvent)) { e.preventDefault(); e.stopPropagation(); return; }
        if (t.dataset?.focus === 'composer' && e.key === 'Enter' && !e.shiftKey && !(e as KeyboardEvent).isComposing) {
            e.preventDefault();
            ACT.send?.(t, e);
        }
        if (t.dataset?.focus === 'lib-dlg-name' && e.key === 'Enter' && !(e as KeyboardEvent).isComposing && state.modal?.type === 'lib-dlg-create') { e.preventDefault(); ACT['lib-create-yes']?.(t, e); }
        if (t.dataset?.focus === 'lib-dlg-name' && e.key === 'Enter' && !(e as KeyboardEvent).isComposing && state.modal?.type === 'lib-dlg-renfolder') { e.preventDefault(); ACT['lib-folder-ren-yes']?.(t, e); }
        if (t.dataset?.focus === 'lib-dlg-name' && e.key === 'Enter' && !(e as KeyboardEvent).isComposing && state.modal?.type === 'lib-dlg-newfolder') { e.preventDefault(); ACT['lib-newfolder-yes']?.(t, e); }
        if (t.dataset?.enter && e.key === 'Enter' && !(e as KeyboardEvent).isComposing) { e.preventDefault(); ACT[t.dataset.enter]?.(t, e); }
        if (t.dataset?.focus === 'lib-tag-text' && e.key === 'Enter' && !(e as KeyboardEvent).isComposing) { e.preventDefault(); ACT['lib-tag-add']?.(t, e); }
        if (t.dataset?.focus === 'ph-draft' && e.key === 'Enter' && !(e as KeyboardEvent).isComposing) { e.preventDefault(); ACT[phone.app === 'social' ? 'ph-chirp' : phone.app === 'post' ? 'ph-reply' : 'ph-send']?.(t, e); }
    });
    document.addEventListener('keydown', (e) => {
        if (!state.open || (e.target as HTMLElement).closest?.('textarea, input, select')) return;
        if (state.view === 'gallery' && state.gal.photo !== null && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            r.querySelector<HTMLElement>(`.mu-lb-nav.${e.key === 'ArrowLeft' ? 'is-prev' : 'is-next'}:not(:disabled)`)?.click();
            return;
        }
        if (e.key !== 'Escape') return;
        if (state.view === 'gallery' && closeLightbox()) return;
        if (phone.open && inGame()) { phone.open = false; notify(); return; }
        if (PL.card) { PL.card = ''; notify(); return; }
        if (state.view === 'worldcfg') { state.view = 'map'; notify(); return; }
        if (state.modal) state.modal = null;
        else if (state.view === 'library' && libraryEscape()) return;
        else if (state.sel) state.sel = null;
        else return;
        notify();
    });
    mapInput.attach(r);
    guardBackgrounds(r);
}

/* ---------- mounting and the clock ---------- */

let ticks = 0, sig = '', frac = 0;

// SillyTavern's own notifications (toastr: errors of extensions, saves…) show up in Mundi's corner while Mundi
// is open, marked "(SillyTavern)". SillyTavern's own toast box is hidden meanwhile (see the CSS).
function hookSillyTavernToasts() {
    const t = (window as any).toastr;
    if (!t || t.__mundi) return;
    t.__mundi = true;
    const kinds: Record<string, 'info' | 'success' | 'error' | 'warn'> = { info: 'info', success: 'success', warning: 'warn', error: 'error' };
    for (const [fn, kind] of Object.entries(kinds)) {
        const orig = t[fn]?.bind(t);
        if (!orig) continue;
        t[fn] = (message: unknown, title?: unknown, opts?: any) => {
            if (ttsNoise(message)) return undefined;   // TTS notices about characters without a voice (Add-ons → TTS)
            // Mundi switches personas itself (Play as): SillyTavern's notices about it are noise while Mundi is open
            if (state.open && /temporar(il)?y (chosen|persona)|persona locked|is locked to in this chat|persona.*(unlocked|lock)/i.test(`${String(title ?? '')} ${String(message ?? '')}`)) return undefined;
            if (state.open) {
                const plain = htmlText;   // (a template: an <img> in the message never loads)
                const text = plain(message), head = plain(title);
                if (text || head) toast(text, kind, { source: 'SillyTavern', title: head, ms: kind === 'error' ? 9000 : kind === 'warn' ? 6000 : 4000 });
            }
            return orig(message, title, opts);
        };
    }
}

export function mount() {
    hookSillyTavernToasts();
    if (root()) return root()!;
    const r = document.createElement('div');
    r.id = ROOT_ID;
    r.hidden = true;
    r.innerHTML = '<div id="mundi-main"></div><div id="mundi-toasts"></div>';
    document.body.appendChild(r);
    installTranslator(r);
    onRender(render);
    attach(r);
    // a line translated (or a picture added) after it arrived, e.g. by SillyTavern's Chat Translation: show it
    let shownSig = '';
    setInterval(() => {
        if (!state.open || (state.view !== 'scene' && state.view !== 'chat') || state.generating) return;
        const sig = chat().slice(-8).map((m: any) => `${m?.extra?.display_text?.length ?? 0}.${Object.prototype.propertyIsEnumerable.call(m?.extra ?? {}, 'image') ? m.extra.image : ''}.${m?.extra?.media?.length ?? 0}`).join('|');
        if (shownSig && sig !== shownSig) notify();
        shownSig = sig;
    }, 1000);
    // a friend's question goes out as a message once you are apart (never while they are in the scene with you)
    let asking = false;
    setInterval(() => {
        const g = game(); const w = g && getWorld(g.world);
        if (asking || !state.open || !g || !w || !inGame() || state.busy || state.generating) return;
        asking = true;
        deliverAsk(g, w, a => isWith(g, a) || presentAt(g, w, g.player.loc).some(r => r.avatar === a))
            .then(async name => name || deliverLetter(g, w))   // or a letter from a friend far away
            .then(name => { if (name) { saveGame(); toast(lex(w, 'newMessage', name), 'info'); notify(); } }).catch(() => { /* the AI is offline: try later */ })
            .finally(() => { asking = false; });
    }, 4000);
    setInterval(() => {
        const g = game(); const w = g && getWorld(g.world);
        if (!state.open || !g || !w || !inGame() || state.busy || state.generating || state.modal || !g.speed || clockMode(g) !== 'live') return;
        frac += g.speed / 60;   // speed 60: one real second is one game minute
        const mins = Math.floor(frac);
        if (mins < 1) return;
        frac -= mins;
        const loc = g.player.loc;
        const msgs = advance(g, w, mins);
        msgs.forEach(m => toast(m, 'warn'));
        if (runPlans()) notify();
        lightUpdate();
        const now = residents(g).map(x => whereNow(g, w, x)).join('|') + `|${g.player.loc}`;
        if (now !== sig || loc !== g.player.loc) {
            sig = now;
            syncScene().then(notify);
        } else if (++ticks % 10 === 0) refreshPrompt();   // the time of day in the prompt
        if (ticks % 15 === 0) saveGame();
        if (ticks % 30 === 0) feedTick();   // characters post on their own (when that option is on)
    }, 1000);
    return r;
}

export const peopleHere = () => { const g = game(); const w = g && getWorld(g.world); return g && w ? presentAt(g, w, g.player.loc) : []; };
export const openOnStart = () => settings().openOnStart;

// The clock card, the place chip under it and the map's tabs under that: stacked by measuring, so a bigger HUD (its
// scale, a festival line, a long place name) never makes them overlap.
function stackHud(main: HTMLElement) {
    if (main.closest('[data-mobile]') || document.querySelector('#mundi-root[data-mobile]')) return;
    const clock = main.querySelector<HTMLElement>('.mh-clock:not(.is-bar):not(.is-home)');
    const chain = [clock, main.querySelector<HTMLElement>('.mh-where:not(.is-home)'), main.querySelector<HTMLElement>('.mu-mapnav')].filter((e): e is HTMLElement => !!e && e.offsetParent !== null);
    if (!clock || chain.length < 2) return;
    for (let i = 1; i < chain.length; i++) {
        const above = chain[i - 1].getBoundingClientRect(), el = chain[i], r = el.getBoundingClientRect();
        const scale = el.offsetHeight ? r.height / el.offsetHeight : 1;
        const delta = (above.bottom + 8 - r.top) / (scale || 1);
        if (Math.abs(delta) < 1) continue;
        const top = parseFloat(getComputedStyle(el).top) || 0;
        el.style.setProperty('top', `${Math.round(top + delta)}px`, 'important');
    }
}
