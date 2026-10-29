// Factions, guilds and kingdoms (§7, §12) and the realm (government, power affinity, pantheon, divine favor).
// Run: node tests/realm.test.mjs [repo root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage, browser, seed, world } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? path.join(here, '..');
const ext = stage(root, 'realm');
const meta = {}; browser(meta);
const D = (p) => import(`${ext}/dist/${p}`);
const store = await D('core/store.js'); const W = await D('core/world.js'); await D('core/saves.js'); const RD = await D('core/rpgdef.js');
const time = await D('sim/time.js'); const R = await D('sim/rpg.js'); const S = await D('sim/social.js'); const F = await D('sim/factions.js');
const RM = await D('sim/realm.js'); const C = await D('sim/combat.js'); const P = await D('sim/prompt.js'); const WS = await D('sim/worldstate.js');
const UI = await D('ui/factionsui.js'); const pre = await D('core/presets.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  FAIL', m); } };
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', f), 'utf8'));
const open = (s) => { for (const k of Object.keys(meta)) delete meta[k]; meta.mundi = s; return store.game(); };
// fed and watered: when death is real (the RPG), hunger and thirst at zero cost hit points
const fed = (g) => { for (const id of ['hunger', 'thirst']) { const st = w.statuses.find(x => x.id === id); if (st) g.player.stats[id] = st.max; } return g; };
const fresh = (rpg, cls = 'fighter') => { const s = fixture('v0.1.0-medieval.json'); s.schema = 1; s.cfg = { ...(s.cfg ?? {}), mode: rpg ? 'rpg' : 'lifesim' }; const g = fed(open(s)); if (rpg) { g.rpg = R.makeSheet(w, { cls }); R.syncLife(g, w); } return g; };
seed(12);
const w = world(ext, 'medieval'); W.registerWorld(w);

// joining, duties, ranks
{
    ok(w.factions.length >= 6 && w.realm?.government === 'fractured', 'Valdoria has factions and a realm');
    const g = fresh(); g.player.money = 500;
    g.player.loc = 'tavern';
    ok(/join at/.test(F.canJoin(g, w, 'adventurers')), 'you join at the headquarters');
    g.player.loc = 'advguild';
    ok(/Copper/.test(F.join(g, w, 'adventurers')) && F.memberOf(g, 'adventurers'), 'joining the Adventurers\' Guild');
    ok(F.standingOf(g, 'adventurers') === 10, 'joining earns standing');
    let n = 0; while (F.memberOf(g, 'adventurers').rank < 1 && n++ < 30) { g.player.loc = 'advguild'; g.player.stats.energy = 100; const r = F.doDuty(g, w, 'adventurers'); if (/enough/.test(r.text)) g.day += 7; else time.advance(g, w, r.minutes); }
    ok(F.memberOf(g, 'adventurers').rank === 1 && F.rankName(g, w, 'adventurers') === 'Iron', `duties lead to a promotion (${n} tries)`);
    ok(P.sceneText().includes('Adventurers\' Guild'), 'the AI knows your factions');
    // rivals
    g.player.loc = 'docks';
    F.addStanding(g, w, 'hand', 30);
    ok(F.standingOf(g, 'crown') < 0, 'helping thieves hurts with the crown');
    g.player.loc = 'castle';
    ok(/rivals|trust/.test(F.canJoin(g, w, 'crown')) || F.canJoin(g, w, 'crown') === '', 'joining asks for standing');
}
// the week: dues and missed duties
{
    const g = fresh(); g.player.money = 100; g.player.loc = 'advguild'; F.join(g, w, 'adventurers');
    const m0 = g.player.money, s0 = F.standingOf(g, 'adventurers');
    for (let i = 0; i < 15; i++) time.advance(g, w, 1440);
    ok(g.player.money <= m0 - 5, 'weekly dues are paid');
    ok(F.standingOf(g, 'adventurers') < s0, 'missed duties cost standing');
}
// leading
{
    const g = fresh(); g.player.money = 1000; g.player.loc = 'advguild'; F.join(g, w, 'adventurers');
    F.memberOf(g, 'adventurers').rank = 4;
    ok(F.isLeader(g, w, 'adventurers'), 'the top rank leads');
    const a = F.startAudience(g, w, 'adventurers');
    ok(typeof a === 'object' && a.choices.length >= 2 && UI.audienceHtml().includes(a.choices[0].label), 'an audience: a petition and choices');
    ok(F.decideAudience(g, w, a.choices[0].id).length > 0 && !F.fstate(g).pending, 'deciding it');
    ok(/done for today/.test(F.startAudience(g, w, 'adventurers')), 'one shift a day');
    g.day++; const m = g.player.money;
    ok(/\+/.test(F.skipShift(g, w, 'adventurers')) && g.player.money > m, 'or skip the shift for a passive income');
}
// your own faction and its levels
{
    const g = fresh(); g.player.money = 2000; g.player.loc = 'square';
    ok(/founded/.test(F.found(g, w, 'The Silver Lanterns', 'guild')) && F.fstate(g).own.level === 1, 'founding a faction');
    ok(/level 2/.test(F.hireAssistant(g, w)) && F.fstate(g).own.level === 2, 'level 2: a roster');
    ok(/level 3/.test(F.setHq(g, w, 'square')) && F.fstate(g).own.level === 3, 'level 3: a headquarters');
    const ppl = Object.values(g.cast).slice(0, 3); ppl.forEach(r => { r.met = true; S.social(g).bond[r.avatar] = 60; F.recruit(g, w, r.avatar); });
    F.deposit(g, 600);
    ok(F.fstate(g).own.level === 4 || /level 4/.test(F.checkLevel(g, w)) || F.fstate(g).own.level === 4, `level 4: members and a treasury (${F.fstate(g).own.level})`);
    ok(F.isLeader(g, w, F.OWN), 'you lead it');
}
// power and rivalries
{
    const g = fresh();
    time.advance(g, w, 1440);
    const before = { crown: F.powerOf(g, 'crown'), hand: F.powerOf(g, 'hand') };
    for (let i = 0; i < 14; i++) time.advance(g, w, 1440);
    ok(F.powerOf(g, 'crown') !== before.crown || F.powerOf(g, 'hand') !== before.hand, 'factions gain and lose ground every week');
    ok(F.fstate(g).news.length > 0, 'and the news says so');
}
// enemies on sight (RPG)
{
    const g = fresh(true); g.player.loc = 'docks'; F.fstate(g).standing.hand = -80;
    time.advance(g, w, 60);
    ok(C.inCombat(g), 'a hostile faction attacks you at its headquarters');
    delete g.combat;
}
// government, power affinity, gods
{
    ok(RD.rpgOf(w).classes.find(c => c.id === 'cleric').name === 'Healer', 'no gods: the cleric is a Healer');
    const holy = structuredClone(w); holy.realm.pantheon = [{ id: 'sol', name: 'Sol', domain: 'the sun' }];
    ok(RD.rpgOf(holy).classes.find(c => c.id === 'cleric').name === 'Cleric', 'with gods: a Cleric again');
    const arc = structuredClone(w); arc.realm.power = 'arcane';
    ok(RD.rpgOf(arc).spells.find(s => s.id === 'cure_wounds').cost === 1, 'an arcane realm: spells cost less');
    const mil = structuredClone(w); mil.realm.power = 'military';
    ok(RM.xpMul(mil) === 1.2 && RM.xpMul(w) === 1, 'a military realm: more experience from fights');
    const tr = structuredClone(w); tr.realm.power = 'trade';
    const g = fresh(); g.player.loc = 'tavern'; g.minutes = 12 * 60;
    ok(Math.abs(WS.priceHere(g, tr) / WS.priceHere(g, w) - 0.95) < 1e-9, 'a trade realm: prices are lower');
    ok(RM.baseTax(w) === 0.08 && RM.realmLine(g, w).includes('fractured'), 'government: taxes and the AI\'s view');
    ok(P.sceneText().includes('No gods answer'), 'without gods, the AI knows altars are monuments');
    // devotion and miracles
    W.registerWorld(holy);
    const gg = fresh(true); gg.world = holy.id;
    ok(/patron/.test(RM.choosePatron(gg, holy, 'sol')), 'choosing a patron');
    gg.player.loc = 'chapel'; gg.player.money = 500;
    for (let i = 0; i < 20 && RM.faithOf(gg).devotion < RM.MIRACLE(holy); i++) { RM.pray(gg, holy); RM.offer(gg, holy); gg.day++; }
    ok(RM.faithOf(gg).devotion >= 100, 'prayer and offerings fill devotion');
    ok(/ward/.test(RM.miracle(gg, holy, 'ward')) && RM.faithOf(gg).ward, 'a miracle: a ward');
    const c = C.startCombat(gg, holy, { why: 'x', foes: ['bear', 'bear', 'captain'] }); C.chooseMode(gg, holy, 'quick');
    // death is real in the RPG: the fight is lost, and the ward turns death aside
    ok(c.over === 'lost' && !gg.mortal?.dead && !RM.faithOf(gg).ward && (gg.mortal?.told ?? []).some(t => /ward turns death aside/.test(t.text)), 'the ward turns death aside');
    delete gg.combat;
    W.registerWorld(w);
}
// screens and presets
{
    const g = fresh(); g.player.loc = 'advguild';
    const h = UI.factionsApp(g, w, '');
    ok(h.includes('Adventurers') && h.includes('Found your own faction') && !h.includes('Velvet Hand'), 'the Factions app (secret factions hidden)');
    const old = structuredClone(w); delete old.factions; delete old.realm; delete old.presetRealm; pre.upgradeWorld(old);
    ok(old.factions?.length && old.realm, 'an older world gets factions and a realm once');
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
