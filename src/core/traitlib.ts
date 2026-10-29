// The standard trait lists (Proficiency, Personality, Interests, Flaws): what every world of a style offers when
// making a character. A world keeps its own options first; these fill in the rest, and a world made before Flaws gets
// them. No group has a limit unless the world maker sets one.
import type { TraitGroup } from './world.js';

const PERSONALITY = ['Outgoing', 'Shy', 'Calm', 'Hot-headed', 'Cheerful', 'Serious', 'Romantic', 'Ambitious', 'Lazy', 'Curious', 'Sarcastic', 'Kind',
    'Brave', 'Cautious', 'Honest', 'Loyal', 'Playful', 'Witty', 'Patient', 'Stoic', 'Gentle', 'Bold', 'Confident', 'Humble', 'Proud', 'Optimistic',
    'Pessimistic', 'Mischievous', 'Thoughtful', 'Adventurous', 'Disciplined', 'Easygoing', 'Empathetic', 'Independent', 'Protective', 'Quiet',
    'Talkative', 'Energetic', 'Dreamy', 'Practical', 'Flirty', 'Mysterious', 'Polite', 'Competitive', 'Generous', 'Rebellious', 'Wise', 'Goofy'];

const FLAWS = ['Stubborn', 'Impatient', 'Jealous', 'Cowardly', 'Reckless', 'Gullible', 'Forgetful', 'Vain', 'Clumsy', 'Bad liar', 'Short-tempered',
    'Greedy', 'Arrogant', 'Insecure', 'Indecisive', 'Naive', 'Paranoid', 'Possessive', 'Selfish', 'Rude', 'Messy', 'Overthinker', 'People-pleaser',
    'Workaholic', 'Gambler', 'Easily distracted', 'Bad with money', 'Sore loser', 'Nosy', 'Blunt', 'Holds grudges', 'Overprotective', 'Secretive',
    'Moody', 'Clingy', 'Afraid of heights', 'Afraid of the dark', 'Squeamish', 'Night owl', 'Picky eater', 'Sweet tooth', 'Hates mornings'];

const MODERN = {
    proficiency: ['Strong', 'Smart', 'Charming', 'Creative', 'Athletic', 'Handy', 'Musical', 'Good with numbers', 'Good cook', 'Tech-savvy',
        'Fast learner', 'Good memory', 'Good listener', 'Persuasive', 'Leader', 'Organized', 'Observant', 'Quick reflexes', 'Tough', 'Flexible',
        'Artistic', 'Good with kids', 'Good with animals', 'Green thumb', 'Good driver', 'Good fighter', 'Good shot', 'First aid', 'Speaks many languages',
        'Good writer', 'Dancer', 'Singer', 'Actor', 'Negotiator', 'Business sense', 'Hacker', 'Mechanic', 'Stealthy', 'Street-smart', 'Lucky'],
    interests: ['Sports', 'Music', 'Games', 'Books', 'Cooking', 'Fashion', 'Technology', 'Nature', 'Art', 'Movies', 'Nightlife', 'Travel',
        'Fitness', 'Dancing', 'Photography', 'Anime', 'Comics', 'History', 'Science', 'Space', 'Cars', 'Animals', 'Gardening', 'Writing', 'Poetry',
        'Theater', 'Politics', 'Philosophy', 'Religion', 'Martial arts', 'Hiking', 'Camping', 'Fishing', 'Board games', 'Puzzles', 'Collecting',
        'Shopping', 'Volunteering', 'Languages', 'Food', 'Coffee', 'Partying', 'Social media', 'Streaming', 'Mythology', 'The occult', 'Crafts'],
    flaws: ['Glued to their phone', 'Procrastinator'],
};
const MEDIEVAL = {
    proficiency: ['Strong', 'Literate', 'Charming', 'Skilled with hands', 'Good cook', 'Good with animals', 'Quick', 'Devout', 'Musical', 'Good with numbers',
        'Swordsman', 'Archer', 'Rider', 'Tracker', 'Healer', 'Herbalist', 'Smith', 'Hunter', 'Sailor', 'Tough', 'Observant', 'Persuasive', 'Leader',
        'Stealthy', 'Lucky', 'Fast learner', 'Good memory', 'Storyteller', 'Dancer', 'Singer', 'Haggler', 'Brewer', 'Tailor', 'Carpenter', 'Climber',
        'Swimmer', 'Speaks many tongues', 'Learned in lore', 'Street-smart'],
    interests: ['Music', 'Swordplay', 'Riding', 'Hunting', 'Herbs', 'Reading', 'Dancing', 'Cards and dice', 'Fishing', 'Faith', 'Crafts', 'Travel',
        'Archery', 'Falconry', 'Poetry', 'Songs and ballads', 'History', 'Legends', 'Magic', 'Alchemy', 'The stars', 'Feasting', 'Ale and wine',
        'Tournaments', 'Chess', 'Gardening', 'Animals', 'Sailing', 'Maps', 'Fine clothes', 'Gossip', 'Politics', 'Painting', 'Woodcarving', 'Cooking',
        'Brawling', 'Treasure', 'Nature'],
    flaws: ['Superstitious', 'Illiterate'],
};

const OLD_MAX: Record<string, number> = { proficiency: 2, personality: 3, interests: 3 };
const union = (a: string[], b: string[]) => { const seen = new Set(a.map(x => x.toLowerCase())); return [...a, ...b.filter(x => !seen.has(x.toLowerCase()))]; };

// The standard groups for a world (medieval or not).
export function standardTraits(medieval: boolean): TraitGroup[] {
    const s = medieval ? MEDIEVAL : MODERN;
    return [
        { id: 'proficiency', label: 'Proficiency', options: [...s.proficiency] },
        { id: 'personality', label: 'Personality', options: [...PERSONALITY] },
        { id: 'interests', label: 'Interests', options: [...s.interests] },
        { id: 'flaws', label: 'Flaws', options: [...FLAWS, ...s.flaws] },
    ];
}

// Brings a world's trait groups up to the standard lists: more options in the standard groups, Flaws added to a
// world that has the standard three, and the old limits (2, 3, 3) lifted. A limit the maker changed stays.
export function upgradeTraits(groups: TraitGroup[] | undefined, medieval: boolean): TraitGroup[] | undefined {
    if (!groups) return groups;
    const std = standardTraits(medieval);
    for (const g of groups) {
        const s = std.find(x => x.id === g.id);
        if (!s) continue;
        g.options = union(g.options ?? [], s.options);
        if (g.max === OLD_MAX[g.id]) delete g.max;
    }
    if (['proficiency', 'personality', 'interests'].every(id => groups.some(g => g.id === id)) && !groups.some(g => g.id === 'flaws'))
        groups.push(std.find(x => x.id === 'flaws')!);
    return groups;
}

// How many a group allows (0: no limit).
export const traitMax = (g: TraitGroup) => (g.max && g.max > 0 ? g.max : 0);
