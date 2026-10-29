// The RPG (phase 5): the character sheet (level, hit points, focus, attributes, class and subclass), d20 checks with
// the AI as judge, quests born from the world, titles, magic (preparing and casting), long journeys with camp, RPG
// bills named by the Lexicon, and memories carried from another game. Run: node tests/rpg.test.mjs [repo root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage, browser, seed, world } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? path.join(here, '..');
const ext = stage(root, 'rpg');
const meta = {}; browser(meta);
const D = (p) => import(`${ext}/dist/${p}`);
const store = await D('core/store.js'); const W = await D('core/world.js'); await D('core/saves.js');
const time = await D('sim/time.js'); const needs = await D('sim/needs.js'); const R = await D('sim/rpg.js');
const J = await D('sim/judge.js'); const Q = await D('sim/quests.js'); const M = await D('sim/magic.js'); const T = await D('sim/journey.js');
const WS = await D('sim/worldstate.js'); const bills = await D('sim/bills.js'); const G = await D('sim/game.js'); const C = await D('sim/combat.js'); const P = await D('sim/prompt.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  FAIL', m); } };
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', f), 'utf8'));
const open = (s) => { for (const k of Object.keys(meta)) delete meta[k]; meta.mundi = s; return store.game(); };
// fed and watered: hunger and thirst at zero now cost hit points, and death is real in the RPG
const fed = (g) => { for (const id of ['hunger', 'thirst']) { const st = w.statuses.find(x => x.id === id); if (st) g.player.stats[id] = st.max; } return g; };
// a day goes by, with meals (a day without them now costs hit points)
const day = (g) => { for (let h = 0; h < 4; h++) { time.advance(g, w, 360); fed(g); } };
const rpgSave = (cls) => { const s = fixture('v0.1.0-medieval.json'); s.schema = 1; s.cfg = { ...(s.cfg ?? {}), mode: 'rpg' }; const g = fed(open(s)); if (cls) { g.rpg = R.makeSheet(w, { cls }); R.syncLife(g, w); } return g; };
seed(21);
const w = world(ext, 'medieval'); W.registerWorld(w);
const modern = world(ext, 'modern'); W.registerWorld(modern);

// the sheet
{
    ok(w.rpg?.classes.length === 6 && w.catalogs.origins.every(o => o.skills?.length && o.feature), 'Valdoria has its RPG and BG3-style backgrounds');
    const g = rpgSave();
    ok(W.gameMode(w) === 'rpg' && R.isRpg(w) && g.rpg && g.rpg.level === 1, 'a save played as RPG gets a sheet when it opens');
    const s = R.makeSheet(w, { cls: 'fighter', attrs: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, skills: ['athletics', 'perception'], origin: { skills: ['survival'], attributes: { con: 1 } } });
    ok(R.pointsUsed({ str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }) === 27, 'point buy: 27 points');
    ok(s.attrs.con === 15 && s.skills.includes('survival') && R.hpMax(w, s) === 12, `the background adds its +1 and skills; fighter HP 10 + CON (${R.hpMax(w, s)})`);
    g.rpg = s; R.syncLife(g, w);
    const life = w.statuses.find(x => x.id === 'life');
    ok(g.player.stats.life === life.max, 'full hit points: full life');
    needs.addStatus(g, w, 'life', -50);
    ok(s.hp === 6 && g.player.stats.life === 50, `losing half the life is losing half the hit points (${s.hp})`);
    R.longRest(g, w); ok(s.hp === 9, `a long rest heals a fifth of the hit points: death is real, wounds take days (${s.hp})`);
    const msgs = R.addXp(g, w, 320, 'test');
    ok(s.level === 3 && R.pendingSubclass(w, s) && msgs.some(m => /Level 3/.test(m)), `experience: level ${s.level}, subclass to choose`);
    ok(R.hpMax(w, s) > 12, 'more hit points with levels');
    ok(/Champion/.test(R.chooseSubclass(g, w, 'champion')) && R.trained(w, s).includes('athletics'), 'choosing a subclass');
    R.addXp(g, w, 300, 'test'); ok(s.level === 4 && s.points === 2, 'level 4: 2 attribute points');
    ok(R.spendPoint(g, w, 'str') && s.attrs.str === 16, 'spending a point');
    ok(/level \d+ Champion fighter/.test(R.sheetLine(g, w)) && P.sceneText().includes('Champion fighter'), 'the AI knows who you are');
}
// checks and the judge
{
    const g = rpgSave('rogue');
    const c = R.rollCheck(g, w, 'stealth', 13, 0, () => 0.5);
    ok(c.d20 === 11 && c.bonus === R.skillBonus(w, g.rpg, 'stealth') && c.total === 11 + c.bonus, 'a check is a d20 plus the skill');
    g.rpg.next = { advantage: ['stealth'] };
    let k = 0; const two = [0.1, 0.9]; const c2 = R.rollCheck(g, w, 'stealth', 13, 0, () => two[k++]);
    ok(c2.adv && c2.d20 === 19 && !g.rpg.next, 'advantage: two dice, the best one; then it is used up');
    const v = J.parseVerdict('CHECK: yes\nSKILL: Deception\nTARGET: Mara\nDIFFICULTY: very hard\nQUALITY: +2');
    ok(v.check && v.skill === 'deception' && v.difficulty === 'very hard' && v.quality === 2 && v.target === 'mara', 'the judge\'s answer is read');
    const someone = Object.values(g.cast)[0]; someone.routine = { weekday: [[0, 'tavern']], weekend: [[0, 'tavern']] }; g.player.loc = 'tavern';
    globalThis.__ctx.generateRaw = async () => `CHECK: yes\nSKILL: persuasion\nTARGET: ${someone.name}\nDIFFICULTY: medium\nQUALITY: 1`;
    const present = (await D('sim/people.js')).presentAt(g, w, 'tavern');
    ok(await J.socialCheck(g, w, 'Nice weather today.', present) === null, 'ordinary talk: no check (the judge is not even asked)');
    const res = await J.socialCheck(g, w, 'Come on, trust me, convince your boss to give me the job.', present);
    ok(res && /Rules — a Persuasion check decided by the dice: d20 \d+/.test(res.prompt) && /vs DC 1\d/.test(res.prompt), `an attempt: the dice decide (${res?.toast})`);
    ok(J.SOUNDS_LIKE.test('Vou tentar convencer ela') && J.SOUNDS_LIKE.test('I swear I didn\'t'), 'attempts are noticed in Portuguese too');
}
// quests born from the world
{
    const g = rpgSave('bard');
    WS.regionState(g, w, 'aurenfort').tension = 70;
    let q = null;
    for (let d = 0; d < 3; d++) day(g);
    ok(!Q.offeredQuests(g).length, 'quests do not turn up by themselves: they are found');
    // what a board in town has on it (the world's state makes the requests)
    for (let d = 0; d < 20 && !q; d++) { day(g); const f = Q.worldQuest(g, w, { how: 'board', place: g.player.loc, here: [] }); if (f) q = Q.offer(g, f); }
    ok(!!q, `the world makes quests to be found (${q?.title})`);
    ok(/accepted/.test(Q.acceptQuest(g, q.id)) && Q.activeQuests(g).length === 1, 'accepting one');
    let guard = 0;
    while (q.state === 'active' && guard++ < 30) { g.player.loc = q.steps[q.step].place; const r = Q.doStep(g, w, q.id); if (r?.fight) { C.combatOf(g).list.filter(f => f.side === 'them').forEach(f => (f.hp = 1)); C.chooseMode(g, w, 'quick'); C.closeCombat(g); } if (r && /tomorrow/.test(r.text)) g.day++; }
    ok(q.state === 'done' || q.state === 'failed', `a quest ends (${q.state})`);
    if (q.state === 'done') ok(g.rpg.xp > 0 && g.rpg.counts.quests === 1, 'experience and a count for the titles');
}
// titles
{
    const g = rpgSave('bard');
    const m = R.count(g, w, 'socialWins', 10);
    ok(m.some(x => /Silver-tongued/.test(x)) && R.titleNames(w, g.rpg).includes('the Silver-tongued'), 'ten social wins: the Silver-tongued');
}
// magic
{
    const g = rpgSave('cleric');
    const s = g.rpg;
    ok(s.known.length === 2 && s.prepared.length === 2, 'a cleric starts with two prepared spells');
    s.hp = 1; R.syncLife(g, w);
    const heal = M.knownSpells(g, w).find(x => x.effect.kind === 'heal');
    if (heal) { const f0 = s.focus; const r = M.cast(g, w, heal.id); ok(r.ok && s.hp > 1 && s.focus === f0 - heal.cost && /cast a spell/.test(r.scene), 'casting heals and costs focus, and the AI is told'); }
    ok(!s.prepOpen && /long rest/.test(M.togglePrepared(g, w, s.known[0])), 'spells are prepared after a long rest');
    R.longRest(g, w); ok(s.prepOpen && s.focus === R.focusMax(w, s), 'after a rest: focus back, preparing again');
    R.addXp(g, w, 120, 'test'); ok(s.learn === 1 && R.spellsFor(w, s).length > 2, 'a new level: a new spell to learn');
    const fighter = rpgSave('fighter'); ok(!R.isCaster(w, fighter.rpg) && fighter.rpg.known.length === 0, 'a fighter has no grimoire');
}
// journeys
{
    const g = rpgSave('ranger');
    const from = w.places.find(p => p.map === 'aurenfort' && !p.link).id, to = w.places.find(p => p.map === 'trigal' && !p.link).id;
    const j = T.journeyOf(g, w, from, to, 14 * 60);
    ok(j && j.camps === 1, 'a long trip between regions means a night at camp');
    ok(!T.journeyOf(g, w, from, from, 60), 'a short walk is not a journey');
    // nearly unhurt: when death is real, a day on the road with nothing to drink kills someone already hurt
    const half = R.hpMax(w, g.rpg) - 1; g.rpg.hp = half; R.syncLife(g, w);
    for (const st of w.statuses) if (st.id !== 'life') g.player.stats[st.id] = st.max;   // set off rested, fed and in good spirits
    const msgs = T.travelRoad(g, w, 9 * 60, true);   // a day on the road and a night at camp
    ok(msgs.some(m => /🏕️/.test(m)) && g.rpg.counts.camps === 1 && g.rpg.hp > 0 && !g.mortal?.dead, `making camp: rest, a Survival check, a count (${g.rpg.hp} HP)`);
}
// RPG bills, by the Lexicon
{
    const g = rpgSave('fighter');
    ok(bills.billList(w).some(b => b.id === 'upkeep' && b.name === 'Upkeep of arms and gear'), 'the RPG has its own bill, named by the Lexicon');
    const s = fixture('v0.1.0-medieval.json'); s.schema = 1; open(s);
    ok(!bills.billList(w).some(b => b.id === 'upkeep') && W.gameMode(w) === 'lifesim' && !store.game().rpg && !W.appsShown(w).some(a => a.id === 'grimoire'), 'played as Life-Sim: no sheet, no RPG bill, no RPG apps');
    void g;
}
// memories from another life
{
    const old = fixture('v0.1.0-medieval.json'); old.facts = [{ id: 'f1', at: 100, place: 'tavern', who: [Object.keys(old.cast)[0]], t: '{u} sang a song for {0}.', a: ['someone'] }, { id: 'f2', at: 120, place: 'tavern', who: ['nobody.png'], t: 'Something else.' }];
    globalThis.__ctx.getRequestHeaders = () => ({});
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ chat_metadata: { mundi: old } }, { mes: 'hi' }] });
    const s = fixture('v0.1.0-medieval.json'); s.facts = [];
    const n = await G.portMemories(s, 'other-chat');
    ok(n === 1 && s.facts[0].t.startsWith('(In another life)') && s.facts[0].id === 'life2:f1', 'only memories of the people of this game come along');
    ok(s.player.money === fixture('v0.1.0-medieval.json').player.money, 'and nothing else');
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
