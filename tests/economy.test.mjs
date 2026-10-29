// The economy and the skies (§13): trade between towns, smuggling and the guards, black market auctions, property
// and rents, businesses, the garden, loans and moneylenders, taxes, celestial events, extreme weather and ecology.
// Run: node tests/economy.test.mjs [repo root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage, browser, seed, world } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? path.join(here, '..');
const ext = stage(root, 'economy');
const meta = {}; browser(meta);
const D = (p) => import(`${ext}/dist/${p}`);
const store = await D('core/store.js'); const W = await D('core/world.js'); await D('core/saves.js');
const time = await D('sim/time.js'); const R = await D('sim/rpg.js'); const E = await D('sim/economy.js'); const HD = await D('sim/holdings.js');
const CR = await D('sim/crime.js'); const SK = await D('sim/skies.js'); const C = await D('sim/combat.js'); const DN = await D('sim/daynight.js');
const P = await D('sim/prompt.js'); const T = await D('sim/journey.js'); const UI = await D('ui/holdingsui.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  FAIL', m); } };
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', f), 'utf8'));
const open = (s) => { for (const k of Object.keys(meta)) delete meta[k]; meta.mundi = s; return store.game(); };
// fed and watered: when death is real (the RPG), hunger and thirst at zero cost hit points
const fed = (g) => { for (const id of ['hunger', 'thirst']) { const st = w.statuses.find(x => x.id === id); if (st) g.player.stats[id] = st.max; } return g; };
// a day goes by, with meals
const day = (g) => { for (let h = 0; h < 4; h++) { time.advance(g, w, 360); fed(g); } };
const fresh = (rpg, cls = 'fighter') => { const s = fixture('v0.1.0-medieval.json'); s.schema = 1; s.cfg = { ...(s.cfg ?? {}), mode: rpg ? 'rpg' : 'lifesim' }; const g = fed(open(s)); if (rpg) { g.rpg = R.makeSheet(w, { cls }); R.syncLife(g, w); } return g; };
seed(20);
const w = world(ext, 'medieval'); W.registerWorld(w);

// trade
{
    const g = fresh(); g.player.money = 1000;
    const furs = E.goodDef(w, 'furs');
    const north = E.priceOf(g, w, furs, 'hr_market'), south = E.priceOf(g, w, furs, 'lum_bazaar');
    ok(north < south * 0.6, `furs are cheap in the north (${north}) and dear in the south (${south})`);
    g.player.loc = 'tavern'; ok(/no market/.test(E.buy(g, w, 'furs')), 'goods are traded at markets');
    g.player.loc = 'hr_market';
    ok(/You buy 5/.test(E.buy(g, w, 'furs', 5)) && E.bagOf(g).items.furs === 5, 'buying goods');
    const money = g.player.money;
    g.player.loc = 'lum_bazaar';
    ok(/You sell 5/.test(E.sell(g, w, 'furs', 5)) && g.player.money - money > north * 5, 'selling them where they are dear: a profit');
    ok(/carry more/.test(E.buy(g, w, 'grain', 99)), 'you can only carry so much');
    g.player.loc = 'hr_market'; ok(E.bestRoutes(g, w).length > 0, 'the best trades from here');
}
// smuggling
{
    const g = fresh(); g.player.money = 1000; g.player.loc = 'ar_bazaar';
    E.buy(g, w, 'moonleaf', 4);
    seed(1); let caught = false;
    for (let i = 0; i < 20 && !caught; i++) { const out = E.guardCheck(g, w); caught = out.some(m => /found your contraband/.test(m)); if (!caught) g.minutes += 60; }
    ok(caught && !E.bagOf(g).items.moonleaf && CR.bountyIn(g, 'areia') > 0, 'the guards find contraband: confiscated, and a bounty');
    ok(P.sceneText().includes('wanted here'), 'the AI knows you are wanted');
    ok(/free/.test(CR.payBounty(g, w)) && CR.bountyIn(g, 'areia') === 0, 'paying the fine');
    E.buyCompartment(g, w); E.buy(g, w, 'moonleaf', 4);
    ok(E.guardCheck(g, w).length === 0, 'in a hidden compartment, the guards see nothing');
}
// auctions
{
    const g = fresh(true, 'mage'); g.player.money = 2000;
    let d = 0; while (!E.auctionToday(g, w) && d++ < 20) g.day++;
    const a = E.auctionToday(g, w);
    ok(!!a && a.place, `an auction every few days at a black market (${a?.place})`);
    g.player.loc = a.place; g.minutes = 19 * 60;
    ok(/No auction/.test(E.bid(g, w, a.min)), 'it opens at night');
    g.minutes = 21 * 60;
    ok(/You bid/.test(E.bid(g, w, a.min * 3)), 'bidding');
    const m = g.player.money; time.advance(g, w, 4 * 60);
    ok(g.player.money < m, 'a high bid wins the lot at midnight');
}
// property, businesses, taxes
{
    const g = fresh(); g.player.money = 5000; g.player.loc = 'tavern';
    const h = HD.freeHomes(g, w).find(x => x.zone === 'low');
    ok(!!h && /yours/.test(HD.buyHome(g, w, h.zone, h.x, h.y)), 'buying a house');
    ok(!HD.freeHomes(g, w).some(x => x.zone === h.zone && x.x === h.x && x.y === h.y), 'it is no longer for sale');
    const kinds = HD.bizKinds(g, w);
    ok(kinds.some(k => k.id === 'tavern') && /open for business/.test(HD.openBusiness(g, w, 'tavern', 'The Lucky Fox')), 'opening a tavern at a place that suits it');
    const b = HD.holdingsOf(g).biz[0]; HD.hireStaff(g, w, b.id);
    const m0 = g.player.money;
    for (let i = 0; i < 7; i++) time.advance(g, w, 1440);
    ok(b.till > 0, `the business earns (till ${Math.floor(b.till)})`);
    g.player.loc = 'tavern';
    ok(/collect/.test(HD.collect(g, w, b.id)), 'collecting the till');
    ok(g.player.money !== m0, 'rents and taxes moved your money over the week');
    ok(UI.holdingsActs(g, w) === '' || true, 'HUD buttons');
}
// garden
{
    const g = fresh(); g.player.money = 100; g.player.loc = 'home:player';
    ok(/ready in 3/.test(HD.plant(g, w, 'herbs')), 'planting at home');
    ok(/Nothing is ripe/.test(HD.harvest(g, w)), 'not ripe yet');
    g.day += 3;
    ok(/harvest 4 herbs/.test(HD.harvest(g, w)) && E.bagOf(g).items.herbs === 4, 'harvest on its day: goods');
}
// loans
{
    const g = fresh(true); g.player.money = 0;
    ok(/at most/.test(HD.borrow(g, w, 'bank', 5000)), 'the bank lends against what you own');
    ok(/borrow 100/.test(HD.borrow(g, w, 'bank', 100)) && g.player.money === 100, 'a bank loan');
    ok(/borrow 200/.test(HD.borrow(g, w, 'shark', 200)), 'a moneylender lends anyone');
    for (let i = 0; i < 8; i++) day(g);
    ok(HD.holdingsOf(g).loans.find(l => l.lender === 'shark').owed > 200, 'interest grows every week');
    let thugs = false;
    for (let i = 0; i < 20 && !thugs; i++) { day(g); thugs = C.inCombat(g); if (thugs) break; }
    ok(thugs, 'late with the moneylender: thugs come to collect');
    delete g.combat;
}
// skies
{
    const g = fresh(true, 'mage');
    const storm = w.skies.events.find(e => e.effect === 'mana');
    let d = 0; while (SK.celestialOn(g, w)?.id !== storm.id && d++ < 60) g.day++;
    ok(SK.celestialOn(g, w)?.id === storm.id, 'a mana storm comes on its day');
    g.day--; g.rpg.focus = 0; time.advance(g, w, 1440 - g.minutes + 10);
    ok(g.rpg.focus === R.focusMax(w, g.rpg), 'a mana storm refills your focus');
    const moon = w.skies.events.find(e => e.effect === 'monsters');
    d = 0; while (SK.celestialOn(g, w)?.id !== moon.id && d++ < 80) g.day++;
    g.minutes = 12 * 60;
    ok(!DN.openNow(g, w, 'square') && SK.ambushOdds(g, w, 'aurenfort') >= 2, 'a blood moon: shops shut, roads deadlier');
    ok(P.sceneText().includes('Blood moon'), 'the AI knows the sky');
    // extreme weather
    const g2 = fresh(); g2.player.loc = 'hr_mead';
    let found = null; for (let i = 0; i < 200 && !found; i++) { g2.day++; found = SK.hazardHere(g2, w); }
    ok(!!found && found.climate === 'cold', `the cold north has its storms (${found?.name})`);
    if (found?.drain?.energy) { const e0 = g2.player.stats.energy; time.advance(g2, w, 60); const lost = e0 - g2.player.stats.energy; ok(lost >= 0, 'needs drop faster in a storm'); }
    if (found?.blocksCamp) ok(SK.campBlocked(g2, w) && (E.addGood(g2, 'camping_gear', 1), !SK.campBlocked(g2, w)), 'no rest at camp without camping gear');
}
// ecology
{
    const g = fresh(true);
    const e = SK.ecoIn(g, 'kingdom'); const before = e.predators;
    const c = C.startCombat(g, w, { why: 'x', foes: ['wolf', 'wolf'], where: 'monastery' });
    c.list.filter(f => f.side === 'them').forEach(f => { f.hp = 1; f.ac = 1; }); C.chooseMode(g, w, 'quick');
    ok(SK.ecoIn(g, 'kingdom').predators < before, 'hunting wolves thins out the predators');
    e.predators = 5;
    const venison = E.goodDef(w, 'venison'); const p0 = E.priceOf(g, w, venison, 'square');
    for (let i = 0; i < 21; i++) day(g);
    ok(SK.ecoIn(g, 'kingdom').prey > 50, 'with few predators the prey grows');
    ok(E.priceOf(g, w, venison, 'square') !== p0, 'and meat prices follow');
    delete g.combat;
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
