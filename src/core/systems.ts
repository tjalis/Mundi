// RPG systems: the kind of RPG a game is played with. A world brings its own (its RPG tab); these can be chosen
// instead when starting a game (and in the world creator, as a start). They keep the usual skill ids (stealth,
// persuasion, medicine…) so the world's actions, jobs, quests and schools still work with any of them, under the
// system's own names and attributes.
import { MEDIEVAL_RPG, MODERN_RPG, POWERS_RPG, type RpgDef, type RpgSkill, type RpgWeapon, type RpgClass, type RpgSpell, type Foe, type RpgTitle } from './rpgdef.js';

export interface RpgSystem { id: string; name: string; desc: string; /** fits a realistic world (no magic) */ realistic?: boolean; def: RpgDef }

const A = (id: string, name: string, short: string, desc: string) => ({ id, name, short, desc });
const S = (id: string, name: string, attr: string): RpgSkill => ({ id, name, attr });
const W = (id: string, name: string, dice: number, sides: number, attr: string, skill: string, ranged = false): RpgWeapon => ({ id, name, dice, sides, attr, skill, ...(ranged ? { ranged } : {}) });
const SP = (id: string, name: string, school: string, level: number, cost: number, desc: string, effect: RpgSpell['effect'], extra: Partial<RpgSpell> = {}): RpgSpell => ({ id, name, school, level, cost, desc, effect, ...extra });
const hit = (id: string, name: string, school: string, level: number, cost: number, desc: string, element?: RpgSpell['element']) => SP(id, name, school, level, cost, desc, { kind: 'scene' }, { combat: 'damage', ...(element ? { element } : {}) });
const guard = (id: string, name: string, school: string, level: number, cost: number, desc: string) => SP(id, name, school, level, cost, desc, { kind: 'scene' }, { combat: 'shield' });
const F = (id: string, icon: string, name: string, level: number, hp: number, ac: number, atk: number, dice: number, sides: number, bonus: number, tags: string[], desc: string, extra: Partial<Foe> = {}): Foe =>
    ({ id, icon, name, level, hp, ac, atk, dice, sides, bonus, row: extra.ranged ? 'back' : 'front', tags, desc, ...extra });
const T = (id: string, name: string, desc: string, when: RpgTitle['when']): RpgTitle => ({ id, name, desc, when });
const XP = [100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500, 5500, 6600];

/* ---------- Nen hunter (Hunter x Hunter style) ---------- */

const NEN_SKILLS: RpgSkill[] = [
    S('athletics', 'Athletics', 'str'), S('acrobatics', 'Acrobatics', 'agi'), S('stealth', 'Stealth', 'agi'), S('sleight', 'Sleight of hand', 'agi'),
    S('investigation', 'Investigation', 'int'), S('history', 'Hunter lore', 'int'), S('arcana', 'Nen theory', 'int'), S('nature', 'Wilderness lore', 'int'), S('tech', 'Technology', 'int'),
    S('insight', 'Read people', 'int'), S('perception', 'Perception', 'int'), S('medicine', 'First aid', 'int'), S('survival', 'Survival', 'vit'),
    S('persuasion', 'Persuasion', 'aura'), S('deception', 'Deception', 'aura'), S('intimidation', 'Intimidation', 'aura'), S('performance', 'Performance', 'aura'), S('animals', 'Beast taming', 'aura'),
    S('religion', 'Customs and myths', 'int'), S('unarmed', 'Hand-to-hand', 'str'), S('blades', 'Blades', 'agi'), S('thrown', 'Throwing', 'agi'), S('firearms', 'Firearms', 'agi'),
    S('cooking', 'Gourmet cooking', 'int'), S('gambling', 'Gambling', 'int'), S('tracking', 'Tracking', 'int'), S('endurance', 'Endurance', 'vit'),
];
const NEN_CLASS = (id: string, name: string, desc: string, key: string, hp: number, skills: string[], school: string, weapon: RpgClass['weapon'], ability: RpgClass['ability'], subs: RpgClass['subclasses'], armor = 2): RpgClass =>
    ({ id, name, desc, hit: hp, key, skills, schools: ['basics', school], armor, weapon, ability, subAt: 3, subclasses: subs });
export const NEN_RPG: RpgDef = {
    name: 'Nen hunter',
    attributes: [A('str', 'Strength', 'STR', 'Raw power: lifting, hitting.'), A('agi', 'Agility', 'AGI', 'Speed, reflexes, a light step.'), A('vit', 'Vitality', 'VIT', 'Toughness and stamina: more hit points.'),
        A('int', 'Intellect', 'INT', 'Wits, memory and reading a fight.'), A('aura', 'Aura', 'AURA', 'The size of your Nen, and the weight of your presence.')],
    hpAttr: 'vit', roles: { defense: 'agi', initiative: 'agi', melee: 'str' },
    pointBuy: { points: 22, min: 8, max: 15 },
    skills: NEN_SKILLS,
    weapons: [W('fists', 'fists', 1, 4, 'str', 'unarmed'), W('knife', 'knife', 1, 4, 'agi', 'blades'), W('sword', 'sword', 1, 8, 'str', 'blades'), W('yoyo', 'weighted yo-yos', 1, 6, 'agi', 'thrown', true),
        W('cards', 'throwing cards', 1, 4, 'agi', 'thrown', true), W('pistol', 'pistol', 1, 8, 'agi', 'firearms', true), W('rod', 'fishing rod', 1, 6, 'agi', 'thrown')],
    classes: [
        NEN_CLASS('enhancer', 'Enhancer', 'Simple and strong: your Nen makes your body and fists stronger.', 'str', 12, ['athletics', 'intimidation', 'survival', 'endurance', 'perception'], 'enhancement',
            { name: 'enhanced fists', dice: 1, sides: 10, attr: 'str', skill: 'unarmed' }, { name: 'Rock, paper, scissors', kind: 'rage', amount: 3, desc: 'All your aura in one fist.' },
            [{ id: 'brawler', name: 'Brawler', desc: 'Every blow lands harder.', skill: 'athletics' }, { id: 'mender', name: 'Mender', desc: 'Your aura closes wounds.', skill: 'medicine' }], 3),
        NEN_CLASS('transmuter', 'Transmuter', 'Your aura takes the qualities of something else: elastic, electric, sharp.', 'agi', 10, ['acrobatics', 'deception', 'stealth', 'sleight', 'insight'], 'transmutation',
            { name: 'transmuted aura', dice: 1, sides: 8, attr: 'agi', element: 'lightning' }, { name: 'Elastic grip', kind: 'mark', desc: 'Stick to a foe: everyone hits it more easily.' },
            [{ id: 'trickster', name: 'Trickster', desc: 'Whimsical, unpredictable.', skill: 'deception' }, { id: 'stormhand', name: 'Stormhand', desc: 'Your aura crackles.', skill: 'acrobatics' }]),
        NEN_CLASS('emitter', 'Emitter', 'Your aura leaves your body and keeps its strength: blasts and bullets of Nen.', 'aura', 8, ['perception', 'intimidation', 'athletics', 'survival'], 'emission',
            { name: 'aura blast', dice: 1, sides: 10, attr: 'aura', ranged: true }, { name: 'Steady aim', kind: 'mark', desc: 'A foe in your sights.' },
            [{ id: 'gunner', name: 'Aura gunner', desc: 'Rapid shots of Nen.', skill: 'perception' }, { id: 'warper', name: 'Warper', desc: 'Your aura carries you, too.', skill: 'stealth' }]),
        NEN_CLASS('conjurer', 'Conjurer', 'You give your aura a shape: chains, tools, weapons only you can hold.', 'int', 8, ['investigation', 'insight', 'stealth', 'arcana', 'tracking'], 'conjuration',
            { name: 'conjured weapon', dice: 1, sides: 8, attr: 'int' }, { name: 'Conjured shield', kind: 'shield', amount: 4, desc: 'A wall of solid aura.' },
            [{ id: 'chainer', name: 'Chain user', desc: 'Binding, judging, seeking.', skill: 'investigation' }, { id: 'tool', name: 'Toolmaker', desc: 'The right tool for every job.', skill: 'tech' }]),
        NEN_CLASS('manipulator', 'Manipulator', 'You control living things and objects through your aura.', 'int', 8, ['persuasion', 'deception', 'insight', 'investigation', 'tech'], 'manipulation',
            { name: 'aura needles', dice: 1, sides: 6, attr: 'int', ranged: true }, { name: 'Puppet string', kind: 'mark', desc: 'The foe moves the way you want.' },
            [{ id: 'puppeteer', name: 'Puppeteer', desc: 'People, then crowds.', skill: 'persuasion' }, { id: 'remote', name: 'Remote operator', desc: 'Objects and machines obey.', skill: 'tech' }]),
        NEN_CLASS('specialist', 'Specialist', 'A Nen nobody else has: rare, strange and often terrifying.', 'aura', 8, ['insight', 'arcana', 'performance', 'deception', 'perception'], 'specialization',
            { name: 'unique aura', dice: 1, sides: 8, attr: 'aura' }, { name: 'Glimpse of fate', kind: 'inspire', desc: 'You saw this coming: allies hit harder.' },
            [{ id: 'seer', name: 'Seer', desc: 'Prophecies that come true.', skill: 'insight' }, { id: 'thief', name: 'Ability thief', desc: 'What is theirs becomes yours.', skill: 'sleight' }]),
    ],
    xp: XP, focusName: 'Aura',
    schools: [{ id: 'basics', name: 'Nen basics', desc: 'Ten, Zetsu, Ren, Gyo and the rest: what every user learns.' }, { id: 'enhancement', name: 'Enhancement', desc: 'Make what you are stronger.' },
        { id: 'transmutation', name: 'Transmutation', desc: 'Change what your aura is like.' }, { id: 'emission', name: 'Emission', desc: 'Send your aura away from you.' },
        { id: 'conjuration', name: 'Conjuration', desc: 'Give your aura a shape.' }, { id: 'manipulation', name: 'Manipulation', desc: 'Control things through your aura.' },
        { id: 'specialization', name: 'Specialization', desc: 'Your own, unlike any other.' }],
    spells: [
        guard('ten', 'Ten', 'basics', 1, 1, 'Your aura wraps you like armor.'), SP('zetsu', 'Zetsu', 'basics', 1, 1, 'Close your aura: you vanish from senses.', { kind: 'advantage', skills: ['stealth'] }),
        hit('ren', 'Ren', 'basics', 1, 1, 'Your aura flares: a stronger blow.'), SP('gyo', 'Gyo', 'basics', 2, 2, 'Aura in your eyes: you see what is hidden.', { kind: 'advantage', skills: ['perception', 'investigation'] }),
        SP('en', 'En', 'basics', 3, 3, 'Your aura spreads out: you feel everything around you.', { kind: 'advantage', skills: ['perception', 'insight', 'survival'] }),
        guard('ryu', 'Ryu', 'basics', 3, 2, 'Aura flows where the blow will land.'), hit('ko', 'Ko', 'basics', 4, 4, 'Every drop of aura in one point: devastating.'),
        hit('jajanken', 'Rock', 'enhancement', 1, 2, 'A fist charged with aura.'), SP('mend', 'Aura mending', 'enhancement', 2, 2, 'Your aura speeds healing.', { kind: 'heal', amount: 30 }),
        hit('spark', 'Electric aura', 'transmutation', 1, 2, 'Your aura turns to lightning.', 'lightning'), SP('elastic', 'Elastic aura', 'transmutation', 2, 2, 'Rubber and gum: you stick, pull and bounce.', { kind: 'advantage', skills: ['acrobatics', 'sleight'] }),
        hit('aura_shot', 'Aura bullet', 'emission', 1, 2, 'A bullet of Nen from your fingertip.'), hit('aura_cannon', 'Aura cannon', 'emission', 3, 4, 'A blast that tears through walls.'),
        guard('chain', 'Binding chain', 'conjuration', 1, 2, 'A conjured chain holds the foe back.'), SP('dowsing', 'Dowsing chain', 'conjuration', 2, 2, 'The chain swings toward the truth.', { kind: 'advantage', skills: ['insight', 'investigation'] }),
        SP('needle', 'Puppet needle', 'manipulation', 1, 2, 'A needle of aura: the target obeys a little.', { kind: 'advantage', skills: ['persuasion', 'intimidation'] }), hit('swarm', 'Controlled swarm', 'manipulation', 2, 3, 'Things you control strike for you.'),
        SP('fortune', 'Fortune poem', 'specialization', 1, 2, 'A verse about what is coming.', { kind: 'rumor' }), SP('steal', 'Borrowed power', 'specialization', 2, 3, 'For one moment you have their gift: +3 to your next check.', { kind: 'bonus', amount: 3 }),
    ],
    titles: [T('rookie', 'the Rookie Hunter', 'Reach level 3.', { level: 3 }), T('one_star', 'the One-star Hunter', 'Reach level 6.', { level: 6 }), T('two_star', 'the Two-star Hunter', 'Earn 100 renown.', { renown: 100 }),
        T('three_star', 'the Three-star Hunter', 'Earn 200 renown.', { renown: 200 }), T('blacklist', 'the Blacklist Hunter', 'Win 25 fights.', { count: 'fights', n: 25 }), T('nen_master', 'the Nen Master', 'Use Nen 30 times.', { count: 'casts', n: 30 })],
    campEvery: 8,
    bestiary: [
        F('thug', '👊', 'Street thug', 1, 12, 11, 3, 1, 6, 2, ['town', 'road'], 'Muscle for hire.'), F('beast', '🐗', 'Magical beast', 1, 14, 12, 4, 1, 8, 2, ['wild', 'road'], 'A creature of the unexplored zones.'),
        F('mafia', '🔫', 'Mafia gunman', 2, 14, 13, 4, 1, 8, 2, ['town'], 'A suit and a sidearm.', { ranged: true }), F('rogue_nen', '🌀', 'Rogue Nen user', 3, 26, 14, 5, 1, 10, 3, ['town', 'road', 'tower'], 'A user who kills for money.'),
        F('ant', '🐜', 'Chimera soldier', 4, 38, 15, 6, 2, 6, 3, ['wild', 'tower'], 'Half beast, half nightmare.'), F('troupe', '🕷️', 'Spider of the troupe', 6, 70, 16, 8, 2, 8, 4, ['tower', 'boss'], 'A thief with a cross on their back.', { inflict: { kind: 'curse', chance: 0.25, turns: 3 } }),
    ],
    mercNames: ['Kaito', 'Rina', 'Zeke', 'Mira', 'Taro', 'Lio', 'Senna', 'Dax'], mercWage: 40,
};

/* ---------- Solo dungeon (Solo Leveling style) ---------- */

const SOLO_SKILLS: RpgSkill[] = [
    S('athletics', 'Athletics', 'str'), S('acrobatics', 'Acrobatics', 'agi'), S('stealth', 'Stealth', 'agi'), S('sleight', 'Sleight of hand', 'agi'),
    S('investigation', 'Investigation', 'int'), S('history', 'Gate lore', 'int'), S('arcana', 'Mana theory', 'int'), S('nature', 'Monster lore', 'int'), S('tech', 'Technology', 'int'),
    S('insight', 'Insight', 'sen'), S('perception', 'Perception', 'sen'), S('medicine', 'First aid', 'int'), S('survival', 'Dungeon survival', 'vit'),
    S('persuasion', 'Persuasion', 'sen'), S('deception', 'Deception', 'agi'), S('intimidation', 'Intimidation', 'str'), S('performance', 'Performance', 'sen'), S('animals', 'Taming', 'sen'),
    S('religion', 'Guild politics', 'int'), S('blades', 'Daggers and swords', 'agi'), S('blunt', 'Maces and hammers', 'str'), S('bows', 'Bows', 'agi'), S('polearms', 'Spears', 'str'),
    S('unarmed', 'Hand-to-hand', 'str'), S('shields', 'Shields', 'vit'), S('appraisal', 'Appraisal', 'int'), S('endurance', 'Endurance', 'vit'),
];
export const SOLO_RPG: RpgDef = {
    name: 'Solo dungeon',
    attributes: [A('str', 'Strength', 'STR', 'Physical power and damage.'), A('agi', 'Agility', 'AGI', 'Speed, dodging and precision.'), A('vit', 'Vitality', 'VIT', 'Health and stamina: more hit points.'),
        A('int', 'Intelligence', 'INT', 'Mana and the power of spells.'), A('sen', 'Sense', 'SEN', 'Perception: danger, presence, the hidden.')],
    hpAttr: 'vit', roles: { defense: 'agi', initiative: 'sen', melee: 'str' },
    pointBuy: { points: 10, min: 10, max: 20, flat: true }, levelPoints: 3, attrCap: 30,
    skills: SOLO_SKILLS,
    weapons: [W('dagger', 'dagger', 1, 6, 'agi', 'blades'), W('twin', 'twin daggers', 2, 4, 'agi', 'blades'), W('sword', 'longsword', 1, 8, 'str', 'blades'), W('greatsword', 'greatsword', 2, 6, 'str', 'blades'),
        W('mace', 'mace', 1, 6, 'str', 'blunt'), W('hammer', 'war hammer', 1, 10, 'str', 'blunt'), W('spear', 'spear', 1, 8, 'str', 'polearms'), W('bow', 'longbow', 1, 8, 'agi', 'bows', true),
        W('fists', 'gauntlets', 1, 6, 'str', 'unarmed'), W('staff', 'mage staff', 1, 6, 'int', 'blunt')],
    classes: [
        { id: 'fighter', name: 'Fighter', desc: 'Front line: big swings and thick skin.', hit: 12, key: 'str', skills: ['athletics', 'intimidation', 'survival', 'endurance', 'blades'], armor: 5, weapon: { name: 'longsword', dice: 1, sides: 8, attr: 'str', skill: 'blades' }, ability: { name: 'Bloodlust', kind: 'rage', amount: 3, desc: 'Fury: more damage, less guard.' }, subAt: 5,
            subclasses: [{ id: 'berserker', name: 'Berserker', desc: 'Stronger the more you bleed.', skill: 'athletics' }, { id: 'knight', name: 'Knight', desc: 'Steel and discipline.', skill: 'shields' }] },
        { id: 'assassin', name: 'Assassin', desc: 'Strike from the shadows, gone before they turn.', hit: 10, key: 'agi', skills: ['stealth', 'acrobatics', 'sleight', 'perception', 'deception'], armor: 2, weapon: { name: 'twin daggers', dice: 2, sides: 4, attr: 'agi', skill: 'blades' }, ability: { name: 'Stealth', kind: 'hide', desc: 'Vanish: your next strike lands harder.' }, subAt: 5, schools: ['shadow'],
            subclasses: [{ id: 'shadow', name: 'Shadow', desc: 'Silent and unseen.', skill: 'stealth' }, { id: 'dancer', name: 'Blade dancer', desc: 'A whirl of steel.', skill: 'acrobatics' }] },
        { id: 'mage', name: 'Mage', desc: 'Fire, ice and lightning from the back row.', hit: 6, key: 'int', skills: ['arcana', 'history', 'investigation', 'nature', 'appraisal'], armor: 0, weapon: { name: 'mana bolt', dice: 1, sides: 10, attr: 'int', ranged: true }, subAt: 5, schools: ['elemental'],
            subclasses: [{ id: 'pyro', name: 'Fire mage', desc: 'Everything burns.', skill: 'intimidation' }, { id: 'frost', name: 'Ice mage', desc: 'Cold and precise.', skill: 'perception' }] },
        { id: 'tank', name: 'Tank', desc: 'The wall the raid hides behind.', hit: 14, key: 'vit', skills: ['athletics', 'intimidation', 'endurance', 'shields', 'survival'], armor: 7, weapon: { name: 'shield bash', dice: 1, sides: 6, attr: 'str', skill: 'shields' }, ability: { name: 'Taunt', kind: 'guard', amount: 4, desc: 'Draw every blow to you.' }, subAt: 5,
            subclasses: [{ id: 'guardian', name: 'Guardian', desc: 'Nobody behind you falls.', skill: 'shields' }, { id: 'juggernaut', name: 'Juggernaut', desc: 'Unstoppable.', skill: 'athletics' }] },
        { id: 'healer', name: 'Healer', desc: 'Keeps the raid alive. Not helpless with a mace.', hit: 8, key: 'sen', skills: ['medicine', 'insight', 'persuasion', 'perception', 'religion'], armor: 3, weapon: { name: 'mace', dice: 1, sides: 6, attr: 'str', skill: 'blunt' }, ability: { name: 'Blessing', kind: 'heal', amount: 30, desc: 'Heal yourself.' }, subAt: 5, schools: ['holy'],
            subclasses: [{ id: 'priest', name: 'Priest', desc: 'Healing comes easily.', skill: 'medicine' }, { id: 'buffer', name: 'Buffer', desc: 'Allies grow stronger.', skill: 'persuasion' }] },
        { id: 'ranger', name: 'Ranger', desc: 'Bow, traps and eyes that miss nothing.', hit: 10, key: 'agi', skills: ['perception', 'survival', 'stealth', 'nature', 'bows'], armor: 3, weapon: { name: 'longbow', dice: 1, sides: 8, attr: 'agi', ranged: true, skill: 'bows' }, ability: { name: 'Hunter\'s mark', kind: 'mark', desc: 'Everyone hits the marked foe more easily.' }, subAt: 5,
            subclasses: [{ id: 'sniper', name: 'Sniper', desc: 'One arrow, one kill.', skill: 'perception' }, { id: 'trapper', name: 'Trapper', desc: 'The ground itself fights for you.', skill: 'survival' }] },
        { id: 'necro', name: 'Necromancer', desc: 'A rare class: the fallen rise again as your shadows.', hit: 8, key: 'int', skills: ['arcana', 'intimidation', 'insight', 'stealth', 'history'], armor: 2, weapon: { name: 'shadow dagger', dice: 1, sides: 6, attr: 'agi', skill: 'blades', element: 'dark' }, subAt: 5, schools: ['shadow', 'necromancy'],
            subclasses: [{ id: 'monarch', name: 'Shadow monarch', desc: 'An army of shadows bows to you.', skill: 'intimidation' }, { id: 'reaper', name: 'Reaper', desc: 'Death walks beside you.', skill: 'stealth' }] },
    ],
    xp: XP, focusName: 'Mana',
    schools: [{ id: 'shadow', name: 'Shadow arts', desc: 'Darkness, speed and silence.' }, { id: 'elemental', name: 'Elemental magic', desc: 'Fire, ice and lightning.' },
        { id: 'holy', name: 'Holy magic', desc: 'Healing, purifying, protecting.' }, { id: 'necromancy', name: 'Necromancy', desc: 'Raise and command the dead.' }],
    spells: [
        SP('dash', 'Dash', 'shadow', 1, 1, 'A burst of speed.', { kind: 'advantage', skills: ['acrobatics', 'athletics'] }), hit('mutilate', 'Mutilation', 'shadow', 1, 2, 'A flurry of cuts.', 'dark'),
        SP('vanish', 'Stealth', 'shadow', 2, 2, 'You fade from sight.', { kind: 'advantage', skills: ['stealth'] }),
        hit('fireball', 'Fireball', 'elemental', 1, 2, 'A ball of flame.', 'fire'), hit('ice_spear', 'Ice spear', 'elemental', 1, 2, 'A lance of ice.', 'ice'), hit('chain_lightning', 'Chain lightning', 'elemental', 3, 4, 'Lightning leaps from foe to foe.', 'lightning'),
        SP('heal', 'Heal', 'holy', 1, 1, 'Light closes wounds.', { kind: 'heal', amount: 30 }), SP('purify', 'Purify', 'holy', 2, 2, 'Poison and curses wash away.', { kind: 'cleanse' }), guard('barrier', 'Barrier', 'holy', 1, 2, 'A dome of light.'),
        SP('greater_heal', 'Greater heal', 'holy', 3, 4, 'The whole body made whole.', { kind: 'heal', amount: 75 }),
        hit('arise', 'Arise', 'necromancy', 1, 2, 'A fallen foe rises and fights for you.', 'dark'), SP('exchange', 'Shadow exchange', 'necromancy', 2, 3, 'You step from one shadow into another.', { kind: 'scene' }),
        SP('monarch_aura', 'Ruler\'s authority', 'necromancy', 3, 3, 'An invisible hand that grabs and crushes: +3 to your next check.', { kind: 'bonus', amount: 3 }),
    ],
    titles: [T('d_rank', 'the D-rank Hunter', 'Reach level 3.', { level: 3 }), T('c_rank', 'the C-rank Hunter', 'Reach level 5.', { level: 5 }), T('b_rank', 'the B-rank Hunter', 'Reach level 7.', { level: 7 }),
        T('a_rank', 'the A-rank Hunter', 'Reach level 9.', { level: 9 }), T('s_rank', 'the S-rank Hunter', 'Reach level 11.', { level: 11 }), T('raider', 'the Raid Leader', 'Win 30 fights.', { count: 'fights', n: 30 }),
        T('gatebreaker', 'the Gatebreaker', 'Earn 150 renown.', { renown: 150 })],
    campEvery: 8,
    bestiary: [
        F('goblin', '👺', 'Goblin', 1, 9, 12, 3, 1, 6, 1, ['wild', 'road', 'tower'], 'Small, fast, in packs.'), F('lycan', '🐺', 'Steel-fanged lycan', 1, 13, 12, 4, 2, 4, 2, ['wild', 'tower'], 'A wolf with teeth like knives.'),
        F('hob_mage', '🧙', 'Hobgoblin shaman', 2, 12, 12, 4, 1, 8, 2, ['tower'], 'Spits fire from the back.', { ranged: true, element: 'fire' }), F('spider', '🕷️', 'Giant spider', 2, 18, 13, 4, 1, 8, 2, ['tower', 'wild'], 'Webs and venom.', { inflict: { kind: 'poison', chance: 0.3, turns: 3 } }),
        F('orc', '👹', 'High orc', 3, 30, 14, 5, 1, 12, 3, ['tower'], 'A warrior bred for war.'), F('ice_elf', '🧝', 'Ice elf archer', 4, 26, 15, 6, 1, 10, 3, ['tower'], 'Arrows of frost.', { ranged: true, element: 'ice' }),
        F('golem', '🗿', 'Stone golem', 5, 60, 17, 6, 2, 8, 4, ['tower', 'boss'], 'The gate\'s guardian.'), F('knight', '⚔️', 'Dungeon knight commander', 7, 90, 17, 8, 2, 10, 4, ['tower', 'boss'], 'A dead knight who still guards.', { element: 'dark' }),
    ],
    mercNames: ['Jin', 'Hae', 'Min', 'Soo', 'Yoon', 'Dae', 'Ara', 'Kang', 'Ji-ho', 'Eun'], mercWage: 50,
};

/* ---------- Space saga (Star Wars style) ---------- */

const SPACE_SKILLS: RpgSkill[] = [
    S('athletics', 'Athletics', 'str'), S('acrobatics', 'Acrobatics', 'agi'), S('stealth', 'Stealth', 'agi'), S('sleight', 'Sleight of hand', 'agi'),
    S('investigation', 'Investigation', 'int'), S('history', 'Galactic lore', 'int'), S('arcana', 'Force lore', 'wil'), S('nature', 'Xenobiology', 'int'), S('tech', 'Slicing and computers', 'int'),
    S('insight', 'Insight', 'wil'), S('perception', 'Perception', 'wil'), S('medicine', 'Medicine', 'int'), S('survival', 'Survival', 'end'),
    S('persuasion', 'Persuasion', 'cha'), S('deception', 'Deception', 'cha'), S('intimidation', 'Intimidation', 'cha'), S('performance', 'Performance', 'cha'), S('animals', 'Beast handling', 'wil'),
    S('religion', 'Old orders and creeds', 'int'), S('piloting', 'Piloting', 'agi'), S('firearms', 'Blasters', 'agi'), S('blades', 'Energy blades and melee', 'agi'), S('unarmed', 'Hand-to-hand', 'str'),
    S('mechanics', 'Repair and droids', 'int'), S('languages', 'Languages', 'int'), S('gambling', 'Sabacc and gambling', 'cha'), S('streetsmarts', 'Underworld contacts', 'cha'), S('leadership', 'Command', 'cha'),
];
export const SPACE_RPG: RpgDef = {
    name: 'Space saga',
    attributes: [A('str', 'Strength', 'STR', 'Muscle.'), A('agi', 'Agility', 'AGI', 'Reflexes, aim, piloting hands.'), A('end', 'Endurance', 'END', 'Toughness: more hit points.'),
        A('int', 'Intellect', 'INT', 'Tech, science and tactics.'), A('wil', 'Willpower', 'WIL', 'Focus, intuition and the Force.'), A('cha', 'Charisma', 'CHA', 'Presence, charm, lies.')],
    hpAttr: 'end', roles: { defense: 'agi', initiative: 'agi', melee: 'str' },
    skills: SPACE_SKILLS,
    weapons: [W('holdout', 'holdout blaster', 1, 4, 'agi', 'firearms', true), W('blaster', 'blaster pistol', 1, 8, 'agi', 'firearms', true), W('rifle', 'blaster rifle', 1, 10, 'agi', 'firearms', true),
        W('bowcaster', 'heavy crossbow-blaster', 1, 10, 'str', 'firearms', true), W('vibroblade', 'vibroblade', 1, 6, 'agi', 'blades'), W('staff', 'shock staff', 1, 8, 'str', 'blades'),
        W('energy_blade', 'energy blade', 1, 10, 'agi', 'blades'), W('fists', 'fists', 1, 4, 'str', 'unarmed')],
    classes: [
        { id: 'adept', name: 'Force adept', desc: 'Trained in the Force: a blade of light and powers of the mind.', hit: 10, key: 'wil', skills: ['arcana', 'insight', 'perception', 'acrobatics', 'athletics'], schools: ['force'], armor: 2, weapon: { name: 'energy blade', dice: 1, sides: 10, attr: 'agi', skill: 'blades', element: 'light' }, ability: { name: 'Deflect', kind: 'shield', amount: 4, desc: 'Bolts bounce off your blade.' }, subAt: 3,
            subclasses: [{ id: 'guardian', name: 'Guardian', desc: 'The blade first.', skill: 'athletics', school: 'force' }, { id: 'sage', name: 'Sage', desc: 'The mind first.', skill: 'insight', school: 'force' }, { id: 'dark', name: 'Dark acolyte', desc: 'Anger is power.', skill: 'intimidation', school: 'dark' }] },
        { id: 'smuggler', name: 'Smuggler', desc: 'A fast ship, a faster mouth, a blaster at your hip.', hit: 8, key: 'cha', skills: ['deception', 'piloting', 'gambling', 'streetsmarts', 'sleight', 'persuasion'], armor: 2, weapon: { name: 'blaster pistol', dice: 1, sides: 8, attr: 'agi', ranged: true, skill: 'firearms' }, ability: { name: 'Shoot first', kind: 'mark', desc: 'You draw before they blink.' }, subAt: 3,
            subclasses: [{ id: 'scoundrel', name: 'Scoundrel', desc: 'Dirty tricks.', skill: 'deception' }, { id: 'ace', name: 'Ace pilot', desc: 'Nobody flies like you.', skill: 'piloting' }] },
        { id: 'soldier', name: 'Soldier', desc: 'Armor, a rifle and training that kicks in under fire.', hit: 12, key: 'agi', skills: ['athletics', 'intimidation', 'perception', 'survival', 'leadership'], armor: 6, weapon: { name: 'blaster rifle', dice: 1, sides: 10, attr: 'agi', ranged: true, skill: 'firearms' }, ability: { name: 'Stim pack', kind: 'heal', amount: 35, desc: 'Patch yourself up.' }, subAt: 3,
            subclasses: [{ id: 'commando', name: 'Commando', desc: 'Heavy weapons.', skill: 'athletics' }, { id: 'officer', name: 'Officer', desc: 'Lead the squad.', skill: 'leadership' }] },
        { id: 'bounty', name: 'Bounty hunter', desc: 'Every target has a price.', hit: 10, key: 'agi', skills: ['investigation', 'perception', 'intimidation', 'stealth', 'survival'], armor: 4, weapon: { name: 'blaster pistol', dice: 1, sides: 8, attr: 'agi', ranged: true, skill: 'firearms' }, ability: { name: 'Mark the target', kind: 'mark', desc: 'Everyone hits the marked foe more easily.' }, subAt: 3,
            subclasses: [{ id: 'tracker', name: 'Tracker', desc: 'Nobody hides from you.', skill: 'investigation' }, { id: 'enforcer', name: 'Enforcer', desc: 'Fear works.', skill: 'intimidation' }] },
        { id: 'tech', name: 'Technician', desc: 'Droids, ships and computers do what you say.', hit: 8, key: 'int', skills: ['tech', 'mechanics', 'piloting', 'investigation', 'medicine'], armor: 2, weapon: { name: 'ion blaster', dice: 1, sides: 6, attr: 'agi', ranged: true, skill: 'firearms', element: 'lightning' }, ability: { name: 'Shield generator', kind: 'shield', amount: 4, desc: 'A portable energy shield.' }, subAt: 3,
            subclasses: [{ id: 'slicer', name: 'Slicer', desc: 'Every system has a door.', skill: 'tech' }, { id: 'medtech', name: 'Med-tech', desc: 'Bacta and steady hands.', skill: 'medicine' }] },
        { id: 'diplomat', name: 'Diplomat', desc: 'Words end more wars than blasters.', hit: 6, key: 'cha', skills: ['persuasion', 'insight', 'languages', 'history', 'deception', 'performance'], armor: 0, weapon: { name: 'holdout blaster', dice: 1, sides: 4, attr: 'agi', ranged: true, skill: 'firearms' }, ability: { name: 'Rally', kind: 'inspire', desc: 'Allies hit harder.' }, subAt: 3,
            subclasses: [{ id: 'senator', name: 'Senator', desc: 'Power in the halls.', skill: 'persuasion' }, { id: 'spy', name: 'Spy', desc: 'Secrets are currency.', skill: 'deception' }] },
    ],
    xp: XP, focusName: 'The Force',
    schools: [{ id: 'force', name: 'The Force', desc: 'The light side: push, sense, heal, calm.' }, { id: 'dark', name: 'The dark side', desc: 'Anger, fear, lightning.' }],
    spells: [
        hit('push', 'Force push', 'force', 1, 1, 'An invisible wave throws the foe back.'), SP('sense', 'Force sense', 'force', 1, 1, 'You feel what others hide.', { kind: 'advantage', skills: ['insight', 'perception'] }),
        SP('jump', 'Force leap', 'force', 1, 1, 'A leap no one could make.', { kind: 'advantage', skills: ['athletics', 'acrobatics'] }), SP('trick', 'Mind trick', 'force', 2, 2, 'These aren\'t the ones you\'re looking for.', { kind: 'advantage', skills: ['persuasion', 'deception'] }),
        SP('heal', 'Force heal', 'force', 2, 2, 'The Force knits your wounds.', { kind: 'heal', amount: 35 }), guard('barrier', 'Force barrier', 'force', 2, 2, 'Bolts stop in the air.'),
        SP('calm', 'Battle meditation', 'force', 3, 3, 'Your calm spreads to everyone around: +3 to your next check.', { kind: 'bonus', amount: 3 }),
        hit('lightning', 'Force lightning', 'dark', 1, 2, 'Lightning from your fingertips.', 'lightning'), SP('choke', 'Force choke', 'dark', 2, 2, 'A grip around the throat.', { kind: 'advantage', skills: ['intimidation'] }),
        hit('rage', 'Dark rage', 'dark', 3, 3, 'Hate gives you strength.', 'dark'),
    ],
    titles: [T('known', 'the Known Spacer', 'Reach level 3.', { level: 3 }), T('legend', 'the Legend of the Rim', 'Earn 120 renown.', { renown: 120 }), T('ace', 'the Ace', 'Win 20 fights.', { count: 'fights', n: 20 }),
        T('knight', 'the Knight', 'Reach level 8.', { level: 8 }), T('master', 'the Master', 'Use the Force 30 times.', { count: 'casts', n: 30 })],
    campEvery: 8,
    bestiary: [
        F('droid', '🤖', 'Battle droid', 1, 9, 12, 3, 1, 6, 1, ['road', 'town', 'tower'], 'Thin, loud, many.', { ranged: true }), F('pirate', '🏴‍☠️', 'Space pirate', 1, 12, 12, 3, 1, 8, 1, ['road', 'town'], 'A scarred face and a cheap blaster.', { ranged: true }),
        F('trooper', '🪖', 'Empire trooper', 2, 14, 14, 4, 1, 8, 2, ['town', 'road', 'tower'], 'White armor, bad aim, lots of friends.', { ranged: true }), F('beast', '🦖', 'Cave beast', 3, 34, 13, 5, 2, 6, 3, ['wild', 'tower'], 'Teeth the size of daggers.'),
        F('hunter', '🎯', 'Rival bounty hunter', 4, 36, 15, 6, 1, 10, 3, ['town', 'road'], 'After the same prize as you.', { ranged: true }), F('dark_warrior', '🔴', 'Dark warrior', 6, 70, 16, 8, 2, 8, 4, ['tower', 'boss'], 'A red blade in the dark.', { element: 'dark' }),
    ],
    mercNames: ['Vex', 'Orra', 'Kel', 'Dash', 'Nima', 'Tarn', 'Jyn', 'Rook', 'Zara', 'Bo'], mercWage: 45,
};

/* ---------- Cultivation (xianxia) ---------- */

const CULT_SKILLS: RpgSkill[] = [
    S('athletics', 'Athletics', 'bod'), S('acrobatics', 'Lightness skill', 'agi'), S('stealth', 'Stealth', 'agi'), S('sleight', 'Sleight of hand', 'agi'),
    S('investigation', 'Investigation', 'mnd'), S('history', 'Sect history', 'mnd'), S('arcana', 'Dao comprehension', 'spi'), S('nature', 'Spirit herbs and beasts', 'mnd'), S('religion', 'Heavenly law', 'mnd'),
    S('insight', 'Insight', 'mnd'), S('perception', 'Spiritual sense', 'spi'), S('medicine', 'Medicine', 'mnd'), S('survival', 'Survival', 'bod'),
    S('persuasion', 'Persuasion', 'mnd'), S('deception', 'Deception', 'mnd'), S('intimidation', 'Killing intent', 'spi'), S('performance', 'Performance', 'mnd'), S('animals', 'Beast taming', 'spi'),
    S('blades', 'Sword arts', 'agi'), S('unarmed', 'Fist arts', 'bod'), S('polearms', 'Spear arts', 'bod'), S('alchemy', 'Alchemy', 'mnd'), S('formations', 'Formations', 'mnd'),
    S('forging', 'Artifact forging', 'mnd'), S('calligraphy', 'Calligraphy and talismans', 'spi'), S('etiquette', 'Etiquette', 'mnd'),
];
export const CULTIVATION_RPG: RpgDef = {
    name: 'Cultivation',
    attributes: [A('bod', 'Body', 'BOD', 'Muscle, bone and tempered flesh.'), A('agi', 'Agility', 'AGI', 'Speed and footwork.'), A('vit', 'Vitality', 'VIT', 'Life force: more hit points.'),
        A('spi', 'Spirit', 'SPI', 'The depth of your qi.'), A('mnd', 'Mind', 'MND', 'Comprehension, memory and craft.')],
    hpAttr: 'vit', roles: { defense: 'agi', initiative: 'agi', melee: 'bod' },
    pointBuy: { points: 22, min: 8, max: 15 },
    skills: CULT_SKILLS,
    weapons: [W('sword', 'jian', 1, 8, 'agi', 'blades'), W('saber', 'saber', 1, 8, 'bod', 'blades'), W('spear', 'spear', 1, 8, 'bod', 'polearms'), W('fists', 'fists', 1, 6, 'bod', 'unarmed'), W('needles', 'flying needles', 1, 4, 'agi', 'blades', true)],
    classes: [
        { id: 'sword', name: 'Sword cultivator', desc: 'One sword, one path: cut through heaven.', hit: 10, key: 'agi', skills: ['blades', 'acrobatics', 'arcana', 'intimidation', 'perception'], schools: ['sword'], armor: 2, weapon: { name: 'flying sword', dice: 1, sides: 8, attr: 'agi', skill: 'blades' }, ability: { name: 'Sword intent', kind: 'rage', amount: 3, desc: 'Your intent sharpens every cut.' }, subAt: 3,
            subclasses: [{ id: 'swordsaint', name: 'Sword saint', desc: 'The sword is you.', skill: 'blades' }, { id: 'swordwind', name: 'Wind sword', desc: 'Swift and light.', skill: 'acrobatics' }] },
        { id: 'body', name: 'Body cultivator', desc: 'Your flesh becomes stone, then iron, then gold.', hit: 12, key: 'bod', skills: ['athletics', 'unarmed', 'survival', 'intimidation'], schools: ['body'], armor: 5, weapon: { name: 'iron fists', dice: 1, sides: 10, attr: 'bod', skill: 'unarmed' }, ability: { name: 'Golden body', kind: 'guard', amount: 4, desc: 'Blows ring off your skin.' }, subAt: 3,
            subclasses: [{ id: 'vajra', name: 'Vajra body', desc: 'Indestructible.', skill: 'athletics' }, { id: 'beast_body', name: 'Beast bloodline', desc: 'The strength of ancient beasts.', skill: 'animals' }] },
        { id: 'alchemist', name: 'Alchemist', desc: 'Pills that heal, pills that kill, pills that break realms.', hit: 6, key: 'mnd', skills: ['alchemy', 'medicine', 'nature', 'insight', 'persuasion'], schools: ['alchemy'], armor: 0, weapon: { name: 'pill flame', dice: 1, sides: 8, attr: 'mnd', ranged: true, element: 'fire' }, ability: { name: 'Healing pill', kind: 'heal', amount: 40, desc: 'Swallow and recover.' }, subAt: 3,
            subclasses: [{ id: 'pill_sage', name: 'Pill sage', desc: 'The best pills under heaven.', skill: 'alchemy' }, { id: 'poison', name: 'Poison master', desc: 'Every pill has two sides.', skill: 'deception' }] },
        { id: 'formation', name: 'Formation master', desc: 'Arrays and talismans: the battlefield is yours before it starts.', hit: 8, key: 'mnd', skills: ['formations', 'calligraphy', 'investigation', 'history', 'arcana'], schools: ['formation'], armor: 1, weapon: { name: 'talisman', dice: 1, sides: 8, attr: 'spi', ranged: true, element: 'lightning' }, ability: { name: 'Defensive array', kind: 'shield', amount: 4, desc: 'A formation shields you.' }, subAt: 3,
            subclasses: [{ id: 'array_lord', name: 'Array lord', desc: 'Great arrays.', skill: 'formations' }, { id: 'talisman', name: 'Talisman master', desc: 'A talisman for everything.', skill: 'calligraphy' }] },
        { id: 'beast', name: 'Beast tamer', desc: 'Spirit beasts fight at your side.', hit: 8, key: 'spi', skills: ['animals', 'nature', 'survival', 'perception', 'insight'], schools: ['beast'], armor: 2, weapon: { name: 'spirit beast', dice: 1, sides: 8, attr: 'spi' }, ability: { name: 'Beast\'s roar', kind: 'mark', desc: 'Your beast marks the prey.' }, subAt: 3,
            subclasses: [{ id: 'dragon', name: 'Dragon tamer', desc: 'The rarest bond.', skill: 'animals' }, { id: 'swarm', name: 'Swarm master', desc: 'A thousand small beasts.', skill: 'nature' }] },
    ],
    xp: XP, focusName: 'Qi',
    schools: [{ id: 'sword', name: 'Sword arts', desc: 'Sword qi, sword intent, sword domain.' }, { id: 'body', name: 'Body tempering', desc: 'Make the flesh a weapon.' }, { id: 'alchemy', name: 'Alchemy', desc: 'Pills and flames.' },
        { id: 'formation', name: 'Formations', desc: 'Arrays, seals and talismans.' }, { id: 'beast', name: 'Beast taming', desc: 'Bonds with spirit beasts.' }],
    spells: [
        hit('sword_qi', 'Sword qi', 'sword', 1, 1, 'A crescent of qi flies from your blade.'), hit('thousand', 'Ten thousand swords', 'sword', 3, 4, 'Swords of qi fill the sky.'),
        guard('iron_skin', 'Iron skin', 'body', 1, 1, 'Your skin turns hard as iron.'), hit('mountain', 'Mountain-splitting palm', 'body', 2, 3, 'A palm strike that cracks stone.', 'earth'),
        SP('pill', 'Recovery pill', 'alchemy', 1, 1, 'A pill restores your body.', { kind: 'heal', amount: 30 }), SP('detox', 'Detox pill', 'alchemy', 2, 2, 'Poisons and curses fade.', { kind: 'cleanse' }),
        guard('seal', 'Sealing array', 'formation', 1, 2, 'An array blocks the attack.'), SP('illusion', 'Illusion array', 'formation', 2, 2, 'They see what you want them to.', { kind: 'advantage', skills: ['deception', 'stealth'] }),
        hit('beast_claw', 'Beast\'s claw', 'beast', 1, 1, 'Your beast tears into the foe.'), SP('beast_sense', 'Beast senses', 'beast', 1, 1, 'Through your beast\'s eyes and nose.', { kind: 'advantage', skills: ['perception', 'survival'] }),
        SP('breathing', 'Qi circulation', 'body', 1, 1, 'You calm your qi: +2 to your next check.', { kind: 'bonus', amount: 2 }),
    ],
    titles: [T('foundation', 'the Foundation Establishment cultivator', 'Reach level 3.', { level: 3 }), T('core', 'the Core Formation cultivator', 'Reach level 5.', { level: 5 }),
        T('nascent', 'the Nascent Soul cultivator', 'Reach level 7.', { level: 7 }), T('soul', 'the Soul Transformation cultivator', 'Reach level 9.', { level: 9 }), T('immortal', 'the Ascending Immortal', 'Reach level 12.', { level: 12 }),
        T('young_master', 'the Young Master Slayer', 'Win 20 fights.', { count: 'fights', n: 20 })],
    campEvery: 8,
    bestiary: [
        F('bandit', '🗡️', 'Mountain bandit', 1, 11, 12, 3, 1, 6, 1, ['road', 'wild'], 'An outer-sect dropout with a saber.'), F('spirit_wolf', '🐺', 'Spirit wolf', 1, 13, 12, 4, 2, 4, 2, ['wild', 'tower'], 'A wolf that drank qi.'),
        F('disciple', '🥋', 'Arrogant sect disciple', 2, 16, 13, 4, 1, 8, 2, ['town', 'road'], 'He looks down on you. Literally.'), F('python', '🐍', 'Venom python', 3, 30, 13, 5, 1, 10, 3, ['wild', 'tower'], 'Fangs dripping green.', { inflict: { kind: 'poison', chance: 0.3, turns: 3 } }),
        F('demonic', '👿', 'Demonic cultivator', 4, 38, 15, 6, 2, 6, 3, ['tower', 'road'], 'Feeds on blood qi.', { element: 'dark' }), F('elder', '👴', 'Rival sect elder', 6, 75, 16, 8, 2, 8, 4, ['tower', 'boss'], 'A thousand years of grudges.'),
    ],
    mercNames: ['Lin', 'Wei', 'Mei', 'Feng', 'Xiao', 'Yun', 'Bai', 'Long', 'Hua', 'Shen'], mercWage: 30,
};

export const RPG_SYSTEMS: RpgSystem[] = [
    { id: 'classic', name: 'Classic fantasy', desc: 'D&D style: six attributes, fighters, rogues, clerics and wizards, spells by school.', def: { ...MEDIEVAL_RPG, name: 'Classic fantasy' } },
    { id: 'martial', name: 'Martial arts', desc: 'Realistic: fighters, soldiers, hackers, medics and detectives; Ki techniques.', realistic: true, def: { ...MODERN_RPG, name: 'Martial arts' } },
    { id: 'powers', name: 'Superpowers', desc: 'Speedsters, powerhouses, elementals and psychics in a modern city.', def: { ...POWERS_RPG, name: 'Superpowers' } },
    { id: 'nen', name: 'Nen hunter', desc: 'Hunter x Hunter style: STR AGI VIT INT AURA, the six Nen types, hunter stars.', def: NEN_RPG },
    { id: 'solo', name: 'Solo dungeon', desc: 'Solo Leveling style: STR AGI VIT INT SEN, stat points every level, gates and hunter ranks E to S.', def: SOLO_RPG },
    { id: 'space', name: 'Space saga', desc: 'Star Wars style: Force adepts, smugglers, bounty hunters, blasters and ships.', def: SPACE_RPG },
    { id: 'cultivation', name: 'Cultivation', desc: 'Xianxia: BOD AGI VIT SPI MND, sword, body and pill paths, realms from Foundation to Immortal.', def: CULTIVATION_RPG },
];
