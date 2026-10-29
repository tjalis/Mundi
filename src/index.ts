// Mundi: an open-world RPG creator for SillyTavern. Entry point: waits for SillyTavern, mounts the screen,
// adds the launcher and follows SillyTavern's events (generation, streaming, chat changes).
import { ctx, on, scenarioOpen, openChatRef, chat, deleteMessageAt } from './st/bridge.js';
import { settings, saveSettings, state, notify, game, toast } from './core/store.js';
import { loadAllWorlds } from './core/world.js';
import { setLang } from './core/tr.js';
import './core/saves.js';   // save safety: migrations, backups and repairs when a save is opened
import { mount, openApp, closeApp } from './ui/app.js';
import { patchLastLine } from './ui/scene.js';
import { installSfx } from './ui/sfx.js';
import { refreshPrompt, clearPrompt } from './sim/prompt.js';
import { applyGameLore } from './sim/lore.js';

// A reply that came back empty (the prompt did not fit the model's context, or the reply ran out of tokens while the
// model was still thinking) is removed, so it does not pile up in the story, and Mundi says why.
let emptyWarned = 0;
// After a reply: a hidden or restricted place named in the story — did {{user}} just find it, or get let in?
async function storyPlaces() {
    const { game, saveGame, toast } = await import('./core/store.js');
    const { getWorld } = await import('./core/world.js');
    const g = game(); const w = g && getWorld(g.world);
    if (!g || !w) return;
    try {
        const found = await (await import('./sim/discovery.js')).storyCheck(g, w);
        if (!found.length || game() !== g) return;
        found.forEach(m => toast(m, 'success'));
        saveGame(); (await import('./sim/prompt.js')).refreshPrompt();
        const { state, notify } = await import('./core/store.js'); if (state.open) notify();
    } catch { /* the judge is offline: the places stay as they are */ }
}
function emptyReply() {
    if (!state.open) return;
    const list = chat(); const m = list.at(-1);
    if (!m || m.is_user || m.is_system) return;
    if (String(m.mes ?? '').replace(/<[^>]+>/g, '').trim()) return;
    if (!(Array.isArray(m.swipes) && m.swipes.filter((x: string) => String(x ?? '').trim()).length)) void deleteMessageAt(list.length - 1);
    if (Date.now() - emptyWarned < 20000) return;
    emptyWarned = Date.now();
    const cc = (ctx() as any).chatCompletionSettings ?? {};
    if (ctx().mainApi === 'openai' && Number(cc.openai_max_context) > 262144) {
        toast(`${m.name ?? 'The AI'} sent an empty reply. SillyTavern's Context Size is set to ${Number(cc.openai_max_context).toLocaleString('en-US')} tokens, so the whole chat is sent and does not fit your model. In AI Response Configuration, set Context Size to the context your model was loaded with (for example 8192).`, 'warn');
        return;
    }
    toast(`${m.name ?? 'The AI'} sent an empty reply. Usually the prompt is bigger than the model's context size, or the reply ran out of tokens while the model was thinking. Raise the context size in your backend (and match it in SillyTavern), or raise the response length.`, 'warn');
}
// screens register their actions when imported
import './ui/menu.js';
import './ui/newgame.js';
import './ui/settings.js';
import './ui/map.js';
import './ui/tools.js';

function addLauncher() {
    const menu = document.getElementById('extensionsMenu');
    if (menu && !document.getElementById('mundi-launch')) {
        const item = document.createElement('div');
        item.id = 'mundi-launch';
        item.className = 'list-group-item flex-container flexGap5';
        item.innerHTML = '<div class="fa-solid fa-earth-americas extensionsMenuExtensionButton"></div><span>Mundi</span>';
        item.addEventListener('click', () => openApp());
        menu.appendChild(item);
    }
    // a world for the chat open now, straight from SillyTavern's own chat
    if (menu && !document.getElementById('mundi-attach')) {
        const item = document.createElement('div');
        item.id = 'mundi-attach';
        item.className = 'list-group-item flex-container flexGap5';
        item.innerHTML = '<div class="fa-solid fa-globe extensionsMenuExtensionButton"></div><span>Mundi: attach a world to this chat</span>';
        item.addEventListener('click', () => { openApp(); void import('./ui/attach.js').then(m => m.openAttach()); });
        menu.appendChild(item);
    }
}

// Mundi's own block in SillyTavern's Extensions panel: open Mundi, and open it when SillyTavern starts.
function addSettingsBlock() {
    const host = document.getElementById('extensions_settings') ?? document.getElementById('extensions_settings2');   // the left column (the right one is usually longer)
    if (!host || document.getElementById('mundi-settings-block')) return;
    const box = document.createElement('div');
    box.id = 'mundi-settings-block';
    box.className = 'extension_container';
    box.innerHTML = `<div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>Mundi</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content">
            <div class="flex-container flexGap5" style="margin:6px 0"><div id="mundi-open-btn" class="menu_button menu_button_icon"><i class="fa-solid fa-earth-americas"></i><span>Open Mundi</span></div></div>
            <label class="checkbox_label" for="mundi-open-start"><input id="mundi-open-start" type="checkbox"><span>Open Mundi when SillyTavern starts</span></label>
        </div></div>`;
    host.appendChild(box);
    const chk = box.querySelector<HTMLInputElement>('#mundi-open-start')!;
    chk.checked = !!settings().openOnStart;
    chk.addEventListener('change', () => { settings().openOnStart = chk.checked; saveSettings(); if (state.open) notify(); });
    box.querySelector('#mundi-open-btn')!.addEventListener('click', () => openApp());
    // the same choice in Mundi's Settings keeps this box in step
    setInterval(() => { if (chk.checked !== !!settings().openOnStart) chk.checked = !!settings().openOnStart; }, 1500);
}

function follow() {
    const redraw = () => { if (state.open) notify(); };
    on('GENERATION_STARTED', (_type: string, _opts: unknown, dryRun: boolean) => { if (dryRun) return; state.generating = true; redraw(); });
    const done = () => {
        state.generating = false;
        if (state.impersonating) {   // the AI wrote the player's line into SillyTavern's box: bring it to Mundi's composer
            state.impersonating = false;
            const field = document.getElementById('send_textarea') as HTMLTextAreaElement | null;
            if (field?.value) { state.composer = field.value; field.value = ''; }
        }
        redraw();
    };
    on('GENERATION_ENDED', () => { emptyReply(); done(); void import('./ui/relui.js').then(m => m.checkAsk()); void import('./ui/events.js').then(m => m.checkEventEnd()); void storyPlaces(); });
    on('GENERATION_STOPPED', done);
    on('GROUP_WRAPPER_FINISHED', done);
    on('STREAM_TOKEN_RECEIVED', () => { if (state.open && state.view === 'scene') patchLastLine(); });
    on('MESSAGE_SENT', (id: number) => { const m: any = (globalThis as any).SillyTavern?.getContext?.().chat?.[id]; if (m?.is_user) void import('./ui/relui.js').then(x => x.detectAsk(String(m.mes ?? ''))); });
    // Home: time passes with every message you send (Settings › This save can turn it off)
    on('MESSAGE_SENT', async (id: number) => {
        const m: any = (globalThis as any).SillyTavern?.getContext?.().chat?.[id];
        if (!m?.is_user || m.is_system) return;
        const { homeTick } = await import('./sim/hometime.js');
        if (await homeTick()) redraw();
    });
    // someone you did not know answered you in the scene: now you know them
    on('MESSAGE_RECEIVED', async (id: number) => {
        const { game, saveGame } = await import('./core/store.js');
        const g = game(); const m: any = (globalThis as any).SillyTavern?.getContext?.().chat?.[id];
        if (!g || !m || m.is_user || m.is_system) return;
        const { speakerOf } = await import('./st/bridge.js');
        const who = speakerOf(m);
        const { markMet } = await import('./sim/game.js');
        if (who && markMet(g, who)) { saveGame(); (await import('./sim/prompt.js')).refreshPrompt(); redraw(); }
    });
    for (const ev of ['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED']) on(ev, redraw);
    on('CHAT_CHANGED', () => {
        // "Continue" opens what was last played in Mundi: a world save or a scenario chat
        if (state.open) {
            const ref = openChatRef();
            if (ref && game() && (settings().attached ?? []).some(e => e.chatId === ref.chatId)) settings().last = { kind: 'world', attached: true, group: ref.group, avatar: ref.avatar, chatId: ref.chatId };
            else if (ref && game() && ref.group) settings().last = { kind: 'world', group: ref.group, chatId: ref.chatId };
            else if (ref && scenarioOpen()) settings().last = { kind: 'chat', ...ref };
            saveSettings();
        }
        // the chat was switched (maybe from SillyTavern's own list): the game follows the open chat
        // the world state follows the chat: a Mundi save keeps it even when played in SillyTavern's own chat
        void applyGameLore();   // the lorebooks this game uses go on (and the previous game's go off)
        if (game()) refreshPrompt();
        else { clearPrompt(); if (state.view === 'map' || state.view === 'scene') state.view = scenarioOpen() ? 'chat' : 'menu'; }
        if (state.view === 'chat' && !scenarioOpen()) state.view = game() ? 'scene' : 'menu';
        redraw();
    });
}

async function init() {
    settings();
    await Promise.all([loadAllWorlds(), setLang((settings() as any).uiLang ?? 'en')]);
    mount();
    installSfx();
    addLauncher();
    addSettingsBlock();
    follow();
    if (game()) refreshPrompt(); else clearPrompt();
    if (settings().openOnStart) openApp();
}

const c = ctx();
c.eventSource.on(c.eventTypes.APP_READY, () => { init().catch(e => console.error('[Mundi] init', e)); });
(globalThis as any).Mundi = { open: openApp, close: closeApp };
