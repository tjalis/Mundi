// The RPG of a world, as data (like everything else): attributes, skills, classes and their subclasses, schools of
// magic and spells, and titles. A world in the RPG mode needs this; the medieval preset brings one (Valdoria), and
// the world creator edits it (RPG tab). The engine (sim/rpg.ts and friends) only reads it.

export interface RpgAttribute { id: string; name: string; short: string; desc?: string; /** a faith attribute: hidden while the realm has no gods */ faith?: boolean }
export interface RpgSkill { id: string; name: string; attr: string }
export interface RpgSubclass { id: string; name: string; desc?: string; skill?: string; school?: string }
export interface RpgClass {
    id: string; name: string; desc?: string;
    /** a faith class: called `secular` (and drawing on willpower) while the realm has no gods */
    faith?: boolean; secular?: string;
    /** hit points: `hit` at level 1 (plus the Constitution-like modifier), about half of it each level after */
    hit: number;
    /** the attribute its abilities and spells use */
    key: string;
    /** skills to pick from at the start (2 of them) */
    skills: string[];
    /** a caster learns spells from these schools (none: no spells) */
    schools?: string[];
    /** the level the subclass is chosen at (3 or 5) */
    subAt: number;
    subclasses: RpgSubclass[];
    /** in a fight: armor (added to 10 + the Dexterity-like modifier), the weapon, and the class's own move */
    armor?: number;
    weapon?: Weapon;
    ability?: Ability;
}
// A weapon: `dice` d `sides` + the attribute's modifier; `ranged` hits any row.
/** `skill`: the weapon skill it needs to add your proficiency (none: anyone who carries it is trained) */
export interface Weapon { name: string; dice: number; sides: number; attr: string; ranged?: boolean; element?: Element; skill?: string }
/** a weapon you can choose when making a character */
export interface RpgWeapon extends Weapon { id: string }
// A class's move in a fight, once per fight: heal yourself or an ally, guard the back row, inspire, hide, mark a foe, a shield.
export interface Ability { name: string; kind: 'heal' | 'guard' | 'inspire' | 'hide' | 'mark' | 'shield' | 'rage'; amount?: number; desc?: string }
// Someone (or something) to fight: hit points, armor, attack bonus and damage, a level (for experience), the row it
// keeps (beasts and bandits up front, archers and casters behind) and where it is met.
export type TalentKind = 'hp' | 'focus' | 'skill' | 'attack' | 'armor' | 'damage' | 'initiative' | 'camp';
export interface RpgTalent { id: string; name: string; desc?: string; cls?: string; tier: number; requires?: string[]; effect: { kind: TalentKind; skill?: string; amount: number } }
export type Affliction = 'poison' | 'burn' | 'blind' | 'silence' | 'curse' | 'slow';
export interface Foe { id: string; name: string; icon?: string; /** when they win: true finishes the fallen off (beasts, monsters), false leaves them (robbers); none: guessed from the tags */ kills?: boolean; inflict?: { kind: Affliction; chance: number; turns: number }; element?: Element; level: number; hp: number; ac: number; atk: number; dice: number; sides: number; bonus?: number; ranged?: boolean; row?: 'front' | 'back'; tags?: string[]; desc?: string }
export interface RpgSchool { id: string; name: string; desc?: string }
export type SpellEffect =
    | { kind: 'heal'; amount: number }                       // % of max HP
    | { kind: 'advantage'; skills: string[] }                // the next check of one of these skills: roll twice, keep the best
    | { kind: 'bonus'; amount: number; skills?: string[] }   // + to the next check (of these skills, or any)
    | { kind: 'calm'; amount: number }                       // the region's tension goes down
    | { kind: 'rumor' }                                      // you learn a rumor going around
    | { kind: 'scene' }                                      // only told to the AI (light, a show of sparks…)
    | { kind: 'weather'; to: 'rain' | 'clear' }              // calls rain or clears the sky over the region, for the day
    | { kind: 'cleanse' }                                    // lifts poisons, curses and other afflictions
    | { kind: 'revive' };                                    // brings back someone who died a moment ago (cast for you when it can be)
export type Element = 'fire' | 'water' | 'lightning' | 'ice' | 'earth' | 'light' | 'dark';
export interface RpgSpell { id: string; name: string; school: string; level: number; cost: number; desc: string; effect: SpellEffect; element?: Element; /** what it does in a fight (techniques and spells of any school): a blow, or a guard */ combat?: 'damage' | 'shield' }
export interface RpgTitle { id: string; name: string; desc: string; when: { count?: string; n?: number; level?: number; renown?: number } }
export interface RpgDef {
    /** the system's name (Classic fantasy, Nen hunter…), told to the AI */
    name?: string;
    attributes: RpgAttribute[];
    /** the attribute that adds to hit points */
    hpAttr: string;
    skills: RpgSkill[];
    classes: RpgClass[];
    /** experience needed to reach level 2, 3, … */
    xp: number[];
    focusName?: string;
    schools: RpgSchool[];
    spells: RpgSpell[];
    titles: RpgTitle[];
    /** long trips: hours on the road before you must make camp */
    campEvery?: number;
    /** what can be fought (phase 6) */
    bestiary?: Foe[];
    /** Talent trees: a point per level after the first, spent freely (and refunded any time: respec). */
    talents?: RpgTalent[];
    /** sellswords for hire: names to give them, and the daily wage per level */
    mercNames?: string[];
    mercWage?: number;
    /** weapons a new character can carry instead of their class's (a healer with a mace, a mage with a dagger) */
    weapons?: RpgWeapon[];
    /** points for starting skills: a class skill costs 1, any other 2 (default 6) */
    skillPoints?: number;
    /** how attributes are bought: D&D point buy (default 27 points, 8 to 15), or flat (each point +1 from `min`) */
    pointBuy?: { points: number; min: number; max: number; flat?: boolean };
    /** attribute points gained at each level (default: 2 every 4 levels), and the highest a score can go (default 20) */
    levelPoints?: number;
    attrCap?: number;
    /** which attribute does what in a fight (defaults: DEX, or the second attribute) */
    roles?: { defense?: string; initiative?: string; melee?: string };
}

// The attribute that plays a part: armor and initiative (agility), bare hands (strength).
export function roleAttr(r: RpgDef | null | undefined, role: 'defense' | 'initiative' | 'melee'): string {
    const has = (id?: string) => !!id && !!r?.attributes.some(a => a.id === id);
    const set = r?.roles?.[role];
    if (has(set)) return set!;
    const order = role === 'melee' ? ['str', 'pow', 'bod'] : ['dex', 'agi', 'spd', 'ref'];
    return order.find(has) ?? r?.attributes[role === 'melee' ? 0 : 1]?.id ?? r?.attributes[0]?.id ?? (role === 'melee' ? 'str' : 'dex');
}

const A = (id: string, name: string, short: string, desc: string): RpgAttribute => ({ id, name, short, desc });
const S = (id: string, name: string, attr: string): RpgSkill => ({ id, name, attr });

// Weapon skills and crafts (any class can learn them): a cleric can be good with a mace, a mage with a dagger.
export const MEDIEVAL_EXTRA_SKILLS: RpgSkill[] = [
    S('blades', 'Blades', 'str'), S('blunt', 'Blunt weapons', 'str'), S('polearms', 'Polearms', 'str'), S('bows', 'Bows', 'dex'), S('thrown', 'Thrown weapons', 'dex'),
    S('unarmed', 'Unarmed fighting', 'str'), S('shields', 'Shields', 'con'), S('riding', 'Riding', 'dex'), S('lockpicking', 'Lockpicking', 'dex'),
    S('smithing', 'Smithing', 'int'), S('alchemy', 'Alchemy', 'int'), S('herbalism', 'Herbalism', 'wis'), S('cooking', 'Cooking', 'wis'), S('sailing', 'Sailing', 'wis'),
    S('gambling', 'Gambling', 'wis'), S('etiquette', 'Etiquette', 'cha'), S('leadership', 'Leadership', 'cha'), S('bartering', 'Bartering', 'cha'),
];
const W = (id: string, name: string, dice: number, sides: number, attr: string, skill: string, ranged = false): RpgWeapon => ({ id, name, dice, sides, attr, skill, ...(ranged ? { ranged } : {}) });
export const MEDIEVAL_WEAPONS: RpgWeapon[] = [
    W('dagger', 'dagger', 1, 4, 'dex', 'blades'), W('shortsword', 'shortsword', 1, 6, 'dex', 'blades'), W('longsword', 'longsword', 1, 8, 'str', 'blades'), W('greatsword', 'greatsword', 2, 6, 'str', 'blades'),
    W('rapier', 'rapier', 1, 8, 'dex', 'blades'), W('mace', 'mace', 1, 6, 'str', 'blunt'), W('warhammer', 'warhammer', 1, 8, 'str', 'blunt'), W('staff', 'quarterstaff', 1, 6, 'str', 'blunt'),
    W('flail', 'flail', 1, 8, 'str', 'blunt'), W('spear', 'spear', 1, 6, 'str', 'polearms'), W('halberd', 'halberd', 1, 10, 'str', 'polearms'), W('shortbow', 'shortbow', 1, 6, 'dex', 'bows', true),
    W('longbow', 'longbow', 1, 8, 'dex', 'bows', true), W('crossbow', 'crossbow', 1, 8, 'dex', 'bows', true), W('axes', 'throwing axes', 1, 6, 'str', 'thrown', true), W('fists', 'fists', 1, 4, 'str', 'unarmed'),
];
export const MODERN_EXTRA_SKILLS: RpgSkill[] = [
    S('firearms', 'Firearms', 'dex'), S('blades', 'Knives and blades', 'dex'), S('blunt', 'Clubs and bats', 'str'), S('unarmed', 'Hand-to-hand', 'str'), S('thrown', 'Throwing', 'dex'),
    S('driving', 'Driving', 'dex'), S('piloting', 'Piloting', 'dex'), S('lockpicking', 'Lockpicking', 'dex'), S('mechanics', 'Mechanics', 'int'),
    S('science', 'Science', 'int'), S('law', 'Law', 'int'), S('business', 'Business', 'int'), S('languages', 'Languages', 'int'), S('cooking', 'Cooking', 'wis'),
    S('animals', 'Animal handling', 'wis'), S('gambling', 'Gambling', 'wis'), S('leadership', 'Leadership', 'cha'), S('seduction', 'Seduction', 'cha'), S('streetsmarts', 'Street smarts', 'cha'),
];
export const MODERN_WEAPONS: RpgWeapon[] = [
    W('knife', 'knife', 1, 4, 'dex', 'blades'), W('machete', 'machete', 1, 6, 'str', 'blades'), W('bat', 'baseball bat', 1, 6, 'str', 'blunt'), W('baton', 'baton', 1, 6, 'str', 'blunt'),
    W('fists', 'fists', 1, 4, 'str', 'unarmed'), W('pistol', 'pistol', 1, 8, 'dex', 'firearms', true), W('revolver', 'revolver', 1, 8, 'dex', 'firearms', true), W('shotgun', 'shotgun', 2, 4, 'dex', 'firearms', true),
    W('rifle', 'rifle', 1, 10, 'dex', 'firearms', true), W('taser', 'taser', 1, 6, 'dex', 'firearms', true), W('bricks', 'whatever you can throw', 1, 4, 'dex', 'thrown', true),
];
export const MEDIEVAL_RPG: RpgDef = {
    attributes: [
        A('str', 'Strength', 'STR', 'Lifting, climbing, hitting hard.'),
        A('dex', 'Dexterity', 'DEX', 'Speed, balance, light fingers.'),
        A('con', 'Constitution', 'CON', 'Health and stamina: more hit points.'),
        A('int', 'Intelligence', 'INT', 'Memory, reasoning, arcane study.'),
        A('wis', 'Wisdom', 'WIS', 'Awareness, intuition, faith.'),
        A('cha', 'Charisma', 'CHA', 'Presence, charm, a silver tongue.'),
    ],
    hpAttr: 'con',
    skills: [
        S('athletics', 'Athletics', 'str'), S('acrobatics', 'Acrobatics', 'dex'), S('stealth', 'Stealth', 'dex'), S('sleight', 'Sleight of hand', 'dex'),
        S('arcana', 'Arcana', 'int'), S('history', 'History', 'int'), S('investigation', 'Investigation', 'int'), S('nature', 'Nature', 'int'), S('religion', 'Religion', 'int'),
        S('animals', 'Animal handling', 'wis'), S('insight', 'Insight', 'wis'), S('medicine', 'Medicine', 'wis'), S('perception', 'Perception', 'wis'), S('survival', 'Survival', 'wis'),
        S('deception', 'Deception', 'cha'), S('intimidation', 'Intimidation', 'cha'), S('performance', 'Performance', 'cha'), S('persuasion', 'Persuasion', 'cha'),
        ...MEDIEVAL_EXTRA_SKILLS,
    ],
    weapons: MEDIEVAL_WEAPONS,
    classes: [
        { id: 'fighter', name: 'Fighter', desc: 'Trained in arms and armor; the steadiest blade in any company.', hit: 10, key: 'str', skills: ['athletics', 'intimidation', 'perception', 'survival', 'history'], armor: 6, weapon: { name: 'longsword', dice: 1, sides: 10, attr: 'str', skill: 'blades' }, ability: { name: 'Second wind', kind: 'heal', amount: 35, desc: 'Catch your breath: heal yourself.' }, subAt: 3,
            subclasses: [{ id: 'champion', name: 'Champion', desc: 'Raw might: strikes that land harder.', skill: 'athletics' }, { id: 'battlemaster', name: 'Battle master', desc: 'Tactics and maneuvers.', skill: 'history' }, { id: 'guardian', name: 'Guardian', desc: 'A shield for others.', skill: 'perception' }] },
        { id: 'rogue', name: 'Rogue', desc: 'Quick hands and quicker wits; locks, lies and shadows.', hit: 8, key: 'dex', skills: ['stealth', 'sleight', 'deception', 'acrobatics', 'investigation', 'insight'], armor: 2, weapon: { name: 'rapier', dice: 1, sides: 8, attr: 'dex', skill: 'blades' }, ability: { name: 'Vanish', kind: 'hide', desc: 'Slip out of sight: your next attack has advantage and deals extra damage.' }, subAt: 3,
            subclasses: [{ id: 'thief', name: 'Thief', desc: 'Nothing is out of reach.', skill: 'sleight' }, { id: 'assassin', name: 'Assassin', desc: 'Strike first, unseen.', skill: 'stealth' }, { id: 'swashbuckler', name: 'Swashbuckler', desc: 'Charm and a rapier.', skill: 'persuasion' }] },
        { id: 'ranger', name: 'Ranger', desc: 'At home in the wild; tracker, hunter, guide.', hit: 10, key: 'dex', skills: ['survival', 'nature', 'animals', 'perception', 'stealth'], armor: 4, weapon: { name: 'longbow', dice: 1, sides: 8, attr: 'dex', ranged: true, skill: 'bows' }, ability: { name: 'Hunter\'s mark', kind: 'mark', amount: 4, desc: 'Mark a foe: the whole party deals more damage to it.' }, subAt: 3,
            subclasses: [{ id: 'hunter', name: 'Hunter', desc: 'Quarry never escapes.', skill: 'survival' }, { id: 'beastmaster', name: 'Beast master', desc: 'A loyal animal companion.', skill: 'animals' }] },
        { id: 'cleric', name: 'Cleric', faith: true, secular: 'Healer', desc: 'A servant of the gods: healing, wards and faith made real.', hit: 8, key: 'wis', skills: ['religion', 'medicine', 'insight', 'persuasion', 'history'], schools: ['restoration', 'abjuration', 'divination'], armor: 5, weapon: { name: 'mace', dice: 1, sides: 6, attr: 'str', skill: 'blunt' }, ability: { name: 'Prayer of healing', kind: 'heal', amount: 30, desc: 'Heal the most hurt ally.' }, subAt: 3,
            subclasses: [{ id: 'life', name: 'Life domain', desc: 'Healing comes easily.', school: 'restoration' }, { id: 'knowledge', name: 'Knowledge domain', desc: 'Secrets and lore.', school: 'divination' }, { id: 'light', name: 'Light domain', desc: 'Radiance that drives back the dark.', school: 'abjuration' }] },
        { id: 'mage', name: 'Mage', desc: 'A scholar of the arcane, a grimoire under the arm.', hit: 6, key: 'int', skills: ['arcana', 'history', 'investigation', 'insight', 'religion'], schools: ['evocation', 'abjuration', 'illusion', 'enchantment', 'divination'], armor: 0, weapon: { name: 'fire bolt', dice: 1, sides: 10, attr: 'int', ranged: true, element: 'fire' }, ability: { name: 'Shield', kind: 'shield', amount: 5, desc: 'A shimmering ward: +5 armor until your next turn.' }, subAt: 5,
            subclasses: [{ id: 'evoker', name: 'School of Evocation', desc: 'Fire and thunder.', school: 'evocation' }, { id: 'illusionist', name: 'School of Illusion', desc: 'Nothing is what it seems.', school: 'illusion' }, { id: 'enchanter', name: 'School of Enchantment', desc: 'Minds bend to you.', school: 'enchantment' }, { id: 'abjurer', name: 'School of Abjuration', desc: 'Wards and protection.', school: 'abjuration' }] },
        { id: 'bard', name: 'Bard', desc: 'Music, stories and magic woven into words.', hit: 8, key: 'cha', skills: ['performance', 'persuasion', 'deception', 'insight', 'history', 'sleight'], schools: ['enchantment', 'illusion', 'restoration'], armor: 2, weapon: { name: 'vicious mockery', dice: 1, sides: 6, attr: 'cha', ranged: true }, ability: { name: 'Inspiration', kind: 'inspire', amount: 4, desc: 'A rousing verse: every ally hits harder this round.' }, subAt: 3,
            subclasses: [{ id: 'lore', name: 'College of Lore', desc: 'You know a little of everything.', skill: 'history' }, { id: 'valor', name: 'College of Valor', desc: 'Songs that steel the heart.', skill: 'intimidation' }] },
    ],
    xp: [100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500, 5500, 6600],
    focusName: 'Focus',
    schools: [
        { id: 'restoration', name: 'Restoration', desc: 'Healing and mending.' },
        { id: 'abjuration', name: 'Abjuration', desc: 'Wards and protection.' },
        { id: 'divination', name: 'Divination', desc: 'Seeing what is hidden.' },
        { id: 'enchantment', name: 'Enchantment', desc: 'Touching minds and hearts.' },
        { id: 'evocation', name: 'Evocation', desc: 'Raw energy: fire, light, thunder.' },
        { id: 'illusion', name: 'Illusion', desc: 'Tricks of light and sound.' },
    ],
    spells: [
        { id: 'healing_word', name: 'Healing word', school: 'restoration', level: 1, cost: 1, desc: 'A whispered prayer closes small wounds.', effect: { kind: 'heal', amount: 15 } },
        { id: 'cure_wounds', name: 'Cure wounds', school: 'restoration', level: 1, cost: 2, desc: 'A touch that knits flesh.', effect: { kind: 'heal', amount: 35 } },
        { id: 'revivify', name: 'Revivify', school: 'restoration', level: 3, cost: 4, desc: 'Within a minute of death, a touch calls the soul back into the body.', effect: { kind: 'revive' } },
        { id: 'mass_mend', name: 'Greater restoration', school: 'restoration', level: 3, cost: 4, desc: 'Body and spirit made whole.', effect: { kind: 'heal', amount: 80 } },
        { id: 'guidance', name: 'Guidance', school: 'divination', level: 1, cost: 1, desc: 'A nudge from beyond: +2 to your next check.', effect: { kind: 'bonus', amount: 2 } },
        { id: 'detect_thoughts', name: 'Detect thoughts', school: 'divination', level: 2, cost: 3, desc: 'Surface thoughts, like whispers: read people.', effect: { kind: 'advantage', skills: ['insight', 'deception', 'persuasion'] } },
        { id: 'augury', name: 'Augury', school: 'divination', level: 2, cost: 2, desc: 'Signs and omens reveal what is being said.', effect: { kind: 'rumor' } },
        { id: 'protection', name: 'Protection from harm', school: 'abjuration', level: 1, cost: 1, desc: 'A faint ward settles on you.', effect: { kind: 'scene' } },
        { id: 'sanctuary', name: 'Sanctuary', school: 'abjuration', level: 1, cost: 2, desc: 'Hostility falters near you.', effect: { kind: 'advantage', skills: ['persuasion', 'insight'] } },
        { id: 'calm', name: 'Calm emotions', school: 'enchantment', level: 2, cost: 3, desc: 'Tempers cool across the street: the town is less tense.', effect: { kind: 'calm', amount: 15 } },
        { id: 'friends', name: 'Friends', school: 'enchantment', level: 1, cost: 1, desc: 'A glamour of goodwill: +3 to your next Charisma check.', effect: { kind: 'bonus', amount: 3, skills: ['persuasion', 'deception', 'intimidation', 'performance'] } },
        { id: 'charm_person', name: 'Charm person', school: 'enchantment', level: 1, cost: 2, desc: 'Someone sees you as a trusted friend for a while.', effect: { kind: 'advantage', skills: ['persuasion', 'deception'] } },
        { id: 'light', name: 'Light', school: 'evocation', level: 1, cost: 1, desc: 'A steady glow from your hand.', effect: { kind: 'scene' } },
        { id: 'thunderwave', name: 'Thunderwave', school: 'evocation', level: 1, cost: 2, desc: 'A boom that rattles windows and nerves.', effect: { kind: 'advantage', skills: ['intimidation'] }, element: 'lightning' },
        { id: 'water_whip', name: 'Water whip', school: 'evocation', level: 1, cost: 1, desc: 'A lash of water: soaks a foe (lightning on a soaked foe strikes them all).', effect: { kind: 'scene' }, element: 'water' },
        { id: 'lightning_bolt', name: 'Lightning bolt', school: 'evocation', level: 2, cost: 3, desc: 'A crack of lightning. Stronger in the rain.', effect: { kind: 'scene' }, element: 'lightning' },
        { id: 'call_rain', name: 'Call rain', school: 'evocation', level: 2, cost: 2, desc: 'Clouds gather: rain for the rest of the day (water and lightning grow stronger, fire weaker).', effect: { kind: 'weather', to: 'rain' }, element: 'water' },
        { id: 'clear_skies', name: 'Clear skies', school: 'divination', level: 2, cost: 2, desc: 'The clouds part for the day.', effect: { kind: 'weather', to: 'clear' } },
        { id: 'purify', name: 'Purify', school: 'restoration', level: 2, cost: 2, desc: 'Lifts poisons, curses and lingering afflictions.', effect: { kind: 'cleanse' }, element: 'light' },
        { id: 'fire_bolt', name: 'Fire bolt', school: 'evocation', level: 1, cost: 1, desc: 'A mote of flame streaks from your finger. Weaker in the rain.', effect: { kind: 'scene' }, element: 'fire' },
        { id: 'minor_illusion', name: 'Minor illusion', school: 'illusion', level: 1, cost: 1, desc: 'A sound or image that is not there: +2 to deceive or perform.', effect: { kind: 'bonus', amount: 2, skills: ['deception', 'performance', 'sleight'] } },
        { id: 'disguise', name: 'Disguise self', school: 'illusion', level: 1, cost: 2, desc: 'You look like someone else for an hour.', effect: { kind: 'advantage', skills: ['deception', 'stealth'] } },
        { id: 'invisibility', name: 'Invisibility', school: 'illusion', level: 2, cost: 3, desc: 'You vanish from sight.', effect: { kind: 'advantage', skills: ['stealth', 'sleight'] } },
    ],
    titles: [
        { id: 'seasoned', name: 'the Seasoned', desc: 'Reach level 5.', when: { level: 5 } },
        { id: 'veteran', name: 'the Veteran', desc: 'Reach level 10.', when: { level: 10 } },
        { id: 'silver', name: 'the Silver-tongued', desc: 'Win 10 social checks.', when: { count: 'socialWins', n: 10 } },
        { id: 'trusted', name: 'the Trusted Hand', desc: 'Finish 5 quests.', when: { count: 'quests', n: 5 } },
        { id: 'hero', name: 'Hero of the Realm', desc: 'Earn 100 renown.', when: { renown: 100 } },
        { id: 'wanderer', name: 'the Wanderer', desc: 'Make camp 5 times on the road.', when: { count: 'camps', n: 5 } },
        { id: 'arcanist', name: 'the Arcanist', desc: 'Cast 20 spells.', when: { count: 'casts', n: 20 } },
    ],
    campEvery: 8,
    bestiary: [
        { id: 'wolf', icon: '🐺', name: 'Wolf', level: 1, hp: 11, ac: 12, atk: 4, dice: 2, sides: 4, bonus: 2, row: 'front', tags: ['road', 'wild'], desc: 'Grey, lean, hungry.' },
        { id: 'bandit', icon: '🗡️', name: 'Bandit', level: 1, hp: 11, ac: 12, atk: 3, dice: 1, sides: 6, bonus: 1, row: 'front', tags: ['road', 'town'], desc: 'A desperate cutthroat with a rusty blade.' },
        { id: 'archer', icon: '🏹', name: 'Bandit archer', inflict: { kind: 'poison', chance: 0.25, turns: 3 }, level: 1, hp: 9, ac: 13, atk: 4, dice: 1, sides: 8, bonus: 2, ranged: true, row: 'back', tags: ['road'], desc: 'Shoots from behind the trees.' },
        { id: 'thug', icon: '👊', name: 'Tavern thug', level: 1, hp: 13, ac: 11, atk: 3, dice: 1, sides: 6, bonus: 2, row: 'front', tags: ['town'], desc: 'Big fists, short temper.' },
        { id: 'boar', icon: '🐗', name: 'Wild boar', level: 2, hp: 18, ac: 11, atk: 4, dice: 1, sides: 8, bonus: 2, row: 'front', tags: ['wild'], desc: 'Tusks like knives.' },
        { id: 'captain', icon: '⚔️', name: 'Bandit captain', level: 3, hp: 32, ac: 15, atk: 5, dice: 2, sides: 6, bonus: 3, row: 'front', tags: ['road', 'boss'], desc: 'Scarred, clever, well armed.' },
        { id: 'cultist', icon: '🕯️', name: 'Cultist', inflict: { kind: 'curse', chance: 0.3, turns: 4 }, element: 'dark', level: 2, hp: 15, ac: 12, atk: 4, dice: 1, sides: 8, bonus: 1, ranged: true, row: 'back', tags: ['town', 'wild'], desc: 'Whispers dark prayers.' },
        { id: 'skeleton', icon: '💀', name: 'Skeleton', level: 2, hp: 14, ac: 13, atk: 4, dice: 1, sides: 6, bonus: 2, row: 'front', tags: ['tower', 'undead'], desc: 'Old bones that will not rest.' },
        { id: 'spider', icon: '🕷️', name: 'Giant spider', inflict: { kind: 'poison', chance: 0.4, turns: 3 }, level: 3, hp: 22, ac: 13, atk: 5, dice: 1, sides: 8, bonus: 2, row: 'front', tags: ['tower', 'wild'], desc: 'Venom drips from its fangs.' },
        { id: 'wraith', icon: '👻', name: 'Wraith', inflict: { kind: 'silence', chance: 0.35, turns: 2 }, element: 'dark', level: 4, hp: 26, ac: 14, atk: 6, dice: 2, sides: 6, bonus: 3, ranged: true, row: 'back', tags: ['tower', 'undead'], desc: 'A cold whisper that steals your voice.' },
        { id: 'drake', icon: '🐲', name: 'Fire drake', inflict: { kind: 'burn', chance: 0.4, turns: 2 }, element: 'fire', level: 6, hp: 60, ac: 16, atk: 7, dice: 2, sides: 10, bonus: 4, row: 'front', tags: ['tower', 'boss'], desc: 'A young dragon, already vicious.' },
        { id: 'troll', icon: '👹', name: 'Cave troll', level: 7, hp: 80, ac: 14, atk: 8, dice: 3, sides: 8, bonus: 5, row: 'front', tags: ['tower', 'wild', 'boss'], desc: 'It regrows what you cut off.' },
        { id: 'bear', icon: '🐻', name: 'Brown bear', level: 4, hp: 34, ac: 11, atk: 6, dice: 2, sides: 8, bonus: 4, row: 'front', tags: ['wild', 'boss'], desc: 'A wall of fur and claws.' },
    ],
    talents: [
        { id: 'tough', name: 'Toughness', desc: 'More hit points.', tier: 1, effect: { kind: 'hp', amount: 6 } },
        { id: 'keen', name: 'Keen senses', desc: '+2 Perception.', tier: 1, effect: { kind: 'skill', skill: 'perception', amount: 2 } },
        { id: 'silver', name: 'Silver tongue', desc: '+2 Persuasion.', tier: 1, effect: { kind: 'skill', skill: 'persuasion', amount: 2 } },
        { id: 'wander', name: 'Wanderer', desc: '+3 on nights at camp.', tier: 1, effect: { kind: 'camp', amount: 3 } },
        { id: 'will', name: 'Iron will', desc: '+2 focus.', tier: 2, requires: ['tough'], effect: { kind: 'focus', amount: 2 } },
        { id: 'f_master', name: 'Weapon master', desc: '+1 to hit.', cls: 'fighter', tier: 1, effect: { kind: 'attack', amount: 1 } },
        { id: 'f_armor', name: 'Heavy armor training', desc: '+1 armor.', cls: 'fighter', tier: 2, requires: ['f_master'], effect: { kind: 'armor', amount: 1 } },
        { id: 'f_cleave', name: 'Cleave', desc: '+2 damage.', cls: 'fighter', tier: 3, requires: ['f_armor'], effect: { kind: 'damage', amount: 2 } },
        { id: 'r_sneak', name: 'Sneak', desc: '+2 Stealth.', cls: 'rogue', tier: 1, effect: { kind: 'skill', skill: 'stealth', amount: 2 } },
        { id: 'r_prec', name: 'Precision', desc: '+1 to hit.', cls: 'rogue', tier: 2, requires: ['r_sneak'], effect: { kind: 'attack', amount: 1 } },
        { id: 'r_assa', name: 'Assassinate', desc: '+3 damage.', cls: 'rogue', tier: 3, requires: ['r_prec'], effect: { kind: 'damage', amount: 3 } },
        { id: 'g_track', name: 'Tracker', desc: '+2 Survival.', cls: 'ranger', tier: 1, effect: { kind: 'skill', skill: 'survival', amount: 2 } },
        { id: 'g_eye', name: 'Deadeye', desc: '+1 to hit.', cls: 'ranger', tier: 2, requires: ['g_track'], effect: { kind: 'attack', amount: 1 } },
        { id: 'g_volley', name: 'Volley', desc: '+2 damage.', cls: 'ranger', tier: 3, requires: ['g_eye'], effect: { kind: 'damage', amount: 2 } },
        { id: 'c_devo', name: 'Devotion', desc: '+2 focus.', cls: 'cleric', tier: 1, effect: { kind: 'focus', amount: 2 } },
        { id: 'c_mend', name: 'Mending', desc: '+2 Medicine.', cls: 'cleric', tier: 2, requires: ['c_devo'], effect: { kind: 'skill', skill: 'medicine', amount: 2 } },
        { id: 'c_armor', name: 'Blessed armor', desc: '+1 armor.', cls: 'cleric', tier: 3, requires: ['c_mend'], effect: { kind: 'armor', amount: 1 } },
        { id: 'm_res', name: 'Arcane reservoir', desc: '+3 focus.', cls: 'mage', tier: 1, effect: { kind: 'focus', amount: 3 } },
        { id: 'm_focus', name: 'Spell focus', desc: '+1 to hit.', cls: 'mage', tier: 2, requires: ['m_res'], effect: { kind: 'attack', amount: 1 } },
        { id: 'm_over', name: 'Overchannel', desc: '+2 damage.', cls: 'mage', tier: 3, requires: ['m_focus'], effect: { kind: 'damage', amount: 2 } },
        { id: 'b_rouse', name: 'Rousing presence', desc: '+2 initiative.', cls: 'bard', tier: 1, effect: { kind: 'initiative', amount: 2 } },
        { id: 'b_lore', name: 'Bardic lore', desc: '+2 History.', cls: 'bard', tier: 2, requires: ['b_rouse'], effect: { kind: 'skill', skill: 'history', amount: 2 } },
        { id: 'b_cut', name: 'Cutting words', desc: '+1 damage.', cls: 'bard', tier: 3, requires: ['b_lore'], effect: { kind: 'damage', amount: 1 } },
    ],
    mercNames: ['Brann', 'Osric', 'Hilde', 'Torvin', 'Maera', 'Gaspard', 'Ilsa', 'Rook', 'Dunstan', 'Wren', 'Corwin', 'Petra'],
    mercWage: 6,
};

// A modern world with no magic: martial arts take its place (styles are the "schools", techniques the "spells",
// and Ki is the focus); the streets have muggers, gangs and bosses.
const T = (id: string, name: string, desc: string, tier: number, kind: TalentKind, amount: number, cls?: string, requires?: string[], skill?: string): RpgTalent => ({ id, name, desc, tier, effect: { kind, amount, ...(skill ? { skill } : {}) }, ...(cls ? { cls } : {}), ...(requires ? { requires } : {}) });
export const MODERN_RPG: RpgDef = {
    attributes: MEDIEVAL_RPG.attributes,
    hpAttr: 'con',
    skills: [
        S('athletics', 'Athletics', 'str'), S('acrobatics', 'Acrobatics', 'dex'), S('stealth', 'Stealth', 'dex'), S('sleight', 'Sleight of hand', 'dex'),
        S('investigation', 'Investigation', 'int'), S('history', 'Knowledge', 'int'), S('tech', 'Technology', 'int'),
        S('insight', 'Insight', 'wis'), S('medicine', 'First aid', 'wis'), S('perception', 'Perception', 'wis'), S('survival', 'Streetwise', 'wis'),
        S('deception', 'Deception', 'cha'), S('intimidation', 'Intimidation', 'cha'), S('performance', 'Performance', 'cha'), S('persuasion', 'Persuasion', 'cha'),
        ...MODERN_EXTRA_SKILLS,
    ],
    weapons: MODERN_WEAPONS,
    classes: [
        { id: 'martial', name: 'Martial artist', desc: 'Years in the dojo: body, breath and discipline.', hit: 10, key: 'wis', skills: ['athletics', 'acrobatics', 'insight', 'perception'], schools: ['karate', 'kungfu', 'capoeira', 'boxing'], armor: 2, weapon: { name: 'fists and feet', dice: 1, sides: 8, attr: 'dex', skill: 'unarmed' }, ability: { name: 'Flurry', kind: 'rage', amount: 3, desc: 'A storm of blows: more damage, less guard.' }, subAt: 3,
            subclasses: [{ id: 'karateka', name: 'Karateka', desc: 'Hard, direct strikes.', school: 'karate' }, { id: 'kungfu_master', name: 'Kung fu master', desc: 'Flow and inner calm.', school: 'kungfu' }, { id: 'capoeirista', name: 'Capoeirista', desc: 'Dance, trickery and kicks.', school: 'capoeira' }, { id: 'boxer', name: 'Boxer', desc: 'Footwork and fists.', school: 'boxing' }] },
        { id: 'soldier', name: 'Ex-soldier', desc: 'Trained to fight, still carrying the habits.', hit: 10, key: 'str', skills: ['athletics', 'intimidation', 'perception', 'survival'], armor: 5, weapon: { name: 'pistol', dice: 1, sides: 8, attr: 'dex', ranged: true, skill: 'firearms' }, ability: { name: 'Suppressing fire', kind: 'mark', amount: 3, desc: 'Pin a target down: everyone hits it harder.' }, subAt: 3,
            subclasses: [{ id: 'commando', name: 'Commando', desc: 'Close-quarters expert.', skill: 'stealth' }, { id: 'sharpshooter', name: 'Sharpshooter', desc: 'One shot, one problem solved.', skill: 'perception' }] },
        { id: 'hacker', name: 'Hacker', desc: 'Systems, cameras and locks bend to your keyboard.', hit: 6, key: 'int', skills: ['tech', 'investigation', 'stealth', 'deception'], armor: 0, weapon: { name: 'taser', dice: 1, sides: 6, attr: 'dex', ranged: true, element: 'lightning' }, ability: { name: 'Kill the lights', kind: 'hide', desc: 'Cameras and lights go dark: your next attack lands unseen.' }, subAt: 3,
            subclasses: [{ id: 'netrunner', name: 'Netrunner', desc: 'Lives online.', skill: 'tech' }, { id: 'social_engineer', name: 'Social engineer', desc: 'The weakest link is people.', skill: 'persuasion' }] },
        { id: 'medic', name: 'Medic', desc: 'Paramedic training: you keep people alive.', hit: 8, key: 'wis', skills: ['medicine', 'insight', 'perception', 'persuasion'], armor: 2, weapon: { name: 'baton', dice: 1, sides: 6, attr: 'str', skill: 'blunt' }, ability: { name: 'Patch up', kind: 'heal', amount: 30, desc: 'Heal the most hurt ally.' }, subAt: 3,
            subclasses: [{ id: 'trauma', name: 'Trauma surgeon', desc: 'Miracles in the worst moments.', skill: 'medicine' }, { id: 'counselor', name: 'Counselor', desc: 'Minds heal too.', skill: 'insight' }] },
        { id: 'detective', name: 'Detective', desc: 'You notice what others miss.', hit: 8, key: 'int', skills: ['investigation', 'insight', 'perception', 'intimidation', 'survival'], armor: 2, weapon: { name: 'revolver', dice: 1, sides: 8, attr: 'dex', ranged: true, skill: 'firearms' }, ability: { name: 'Read the opponent', kind: 'mark', amount: 4, desc: 'Find the weak spot: the whole party deals more damage to it.' }, subAt: 3,
            subclasses: [{ id: 'private_eye', name: 'Private eye', desc: 'Shadows and stakeouts.', skill: 'stealth' }, { id: 'inspector', name: 'Inspector', desc: 'The badge opens doors.', skill: 'intimidation' }] },
        { id: 'influencer', name: 'Influencer', desc: 'A million followers and a way with words.', hit: 6, key: 'cha', skills: ['persuasion', 'performance', 'deception', 'insight'], armor: 0, weapon: { name: 'pepper spray', dice: 1, sides: 4, attr: 'dex', ranged: true }, ability: { name: 'Hype', kind: 'inspire', amount: 3, desc: 'Everyone feels like the main character: their next blow lands truer.' }, subAt: 3,
            subclasses: [{ id: 'streamer', name: 'Streamer', desc: 'Always live.', skill: 'performance' }, { id: 'activist', name: 'Activist', desc: 'A cause and a crowd.', skill: 'persuasion' }] },
    ],
    xp: MEDIEVAL_RPG.xp,
    focusName: 'Ki',
    schools: [
        { id: 'karate', name: 'Karate', desc: 'Hard strikes and an iron body.' },
        { id: 'kungfu', name: 'Kung fu', desc: 'Flow, balance and inner calm.' },
        { id: 'capoeira', name: 'Capoeira', desc: 'Dance, deception and sweeping kicks.' },
        { id: 'boxing', name: 'Boxing', desc: 'Footwork, guard and fists.' },
    ],
    spells: [
        { id: 'focused_strike', name: 'Focused strike', school: 'karate', level: 1, cost: 1, desc: 'All your Ki in one strike.', effect: { kind: 'scene' }, combat: 'damage' },
        { id: 'iron_body', name: 'Iron body', school: 'karate', level: 1, cost: 2, desc: 'Muscles like armor: +3 armor in a fight.', effect: { kind: 'scene' }, combat: 'shield' },
        { id: 'breaking_blow', name: 'Breaking blow', school: 'karate', level: 2, cost: 3, desc: 'The strike that splits boards (and jaws).', effect: { kind: 'scene' }, combat: 'damage' },
        { id: 'crane', name: 'Crane stance', school: 'kungfu', level: 1, cost: 1, desc: 'Perfect balance: +3 armor in a fight.', effect: { kind: 'scene' }, combat: 'shield' },
        { id: 'inner_calm', name: 'Inner calm', school: 'kungfu', level: 1, cost: 1, desc: 'Breathe: recover some strength.', effect: { kind: 'heal', amount: 15 } },
        { id: 'dragon_palm', name: 'Palm of the dragon', school: 'kungfu', level: 2, cost: 3, desc: 'An open palm that hits like a truck.', effect: { kind: 'scene' }, combat: 'damage' },
        { id: 'meditation', name: 'Meditation', school: 'kungfu', level: 1, cost: 1, desc: 'A clear mind: +2 to your next check.', effect: { kind: 'bonus', amount: 2 } },
        { id: 'meia_lua', name: 'Meia lua', school: 'capoeira', level: 1, cost: 1, desc: 'A spinning half-moon kick.', effect: { kind: 'scene' }, combat: 'damage' },
        { id: 'ginga', name: 'Ginga', school: 'capoeira', level: 1, cost: 2, desc: 'Never where they expect: your next Acrobatics or Stealth check rolls twice.', effect: { kind: 'advantage', skills: ['acrobatics', 'stealth', 'deception'] } },
        { id: 'martelo', name: 'Martelo', school: 'capoeira', level: 2, cost: 2, desc: 'The hammer kick.', effect: { kind: 'scene' }, combat: 'damage' },
        { id: 'jab_cross', name: 'Jab-cross', school: 'boxing', level: 1, cost: 1, desc: 'The classic one-two.', effect: { kind: 'scene' }, combat: 'damage' },
        { id: 'rope_a_dope', name: 'Rope-a-dope', school: 'boxing', level: 1, cost: 1, desc: 'Cover up and let them tire: +3 armor.', effect: { kind: 'scene' }, combat: 'shield' },
        { id: 'haymaker', name: 'Haymaker', school: 'boxing', level: 2, cost: 3, desc: 'Everything behind one punch.', effect: { kind: 'scene' }, combat: 'damage' },
    ],
    titles: [
        { id: 'seasoned', name: 'the Seasoned', desc: 'Reach level 5.', when: { level: 5 } },
        { id: 'veteran', name: 'the Veteran', desc: 'Reach level 10.', when: { level: 10 } },
        { id: 'smooth', name: 'the Smooth Talker', desc: 'Win 10 social checks.', when: { count: 'socialWins', n: 10 } },
        { id: 'fixer', name: 'the Fixer', desc: 'Finish 5 missions.', when: { count: 'quests', n: 5 } },
        { id: 'legend', name: 'Neighborhood Legend', desc: 'Earn 100 renown.', when: { renown: 100 } },
        { id: 'brawler', name: 'the Undefeated', desc: 'Win 10 fights.', when: { count: 'fights', n: 10 } },
    ],
    campEvery: 8,
    bestiary: [
        { id: 'mugger', icon: '🔪', name: 'Mugger', level: 1, hp: 10, ac: 11, atk: 3, dice: 1, sides: 6, bonus: 1, row: 'front', tags: ['town', 'road'], desc: 'A knife and nothing to lose.' },
        { id: 'ganger', icon: '🧢', name: 'Gang member', level: 1, hp: 12, ac: 12, atk: 3, dice: 1, sides: 6, bonus: 2, row: 'front', tags: ['town', 'tower'], desc: 'Colors, attitude and a chain.' },
        { id: 'dog', icon: '🐕', name: 'Guard dog', level: 1, hp: 9, ac: 12, atk: 4, dice: 1, sides: 6, bonus: 2, row: 'front', tags: ['town', 'wild'], desc: 'Trained to bite first.' },
        { id: 'bat', icon: '🏏', name: 'Thug with a bat', level: 2, hp: 16, ac: 12, atk: 4, dice: 1, sides: 8, bonus: 2, row: 'front', tags: ['town', 'tower'], desc: 'Swings for the fences.' },
        { id: 'gunman', icon: '🔫', name: 'Gunman', level: 2, hp: 12, ac: 13, atk: 5, dice: 1, sides: 8, bonus: 2, ranged: true, row: 'back', tags: ['town', 'road', 'tower'], desc: 'Shoots from behind cover.' },
        { id: 'security', icon: '👮', name: 'Security guard', level: 2, hp: 18, ac: 14, atk: 4, dice: 1, sides: 6, bonus: 2, row: 'front', tags: ['town'], desc: 'Paid to stop you, not to like it.' },
        { id: 'bouncer', icon: '💪', name: 'Bouncer', level: 3, hp: 26, ac: 12, atk: 5, dice: 2, sides: 6, bonus: 3, row: 'front', tags: ['town', 'tower'], desc: 'A wall in a black shirt.' },
        { id: 'boss', icon: '😎', name: 'Gang boss', level: 5, hp: 45, ac: 15, atk: 6, dice: 2, sides: 8, bonus: 3, row: 'front', tags: ['town', 'tower', 'boss'], desc: 'Gold chains, cold eyes.' },
    ],
    talents: [
        T('tough', 'Toughness', 'More hit points.', 1, 'hp', 6), T('keen', 'Keen senses', '+2 Perception.', 1, 'skill', 2, undefined, undefined, 'perception'),
        T('silver', 'Silver tongue', '+2 Persuasion.', 1, 'skill', 2, undefined, undefined, 'persuasion'), T('street', 'Street smart', '+3 on nights on the road.', 1, 'camp', 3),
        T('will', 'Iron will', '+2 Ki.', 2, 'focus', 2, undefined, ['tough']),
        T('ma_breath', 'Breath control', '+3 Ki.', 1, 'focus', 3, 'martial'), T('ma_speed', 'Lightning reflexes', '+2 initiative.', 2, 'initiative', 2, 'martial', ['ma_breath']), T('ma_power', 'Devastating strikes', '+2 damage.', 3, 'damage', 2, 'martial', ['ma_speed']),
        T('so_aim', 'Marksman', '+1 to hit.', 1, 'attack', 1, 'soldier'), T('so_vest', 'Body armor', '+1 armor.', 2, 'armor', 1, 'soldier', ['so_aim']), T('so_hollow', 'Hollow points', '+2 damage.', 3, 'damage', 2, 'soldier', ['so_vest']),
        T('ha_code', 'Script kiddie no more', '+2 Technology.', 1, 'skill', 2, 'hacker', undefined, 'tech'), T('ha_mod', 'Modded taser', '+2 damage.', 2, 'damage', 2, 'hacker', ['ha_code']), T('ha_ghost', 'Ghost', '+2 Stealth.', 3, 'skill', 2, 'hacker', ['ha_mod'], 'stealth'),
        T('me_kit', 'Full kit', '+2 First aid.', 1, 'skill', 2, 'medic', undefined, 'medicine'), T('me_calm', 'Steady hands', '+1 to hit.', 2, 'attack', 1, 'medic', ['me_kit']), T('me_tough', 'Seen it all', 'More hit points.', 3, 'hp', 8, 'medic', ['me_calm']),
        T('de_eye', 'Eye for detail', '+2 Investigation.', 1, 'skill', 2, 'detective', undefined, 'investigation'), T('de_draw', 'Quick draw', '+2 initiative.', 2, 'initiative', 2, 'detective', ['de_eye']), T('de_shot', 'Called shot', '+2 damage.', 3, 'damage', 2, 'detective', ['de_draw']),
        T('in_charm', 'Charisma', '+2 Performance.', 1, 'skill', 2, 'influencer', undefined, 'performance'), T('in_crowd', 'The crowd loves you', '+2 initiative.', 2, 'initiative', 2, 'influencer', ['in_charm']), T('in_viral', 'Viral', '+2 Ki.', 3, 'focus', 2, 'influencer', ['in_crowd']),
    ],
    mercNames: ['Marcus', 'Dee', 'Rico', 'Tanya', 'Viktor', 'Jules', 'Ray', 'Nina', 'Tomas', 'Kat'],
    mercWage: 40,
};

// Superpowers: the same city, in a world where powers are real and everyone knows it. The modern classes (a martial
// artist makes a fine vigilante) plus speedsters, powerhouses, elementals and psychics; powers are the "schools";
// villains and their henchmen join the street's thugs.
export const POWERS_RPG: RpgDef = {
    ...MODERN_RPG,
    skills: [...MODERN_RPG.skills, S('arcana', 'Powers lore', 'int')],
    classes: [
        ...MODERN_RPG.classes,
        { id: 'speedster', name: 'Speedster', desc: 'Faster than the eye: the city is a blur around you.', hit: 8, key: 'dex', skills: ['acrobatics', 'athletics', 'perception', 'sleight'], schools: ['speed'], armor: 1, weapon: { name: 'a hundred punches a second', dice: 1, sides: 8, attr: 'dex' }, ability: { name: 'Blur', kind: 'hide', desc: 'Gone before they blink: your next blow lands unseen.' }, subAt: 3,
            subclasses: [{ id: 'sprinter', name: 'Sprinter', desc: 'Pure speed.', skill: 'athletics' }, { id: 'phaser', name: 'Phaser', desc: 'Vibrates through walls.', skill: 'stealth' }] },
        { id: 'powerhouse', name: 'Powerhouse', desc: 'You lift buses. Bullets bounce.', hit: 12, key: 'str', skills: ['athletics', 'intimidation', 'perception', 'persuasion'], schools: ['strength'], armor: 6, weapon: { name: 'super-strength', dice: 2, sides: 6, attr: 'str' }, ability: { name: 'Stand in the way', kind: 'guard', desc: 'You take the hits meant for your friends.' }, subAt: 3,
            subclasses: [{ id: 'titan', name: 'Titan', desc: 'Bigger, stronger.', skill: 'athletics' }, { id: 'guardian', name: 'Guardian', desc: 'The city\'s shield.', skill: 'insight' }] },
        { id: 'elemental', name: 'Elemental', desc: 'Fire, water and lightning answer you.', hit: 6, key: 'con', skills: ['arcana', 'survival', 'intimidation', 'performance'], schools: ['elemental'], armor: 0, weapon: { name: 'energy blast', dice: 1, sides: 8, attr: 'con', ranged: true, element: 'fire' }, ability: { name: 'Overload', kind: 'rage', amount: 3, desc: 'Let it all out: more damage, less control.' }, subAt: 3,
            subclasses: [{ id: 'pyro', name: 'Pyrokinetic', desc: 'Fire.', skill: 'intimidation' }, { id: 'storm', name: 'Stormcaller', desc: 'Rain and lightning.', skill: 'survival' }] },
        { id: 'psychic', name: 'Psychic', desc: 'You hear thoughts and move things with your mind.', hit: 6, key: 'int', skills: ['insight', 'arcana', 'persuasion', 'investigation', 'deception'], schools: ['mind'], armor: 0, weapon: { name: 'telekinetic shove', dice: 1, sides: 6, attr: 'int', ranged: true }, ability: { name: 'Read them', kind: 'mark', amount: 4, desc: 'You see their next move: the team hits them harder.' }, subAt: 3,
            subclasses: [{ id: 'telepath', name: 'Telepath', desc: 'Minds are open books.', skill: 'insight' }, { id: 'telekinetic', name: 'Telekinetic', desc: 'Mind over matter.', skill: 'athletics' }] },
    ],
    focusName: 'Power',
    schools: [...MODERN_RPG.schools, { id: 'speed', name: 'Super-speed', desc: 'Move faster than thought.' }, { id: 'strength', name: 'Super-strength', desc: 'Lift, smash, endure.' }, { id: 'elemental', name: 'Elemental control', desc: 'Fire, water, lightning and the weather.' }, { id: 'mind', name: 'Psychic powers', desc: 'Telepathy and telekinesis.' }],
    spells: [
        ...MODERN_RPG.spells,
        { id: 'rapid_strikes', name: 'Rapid strikes', school: 'speed', level: 1, cost: 1, desc: 'A flurry too fast to see.', effect: { kind: 'scene' }, combat: 'damage' },
        { id: 'afterimage', name: 'Afterimage', school: 'speed', level: 1, cost: 2, desc: 'They hit where you were: +3 armor in a fight.', effect: { kind: 'scene' }, combat: 'shield' },
        { id: 'quick_hands', name: 'Quick hands', school: 'speed', level: 2, cost: 2, desc: 'Your next Sleight of hand, Acrobatics or Stealth check rolls twice.', effect: { kind: 'advantage', skills: ['sleight', 'acrobatics', 'stealth'] } },
        { id: 'thunderclap', name: 'Thunderclap', school: 'strength', level: 1, cost: 1, desc: 'Hands together: a shockwave.', effect: { kind: 'scene' }, combat: 'damage' },
        { id: 'iron_skin', name: 'Unbreakable', school: 'strength', level: 1, cost: 2, desc: 'Bullets bounce off: +3 armor in a fight.', effect: { kind: 'scene' }, combat: 'shield' },
        { id: 'meteor_punch', name: 'Meteor punch', school: 'strength', level: 2, cost: 3, desc: 'You leap, you fall, you punch.', effect: { kind: 'scene' }, combat: 'damage' },
        { id: 'fire_blast', name: 'Fire blast', school: 'elemental', level: 1, cost: 1, desc: 'A jet of flame.', effect: { kind: 'scene' }, combat: 'damage', element: 'fire' },
        { id: 'water_jet', name: 'Water jet', school: 'elemental', level: 1, cost: 1, desc: 'A blast of water: the foe is soaked (lightning hits it harder).', effect: { kind: 'scene' }, combat: 'damage', element: 'water' },
        { id: 'lightning_arc', name: 'Lightning arc', school: 'elemental', level: 2, cost: 3, desc: 'A crack of lightning. Stronger in the rain.', effect: { kind: 'scene' }, combat: 'damage', element: 'lightning' },
        { id: 'call_rain', name: 'Call rain', school: 'elemental', level: 2, cost: 2, desc: 'Clouds gather over the city for the day (water and lightning grow stronger, fire weaker).', effect: { kind: 'weather', to: 'rain' }, element: 'water' },
        { id: 'clear_skies', name: 'Clear skies', school: 'elemental', level: 2, cost: 2, desc: 'The clouds part for the day.', effect: { kind: 'weather', to: 'clear' } },
        { id: 'mind_spike', name: 'Mind spike', school: 'mind', level: 1, cost: 1, desc: 'A psychic jab.', effect: { kind: 'scene' }, combat: 'damage' },
        { id: 'force_field', name: 'Force field', school: 'mind', level: 1, cost: 2, desc: 'A shimmering bubble: +3 armor in a fight.', effect: { kind: 'scene' }, combat: 'shield' },
        { id: 'read_mind', name: 'Read a mind', school: 'mind', level: 1, cost: 1, desc: 'Your next Insight, Persuasion or Deception check rolls twice.', effect: { kind: 'advantage', skills: ['insight', 'persuasion', 'deception'] } },
        { id: 'calm_crowd', name: 'Calm the crowd', school: 'mind', level: 2, cost: 2, desc: 'A wave of calm over the neighborhood (tension down).', effect: { kind: 'calm', amount: 15 } },
        { id: 'purge', name: 'Psychic purge', school: 'mind', level: 2, cost: 2, desc: 'Clears poisons, burns and confusion from body and mind.', effect: { kind: 'cleanse' } },
    ],
    bestiary: [
        ...MODERN_RPG.bestiary!,
        { id: 'henchman', icon: '🦹', name: 'Masked henchman', level: 1, hp: 12, ac: 12, atk: 3, dice: 1, sides: 6, bonus: 2, row: 'front', tags: ['town', 'tower', 'road'], desc: 'Matching jumpsuits, questionable loyalty.' },
        { id: 'drone', icon: '🤖', name: 'Attack drone', element: 'lightning', inflict: { kind: 'slow', chance: 0.25, turns: 2 }, level: 2, hp: 14, ac: 14, atk: 4, dice: 1, sides: 8, bonus: 1, ranged: true, row: 'back', tags: ['town', 'tower'], desc: 'Buzzing, red-eyed, armed.' },
        { id: 'firestarter', icon: '🔥', name: 'Firestarter', element: 'fire', inflict: { kind: 'burn', chance: 0.35, turns: 3 }, level: 3, hp: 20, ac: 13, atk: 5, dice: 1, sides: 10, bonus: 2, ranged: true, row: 'back', tags: ['town', 'tower'], desc: 'A villain who just wants to watch it burn.' },
        { id: 'mesmer', icon: '🌀', name: 'Mesmerist', inflict: { kind: 'silence', chance: 0.35, turns: 2 }, level: 3, hp: 18, ac: 13, atk: 5, dice: 1, sides: 8, bonus: 2, ranged: true, row: 'back', tags: ['town', 'tower'], desc: 'Her voice gets into your head.' },
        { id: 'brute', icon: '🦍', name: 'Rampaging brute', inflict: { kind: 'slow', chance: 0.3, turns: 2 }, level: 4, hp: 38, ac: 13, atk: 6, dice: 2, sides: 8, bonus: 3, row: 'front', tags: ['town', 'road', 'tower'], desc: 'Grew too big for his shirt and his conscience.' },
        { id: 'mastermind', icon: '🎭', name: 'Masked mastermind', inflict: { kind: 'curse', chance: 0.3, turns: 3 }, level: 6, hp: 50, ac: 16, atk: 7, dice: 2, sides: 8, bonus: 4, row: 'back', ranged: true, tags: ['town', 'tower', 'boss'], desc: 'Always three plans ahead.' },
    ],
    talents: [
        ...MODERN_RPG.talents!,
        T('sp_feet', 'Light feet', '+2 initiative.', 1, 'initiative', 2, 'speedster'), T('sp_reflex', 'Reflexes', '+1 armor.', 2, 'armor', 1, 'speedster', ['sp_feet']), T('sp_mach', 'Mach punch', '+2 damage.', 3, 'damage', 2, 'speedster', ['sp_reflex']),
        T('po_bulk', 'Bulk', 'More hit points.', 1, 'hp', 8, 'powerhouse'), T('po_grip', 'Iron grip', '+1 to hit.', 2, 'attack', 1, 'powerhouse', ['po_bulk']), T('po_quake', 'Earthshaker', '+2 damage.', 3, 'damage', 2, 'powerhouse', ['po_grip']),
        T('el_core', 'Inner fire', '+2 power.', 1, 'focus', 2, 'elemental'), T('el_aim', 'Focused blasts', '+1 to hit.', 2, 'attack', 1, 'elemental', ['el_core']), T('el_storm', 'Living storm', '+2 damage.', 3, 'damage', 2, 'elemental', ['el_aim']),
        T('ps_mind', 'Open mind', '+2 power.', 1, 'focus', 2, 'psychic'), T('ps_read', 'Cold reading', '+2 Insight.', 2, 'skill', 2, 'psychic', ['ps_mind'], 'insight'), T('ps_crush', 'Mind crush', '+2 damage.', 3, 'damage', 2, 'psychic', ['ps_read']),
    ],
    titles: [...MODERN_RPG.titles, { id: 'hero', name: 'the City\'s Hero', desc: 'Earn 150 renown.', when: { renown: 150 } }, { id: 'super', name: 'the Unstoppable', desc: 'Use your powers 20 times.', when: { count: 'casts', n: 20 } }],
};

// The realm has gods when its pantheon has someone in it. Without them, faith classes take their secular name
// (a Cleric becomes a Healer, drawing on willpower) and faith attributes are hidden.
export const godsActive = (w: { realm?: { pantheon?: unknown[] } } | null | undefined) => !!w?.realm?.pantheon?.length;
const VIEW = new WeakMap<RpgDef, { key: string; v: RpgDef }>();
// (an arcane realm also makes every spell cost 1 less focus, never below 1)
// A game can be played with another RPG system than its world's (chosen when starting it; kept in the save as
// `rpgDef`): the open game's system wins for its own world. `withRpg` forces one while a game is being made.
let FORCED: RpgDef | null = null;
let GAME: () => { world?: string; rpgDef?: RpgDef } | null = () => null;
export const setRpgGame = (f: typeof GAME) => { GAME = f; };
export function withRpg<T>(def: RpgDef | null | undefined, fn: () => T): T {
    const was = FORCED; FORCED = def ?? null;
    try { return fn(); } finally { FORCED = was; }
}
const ownRpg = (w: { id?: string } | null | undefined): RpgDef | null => {
    if (FORCED) return FORCED;
    const g = GAME(); return g?.rpgDef?.classes?.length && w?.id && g.world === w.id ? g.rpgDef : null;
};
export const rpgOf = (w: { id?: string; rpg?: RpgDef; realm?: { pantheon?: unknown[]; power?: string } } | null | undefined): RpgDef | null => {
    const r = ownRpg(w) ?? (w?.rpg && w.rpg.classes?.length ? w.rpg : null);
    if (!r) return null;
    const gods = godsActive(w), arcane = w?.realm?.power === 'arcane';
    const faithy = r.classes.some(c => c.faith) || r.attributes.some(a => a.faith);
    if ((gods || !faithy) && !arcane) return r;
    const key = `${gods}|${arcane}`;
    const hit = VIEW.get(r);
    if (hit && hit.key === key) return hit.v;
    const v: RpgDef = { ...r,
        attributes: gods ? r.attributes : r.attributes.filter(a => !a.faith),
        classes: gods ? r.classes : r.classes.map(c => (c.faith && c.secular ? { ...c, name: c.secular } : c)),
        spells: arcane ? r.spells.map(sp => ({ ...sp, cost: Math.max(1, sp.cost - 1) })) : r.spells };
    VIEW.set(r, { key, v });
    return v;
};
