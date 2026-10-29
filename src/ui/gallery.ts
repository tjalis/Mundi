import { fmtDate } from '../core/fmt.js';
// Gallery: the pictures of every save, one photo album per save, grouped by game. A picture is any image in a
// save's chat: the ones the Image Generation extension makes, and the ones attached to messages.
import { state, notify, esc, settings, saveSettings } from '../core/store.js';
import { readChat, characters, isFav, charOf, ctx, personas } from '../st/bridge.js';
// the character's small card picture (SillyTavern's thumbnail), so the list opens fast
const smallCard = (avatar: string) => ctx().getThumbnailUrl('avatar', avatar);
import { listSaves, type SaveRow } from '../sim/game.js';
import { ACT, INPUT } from './reg.js';
import { icon } from './icons.js';
import { thumbCanvas } from './thumbs.js';
import { spritePhotos, spriteCgPhotos, personaKey } from './spritegen.js';

const G = state.gal;
interface Photo { url: string; caption: string; who: string; at: number }
interface Album { key: string; row: SaveRow; photos: Photo[] }

const isImage = (u: unknown) => typeof u === 'string' && u.length > 0;

// Every image of a message: SillyTavern's media list, plus the older single image and image swipes.
export function photosOf(m: any, at: number): Photo[] {
    const x = m?.extra ?? {};
    const out: Photo[] = [];
    const who = String(m?.name ?? '');
    const add = (url: unknown, title: unknown) => { if (isImage(url) && !out.some(p => p.url === url)) out.push({ url: String(url), caption: String(title ?? x.title ?? ''), who, at }); };
    if (Array.isArray(x.media)) for (const it of x.media) if (it && (!it.type || it.type === 'image')) add(it.url, it.title);
    if (Array.isArray(x.image_swipes)) for (const u of x.image_swipes) add(u, x.title);
    if (Object.prototype.propertyIsEnumerable.call(x, 'image')) add(x.image, x.title);
    for (const u of linkedImages(String(m?.mes ?? ''))) add(u, '');
    return out;
}
// Pictures written into a text as links: Markdown ![…](url) and <img src="…">.
export function linkedImages(t: string): string[] {
    const out: string[] = [];
    for (const m of t.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g)) out.push(m[1]);
    for (const m of t.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) out.push(m[1]);
    return [...new Set(out)].filter(u => /^(https?:\/\/|\/|data:image\/)/i.test(u) || /^[\w%.~-]+\//.test(u));
}
// The pictures in a character's greetings (first message and alternates).
function greetingPics(c: any): string[] {
    const list = [c?.first_mes, ...(c?.data?.alternate_greetings ?? [])].map(x => String(x ?? ''));
    return [...new Set(list.flatMap(linkedImages))];
}

async function loadAlbums(): Promise<Album[]> {
    const rows = await listSaves();
    const out: Album[] = [];
    // each character's greeting pictures are one album of that character, and are not repeated in its chats
    const greet = new Map<string, string[]>();
    for (const c of characters()) { const pics = greetingPics(c); if (pics.length) greet.set(c.avatar, pics); }
    for (const row of rows) {
        let photos: Photo[] = [];
        try { (await readChat(row.chatId)).forEach((m, i) => { photos = photos.concat(photosOf(m, i)); }); } catch { /* an unreadable chat is an empty album */ }
        const skip = new Set(row.avatar ? greet.get(row.avatar) ?? [] : []);
        out.push({ key: `${row.groupId}/${row.chatId}`, row, photos: photos.filter(p => !skip.has(p.url)) });
    }
    for (const c of characters()) {
        const pics = greet.get(c.avatar); if (!pics) continue;
        out.push({ key: `char/${c.avatar}`, row: { kind: 'chat', groupId: '__greetings', avatar: c.avatar, chatId: String(c.name), title: 'Character greetings', world: '', last: 0, count: 0, current: false },
            photos: pics.map(url => ({ url, caption: 'Greeting', who: String(c.name), at: 0 })) });
    }
    return out.concat(await spriteAlbums());
}
// Each character's and persona's sprites (Expressions), every outfit: one album each, looked up a few at a time.
async function spriteAlbums(): Promise<Album[]> {
    const who = [...characters().map(c => ({ key: String(c.avatar), name: String(c.name ?? ''), avatar: String(c.avatar) })),
        ...personas().map(p => ({ key: personaKey(p.file), name: p.name, avatar: '' }))];
    const out: Album[] = [];
    const next = async (): Promise<void> => {
        const w = who.shift(); if (!w) return;
        try {
            const pics = await spritePhotos(w.key);
            if (pics.length) out.push({ key: `spr/${w.key}`, row: { kind: 'chat', groupId: '__sprites', avatar: w.avatar || undefined, chatId: w.name, title: w.avatar ? 'Sprites' : 'Persona sprites', world: '', last: 0, count: 0, current: false } as SaveRow,
                photos: pics.map(p => ({ url: p.url, caption: p.caption, who: w.name, at: 0 })) });
            const cg = await spriteCgPhotos(w.key);
            if (cg.length) out.push({ key: `cg/${w.key}`, row: { kind: 'chat', groupId: '__sprites', avatar: w.avatar || undefined, chatId: w.name, title: 'CG pictures', world: '', last: 0, count: 0, current: false } as SaveRow,
                photos: cg.map(p => ({ url: p.url, caption: p.caption, who: w.name, at: 0 })) });
        } catch { /* no sprites */ }
        return next();
    };
    await Promise.all(Array.from({ length: 6 }, next));
    return out.sort((a, b) => a.row.chatId.localeCompare(b.row.chatId));
}

const albums = () => (G.albums ?? []) as Album[];
const current = () => (G.album === '__fav' ? favAlbum() : albums().find(a => a.key === G.album) ?? null);
const when = (t: number) => (t ? fmtDate(t) : '');

function cover(a: Album) {
    const pics = a.photos.slice(-4).reverse();
    if (!pics.length) return `<div class="mu-album-cover is-empty"><i>${icon('image')}</i></div>`;
    return `<div class="mu-album-cover n${pics.length}">${pics.map(p => thumbCanvas(esc(p.url))).join('')}</div>`;
}

// Favorite pictures (a star in the picture viewer), kept in Mundi's settings.
const favPics = () => ((settings() as any).favPics ??= []) as string[];
const isFavPic = (u: string) => favPics().includes(u);
const GF = { q: '', favChars: false, tab: 'saves' as 'saves' | 'greet' | 'sprites' };
// All favorite pictures, as one album.
function favAlbum(): Album | null {
    const seen = new Set<string>(); const photos: Photo[] = [];
    for (const a of albums()) for (const p of a.photos) if (isFavPic(p.url) && !seen.has(p.url)) { seen.add(p.url); photos.push(p); }
    return { key: '__fav', row: { kind: 'chat', groupId: '__fav', chatId: 'Favorite pictures', title: 'Your favorites', world: '', last: 0, count: 0, current: false }, photos };
}

function shelf() {
    const list = albums();
    const q = GF.q.toLowerCase();
    const match = (a: Album) => !q || `${a.row.chatId} ${a.row.title}`.toLowerCase().includes(q);
    // characters whose greetings have pictures: only the card picture and the name (the pictures load when opened)
    const allChars = list.filter(a => a.key.startsWith('char/') && a.photos.length);
    const allSaves = list.filter(a => !a.key.startsWith('char/') && !a.key.startsWith('spr/') && !a.key.startsWith('cg/') && a.photos.length);
    const allSprites = list.filter(a => a.key.startsWith('spr/') && a.photos.length);
    const allCgs = list.filter(a => a.key.startsWith('cg/') && a.photos.length);
    const chars = allChars.filter(a => match(a) && (!GF.favChars || isFav(charOf(a.row.avatar!))));
    const saves = allSaves.filter(match).sort((a, b) => (b.row.last || 0) - (a.row.last || 0));
    const sprites = allSprites.filter(a => match(a) && (!GF.favChars || (!!a.row.avatar && isFav(charOf(a.row.avatar)))));
    const cgs = allCgs.filter(a => match(a) && (!GF.favChars || (!!a.row.avatar && isFav(charOf(a.row.avatar)))));
    const nFav = favAlbum()!.photos.length;
    const greet = GF.tab === 'greet', sprTab = GF.tab === 'sprites';
    // three tabs: the pictures of your saves, the pictures in your characters' greetings, and everyone's sprites
    const tabs = `<nav class="mu-tabs mu-gal-tabs"><button class="${greet || sprTab ? '' : 'is-on'}" data-act="gal-tab" data-tab="saves">${icon('image')}<span>Saves · ${allSaves.length}</span></button>
        <button class="${greet ? 'is-on' : ''}" data-act="gal-tab" data-tab="greet">${icon('users')}<span>Character greetings · ${allChars.length}</span></button>
        <button class="${sprTab ? 'is-on' : ''}" data-act="gal-tab" data-tab="sprites">${icon('users')}<span>Sprites and CG · ${allSprites.length + allCgs.length}</span></button></nav>`;
    const bar = `<div class="mu-gal-bar"><input class="mu-search" type="search" data-input="gal-q" data-focus="galq" placeholder="Search by name" value="${esc(GF.q)}">
        ${greet || sprTab ? `<button class="mu-chip ${GF.favChars ? 'is-on' : ''}" data-act="gal-favchars">${icon(GF.favChars ? 'starFill' : 'star')}<span>Favorite characters</span></button>` : ''}
        <button class="mu-chip" data-act="gal-album" data-key="__fav" ${nFav ? '' : 'aria-disabled="true"'}>${icon('heart')}<span>Favorite pictures · ${nFav}</span></button></div>`;
    const shown = sprTab ? sprites.length + cgs.length : greet ? chars.length : saves.length;
    if (!shown) return `${tabs}${bar}<div class="mu-gal-empty mu-panel"><i>${icon('image')}</i><h3>${q || ((greet || sprTab) && GF.favChars) ? 'Nothing found' : 'No pictures yet'}</h3>
        <p class="mu-muted">${sprTab ? 'The sprites and CG pictures of your characters and personas show up here.' : greet ? "The pictures in your characters' greetings show up here." : 'Images made in a chat (Image Generation, attached, or written as links) show up here.'}</p></div>`;
    // sprites: the neutral one of each, as their picture
    const sprCover = (a: Album) => a.photos.find(p => p.caption.endsWith('· neutral'))?.url ?? a.photos[0].url;
    if (sprTab) return tabs + bar + `<div class="mu-gal-chars mu-gal-sprites">${sprites.map(a => `<button class="mu-gal-char" data-act="gal-album" data-key="${esc(a.key)}"><img src="${esc(sprCover(a))}" alt="" loading="lazy" decoding="async">
            <span><b data-notr>${esc(a.row.chatId)}</b><small>${a.photos.length === 1 ? '1 sprite' : `${a.photos.length} sprites`}${a.row.avatar ? '' : ' · persona'}</small></span></button>`).join('')}</div>`
        // the CG pictures, apart from the sprites
        + (cgs.length ? `<section class="mu-gal-game"><h3>CG pictures</h3>
        <div class="mu-gal-chars mu-gal-sprites">${cgs.map(a => `<button class="mu-gal-char" data-act="gal-album" data-key="${esc(a.key)}"><img src="${esc(a.photos[0].url)}" alt="" loading="lazy" decoding="async">
            <span><b data-notr>${esc(a.row.chatId)}</b><small>${a.photos.length === 1 ? '1 CG' : `${a.photos.length} CG`}${a.row.avatar ? '' : ' · persona'}</small></span></button>`).join('')}</div></section>` : '');
    if (greet) return tabs + bar + `<div class="mu-gal-chars">${chars.map(a => `<button class="mu-gal-char" data-act="gal-album" data-key="${esc(a.key)}"><img src="${esc(smallCard(a.row.avatar!))}" alt="" loading="lazy" decoding="async">
            <span><b data-notr>${esc(a.row.chatId)}</b><small>${a.photos.length === 1 ? '1 picture' : `${a.photos.length} pictures`}</small></span>${isFav(charOf(a.row.avatar!)) ? `<em>${icon('starFill')}</em>` : ''}</button>`).join('')}</div>`;
    // every save in one grid, newest first; the game's name goes under each album
    return tabs + bar + `<div class="mu-albums">${saves.map(a => `<button class="mu-album" data-act="gal-album" data-key="${esc(a.key)}">${cover(a)}
            <b data-notr>${esc(a.row.chatId)}</b><small><span data-notr>${esc(a.row.title)}</span></small><small>${a.photos.length === 1 ? '1 picture' : `${a.photos.length} pictures`} · ${esc(when(a.row.last))}</small></button>`).join('')}</div>`;
}

function albumView(a: Album) {
    return `<div class="mu-gal-albumhead"><button data-act="gal-shelf" data-sfx="back">← Albums</button>
            <div><h3 data-notr>${esc(a.row.chatId)}</h3><small data-notr>${esc(a.row.title)}</small></div>
            ${a.key.startsWith('spr/') ? `<button class="mu-ghost mu-right" data-act="spr-open" data-who="${esc(a.key.slice(4))}">${icon('edit')}<span>Edit or draw in the Library</span></button>` : ''}</div>
        <div class="mu-photos ${a.key.startsWith('spr/') ? 'is-sprites' : ''}">${a.photos.map((p, i) => `<button class="mu-photo" data-act="gal-photo" data-i="${esc(i)}" title="${esc(p.caption)}" data-notr>${thumbCanvas(esc(p.url))}${isFavPic(p.url) ? `<em class="mu-photo-fav">${icon('heart')}</em>` : ''}</button>`).join('')}</div>`;
}

function lightbox(a: Album, i: number) {
    const p = a.photos[i];
    if (!p) return '';
    const fav = isFavPic(p.url);
    // the arrows are never "disabled" buttons: a click on a disabled button falls through to the background and closed the viewer
    return `<div class="mu-lightbox" data-act="gal-close-bg">
        <figure><img src="${esc(p.url)}" alt="">
            <figcaption><b data-notr>${esc(p.who)}</b>${p.caption ? `<span data-notr>${esc(p.caption)}</span>` : ''}<small>${i + 1} / ${a.photos.length}</small>
                <button class="mu-ghost mu-lb-fav ${fav ? 'is-on' : ''}" data-act="gal-fav" title="${fav ? 'Remove from favorites' : 'Favorite this picture'}">${icon(fav ? 'heart' : 'heartLine')}<span>${fav ? 'Favorite' : 'Favorite'}</span></button>
                <a href="${esc(p.url)}" target="_blank" rel="noopener">Open full size</a></figcaption></figure>
        <button class="mu-lb-nav is-prev ${i === 0 ? 'is-hidden' : ''}" data-act="gal-step" data-d="-1" aria-label="Previous">‹</button>
        <button class="mu-lb-nav is-next ${i >= a.photos.length - 1 ? 'is-hidden' : ''}" data-act="gal-step" data-d="1" aria-label="Next">›</button>
        <button class="mu-lb-close" data-act="gal-close" aria-label="Close">✕</button>
    </div>`;
}

export function galleryHtml() {
    if (G.albums === null) {
        loadAlbums().then(r => { G.albums = r; notify(); }).catch(() => { G.albums = []; notify(); });
        return `<div class="mu-gallery">${head()}<p class="mu-muted mu-pad">Opening your albums…</p></div>`;
    }
    const a = current();
    return `<div class="mu-gallery">${head()}<div class="mu-gal-body" data-keep="gallery">${a ? albumView(a) : shelf()}</div>
        ${a && G.photo !== null ? lightbox(a, G.photo) : ''}</div>`;
}
const head = () => `<div class="mu-subhead"><button data-act="gal-back" data-sfx="back">← Back</button><h2>Gallery</h2></div>`;

// Every picture of the gallery, for choosing one elsewhere (the phone's wallpaper). Loads the albums the first time.
let galLoading = false;
export function galleryPictures(): string[] | null {
    if (G.albums === null) {
        if (!galLoading) { galLoading = true; loadAlbums().then(r => { G.albums = r; }).catch(() => { G.albums = []; }).finally(() => { galLoading = false; notify(); }); }
        return null;
    }
    return [...new Set(albums().filter(a => !a.key.startsWith('spr/')).flatMap(a => a.photos.map(p => p.url)))];
}
export function openGallery() { state.view = 'gallery'; G.albums = null; G.album = null; G.photo = null; notify(); }
export function closeLightbox(): boolean { if (G.photo === null) return false; G.photo = null; notify(); return true; }

Object.assign(ACT, {
    'gal-back': () => { state.view = 'menu'; notify(); },
    'gal-album': (el) => { G.album = el.dataset.key!; G.photo = null; notify(); },
    'gal-shelf': () => { G.album = null; G.photo = null; notify(); },
    'gal-photo': (el) => { G.photo = Number(el.dataset.i); notify(); },
    'gal-step': (el) => { const a = current(); if (!a || G.photo === null) return; G.photo = Math.max(0, Math.min(a.photos.length - 1, G.photo + Number(el.dataset.d))); notify(); },
    'gal-close': () => { closeLightbox(); },
    // only a click on the dark background itself closes it
    'gal-close-bg': (el, e) => { if (e.target === el) closeLightbox(); },
    'gal-fav': () => { const a = current(); const p = a && G.photo !== null ? a.photos[G.photo] : null; if (!p) return; const f = favPics(); const k = f.indexOf(p.url); if (k >= 0) f.splice(k, 1); else f.push(p.url); saveSettings(); if (G.album === '__fav' && k >= 0) { const n = favAlbum()!.photos.length; G.photo = n ? Math.min(G.photo!, n - 1) : null; } notify(); },
    'gal-tab': (el) => { const t = el.dataset.tab; GF.tab = t === 'greet' || t === 'sprites' ? t : 'saves'; notify(); },
    'gal-favchars': () => { GF.favChars = !GF.favChars; notify(); },
});

Object.assign(INPUT, { 'gal-q': (el) => { GF.q = el.value; notify(); } });
// ← → move between pictures while one is open
document.addEventListener('keydown', (e) => {
    if (state.view !== 'gallery' || G.photo === null || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const a = current(); if (!a) return;
    G.photo = Math.max(0, Math.min(a.photos.length - 1, G.photo + (e.key === 'ArrowLeft' ? -1 : 1))); notify();
});
