// Stop: everything Mundi is drawing on ComfyUI, at once. While anything is (sprites, CG, scene looks, painting the
// world, a place drawn into its map), a small Stop button floats in the corner, in Mundi and in SillyTavern alike.
// Stopping takes Mundi's waiting jobs off ComfyUI's queue, interrupts the one it is running (only if it is Mundi's),
// and tells the loops (the sprite queue, Paint) to send nothing more. Jobs of other apps on ComfyUI are left alone.

/** A job or loop ended by Stop: its caller says nothing (one "Stopped" toast covers them all). */
export class Stopped extends Error { constructor() { super('Stopped.'); this.name = 'Stopped'; } }
export const isStopped = (e: unknown) => e instanceof Stopped;

// Mundi's jobs on ComfyUI while they wait or run (prompt id → server), and how many times Stop was pressed: a job
// or a loop that began before the last Stop ends.
const LIVE = new Map<string, string>();
let stops = 0;
export const stopCount = () => stops;
/** Throws when Stop was pressed since `at` (a stopCount() taken when the loop began). */
export const checkStop = (at: number) => { if (stops !== at) throw new Stopped(); };

// What each part that draws does on Stop, and what it is doing now ('' when nothing).
interface Part { stop: () => void; doing: () => string }
const PARTS: Part[] = [];
export const stoppable = (p: Part) => { PARTS.push(p); };

export function jobStarted(id: string, url: string) { LIVE.set(id, url); show(); }
export function jobEnded(id: string) { LIVE.delete(id); show(); }

// Off ComfyUI's queue (waiting), and interrupted (running: only when it is one of these).
export async function cancelJobs(url: string, ids: string[]) {
    const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await post('/queue', { delete: ids }).catch(() => {});
    const q = await fetch(`${url}/queue`).then(r => r.json()).catch(() => ({}));
    const running: string[] = (q.queue_running ?? []).map((r: any) => String(r?.[1]));
    for (const id of ids) if (running.includes(id)) await post('/interrupt', { prompt_id: id }).catch(() => {});
}

export async function stopAll() {
    stops++;
    for (const p of PARTS) { try { p.stop(); } catch (e) { console.warn('[Mundi] stop', e); } }
    const byUrl = new Map<string, string[]>();
    for (const [id, url] of LIVE) byUrl.set(url, [...(byUrl.get(url) ?? []), id]);
    LIVE.clear(); show();
    await Promise.all([...byUrl].map(([url, ids]) => cancelJobs(url, ids)));
    const { toast } = await import('../core/store.js');
    toast('Stopped: nothing more goes to ComfyUI.', 'info');
}

/* ---------- the button ---------- */

const doing = () => PARTS.map(p => p.doing()).find(Boolean) || (LIVE.size ? 'Drawing on ComfyUI' : '');
let el: HTMLElement | null = null;
function show() {
    if (typeof document === 'undefined') return;
    const now = doing();
    if (!now) { el?.remove(); el = null; return; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'mundi-comfystop';
        el.innerHTML = '<span class="mu-cs-spin" aria-hidden="true"></span><span class="mu-cs-text"></span><button type="button" title="Stop everything Mundi is drawing on ComfyUI">■ Stop</button>';
        el.querySelector('button')!.addEventListener('click', (e) => { e.stopPropagation(); void stopAll(); });
        document.body.appendChild(el);
    }
    const t = el.querySelector('.mu-cs-text')!;
    if (t.textContent !== now) t.textContent = now;
}
// the parts' progress changes without telling this module: looked at twice a second
if (typeof window !== 'undefined') setInterval(show, 500);
