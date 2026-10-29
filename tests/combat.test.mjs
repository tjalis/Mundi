// Combat (phase 6): the adventuring party and its formation, sellswords, tactical turn-by-turn fights (initiative,
// rows, actions, synergy, reactions) and the narrative quick resolution, the end of a fight (XP, spoils, wounds,
// fallen sellswords, defeat and the healer), quests and ambushes that start fights, the AI's view.
// Run: node tests/combat.test.mjs [repo root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage, browser, seed, world } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? path.join(here, '..');
const ext = stage(root, 'combat');
const meta = {}; browser(meta);
const D = (p) => import(`${ext}/dist/${p}`);
const store = await D('core/store.js'); const W = await D('core/world.js'); await D('core/saves.js');
const time = await D('sim/time.js'); const R = await D('sim/rpg.js'); const Q = await D('sim/quests.js'); const T = await D('sim/journey.js');
const C = await D('sim/combat.js'); const PT = await D('sim/party.js'); const S = await D('sim/social.js'); const P = await D('sim/prompt.js');
const UI = await D('ui/combatui.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  FAIL', m); } };
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', f), 'utf8'));
const open = (s) => { for (const k of Object.keys(meta)) delete meta[k]; meta.mundi = s; return store.game(); };
// fed and watered: when death is real (the RPG), hunger and thirst at zero cost hit points
const fed = (g) => { for (const id of ['hunger', 'thirst']) { const st = w.statuses.find(x => x.id === id); if (st) g.player.stats[id] = st.max; } return g; };
const rpgSave = (cls, level = 1) => { const s = fixture('v0.1.0-medieval.json'); s.schema = 1; s.cfg = { ...(s.cfg ?? {}), mode: 'rpg' }; const g = fed(open(s)); g.rpg = R.makeSheet(w, { cls }); if (level > 1) R.addXp(g, w, w.rpg.xp[level - 2], 'test'); R.longRest(g, w); return g; };
seed(6);
const w = world(ext, 'medieval'); W.registerWorld(w);
const people = (g) => Object.values(g.cast).filter(r => !(g.family?.kids ?? []).some(k => k.avatar === r.avatar));

// the data
{
    ok(w.rpg.bestiary.length >= 8 && w.rpg.classes.every(c => c.weapon && c.ability && c.armor !== undefined) && w.rpg.mercNames.length && w.rpg.mercWage, 'Valdoria has a bestiary, class arms and abilities, sellswords');
    const old = structuredClone(w); delete old.rpg.bestiary; old.rpg.classes.forEach(c => { delete c.weapon; delete c.ability; delete c.armor; }); delete old.presetCombat;
    const pre = await D('core/presets.js'); pre.upgradeWorld(old);
    ok(old.rpg.bestiary?.length && old.rpg.classes[0].weapon && old.presetCombat, 'an RPG made before combat gets its data once');
}
// the party
{
    const g = rpgSave('fighter');
    const [a, b, c, d] = people(g);
    for (const r of [a, b, c, d]) { r.met = true; S.social(g).bond[r.avatar] = 50; }
    ok(!PT.canJoin(g, w, a.avatar) && PT.join(g, w, a.avatar) === '' && PT.inParty(g, a.avatar) && S.isWith(g, a.avatar), 'someone who trusts you joins the party and follows you');
    S.social(g).bond[d.avatar] = 10;
    ok(/trust/.test(PT.canJoin(g, w, d.avatar)), 'a stranger does not');
    PT.join(g, w, b.avatar); PT.join(g, w, c.avatar);
    S.social(g).bond[d.avatar] = 80;
    ok(/full/.test(PT.canJoin(g, w, d.avatar)), `three companions at most`);
    const m = PT.partyOf(g).members[0]; const other = m.row === 'front' ? 'back' : 'front';
    PT.setRow(g, a.avatar, other); ok(PT.partyOf(g).members[0].row === other, 'the formation can be changed');
    time.advance(g, w, 24 * 60);
    ok(PT.friends(g).length === 3 && S.isWith(g, a.avatar), 'companions are still with you the next day');
    ok(PT.partyLine(g, w).includes(a.name) && P.sceneText().includes('adventuring party'), 'the AI knows the party');
    PT.leave(g, b.avatar); ok(!PT.inParty(g, b.avatar) && !S.isWith(g, b.avatar), 'parting ways');
    // sellswords
    g.player.loc = 'tavern'; g.player.money = 100;
    ok(PT.hiringHere(w, 'tavern') && !PT.hiringHere(w, 'smithy'), 'sellswords are found at a tavern');
    const list = PT.forHire(g, w);
    ok(list.length === 3 && list.every(x => w.rpg.mercNames.includes(x.name) && x.wage === w.rpg.mercWage * x.level), 'three for hire today, paid by level');
    ok(/joins you/.test(PT.hire(g, w, list[0].id)) && g.player.money === 100 - list[0].wage && PT.mercs(g).length === 1, 'hiring one: the first day is paid');
    PT.hire(g, w, list[1].id);
    ok(/at a time/.test(PT.hire(g, w, list[2].id)), 'two sellswords at a time');
    g.player.money = list[0].wage;
    const news = []; for (let h = 0; h < 4; h++) { news.push(...time.advance(g, w, 6 * 60)); fed(g); }   // a day, with meals
    ok(PT.mercs(g).length === 1 && news.some(n => /could not pay/.test(n)), 'unpaid, a sellsword walks away');
}
// a tactical fight
{
    const g = rpgSave('fighter', 3);
    const [a] = people(g); a.met = true; S.social(g).bond[a.avatar] = 70; PT.join(g, w, a.avatar);
    const c = C.startCombat(g, w, { why: 'Test fight:', foes: ['bandit', 'archer'] });
    ok(c && c.list.length === 4 && C.inCombat(g) && !c.mode, 'a fight starts: you, your companion, two foes; you choose how to fight');
    const me = c.list.find(f => f.id === 'you');
    ok(me.ac === 16 && me.row === 'front' && me.weapon === 'longsword', `the fighter: armor 16, front row, longsword (${me.ac})`);
    ok(C.startCombat(g, w, { why: 'x' }) === null, 'one fight at a time');
    C.chooseMode(g, w, 'tactical');
    ok(C.yourTurn(c) || c.over, 'turn by turn: the others act until your turn');
    const archer = c.list.find(f => f.ref === 'archer'); const bandit = c.list.find(f => f.ref === 'bandit');
    ok(archer.row === 'back' && bandit.row === 'front', 'archers stand in the back row');
    if (!bandit.down) ok(!C.targetsFor(c, me).some(f => f.id === archer.id) && C.targetsFor(c, me, true).some(f => f.id === archer.id), 'a blade reaches only the front row while it stands; a bow reaches anyone');
    ok(/reach/.test(C.act(g, w, { kind: 'attack', target: archer.id }).join(' ')) || bandit.down, 'attacking the back row with a blade is refused');
    let guard = 0;
    while (!c.over && guard++ < 50) {
        const t = C.targetsFor(c, me)[0];
        if (!me.used && me.hp < me.max / 2) C.act(g, w, { kind: 'ability' });
        else C.act(g, w, t ? { kind: 'attack', target: t.id } : { kind: 'defend' });
    }
    ok(c.over && c.log.some(l => /attack/.test(l)), `the fight ends (${c.over})`);
    ok(c.over === 'won', 'a level 3 fighter with a friend beats two bandits');
    if (c.over === 'won') {
        ok(g.rpg.xp > 0 && c.summary.includes('won') && c.msgs !== undefined, 'victory: experience and a summary for the AI');
        ok(g.rpg.counts.fights === 1, 'fights are counted');
    }
    ok(C.closeCombat(g) && !C.combatOf(g), 'closing the fight');
}
// rules: rows, synergy, reactions
{
    const g = rpgSave('mage', 2);
    const [a] = people(g); a.met = true; S.social(g).bond[a.avatar] = 90; PT.join(g, w, a.avatar); PT.setRow(g, a.avatar, 'front');
    const c = C.startCombat(g, w, { why: 'Rules:', foes: ['wolf'] });
    const me = c.list.find(f => f.id === 'you'); const fr = c.list.find(f => f.who === 'friend'); const wolf = c.list.find(f => f.who === 'foe');
    ok(me.row === 'back' && me.ranged, 'a mage fights from the back row');
    // cover: a heavy front row
    fr.heavy = true; fr.row = 'front';
    c.mode = 'tactical';
    // the guardian: a defending front-row ally takes a blow aimed at the back row
    fr.defend = true; wolf.ranged = true;
    Math.random = () => 0.99;   // the wolf rolls a 20
    const before = fr.hp;
    // drive one wolf attack at the mage through the AI: put the wolf on turn
    c.order = [wolf.id, 'you', fr.id]; c.turn = 0;
    const lines = C.runAI(g, w);
    ok(lines.some(l => /steps in front of You/.test(l)) && fr.hp < before && me.hp === me.max, 'the guardian steps in front of the back row');
    seed(3); delete g.combat;
    // riposte
    const c2 = C.startCombat(g, w, { why: 'Riposte:', foes: ['bandit'] }); c2.mode = 'tactical';
    const f2 = c2.list.find(f => f.who === 'friend'); const b2 = c2.list.find(f => f.who === 'foe');
    f2.heavy = true; f2.row = 'front'; f2.ac = 30; c2.list.find(f => f.id === 'you').down = true; c2.list.find(f => f.id === 'you').row = 'back';
    c2.order = [b2.id, f2.id, 'you']; c2.turn = 0;
    let k = 0; const seq = [0.3, 0.99, 0.5, 0.5, 0.5, 0.5]; Math.random = () => seq[k++ % seq.length];
    const l2 = C.runAI(g, w);
    ok(l2.some(l => /ripostes/.test(l)), 'a heavily armored fighter answers a clumsy miss with a riposte');
    seed(4); delete g.combat;
    // fighting as one: bonded allies on the same foe
    const c3 = C.startCombat(g, w, { why: 'Together:', foes: ['bear'] }); c3.mode = 'tactical';
    const f3 = c3.list.find(f => f.who === 'friend'); const bear = c3.list.find(f => f.who === 'foe'); bear.hp = bear.max = 999;
    c3.hits[bear.id] = [f3.id];
    c3.order = ['you', f3.id, bear.id]; c3.turn = 0;
    Math.random = () => 0.6;
    const l3 = C.act(g, w, { kind: 'attack', target: bear.id });
    ok(l3.some(l => /fighting as one/.test(l)), 'friends close to you (bond 60+) fight as one');
    seed(5); delete g.combat;
}
// abilities and spells
{
    const g = rpgSave('cleric', 2);
    const c = C.startCombat(g, w, { why: 'Spells:', foes: ['thug'] }); C.chooseMode(g, w, 'tactical');
    if (!c.over) {
        const me = c.list.find(f => f.id === 'you'); me.hp = 3;
        const sp = C.combatSpells(g, w);
        ok(sp.some(x => x.effect.kind === 'heal'), 'a cleric can heal in a fight');
        const focus = g.rpg.focus;
        const r = C.act(g, w, { kind: 'cast', spell: sp.find(x => x.effect.kind === 'heal').id, target: 'you' });
        ok(r.some(l => /heal/.test(l)) && g.rpg.focus < focus, 'casting costs focus and heals');
    }
    delete g.combat;
    const g2 = rpgSave('ranger');
    const c2 = C.startCombat(g2, w, { why: 'Mark:', foes: ['wolf', 'bandit'] }); c2.mode = 'tactical'; c2.order = ['you', ...c2.order.filter(x => x !== 'you')]; c2.turn = 0;
    const foe = c2.list.find(f => f.who === 'foe');
    C.act(g2, w, { kind: 'ability', target: foe.id });
    ok(c2.mark?.on === foe.id && c2.list.find(f => f.id === 'you').used, "hunter's mark, once a fight");
    delete g2.combat;
}
// the story way, the end: defeat, the healer, fallen sellswords
{
    const g = rpgSave('rogue');
    g.player.loc = 'tavern'; g.player.money = 500;
    const m = PT.forHire(g, w)[0]; PT.hire(g, w, m.id);
    const c = C.startCombat(g, w, { why: 'Doomed:', foes: ['bear', 'bear', 'captain'] });
    C.chooseMode(g, w, 'quick');
    ok(c.over && c.log.length > 3, `narrative: the engine plays out the whole fight at once (${c.over})`);
    ok(c.over === 'lost', 'three big foes beat a level 1 rogue');
    if (c.over === 'lost') {
        // death is real in the RPG: with nobody to treat you in time, a lost fight is the end
        ok(g.mortal?.dead && g.mortal.graves.some(x => x.you), 'beaten with nobody to save you: you are killed (a grave, and the death screen)');
        ok(c.summary.includes('lost') && c.summary.includes('died'), 'the AI is told');
    }
    ok(!PT.mercs(g).length && (c.msgs ?? []).some(x => /died|killed/.test(x)), 'a fallen sellsword is gone for good');
    delete g.combat;
}
// a fight's view for the AI and on screen
{
    const g = rpgSave('bard');
    const c = C.startCombat(g, w, { why: 'Shown:', foes: ['wolf'] });
    ok(/in a fight/.test(C.combatLine(g, w)) && P.sceneText().includes('in a fight'), 'the AI knows there is a fight and what the engine decided');
    const reg = await D('ui/reg.js');
    ok(UI.combatHtml().includes('pkb-next') && UI.combatHtml().includes('Shown:'), 'the fight screen tells what happens, one line at a time');
    reg.ACT['pkb-skip']();
    ok(UI.combatHtml().includes('TURN BY TURN') && UI.combatHtml().includes('AS A STORY'), 'then asks how to fight');
    C.chooseMode(g, w, 'tactical');
    reg.ACT['pkb-skip']();
    if (C.yourTurn(c)) {
        const h = UI.combatHtml();
        ok(h.includes('FIGHT') && h.includes('fight-flee') && h.includes('INSPIRATION') && h.includes('MAGIC') && h.includes('What will'), 'your turn: the 2×2 menu (fight, ability, magic, run)');
        reg.ACT['pkb-menu']({ dataset: { v: 'fight' } }); ok(UI.combatHtml().includes('DEFEND') && UI.combatHtml().includes('BACK'), 'fight: your weapon, defend, back');
        reg.ACT['fight-pick']({ dataset: { v: 'attack' } }); ok(UI.combatHtml().includes('is-target') && UI.combatHtml().includes('Who do you attack'), 'choosing a target on the field');
    }
    ok(c.frames.length >= 1 && c.frames.every(f => f.hp && f.text), 'every line is kept with everyone\'s hit points after it');
    delete g.combat;
    ok(UI.partyApp(g, w, '').includes('Your party'), 'the Party app');
}
// quests and ambushes start fights
{
    const g = rpgSave('fighter', 2);
    const giver = people(g).find(r => r.occupation) ?? people(g)[0];
    const q = { id: 'qb', kind: 'bandits', title: 'Bandits on the road', giver: giver.avatar, text: '', steps: [{ place: 'fort', what: 'Fight the bandits', fight: ['road'] }], step: 0, reward: { xp: 120, money: 40, renown: 8 }, due: g.day + 4, state: 'active' };
    Q.quests(g).push(q); g.player.loc = 'fort';
    const r = Q.doStep(g, w, 'qb');
    ok(r.fight && C.inCombat(g) && C.combatOf(g).quest === 'qb', 'a bandits quest starts a fight');
    const c = C.combatOf(g); c.list.filter(f => f.side === 'them').forEach(f => { f.hp = 1; f.ac = 1; });
    const money = g.player.money;
    C.chooseMode(g, w, 'quick');
    ok(c.over === 'won' && q.state === 'done' && g.player.money > money, `won: the quest is done (${q.state})`);
    delete g.combat;
    // an ambush on the road
    let ambushed = false;
    for (let i = 0; i < 40 && !ambushed; i++) { seed(100 + i); delete g.combat; g.rpg.attrs.wis = 3; T.travelRoad(g, w, 20 * 60, true); ambushed = C.inCombat(g); }
    ok(ambushed && /Ambush/.test(C.combatOf(g).log[0]), 'a bad night at camp can end in an ambush');
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
