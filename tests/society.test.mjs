// Life and society (§9C): habits that become traits, reputation that fades, a secret identity with suspicion, pets and
// familiars, apprentices, letters from friends far away, festivals. Run: node tests/society.test.mjs [repo root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage, browser, seed, world } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? path.join(here, '..');
const ext = stage(root, 'society');
const meta = {}; browser(meta);
const D = (p) => import(`${ext}/dist/${p}`);
const store = await D('core/store.js'); const W = await D('core/world.js'); await D('core/saves.js');
const time = await D('sim/time.js'); const needs = await D('sim/needs.js'); const R = await D('sim/rpg.js'); const S = await D('sim/social.js');
const HB = await D('sim/habits.js'); const ST = await D('sim/standing.js'); const PT = await D('sim/pets.js'); const MT = await D('sim/mentors.js');
const LT = await D('sim/letters.js'); const FS = await D('sim/festivals.js'); const P = await D('sim/prompt.js'); const facts = await D('sim/facts.js');
const people = await D('sim/people.js'); const WS = await D('sim/worldstate.js'); const UI = await D('ui/lifeplus.js');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  FAIL', m); } };
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', f), 'utf8'));
const open = (s) => { for (const k of Object.keys(meta)) delete meta[k]; meta.mundi = s; return store.game(); };
// fed and watered: when death is real (the RPG), hunger and thirst at zero cost hit points
const fed = (g) => { for (const id of ['hunger', 'thirst']) { const st = w.statuses.find(x => x.id === id); if (st) g.player.stats[id] = st.max; } return g; };
// a day goes by, with meals
const day = (g) => { for (let h = 0; h < 4; h++) { time.advance(g, w, 360); fed(g); } };
const fresh = (rpg) => { const s = fixture('v0.1.0-medieval.json'); s.schema = 1; s.cfg = { ...(s.cfg ?? {}), mode: rpg ? 'rpg' : 'lifesim' }; const g = fed(open(s)); if (rpg) { g.rpg = R.makeSheet(w, { cls: 'mage' }); R.syncLife(g, w); } return g; };
seed(8);
const w = world(ext, 'medieval'); W.registerWorld(w);
const act = (id) => w.actions.find(a => a.id === id);

// habits
{
    const g = fresh();
    ok(w.habits.length >= 5 && w.festivals.length >= 3 && w.pets.length >= 3, 'the world has habits, festivals and animals');
    g.player.money = 1000; g.player.loc = 'tavern';
    for (let i = 0; i < 6; i++) { needs.applyAction(g, w, act('ale')); if (i % 2) time.advance(g, w, 1440); }
    time.advance(g, w, 1440);
    ok(HB.habitTraits(g, w).includes('Heavy drinker') && Object.values(g.player.traits).flat().includes('Heavy drinker'), 'ale six times in a week: "Heavy drinker"');
    ok(P.sceneText().includes('heavy drinker'), 'the AI knows the habit');
    time.advance(g, w, 15 * 1440);
    ok(!HB.habitTraits(g, w).includes('Heavy drinker'), 'two weeks without it: the habit fades');
    ok(HB.matches({ hours: [5, 8], count: 1, days: 1 }, { id: 'x' }, 6 * 60) && !HB.matches({ hours: [5, 8], count: 1, days: 1 }, { id: 'x' }, 9 * 60), 'habits by the hour');
}
// reputation
{
    const g = fresh(); g.player.loc = 'tavern';
    ST.addRep(g, w, 35, 'test');
    ok(ST.repIn(g, w, 'aurenfort') === 35 && ST.repWord(35) === 'respected', 'a deed builds a name in town');
    ok(P.sceneText().includes('respected'), 'the AI knows how the town sees you');
    const d0 = g.day; time.advance(g, w, 20 * 1440);
    ok(ST.repIn(g, w, 'aurenfort') < 35 && ST.repIn(g, w, 'aurenfort') > 25, `without news it fades (${ST.repIn(g, w, 'aurenfort')} after ${g.day - d0} days)`);
}
// secret identity
{
    const g = fresh(); g.player.loc = 'home:player';
    ok(/first/.test(ST.toggleDisguise(g, w)), 'no disguise without an alter ego');
    ok(ST.setAlias(g, 'The Fox') === '' && /The Fox/.test(ST.toggleDisguise(g, w)) && ST.disguised(g, w), 'an alter ego and a disguise');
    const f = facts.note(g, '{u} stole a purse.', [], [], 'square', 'event');
    ok(f.u === 'The Fox', 'in disguise, what you do is told about the alter ego');
    g.player.loc = 'tavern'; ST.addRep(g, w, -40, 'crime');
    ok(ST.repIn(g, w, 'aurenfort') === 0 && ST.repIn(g, w, 'aurenfort', true) === -40, 'the alter ego has its own reputation');
    ok(P.sceneText().includes('disguise as "The Fox"'), 'the AI knows about the disguise');
    const out = ST.raiseSuspicion(g, w, 100, []);
    ok(out.some(m => /Unmasked/.test(m)) && !ST.disguised(g, w) && ST.repIn(g, w, 'aurenfort') === -20, 'suspicion at 100: unmasked, and half the infamy is yours');
    ok(/knows that name/.test(ST.setAlias(g, 'The Fox')), 'a burned name cannot be used again');
    // people who know you well raise suspicion
    const g2 = fresh(); ST.setAlias(g2, 'Raven'); g2.player.loc = 'home:player'; ST.toggleDisguise(g2, w); g2.player.loc = 'tavern';
    const friend = Object.values(g2.cast)[0]; friend.met = true; S.social(g2).bond[friend.avatar] = 60; friend.routine = { weekday: [[0, 'tavern']], weekend: [[0, 'tavern']] };
    ST.suspicionTick(g2, w);
    ok(ST.identityOf(g2).suspicion > 0, 'a close friend nearby makes you suspicious');
}
// pets and familiars
{
    const g = fresh(true); g.player.money = 500; g.player.loc = 'square';
    const sold = PT.petsAvailable(w).filter(p => PT.soldHere(g, w, p)).map(p => p.id);
    ok(sold.includes('dog') && sold.includes('cat') && !sold.includes('owl'), `the market sells hounds and cats (${sold})`);
    ok(/yours/.test(PT.buyPet(g, w, 'dog', 'Rex')) && PT.petsOf(g)[0].name === 'Rex', 'buying and naming a pet');
    ok(P.sceneText().includes('Rex'), 'a hound follows you (the AI knows)');
    g.player.loc = 'arcanum';
    ok(PT.soldHere(g, w, PT.petDef(w, 'owl')) && /yours/.test(PT.buyPet(g, w, 'owl', 'Hoot')), 'an owl familiar at the school of magic');
    const before = R.rollCheck(g, w, 'arcana', 10, 0, () => 0.5).bonus;
    PT.petsOf(g)[1].hunger = 0;
    const after = R.rollCheck(g, w, 'arcana', 10, 0, () => 0.5).bonus;
    ok(before - after === 2, `a happy familiar helps its skill (+2), a hungry one does not (${before} vs ${after})`);
    ok(/You play/.test(PT.playWithPet(g, w, PT.petsOf(g)[0].id)) && /eats/.test(PT.feedPet(g, w, PT.petsOf(g)[0].id)), 'feeding and playing');
    for (let i = 0; i < 6; i++) day(g);
    ok(PT.petsOf(g).length < 2, 'neglected, they run away');
}
// apprentices
{
    const g = fresh(true);
    const r = Object.values(g.cast).find(x => !(g.family?.kids ?? []).some(k => k.avatar === x.avatar)); r.met = true;
    S.social(g).bond[r.avatar] = 30;
    ok(/trust/.test(MT.canMentor(g, w, r.avatar)), 'only someone who trusts you');
    S.social(g).bond[r.avatar] = 60; g.player.money = 500;
    const area = MT.teachable(g, w)[0][0];
    ok(/apprentice/.test(MT.takeApprentice(g, w, r.avatar, area)), 'taking an apprentice');
    ok(/with you/.test(MT.lesson(g, w, r.avatar, false).text), 'lessons only with them here');
    let n = 0; while (!MT.graduated(g, r.avatar) && n++ < 20) { MT.lesson(g, w, r.avatar, true); g.day++; }
    ok(MT.graduated(g, r.avatar) && n < 15, `they finish (${n} lessons): mentor and apprentice for life`);
    const C = await D('sim/combat.js'); const PA = await D('sim/party.js');
    PA.join(g, w, r.avatar); const c = C.startCombat(g, w, { why: 'x', foes: ['wolf'] });
    ok(c.list.find(f => f.ref === r.avatar).level === g.rpg.level + 1, 'a former apprentice fights a level higher');
    delete g.combat;
}
// letters
{
    const g = fresh(); g.player.money = 200;
    const r = Object.values(g.cast)[1]; r.met = true; S.social(g).bond[r.avatar] = 50; r.home = { zone: 'hr_long', x: 20, y: 30 }; delete r.homeWith;
    ok(LT.farAway(g, w, r.avatar) && LT.distantFriends(g, w).some(x => x.avatar === r.avatar), 'a friend living in Hrafnborg is far away');
    let got = false; for (let i = 0; i < 30 && !got; i++) { time.advance(g, w, 1440); got = LT.postOf(g).queue.some(l => l.avatar === r.avatar); }
    ok(got, 'friends far away write now and then');
    globalThis.__ctx.generateRaw = async () => 'Dear friend, things are hard in the north. Could you help me?';
    LT.postOf(g).queue = [{ avatar: r.avatar, kind: 'help', ask: 20, day: g.day }];
    ok(await LT.deliverLetter(g, w) === r.name && S.social(g).threads[r.avatar].at(-1).text.includes('north'), 'the AI writes the letter in their voice');
    const b = S.bondOf(g, r.avatar);
    ok(/sent 20/.test(LT.sendHelp(g, w, r.avatar)) && S.bondOf(g, r.avatar) > b && g.player.money === 180, 'sending help warms the friendship');
    S.social(g).bond[r.avatar] = 60; LT.postOf(g).contact[r.avatar] = g.day; (S.social(g).threads[r.avatar] ?? []).length = 0;
    for (let i = 0; i < 24; i++) time.advance(g, w, 1440);
    ok(S.bondOf(g, r.avatar) < 60, 'without a word for weeks, distance cools it');
}
// festivals
{
    const g = fresh(); g.player.loc = 'square';
    const f = w.festivals.find(x => x.id === 'harvest');
    const sd = time.seasonDays(g); g.day = 2 * sd + f.day; g.minutes = 15 * 60;   // autumn
    ok(FS.festivalOn(g, w)?.id === 'harvest', 'the Harvest Festival comes on its day');
    ok(Math.abs(WS.priceHere(g, w) / (WS.priceHere(g, w) / 0.9) - 0.9) < 1e-9, 'prices change during it');
    // someone who lives in the festival's town (a festival belongs to its town)
    const town = w.places.find(p => p.id === 'square').map;
    const r0 = Object.values(g.cast).find(x => (x.routine?.weekday ?? []).some(s => s[1] === 'leisure'));
    const r = r0 && { ...r0, homeWith: undefined, home: { ...r0.home, zone: w.homes.zones.find(z => z.map === town).id } };
    if (r) ok(people.routineAt(g, w, { ...r, routine: { weekday: [[0, 'leisure']], weekend: [[0, 'leisure']] } }, g.day * 1440 + 15 * 60) === 'square', 'free time is spent at the festival');
    ok(P.sceneText().includes('Harvest Festival'), 'the AI knows it is a festival day');
    ok(UI.lifeActs(g, w).includes('Celebrate'), 'a Celebrate button at the festival');
    const mood = g.player.stats.mood; ok(/join/.test(FS.celebrate(g, w, () => { })) && g.player.stats.mood > mood && !FS.canCelebrate(g, w), 'celebrating, once a day');
    ok(FS.upcoming(g, w).length >= 1, 'the calendar lists festivals');
}
// screens
{
    const g = fresh(true); g.player.loc = 'square';
    ok(UI.standingApp(g, w, '').includes('Habits') && UI.standingApp(g, w, '').includes('Mask'), 'the Reputation app');
    ok(UI.petsApp(g, w, '').includes('For sale here'), 'the Animals app');
    ok(W.appsShown(w).some(a => a.id === 'standing') && W.appsShown(w).some(a => a.id === 'pets'), 'both apps are on the phone');
    const off = structuredClone(w); off.features = { ...(off.features ?? {}), pets: false, reputation: false };
    ok(!W.appsShown(off).some(a => a.id === 'pets') && !W.appsShown(off).some(a => a.id === 'standing'), 'turned off, they are gone');
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
