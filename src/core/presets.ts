// Style presets: what a world of each style starts with, as data. The engine reads only the world; a style is just
// the set of values a new world (or an older world that lacks a field) begins with. Everything here can be changed
// per world in the world creator.
import type { WorldDef, ActionDef, Crisis, HabitDef, FestivalDef, PetDef, FactionDef, RealmDef, InstitutionDef, GoodDef, CropDef, BusinessDef, RecipeDef, TowerDef, BladeDef } from './world.js';
import { MEDIEVAL_RPG, MODERN_RPG, type RpgDef } from './rpgdef.js';
import { upgradeTraits } from './traitlib.js';

export interface ShopItem { id: string; name: string; desc: string; icon: string; price: number;
    /** trips take this share of the time (0.5 = half); the best vehicle you own counts */ travel?: number;
    /** mood gained each morning you wake up at home */ sleepMood?: number }
export interface Breakable { id: string; name: string; blocks: string[] }
export interface Kinds { deviceLook: 'phone' | 'book'; socialKind: 'feed' | 'board'; messageKind: 'texts' | 'letters'; voice: string }

const roll = (dc: number, traits: string[], ok: string, okFx: Record<string, number> | null, okMoney: number | null, bad: string, badFx: Record<string, number>) =>
    ({ dc, traits, success: { text: ok, ...(okMoney ? { money: okMoney } : {}), ...(okFx ? { effects: okFx } : {}) }, fail: { text: bad, effects: badFx } });

export interface Preset { recipes?: RecipeDef[]; towers?: TowerDef[]; blades?: BladeDef[]; goods?: GoodDef[]; crops?: CropDef[]; businesses?: BusinessDef[]; skies?: WorldDef['skies']; climates?: Record<string, string>; institutions?: InstitutionDef[]; factions?: FactionDef[]; realm?: RealmDef; habits?: HabitDef[]; festivals?: FestivalDef[]; pets?: PetDef[]; rpg?: RpgDef; origins?: Record<string, { skills: string[]; feature: string; attributes?: Record<string, number> }>; kinds: Kinds; shop: ShopItem[]; actions: ActionDef[]; breakables: Breakable[]; repairCost: number; crises?: Record<string, Crisis> }
// What happens when a need stays at zero (the same idea in every style; only the words change).
const CRISES = (helper: string, water: string): Record<string, Crisis> => ({
    hunger: { after: 180, text: `You feel faint from hunger and nearly collapse. ${helper} helps you sit down and gives you something to eat.`, restore: 25, mood: -15, shame: 0, seen: '{u} nearly fainted from hunger at {0}.' },
    thirst: { after: 120, text: `Dizzy and dehydrated, you have to sit down. ${helper} hands you ${water}.`, restore: 25, mood: -10, shame: 0, seen: '{u} almost passed out from thirst at {0}.' },
    energy: { after: 0, text: '', seen: '{u} collapsed from exhaustion at {0}.' },
    hygiene: { after: 360, text: 'People step away from you, and someone says something about the smell. Your face burns.', mood: -15, shame: 5, seen: 'People at {0} kept away from {u}, who badly needed a wash.' },
    mood: { after: 240, text: 'Everything feels too heavy. You break down and have to go home.', place: 'home', restore: 25, shame: 0, seen: '{u} broke down at {0}.' },
});
export const PRESETS: Record<string, Preset> = {
    modern: {
        goods: [
            { id: 'beans', name: 'Coffee beans', icon: '☕', price: 8, kind: 'food', cheap: ['farms'], dear: ['finance'] },
            { id: 'produce', name: 'Fresh produce', icon: '🥕', price: 4, kind: 'food', cheap: ['farms'], dear: ['downtown'] },
            { id: 'seafood', name: 'Seafood', icon: '🦐', price: 12, kind: 'food', cheap: ['docks'], dear: ['mall'] },
            { id: 'electronics', name: 'Electronics', icon: '📱', price: 60, kind: 'goods', cheap: ['docks'], dear: ['campus'] },
            { id: 'fashion', name: 'Designer clothes', icon: '👗', price: 45, kind: 'cloth', cheap: ['mall'], dear: ['industrial'] },
            { id: 'sneakers', name: 'Counterfeit sneakers', icon: '👟', price: 30, kind: 'contraband', cheap: ['docks'], dear: ['mall'], illegal: true },
            { id: 'comics', name: 'Vintage comics', icon: '📚', price: 150, kind: 'rare', dear: ['campus'] },
            { id: 'camping_gear', name: 'Camping gear', icon: '⛺', price: 60, kind: 'gear' },
            { id: 'scrap', name: 'Scrap metal', icon: '⚙️', price: 6, kind: 'ore', cheap: ['industrial'], dear: ['finance'] },
            { id: 'supplies', name: 'Medical supplies', icon: '🧴', price: 10, kind: 'goods', cheap: ['hospital'], dear: ['industrial'] },
            { id: 'medkit', name: 'First aid kit', icon: '🩹', price: 30, kind: 'potion', cures: true },
            { id: 'scope', name: 'Red-dot sight', icon: '🎯', price: 90, kind: 'arms', socket: { slot: 'weapon', kind: 'attack', amount: 1 } },
            { id: 'weights', name: 'Weighted gloves', icon: '🥊', price: 70, kind: 'arms', socket: { slot: 'weapon', kind: 'damage', amount: 1 } },
            { id: 'kevlar', name: 'Kevlar plate', icon: '🦺', price: 120, kind: 'arms', socket: { slot: 'armor', kind: 'armor', amount: 1 } },
            { id: 'champion_belt', name: 'Champion\'s belt', icon: '🏆', price: 400, kind: 'rare' },
        ],
        recipes: [
            { id: 'medkit', name: 'First aid kit', needs: { supplies: 2 }, makes: 'medkit', skill: 'medicine', dc: 10, at: ['home', 'hospital'] },
            { id: 'knuckles', name: 'Weighted gloves', needs: { scrap: 3 }, makes: 'weights', skill: 'athletics', dc: 12, at: ['industrial', 'docks'] },
            { id: 'plate', name: 'Kevlar plate', needs: { scrap: 4, fashion: 1 }, makes: 'kevlar', skill: 'tech', dc: 13, at: ['industrial'], risky: true },
            { id: 'belt', name: 'A champion\'s belt of your own', needs: { scrap: 5, comics: 1 }, makes: 'champion_belt', skill: 'performance', dc: 15, at: ['stadium'], legendary: true },
        ],
        towers: [{ id: 'tower', name: 'The Abandoned Tower', place: 'industrial', floors: 50, tags: ['tower'], desc: 'a half-built skyscraper the gangs took over, floor by floor' }],
        crops: [
            { id: 'tomatoes', name: 'Tomatoes', icon: '🍅', days: 5, seed: 5, good: 'produce', yield: 6 },
            { id: 'beans', name: 'Coffee plant', icon: '☕', days: 10, seed: 20, good: 'beans', yield: 5 },
        ],
        businesses: [
            { id: 'foodtruck', name: 'Food truck', icon: '🚚', cost: 3000, profit: 120, staff: 2, tags: ['food', 'leisure'] },
            { id: 'cart', name: 'Coffee cart', icon: '☕', cost: 1200, profit: 50, staff: 1, tags: ['food', 'work'] },
            { id: 'boutique', name: 'Boutique', icon: '👗', cost: 6000, profit: 220, staff: 3, tags: ['shop'] },
            { id: 'repair', name: 'Repair shop', icon: '🔧', cost: 2500, profit: 90, staff: 2, tags: ['work'] },
        ],
        climates: { city: 'coastal' },
        skies: {
            events: [{ id: 'eclipse', name: 'Solar eclipse', desc: 'the city stops to look up at a dark sun', every: 40, days: 1, effect: 'omen', amount: 3 }],
            hazards: [
                { id: 'heatwave', name: 'Heatwave', desc: 'a record-breaking heat', climate: 'coastal', season: 'summer', chance: 0.3, drain: { thirst: 2, energy: 1.3 } },
                { id: 'hurricane', name: 'Hurricane warning', desc: 'shops board up their windows; everyone stays in', climate: 'coastal', season: 'autumn', chance: 0.06, drain: { mood: 1.5 }, closes: true },
            ],
        },
        institutions: [
            { id: 'uni', name: 'Porto Alto University', place: 'campus', ranks: ['Freshman', 'Class president', 'Professor', 'Dean'], tuition: 120, trait: 'Smart', examEvery: 7, clubs: ['Chess club', 'Theater club', 'Debate society'], desc: 'lecture halls, labs and a famous library' },
            { id: 'high', name: 'City High School', place: 'school', ranks: ['Student', 'Class president', 'Teacher', 'Principal'], tuition: 0, trait: 'Curious', examEvery: 7, clubs: ['School band', 'Science club', 'Football team'] },
        ],
        realm: { government: 'republic', leadership: 'An elected mayor and city council', power: 'balanced', pantheon: [] },
        factions: [
            { id: 'cityhall', name: 'City Hall', kind: 'government', desc: 'the mayor, the council and the city\'s officials', hq: 'civic', ranks: ['Volunteer', 'Staffer', 'Advisor', 'Deputy mayor'], jobs: ['clerk', 'stationagent'], beats: 'saints', rivals: ['saints'], quota: 2 },
            { id: 'halcyon', name: 'Halcyon Corp', kind: 'corporation', desc: 'the tech giant in the financial district', hq: 'finance', ranks: ['Intern', 'Associate', 'Director', 'CEO'], jobs: ['analyst', 'developer'], beats: 'cityhall', dues: 0, quota: 2, joinRep: 10 },
            { id: 'union', name: 'Dockworkers\' Union', kind: 'union', desc: 'the workers of the port, proud and loud', hq: 'docks', ranks: ['Member', 'Shop steward', 'Organizer', 'Union boss'], jobs: ['dockworker', 'mechanic', 'engineer'], allies: ['cityhall'], rivals: ['halcyon'], dues: 5, quota: 1 },
            { id: 'saints', name: 'The Saints', kind: 'gang', desc: 'a street gang that runs the industrial zone at night', hq: 'industrial', ranks: ['Lookout', 'Runner', 'Lieutenant', 'Boss'], beats: 'halcyon', rivals: ['cityhall'], secret: true, quota: 2 },
            { id: 'society', name: 'Campus Society', kind: 'club', desc: 'students and scholars with old traditions', hq: 'campus', ranks: ['Pledge', 'Member', 'Officer', 'President'], jobs: ['librarian', 'researcher', 'teacher'], quota: 1 },
        ],
        habits: [
            { id: 'early', name: 'Early riser', trait: 'Early riser', desc: 'Up and doing things before 8, five days in a week.', hours: [5, 8], count: 5, days: 7, daily: { energy: 3 } },
            { id: 'owl', name: 'Night owl', trait: 'Night owl', desc: 'Out and about after midnight, four times in a week.', hours: [0, 4], count: 4, days: 7 },
            { id: 'coffee', name: 'Coffee addict', trait: 'Coffee addict', desc: 'Coffee eight times in a week.', actions: ['coffee', 'x-coffee'], count: 8, days: 7, daily: { mood: -2 } },
            { id: 'fit', name: 'Fitness buff', trait: 'Athletic', desc: 'Working out or running five times in ten days.', actions: ['x-workout', 'x-run', 'x-treadmill'], count: 5, days: 10, daily: { mood: 2 } },
            { id: 'party', name: 'Party animal', trait: 'Nightlife', desc: 'Drinks out six times in a week.', actions: ['drink'], count: 6, days: 7, daily: { energy: -3 } },
            { id: 'chef', name: 'Home chef', trait: 'Good cook', desc: 'Cooking at home five times in a week.', actions: ['cook'], count: 5, days: 7 },
            { id: 'clean', name: 'Neat freak', trait: 'Tidy', desc: 'Showering every day for a week.', actions: ['shower', 'gymshower'], count: 7, days: 7 },
        ],
        festivals: [
            { id: 'spring', name: 'Spring Street Fair', season: 'spring', day: 7, days: 1, place: 'downtown', prices: 1.1, mood: 15, desc: 'food trucks, music and stalls fill downtown' },
            { id: 'summer', name: 'Summer Beach Festival', season: 'summer', day: 10, days: 2, place: 'beach', prices: 1.15, mood: 20, desc: 'concerts on the sand and fireworks at night' },
            { id: 'halloween', name: 'Halloween Night', season: 'autumn', day: 12, days: 1, place: 'downtown', prices: 1.05, mood: 15, desc: 'costumes, parties and trick-or-treating' },
            { id: 'newyear', name: 'New Year\'s Eve', season: 'winter', day: 14, days: 1, place: 'waterfront', prices: 1.2, mood: 25, desc: 'countdown and fireworks over the water' },
        ],
        pets: [
            { id: 'dog', name: 'Dog', icon: '🐕', price: 300, follows: true, mood: 4, desc: 'A loyal friend who walks with you everywhere.', where: ['mall'] },
            { id: 'cat', name: 'Cat', icon: '🐈', price: 150, mood: 3, desc: 'Waits for you at home (on your keyboard).', where: ['mall'] },
            { id: 'parrot', name: 'Parrot', icon: '🦜', price: 400, mood: 3, desc: 'Talks back. A lot.', where: ['mall'] },
            { id: 'horse', name: 'Horse', icon: '🐎', price: 2500, follows: true, mount: true, speed: 0.6, carry: 10, mood: 3, desc: 'Kept at the farms: ride along the coast road (trips take less time).', where: ['farms'] },
        ],
        rpg: MODERN_RPG,
        origins: {
            newcomer: { skills: ['survival', 'perception'], feature: 'Fresh eyes: you notice what locals stopped seeing.', attributes: { wis: 1, dex: 1 } },
            local: { skills: ['survival', 'persuasion'], feature: 'Born here: the neighborhood looks out for you.', attributes: { con: 1, cha: 1 } },
            student: { skills: ['history', 'investigation'], feature: 'Library card: campus resources and professors help you.', attributes: { int: 1, wis: 1 } },
            heir: { skills: ['persuasion', 'history'], feature: 'Old money: doors open, and so do wallets.', attributes: { cha: 1, int: 1 } },
        },
        crises: CRISES('A stranger', 'a bottle of water'),
        kinds: { deviceLook: 'phone', socialKind: 'feed', messageKind: 'texts', voice: 'casual; emoji and hashtags are fine' },
        shop: [
            { id: 'bed', name: 'King size bed', desc: 'Sleep better: you wake up in a better mood.', icon: '🛏️', price: 900, sleepMood: 10 },
            { id: 'coffee', name: 'Coffee machine', desc: 'Make coffee at home (energy).', icon: '☕', price: 250 },
            { id: 'car', name: 'Sports car', desc: 'Travel takes half the time.', icon: '🚗', price: 18000, travel: 0.5 },
            { id: 'bike', name: 'Bicycle', desc: 'Travel takes a quarter less time.', icon: '🚲', price: 450, travel: 0.75 },
            { id: 'pc', name: 'Gaming PC', desc: 'Freelance or stream from home.', icon: '🖥️', price: 2200 },
            { id: 'easel', name: 'Easel and paints', desc: 'Paint at home; a good painting sells.', icon: '🎨', price: 300 },
            { id: 'treadmill', name: 'Treadmill', desc: 'Work out at home.', icon: '🏃', price: 1200 },
        ],
        actions: [
            { id: 'x-tv', name: 'TV', label: 'Watch TV', icon: '📺', cost: 0, minutes: 60, home: true, effects: { mood: 6, energy: -2 } },
            { id: 'x-coffee', name: 'Coffee', label: 'Make coffee', icon: '☕', cost: 0, minutes: 10, home: true, needsItem: 'coffee', effects: { energy: 20, thirst: 5 } },
            { id: 'x-freelance', name: 'Freelance', label: 'Freelance on the computer', icon: '🖥️', cost: -70, minutes: 180, home: true, needsItem: 'pc', effects: { energy: -15, mood: -4, hygiene: -5 } },
            { id: 'x-paint', name: 'Painting', label: 'Paint something to sell', icon: '🎨', cost: 0, minutes: 120, home: true, needsItem: 'easel', effects: { energy: -10, mood: 6 },
                roll: roll(13, ['Creative', 'Skilled with hands'], 'Your painting sold quickly.', null, 110, 'Nobody wanted this one.', { mood: -6 }) },
            { id: 'x-treadmill', name: 'Treadmill', label: 'Run on the treadmill', icon: '🏃', cost: 0, minutes: 45, home: true, needsItem: 'treadmill', effects: { energy: -20, hygiene: -25, mood: 3 },
                roll: roll(9, ['Athletic', 'Strong', 'Sports'], 'A good run.', { mood: 5 }, null, 'You gave up halfway.', { mood: -2 }) },
            { id: 'x-gig', name: 'Quick gig', label: 'Do a quick gig: deliveries (2 h)', icon: '🛵', cost: -25, minutes: 120, tags: ['work'], effects: { energy: -15, hunger: -10, hygiene: -10 } },
            { id: 'x-workout', name: 'Workout', label: 'Work out at the gym', icon: '🏋️', cost: 15, minutes: 90, tags: ['sport'], effects: { energy: -25, hygiene: -30, mood: 4, thirst: -10 },
                roll: roll(9, ['Athletic', 'Strong', 'Sports'], 'A great workout.', { mood: 6 }, null, 'A sloppy workout; your heart was not in it.', { mood: -2 }) },
            { id: 'x-run', name: 'Run', label: 'Go for a run', icon: '👟', cost: 0, minutes: 40, tags: ['leisure'], notTags: ['sport'], effects: { energy: -15, hygiene: -20, mood: 6, thirst: -10 } },
        ] as ActionDef[],
        breakables: [
            { id: 'shower', name: 'the shower', blocks: ['shower', 'basin'] },
            { id: 'stove', name: 'the stove', blocks: ['cook'] },
            { id: 'sink', name: 'the kitchen sink', blocks: ['water'] },
        ],
        repairCost: 90,
    },
    medieval: {
        goods: [
            { id: 'grain', name: 'Grain', icon: '🌾', price: 4, kind: 'food', cheap: ['trigal', 'fields'], dear: ['eskarn', 'pedrafria', 'areia'] },
            { id: 'fish', name: 'Salted fish', icon: '🐟', price: 5, kind: 'food', cheap: ['mare_alta', 'sereno'], dear: ['pedrafria', 'areia'] },
            { id: 'venison', name: 'Venison', icon: '🍖', price: 8, kind: 'meat', cheap: ['kingdom', 'eskarn'], dear: ['lumeria'] },
            { id: 'furs', name: 'Furs', icon: '🦊', price: 18, kind: 'fur', cheap: ['eskarn'], dear: ['solmira'] },
            { id: 'iron', name: 'Iron ore', icon: '🪨', price: 10, kind: 'ore', cheap: ['pedrafria'], dear: ['lumeria', 'sereno'] },
            { id: 'blades', name: 'Steel blades', icon: '⚔️', price: 35, kind: 'arms', cheap: ['hrafnborg', 'smithy'], dear: ['areia'] },
            { id: 'silk', name: 'Silk', icon: '🧵', price: 30, kind: 'cloth', cheap: ['lumeria', 'areia'], dear: ['eskarn', 'kingdom'] },
            { id: 'spices', name: 'Spices', icon: '🌶️', price: 25, kind: 'spice', cheap: ['areia'], dear: ['eskarn', 'kingdom'] },
            { id: 'salt', name: 'Salt', icon: '🧂', price: 6, kind: 'food', cheap: ['mare_alta', 'areia'], dear: ['pedrafria'] },
            { id: 'mead', name: 'Mead', icon: '🍯', price: 9, kind: 'drink', cheap: ['hrafnborg'], dear: ['solmira'] },
            { id: 'wine', name: 'Wine', icon: '🍷', price: 12, kind: 'drink', cheap: ['solmira'], dear: ['eskarn'] },
            { id: 'potion', name: 'Healing potion', icon: '🧪', price: 20, kind: 'potion', cheap: ['lumeria'], dear: ['vigilia', 'eskarn'] },
            { id: 'herbs', name: 'Herbs', icon: '🌿', price: 5, kind: 'herb', cheap: ['trigal'], dear: ['lumeria'] },
            { id: 'mandrake', name: 'Mandrake root', icon: '🥕', price: 25, kind: 'herb', dear: ['lumeria'] },
            { id: 'moonleaf', name: 'Moonleaf', icon: '🍃', price: 40, kind: 'contraband', cheap: ['areia'], dear: ['kingdom', 'eskarn'], illegal: true },
            { id: 'relic', name: 'Smuggled relic', icon: '🏺', price: 120, kind: 'relic', dear: ['lumeria'], illegal: true },
            { id: 'dragonscale', name: 'Dragon scale', icon: '🐉', price: 300, kind: 'rare', dear: ['lumeria'] },
            { id: 'camping_gear', name: 'Camping gear', icon: '⛺', price: 30, kind: 'gear' },
        ],
        crops: [
            { id: 'herbs', name: 'Herbs', icon: '🌿', days: 3, seed: 3, good: 'herbs', yield: 4 },
            { id: 'grain', name: 'Grain', icon: '🌾', days: 5, seed: 2, good: 'grain', yield: 6 },
            { id: 'mandrake', name: 'Mandrake', icon: '🥕', days: 6, seed: 12, good: 'mandrake', yield: 2 },
            { id: 'moonleaf', name: 'Moonleaf (illegal)', icon: '🍃', days: 7, seed: 15, good: 'moonleaf', yield: 3 },
        ],
        businesses: [
            { id: 'tavern', name: 'Tavern', icon: '🍺', cost: 400, profit: 25, staff: 3, tags: ['food', 'leisure'] },
            { id: 'stall', name: 'Market stall', icon: '🧺', cost: 150, profit: 10, staff: 1, tags: ['shop'] },
            { id: 'forge', name: 'Forge', icon: '🔨', cost: 300, profit: 18, staff: 2, tags: ['work'] },
            { id: 'apothecary', name: 'Apothecary', icon: '🧪', cost: 350, profit: 20, staff: 2, tags: ['service'] },
            { id: 'post', name: 'Trading post', icon: '⚖️', cost: 600, profit: 30, staff: 3, tags: ['shop'] },
        ],
        climates: { kingdom: 'temperate', eskarn: 'cold', solmira: 'hot', mare_alta: 'coastal', sereno: 'coastal' },
        skies: {
            events: [
                { id: 'manastorm', name: 'Mana storm', desc: 'the sky shimmers; magic flows freely: focus returns every morning', every: 23, days: 1, effect: 'mana' },
                { id: 'bloodmoon', name: 'Blood moon', desc: 'a red moon: beasts are bold, roads are deadly, shops stay shut in fear', every: 31, days: 1, effect: 'monsters' },
                { id: 'eclipse', name: 'Eclipse', desc: 'the sun goes dark at noon; folk whisper of bad omens', every: 41, days: 1, effect: 'omen', amount: 6 },
            ],
            hazards: [
                { id: 'blizzard', name: 'Blizzard', desc: 'snow and wind that freeze to the bone', climate: 'cold', season: 'winter', chance: 0.35, drain: { energy: 2, hunger: 1.5 }, blocksCamp: true },
                { id: 'coldsnap', name: 'Cold snap', desc: 'bitter cold', climate: 'cold', chance: 0.1, drain: { energy: 1.5 } },
                { id: 'heatwave', name: 'Heatwave', desc: 'a crushing heat', climate: 'hot', season: 'summer', chance: 0.35, drain: { thirst: 3, energy: 1.5 } },
                { id: 'sandstorm', name: 'Sandstorm', desc: 'walls of sand: the town shuts its doors', climate: 'hot', chance: 0.08, drain: { thirst: 2 }, blocksCamp: true, closes: true },
                { id: 'seastorm', name: 'Sea storm', desc: 'waves over the harbor walls; nobody sails', climate: 'coastal', season: 'autumn', chance: 0.25, drain: { energy: 1.3 }, closes: true },
            ],
        },
        institutions: [
            { id: 'arcanum', name: 'The Grand Arcanum', place: 'arcanum', ranks: ['Student', 'Prefect', 'Magister', 'Archmage'], tuition: 15, skill: 'arcana', trait: 'Literate', examEvery: 7, clubs: ['Circle of Stargazers', 'Duelling society'] },
            { id: 'runes', name: 'Academy of Runes', place: 'rune_academy', ranks: ['Student', 'Prefect', 'Rune master', 'High runecarver'], tuition: 10, skill: 'history', trait: 'Crafts', examEvery: 7, clubs: ['Skalds\' bench'] },
            { id: 'arms', name: 'Royal Academy of Arms', place: 'academy', ranks: ['Cadet', 'Cadet captain', 'Master-at-arms', 'Lord commandant'], tuition: 12, skill: 'athletics', trait: 'Swordplay', examEvery: 7, clubs: ['Jousting club'] },
            { id: 'warriors', name: 'Hall of Warriors', place: 'warrior_hall', ranks: ['Thrall-in-training', 'Shield-bearer', 'Champion', 'War-chief'], tuition: 6, skill: 'athletics', trait: 'Strong', examEvery: 7 },
            { id: 'duelists', name: 'Circle of Duelists', place: 'duel_circle', ranks: ['Novice', 'Second', 'Blade master', 'Grand master'], tuition: 12, skill: 'acrobatics', trait: 'Swordplay', examEvery: 7 },
            { id: 'navigators', name: 'Navigators\' and Merchants\' School', place: 'trade_school', ranks: ['Apprentice', 'Class head', 'Master', 'Rector'], tuition: 10, skill: 'persuasion', trait: 'Good with numbers', examEvery: 7, clubs: ['Cartographers\' guild'] },
            { id: 'commerce', name: 'School of Commerce', place: 'ar_school', ranks: ['Apprentice', 'Class head', 'Master merchant', 'Grand factor'], tuition: 10, skill: 'insight', trait: 'Good with numbers', examEvery: 7 },
            { id: 'rangers', name: 'Rangers\' Lodge', place: 'vg_lodge', ranks: ['Recruit', 'Pathfinder', 'Warden', 'Ranger-general'], tuition: 5, skill: 'survival', trait: 'Hunting', examEvery: 7 },
            { id: 'green', name: 'Circle of the Green', place: 'green_circle', ranks: ['Seedling', 'Sapling', 'Elder', 'Archdruid'], tuition: 4, skill: 'nature', trait: 'Herbs', examEvery: 7 },
            { id: 'seamages', name: 'Tower of the Sea Mages', place: 'ps_tower', ranks: ['Novice', 'Tide-reader', 'Storm-caller', 'Lord of the tides'], tuition: 12, skill: 'arcana', trait: 'Literate', examEvery: 7 },
        ],
        realm: { government: 'fractured', leadership: 'Three regional crowns: a king, a jarl-king and a sun queen', power: 'balanced', pantheon: [] },
        factions: [
            { id: 'crown', name: 'Crown of Valdoria', kind: 'kingdom', desc: 'the king of Valdoria and his knights', hq: 'castle', region: 'kingdom', ranks: ['Squire', 'Knight', 'Knight-captain', 'Lord marshal'], jobs: ['guard', 'steward', 'castlecook', 'tutor', 'armsmaster'], beats: 'hand', rivals: ['hand'], quota: 2, joinRep: 10 },
            { id: 'jarl', name: 'Jarl-King of Eskarn', kind: 'kingdom', desc: 'the jarl-king and his huscarls', hq: 'jarl_hall', region: 'eskarn', ranks: ['Carl', 'Huscarl', 'Thane', 'Jarl\'s hand'], jobs: ['runecarver', 'miner', 'scout'], quota: 2, joinRep: 10 },
            { id: 'sun', name: 'Sun Court of Solmira', kind: 'kingdom', desc: 'the sun queen and her court of mages', hq: 'sol_palace', region: 'solmira', ranks: ['Courtier', 'Sun knight', 'Vizier', 'Hand of the queen'], jobs: ['arcanist', 'trader', 'seamage'], quota: 2, joinRep: 10 },
            { id: 'adventurers', name: 'Adventurers\' Guild', kind: 'guild', desc: 'contracts, bounties and maps for those with steel and nerve', hq: 'advguild', ranks: ['Copper', 'Iron', 'Silver', 'Gold', 'Mythril'], dues: 5, quota: 2 },
            { id: 'arcanum', name: 'The Grand Arcanum', kind: 'order', desc: 'the greatest order of mages of the Three Crowns', hq: 'arcanum', region: 'lumeria', ranks: ['Novice', 'Adept', 'Magister', 'Archmage'], jobs: ['arcanist'], dues: 8, quota: 1, joinRep: 15 },
            { id: 'league', name: 'Merchants\' League', kind: 'guild', desc: 'the merchants who move goods and gold between the kingdoms', hq: 'trade_school', ranks: ['Clerk', 'Factor', 'Master merchant', 'Guildmaster'], jobs: ['merchant', 'customs', 'trader', 'porter'], beats: 'crown', rivals: ['hand'], dues: 6, quota: 1 },
            { id: 'hand', name: 'The Velvet Hand', kind: 'thieves\' guild', desc: 'thieves and smugglers who rule the docks after dark', hq: 'docks', ranks: ['Footpad', 'Cutpurse', 'Shadow', 'Guildmaster'], beats: 'league', rivals: ['crown', 'league'], secret: true, quota: 2 },
        ],
        habits: [
            { id: 'early', name: 'Early riser', trait: 'Early riser', desc: 'Up and working before 8, five days in a week.', hours: [5, 8], count: 5, days: 7, daily: { energy: 3 } },
            { id: 'owl', name: 'Night owl', trait: 'Night owl', desc: 'Up after midnight, four times in a week.', hours: [0, 4], count: 4, days: 7 },
            { id: 'drinker', name: 'Heavy drinker', trait: 'Heavy drinker', desc: 'Ale six times in a week.', actions: ['ale'], count: 6, days: 7, daily: { mood: -2, energy: -2 } },
            { id: 'devout', name: 'Devout', trait: 'Devout', desc: 'Praying four times in a week.', actions: ['pray'], count: 4, days: 7, daily: { mood: 2 } },
            { id: 'minstrel', name: 'Street minstrel', trait: 'Musical', desc: 'Busking five times in ten days.', actions: ['busk'], count: 5, days: 10 },
            { id: 'angler', name: 'Angler', trait: 'Fishing', desc: 'Fishing five times in ten days.', actions: ['fish'], count: 5, days: 10 },
            { id: 'clean', name: 'Fastidious', trait: 'Tidy', desc: 'A bath or a wash every day for a week.', actions: ['bath', 'basin'], count: 7, days: 7 },
        ],
        festivals: [
            { id: 'spring', name: 'Spring Fair', season: 'spring', day: 7, days: 1, place: 'square', prices: 1.1, mood: 15, desc: 'jugglers, ribbons and stalls in the market square' },
            { id: 'midsummer', name: 'Midsummer Night', season: 'summer', day: 10, days: 1, place: 'green', prices: 1.05, mood: 20, desc: 'bonfires, dancing and songs until dawn' },
            { id: 'harvest', name: 'Harvest Festival', season: 'autumn', day: 7, days: 2, place: 'square', prices: 0.9, mood: 20, desc: 'the harvest is in: cheap bread, cider and contests of strength' },
            { id: 'midwinter', name: 'Midwinter Feast', season: 'winter', day: 12, days: 1, place: 'tavern', prices: 1.2, mood: 25, desc: 'roast meat, candles and gifts on the longest night' },
        ],
        pets: [
            { id: 'dog', name: 'Hound', icon: '🐕', price: 40, follows: true, mood: 4, desc: 'A loyal hound that walks at your side.', where: ['square', 'market'] },
            { id: 'cat', name: 'Cat', icon: '🐈', price: 15, mood: 3, desc: 'Keeps the mice away; waits for you at home.', where: ['square', 'market'] },
            { id: 'owl', name: 'Owl familiar', icon: '🦉', price: 120, follows: true, familiar: true, mood: 2, skill: 'arcana', bonus: 2, desc: 'A wise owl bound to your magic: +2 on Arcana.', where: ['arcan', 'academy', 'rune', 'tower'] },
            { id: 'raven', name: 'Raven familiar', icon: '🐦‍⬛', price: 90, follows: true, familiar: true, mood: 1, skill: 'perception', bonus: 2, desc: 'Sees everything: +2 on Perception.', where: ['market', 'bazaar'] },
            { id: 'shadowcat', name: 'Shadow cat (exotic)', icon: '🐈‍⬛', price: 150, follows: true, familiar: true, mood: 2, skill: 'stealth', bonus: 2, desc: 'An exotic cat that walks unseen: +2 on Stealth. Sold under the counter.', where: ['bazaar', 'docks'] },
        ],
        rpg: MEDIEVAL_RPG,
        origins: {
            traveler: { skills: ['survival', 'athletics'], feature: 'Wanderer: you always find food and a dry place to sleep on the road.', attributes: { con: 1, wis: 1 } },
            peasant: { skills: ['animals', 'survival'], feature: 'Folk hero: common folk take you in and keep your secrets.', attributes: { str: 1, con: 1 } },
            merchant: { skills: ['insight', 'persuasion'], feature: 'Guild member: the guilds know your family name.', attributes: { int: 1, cha: 1 } },
            noble: { skills: ['history', 'persuasion'], feature: 'Position of privilege: people of rank receive you.', attributes: { cha: 1, int: 1 } },
        },
        crises: CRISES('A passer-by', 'a cup of water'),
        kinds: { deviceLook: 'book', socialKind: 'board', messageKind: 'letters', voice: 'in the voice of the time (no modern things)' },
        shop: [
            { id: 'bed', name: 'Feather bed', desc: 'Sleep better: you wake up in a better mood.', icon: '🛏️', price: 60, sleepMood: 10 },
            { id: 'horse', name: 'Horse', desc: 'Travel takes half the time.', icon: '🐎', price: 400, travel: 0.5 },
            { id: 'mule', name: 'Mule', desc: 'Travel takes a quarter less time.', icon: '🐴', price: 150, travel: 0.75 },
            { id: 'loom', name: 'Loom', desc: 'Weave cloth at home and sell it.', icon: '🧶', price: 120 },
            { id: 'easel', name: 'Easel and paints', desc: 'Paint at home; a good painting sells.', icon: '🎨', price: 80 },
        ],
        actions: [
            { id: 'x-tv', name: 'Hearth', label: 'Sit by the fire', icon: '🔥', cost: 0, minutes: 60, home: true, effects: { mood: 5, energy: -2 } },
            { id: 'x-weave', name: 'Weaving', label: 'Weave cloth to sell', icon: '🧶', cost: -8, minutes: 180, home: true, needsItem: 'loom', effects: { energy: -15, mood: -3 } },
            { id: 'x-paint', name: 'Painting', label: 'Paint something to sell', icon: '🎨', cost: 0, minutes: 120, home: true, needsItem: 'easel', effects: { energy: -10, mood: 6 },
                roll: roll(13, ['Creative', 'Skilled with hands'], 'Your painting sold quickly.', null, 12, 'Nobody wanted this one.', { mood: -6 }) },
            { id: 'x-gig', name: 'Carrying loads', label: 'Carry loads for a few coins (2 h)', icon: '📦', cost: -3, minutes: 120, tags: ['work'], effects: { energy: -15, hunger: -10, hygiene: -10 } },
            { id: 'x-workout', name: 'Training', label: 'Train in the yard', icon: '🏋️', cost: 0, minutes: 90, tags: ['sport'], effects: { energy: -25, hygiene: -30, mood: 4, thirst: -10 },
                roll: roll(9, ['Athletic', 'Strong', 'Sports'], 'A great workout.', { mood: 6 }, null, 'A sloppy workout; your heart was not in it.', { mood: -2 }) },
            { id: 'x-run', name: 'Run', label: 'Go for a run', icon: '👟', cost: 0, minutes: 40, tags: ['leisure'], notTags: ['sport'], effects: { energy: -15, hygiene: -20, mood: 6, thirst: -10 } },
        ] as ActionDef[],
        breakables: [
            { id: 'shower', name: 'the washbasin', blocks: ['shower', 'basin'] },
            { id: 'stove', name: 'the hearth', blocks: ['cook'] },
            { id: 'sink', name: 'the water barrel', blocks: ['water'] },
        ],
        repairCost: 8,
    },
};
const styleId = (w: WorldDef) => (w.style ?? ((w.kind || '').toLowerCase().includes('modern') ? 'modern' : (w.kind || 'modern').toLowerCase()));
export const presetOf = (w: WorldDef): Preset => PRESETS[styleId(w)] ?? PRESETS.modern;

// Fills what a world lacks from its style's preset (older worlds, and worlds made before these were editable).
// Safe to run again: only what is missing is added; nothing the world has is changed.
export function upgradeWorld(w: WorldDef): WorldDef {
    const p = presetOf(w);
    const c = (w.catalogs ??= {} as any) as any;
    c.shop ??= structuredClone(p.shop);
    const f = (w.features ??= {});
    const k = f as any;
    k.deviceLook ??= p.kinds.deviceLook; k.socialKind ??= p.kinds.socialKind; k.messageKind ??= p.kinds.messageKind;
    const ai = ((w as any).ai ??= {});
    ai.voice ??= p.kinds.voice;
    // the actions the engine used to add by itself are the world's own now
    if (!(w as any).presetActions) {
        for (const a of p.actions) if (!w.actions.some(x => x.id === a.id)) w.actions.push(structuredClone(a));
        (w as any).presetActions = true;
    }
    const h = w.homes as any;
    h.breakables ??= structuredClone(p.breakables);
    h.repairCost ??= p.repairCost;
    // the RPG (attributes, classes, magic…) and what each background gives in it, once (the creator can change it)
    if (!(w as any).presetRpg) {
        if (p.rpg && !w.rpg) w.rpg = structuredClone(p.rpg);
        for (const o of w.catalogs?.origins ?? []) { const x = p.origins?.[o.id]; if (x) { o.skills ??= [...x.skills]; o.feature ??= x.feature; if (x.attributes && !o.attributes) o.attributes = { ...x.attributes }; } }
        (w as any).presetRpg = true;
    }
    // the economy and the skies: once
    if (!(w as any).presetEconomy) {
        if (p.goods && !w.goods) w.goods = structuredClone(p.goods);
        if (p.crops && !w.crops) w.crops = structuredClone(p.crops);
        if (p.businesses && !w.businesses) w.businesses = structuredClone(p.businesses);
        if (p.skies && !w.skies) w.skies = structuredClone(p.skies);
        for (const [id, c] of Object.entries(p.climates ?? {})) { const m = w.maps?.find(x => x.id === id); if (m && !m.climate) m.climate = c; }
        (w as any).presetEconomy = true;
    }
    // schools and academies: once
    if (!(w as any).presetSchools) {
        if (p.institutions && !w.institutions) w.institutions = structuredClone(p.institutions).filter(i => w.places.some(x => x.id === i.place));
        if (p.rpg && w.rpg && !w.rpg.talents) w.rpg.talents = structuredClone(p.rpg.talents ?? []);
        (w as any).presetSchools = true;
    }
    // factions and the realm: once for a world made before them
    if (!(w as any).presetRealm) {
        if (p.factions && !w.factions) w.factions = structuredClone(p.factions).filter(f => !f.hq || w.places.some(x => x.id === f.hq));
        if (p.realm && !w.realm) w.realm = structuredClone(p.realm);
        (w as any).presetRealm = true;
    }
    // habits, festivals and animals: once for a world made before them (removed ones stay removed)
    if (!(w as any).presetLife2) {
        if (p.habits && !w.habits) w.habits = structuredClone(p.habits);
        if (p.festivals && !w.festivals) w.festivals = structuredClone(p.festivals).filter(f => !f.place || w.places.some(x => x.id === f.place));
        if (p.pets && !w.pets) w.pets = structuredClone(p.pets);
        (w as any).presetLife2 = true;
    }
    // combat (phase 6): class arms and abilities, the bestiary, sellswords, once for an RPG made before it
    if (!(w as any).presetCombat) {
        if (p.rpg && w.rpg) {
            for (const c of w.rpg.classes ?? []) { const d = p.rpg.classes.find(x => x.id === c.id); if (!d) continue; c.armor ??= d.armor; if (d.weapon && !c.weapon) c.weapon = { ...d.weapon }; if (d.ability && !c.ability) c.ability = { ...d.ability }; }
            if (!w.rpg.bestiary) w.rpg.bestiary = structuredClone(p.rpg.bestiary ?? []);
            w.rpg.mercNames ??= [...(p.rpg.mercNames ?? [])];
            w.rpg.mercWage ??= p.rpg.mercWage;
        }
        (w as any).presetCombat = true;
    }
    // adventure (crafting, towers, sentient weapons, mounts) and an RPG for a world made before its style had one: once
    if (!(w as any).presetAdventure) {
        if (p.rpg && !w.rpg) { w.rpg = structuredClone(p.rpg); for (const o of w.catalogs?.origins ?? []) { const x = p.origins?.[o.id]; if (x) { o.skills ??= [...x.skills]; o.feature ??= x.feature; if (x.attributes && !o.attributes) o.attributes = { ...x.attributes }; } } }
        if (p.recipes && !w.recipes) w.recipes = structuredClone(p.recipes);
        if (p.towers && !w.towers) w.towers = structuredClone(p.towers).filter(t => w.places.some(x => x.id === t.place));
        if (p.blades && !w.blades) w.blades = structuredClone(p.blades);
        if (w.goods) for (const x of p.goods ?? []) if ((x.socket || x.cures || x.kind === 'potion' || x.kind === 'sentient' || (p.recipes ?? []).some(r => r.makes === x.id || x.id in r.needs)) && !w.goods.some(y => y.id === x.id)) w.goods.push(structuredClone(x));
        if (w.pets) for (const x of p.pets ?? []) if (x.mount && !w.pets.some(y => y.id === x.id)) w.pets.push(structuredClone(x));
        (w as any).presetAdventure = true;
    }
    // crises at zero (an older world gets them once; one removed in the creator stays removed)
    if (!(w as any).presetCrises) {
        for (const s of w.statuses ?? []) {
            const c = p.crises?.[s.id];
            if (!c || s.zero?.crisis) continue;
            s.zero = { ...(s.zero ?? {}), crisis: structuredClone(c) };
        }
        (w as any).presetCrises = true;
    }
    // weapon skills, crafts and weapons to choose (any class can learn them): once for an RPG made before them
    if (!(w as any).presetSkills2) {
        if (p.rpg && w.rpg) {
            const attrs = new Set(w.rpg.attributes.map(a => a.id));
            for (const k of p.rpg.skills) if (attrs.has(k.attr) && !w.rpg.skills.some(x => x.id === k.id)) w.rpg.skills.push({ ...k });
            w.rpg.weapons ??= structuredClone(p.rpg.weapons ?? []).filter(x => attrs.has(x.attr));
            for (const c of w.rpg.classes ?? []) { const d = p.rpg.classes.find(x => x.id === c.id); if (c.weapon && d?.weapon?.skill && c.weapon.name === d.weapon.name) c.weapon.skill ??= d.weapon.skill; }
        }
        (w as any).presetSkills2 = true;
    }
    // the bigger trait lists, Flaws, and no limit on how many you pick: once (the creator can change them after)
    if (!(w as any).presetTraits2) {
        if (w.sheet) w.sheet.traits = upgradeTraits(w.sheet.traits, p === PRESETS.medieval || (w.sheet.traits ?? []).some(g => g.options?.includes('Literate')));
        (w as any).presetTraits2 = true;
    }
    return w;
}
