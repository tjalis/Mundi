// Settings, the same screen from the menu and from the game: interface, sound and (in game) the clock.
import { UI_LANGS } from '../core/i18n.js';
import { setLang } from '../core/tr.js';
import { getWorld, isScenario } from '../core/world.js';
import { state, notify, settings, saveSettings, UI, esc, game, saveGame, clockMode, deviceMode, SAVE, toast } from '../core/store.js';
import { backups, restoreBackup } from '../core/saves.js';
import { tutorialSettingsHtml } from './tutorial.js';
import { play } from './sfx.js';
import { ACT, INPUT } from './reg.js';
import { warningsBanner } from './warnings.js';
import { NATIVE, nativeHost } from './native.js';
import { feedPrefs } from '../sim/feed.js';
import { setSkin } from './skins.js';
import { addonsTab } from './addons.js';
import { spritesSettingsHtml } from './spritegen.js';
import { lorasSettingsHtml } from './loras.js';
import { peopleSettingsHtml } from './storypeople.js';
import { lookPanelHtml, lookConfirmHtml } from './chatlook.js';
import { DATE_FORMATS, fmtDate, fmtDateTime, fmtClock } from '../core/fmt.js';
import { aiTestHtml } from './aitest.js';

// Fonts: Mundi's default, the system's, or one of these (the world's style font is used when "world" is chosen).
export const FONTS: [string, string, string][] = [['default', 'Mundi (Nunito)', ''], ['system', 'System', 'system-ui, "Segoe UI", sans-serif'], ['inter', 'Inter', '"Inter", sans-serif'],
    ['poppins', 'Poppins', '"Poppins", sans-serif'], ['quicksand', 'Quicksand', '"Quicksand", sans-serif'], ['merriweather', 'Merriweather (serif)', '"Merriweather", Georgia, serif'],
    ['garamond', 'EB Garamond (old book)', '"EB Garamond", Georgia, serif'], ['cinzel', 'Cinzel (fantasy)', '"Cinzel", Georgia, serif'], ['orbitron', 'Orbitron (sci-fi)', '"Orbitron", sans-serif']];
const ACCENTS: [string, string, string][] = [['blue', 'Blue', '#1e88e5'], ['green', 'Green', '#36a81c'], ['red', 'Red', '#e23b41'], ['purple', 'Purple', '#7c4ddb'], ['pink', 'Pink', '#e7489a'], ['yellow', 'Yellow', '#f0ad13']];
// The second color (selected chips, the line under the headers, the main menu's first button…).
const SECONDARY: [string, string, string][] = [['green', 'Green', '#43b51b'], ['blue', 'Blue', '#1e88e5'], ['teal', 'Teal', '#16b3a5'], ['purple', 'Purple', '#7c4ddb'], ['pink', 'Pink', '#e7489a'], ['red', 'Red', '#e23b41'], ['orange', 'Orange', '#f07f13'], ['yellow', 'Yellow', '#f0ad13']];
const TABS: [string, string][] = [['game', 'Game'], ['sound', 'Sound'], ['interface', 'Interface'], ['addons', 'Add-ons'], ['aitest', 'AI tests']];
// SillyTavern's own settings panels, shown here as they are (same texts and translations as in SillyTavern).
const ST_TABS = ['st-api', 'st-ai', 'st-format', 'st-user', 'st-ext'];

const slider = (label: string, key: string, min: number, max: number, unit = '') =>
    `<label class="mu-field slider"><span>${label}</span><input type="range" min="${min}" max="${max}" value="${(UI() as any)[key]}" data-input="ui-num" data-key="${esc(key)}"><output>${(UI() as any)[key]}${unit}</output></label>`;
const check = (label: string, key: string) =>
    `<label class="mu-check"><input type="checkbox" data-input="ui-bool" data-key="${esc(key)}" ${(UI() as any)[key] ? 'checked' : ''}><span>${label}</span></label>`;

function tabInterface() {
    const cur = (settings() as any).uiLang ?? 'en';
    return `<section><h3>Language</h3><label class="mu-field"><span>Mundi's screens</span><select data-input="set-uilang">${UI_LANGS.map(l => `<option value="${l.id}" ${cur === l.id ? 'selected' : ''} data-notr>${l.name}</option>`).join('')}</select></label>
            <small class="mu-muted">Only Mundi's own screens (menus, buttons, help). The story's language is up to your SillyTavern preset, and the worlds' places and people keep their own names.</small></section>
        <section><h3>Date and time</h3><div class="mu-row2">
            <label class="mu-field"><span>Date format · ${esc(fmtDate(Date.now()))}</span><select data-input="ui-str" data-key="dateFormat">${DATE_FORMATS.map(([id, ex]) => `<option value="${id}" ${(UI().dateFormat || 'DD/MM/YYYY') === id ? 'selected' : ''}>${id} — ${ex}</option>`).join('')}</select></label>
            <label class="mu-field"><span>Clock · ${esc(fmtClock(new Date().getHours() * 60 + new Date().getMinutes()))}</span><select data-input="ui-str" data-key="timeFormat">${([['24', '24 hours (18:30)'], ['12', '12 hours (6:30 PM)']] as const).map(([id, l]) => `<option value="${id}" ${(UI().timeFormat || '24') === id ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div></section>
        <section><h3>Look</h3>
            <div class="mu-field"><span>Theme color</span><div class="mu-swatches">${ACCENTS.map(([id, label, c]) => `<button class="mu-swatch ${(UI() as any).accentLocked && (UI().accent || 'blue') === id ? 'is-sel' : ''}" data-act="set-accent" data-v="${esc(id)}" title="${label}" aria-label="${label}" style="--c:${c}"></button>`).join('')}</div></div>
            ${(UI() as any).accentLocked || UI().secondary ? `<button class="mu-ghost mu-skincolors" data-act="set-skincolors">${'↺'} Use the skin's own colors</button>` : `<small class="mu-muted">Now using the skin's own colors. Pick a color to use yours.</small>`}
            <div class="mu-field"><span>Secondary color</span><div class="mu-swatches">${SECONDARY.map(([id, label, c]) => `<button class="mu-swatch ${UI().secondary === c ? 'is-sel' : ''}" data-act="set-secondary" data-v="${esc(c)}" title="${label}" aria-label="${label}" style="--c:${c}"></button>`).join('')}</div></div>
            <label class="mu-field"><span>Font</span><select data-input="ui-font">${FONTS.map(([id, label]) => `<option value="${id}" ${(UI().font || 'default') === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
            ${deviceMode() === 'port' ? slider('Overall scale (on this phone)', 'scalePhone', 60, 120, '%') + slider('Game HUD size (on this phone)', 'hudPhone', 60, 120, '%') : deviceMode() === 'land' ? slider('Overall scale (phone sideways)', 'scaleLand', 50, 110, '%') + slider('Game HUD size (phone sideways)', 'hudLand', 50, 120, '%') : slider('Overall scale', 'scale', 70, 140, '%')}${slider('Scene text', 'sceneText', 70, 160, '%')}${slider('Dialogue box blur', 'dialogBlur', 0, 40, 'px')}</section>
        <section><h3>Scene</h3>
            <div class="mu-layouts">
                <button class="mu-layout ${(UI().layout ?? 'vn') === 'vn' ? 'is-on' : ''}" data-act="set-layout" data-v="vn"><i class="is-vn"><b></b><u></u></i><b>Visual novel</b><small>The character in the middle, the conversation in a box below.</small></button>
                <button class="mu-layout ${UI().layout === 'classic' ? 'is-on' : ''}" data-act="set-layout" data-v="classic"><i class="is-classic"><b></b><u></u></i><b>Classic SillyTavern</b><small>The conversation fills the middle of the screen, the character beside it.</small></button>
                <button class="mu-layout ${UI().layout === 'cards' ? 'is-on' : ''}" data-act="set-layout" data-v="cards"><i class="is-cards"><b></b><u></u><s></s></i><b>Cards</b><small>Each message with a big rounded picture of who speaks beside it.</small></button>
            </div>
            ${(UI().layout ?? 'vn') === 'vn' ? `<div class="mu-field"><span>Dialogue box</span><div class="mu-chips">${([['center', 'Centered'], ['left', 'Left']] as [string, string][]).map(([id, label]) => `<button class="mu-chip ${(UI().dialogPos || 'center') === id ? 'is-on' : ''}" data-act="set-dialogpos" data-v="${esc(id)}">${label}</button>`).join('')}</div></div>` : ''}
            ${slider('Character size', 'spriteSize', 50, 160, '%')}${slider('Character width', 'spriteW', 60, 140, '%')}${slider('Character height (move up or down)', 'spriteY', -30, 30, 'vh')}
            ${check('Show the character card when there are no expression sprites', 'cardMode')}
        </section>
        <section><h3>Chat look</h3><p class="mu-muted">Also in the scenario's side menu (Look) and the game menu. Saved in Mundi's own settings, apart from SillyTavern's.</p>${lookPanelHtml()}</section>
`;
}

function tabSound() {
    return `<section><h3>Interface sounds</h3>${check('Interface sounds', 'sound')}${slider('Volume', 'volume', 0, 100, '%')}<button data-act="sfx-test">▶ Test</button></section>
        <section><h3>Weather sounds</h3><p class="mu-muted">The rain you hear in the scenes and on the map. Apart from the interface sounds: you can turn off only the rain, or only the clicks.</p>
            ${check('Weather sounds (rain)', 'weatherSound')}${slider('Volume', 'weatherVolume', 0, 100, '%')}</section>`;
}

function tabGame() {
    const g = game();
    return `<section><h3>General</h3>
            <label class="mu-check"><input type="checkbox" data-input="set-openstart" ${settings().openOnStart ? 'checked' : ''}><span>Open Mundi when SillyTavern starts</span></label></section>
        <section><h3>AI calls</h3><p class="mu-muted">What makes Mundi call the AI (the diary, Chirp, characters' texts, narrating what you do) is now in the game: ☰ → This world → AI context.</p></section>
        ${peopleSettingsHtml()}
        <section><h3>Background</h3>
            <label class="mu-field"><span>When you move between places</span><select data-input="set-bgfollow">${([['mundi', 'Only Mundi\'s scene changes picture'], ['chat', 'SillyTavern\'s chat background follows the place too']] as const).map(([v, l]) => `<option value="${v}" ${((settings() as any).bgFollow ?? 'mundi') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></section>
        ${g ? `<section><h3>This save</h3>
            ${clockMode(g) === 'live' ? `<label class="mu-field"><span>Clock speed</span><select data-input="set-speed">${[0, 30, 60, 120].map(s => `<option value="${s}" ${g.speed === s ? 'selected' : ''}>${s ? `×${s / 60} (1 real second = ${s / 60} game minute${s === 60 ? '' : 's'})` : 'Paused'}</option>`).join('')}</select></label>` : (isScenario(getWorld(g.world)) ? '' : '<p class="mu-muted">Time passes only with what you do. To have a running clock, change it in This world → Rules.</p>')}
            <div class="mu-row"><button data-act="save-branch">Make a branch</button></div>
            <p class="mu-muted">A copy of this save as it is now (the story, the diary, everything), saved next to it. You keep playing here; open the branch from Load when you want to try the other path.</p>
            ${backupsHtml()}</section>` : ''}`;
}

// The copies Mundi kept before an update or a repair changed this save (core/saves.ts). Restoring asks twice.
const RESTORE = { i: -1 };
function backupsHtml() {
    const list = backups();
    const ro = SAVE.readOnly ? '<p class="mu-bad">This save was made with a newer version of Mundi and opens read-only: nothing is saved until you update Mundi.</p>' : '';
    if (!list.length) return ro;
    return `${ro}<h4>Backups</h4><p class="mu-muted">Kept automatically before an update or a repair changed this save (the last ${list.length}).</p>
        ${list.map((b, i) => `<div class="mu-row"><span>${esc(fmtDateTime(b.at))} · ${esc(b.reason)}</span><button class="${RESTORE.i === i ? 'mu-danger' : ''}" data-act="save-restore" data-i="${esc(i)}" ${SAVE.readOnly ? 'aria-disabled="true"' : ''}>${RESTORE.i === i ? 'Tap again to restore' : 'Restore'}</button></div>`).reverse().join('')}`;
}

export function settingsHtml() {
    const tab = state.settingsTab;
    if (!TABS.some(t => t[0] === tab) && !ST_TABS.includes(tab)) state.settingsTab = 'game';
    const native = ST_TABS.includes(state.settingsTab);
    const body = native ? nativeHost(state.settingsTab) : state.settingsTab === 'sound' ? tabSound() : state.settingsTab === 'game' ? tutorialSettingsHtml() + tabGame() : state.settingsTab === 'addons' ? addonsTab() + spritesSettingsHtml() + lorasSettingsHtml() : state.settingsTab === 'aitest' ? aiTestHtml() : tabInterface();
    return `<div class="mu-settings">
        <div class="mu-subhead"><button data-act="settings-back" data-sfx="back">← Back</button><h2>Settings</h2></div>
        ${warningsBanner()}
        <div class="mu-settings-layout">
            <nav class="mu-tabs">${TABS.map(([id, l]) => `<button class="${state.settingsTab === id ? 'is-on' : ''}" data-act="settings-tab" data-tab="${esc(id)}">${l}</button>`).join('')}
                <div class="mu-tabs-st"><h4 class="mu-tabs-group">SillyTavern</h4>
                ${ST_TABS.map(id => `<button class="${state.settingsTab === id ? 'is-on' : ''}" data-act="settings-tab" data-tab="${esc(id)}" title="${esc(NATIVE[id].label)}">${NATIVE[id].label}</button>`).join('')}</div></nav>
            <div class="mu-settings-body mu-panel ${native ? 'is-native' : ''}" data-keep="settings">${body}</div>
        </div>${lookConfirmHtml()}
    </div>`;
}

const applyLook = () => import('./app.js').then(m => m.applyUi());

Object.assign(ACT, {
    'save-restore': async (el) => {
        const i = Number(el.dataset.i);
        if (SAVE.readOnly) return;
        if (RESTORE.i !== i) { RESTORE.i = i; notify(); return; }
        RESTORE.i = -1;
        if (!restoreBackup(i)) { toast('That backup could not be restored.', 'error'); return; }
        const { syncScene } = await import('../sim/game.js');
        await syncScene();
        toast('Backup restored. The save you had before is kept as a backup too.', 'success'); notify();
    },
    'settings-tab': (el) => { state.settingsTab = el.dataset.tab!; notify(); },
    'settings-back': () => { state.view = game() && (state.backTo === 'map' || state.backTo === 'scene') ? state.backTo : state.backTo === 'chat' ? 'chat' : 'menu'; notify(); },
    'set-secondary': (el) => { UI().secondary = el.dataset.v; saveSettings(); applyLook(); notify(); },
    'set-accent': (el) => { UI().accent = el.dataset.v!; (UI() as any).accentLocked = true; saveSettings(); applyLook(); notify(); },
    'set-skincolors': () => { (UI() as any).accentLocked = false; UI().secondary = undefined; saveSettings(); applyLook(); notify(); },
    'set-skin': (el) => { setSkin(el.dataset.style!, el.dataset.v!); saveSettings(); notify(); },
    'set-dialogpos': (el) => { UI().dialogPos = el.dataset.v as any; saveSettings(); applyLook(); notify(); },
    'set-layout': (el) => { UI().layout = el.dataset.v as any; saveSettings(); applyLook(); notify(); },
    'sfx-test': () => play('success'),
    'save-branch': async () => { const { branchSave } = await import('../sim/game.js'); await branchSave(); notify(); },
});

Object.assign(INPUT, {
    'set-uilang': async (el) => { (settings() as any).uiLang = el.value; saveSettings(); await setLang(el.value); notify(); },
    'ui-num': (el) => { (UI() as any)[el.dataset.key!] = Number(el.value); const o = el.nextElementSibling; if (o) o.textContent = `${el.value}${o.textContent!.replace(/[-\d.]/g, '')}`; saveSettings(); applyLook(); if (el.dataset.key!.startsWith('weather')) notify(); },
    'ui-str': (el) => { (UI() as any)[el.dataset.key!] = el.value; saveSettings(); notify(); },
    'ui-font': (el) => { UI().font = el.value; saveSettings(); applyLook(); },
    'ui-bool': (el) => { (UI() as any)[el.dataset.key!] = el.checked; saveSettings(); applyLook(); if (el.dataset.key!.startsWith('weather')) notify(); },   // (the rain follows at once)
    'set-bgfollow': (el) => { (settings() as any).bgFollow = el.value; saveSettings(); },
    'set-feed': (el) => { feedPrefs().mode = el.value as any; saveSettings(); },
    'set-feedimg': (el) => { feedPrefs().images = el.checked; saveSettings(); },
    'set-diary': (el) => { (settings() as any).diaryOnSleep = el.checked; saveSettings(); },
    'set-openstart': (el) => { settings().openOnStart = el.checked; saveSettings(); },
    'set-speed': (el) => { const g = game(); if (g) { g.speed = Number(el.value); saveGame(); } },
});
