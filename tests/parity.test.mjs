// Parity: everything a built-in world has can be made in the world creator. Every field of worlds/*/world.json must be
// either a field the creator shows (any tab, any item selected) or edited by one of the creator's tools (TOOLS).
// A new field nobody can edit fails the build. Run: node tests/parity.test.mjs [repo root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage, browser, world } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? path.join(here, '..');
const ext = stage(root, 'parity'); browser({});
const D = (p) => import(`${ext}/dist/${p}`);
const W = await D('core/world.js'); const store = await D('core/store.js'); const cw = await D('ui/creator.js');
store.state.view = 'creator';

// Keys that are names chosen by the world, not fields: they become "*".
const DYNAMIC = [/^homes\.kinds\.[^.]+/, /^cast\.routineTemplates\.[^.]+/, /^lexicon\.[^.]+/, /^music\.[^.]+/, /^sleep\.restore\.[^.]+/,
    /^actions\.\*\.effects\.[^.]+/, /^occupations\.\*\.cost\.[^.]+/, /^occupations\.\*\.requires\.[^.]+/, /^homes\.kinds\.\*\.bills\.[^.]+/, /^catalogs\.origins\.\*\.attributes\.[^.]+/,
    /^actions\.\*\.roll\.(success|fail)\.effects\.[^.]+/, /^cast\.routineTemplates\.\*\.(weekday|weekend)/];
const norm = (p) => { let s = p.replace(/\.\d+(?=\.|$)/g, '.*'); for (const re of DYNAMIC) s = s.replace(re, m => m.replace(/[^.]+$/, '*')); return s; };
const leaves = (o, at = '') => (o === null || typeof o !== 'object' ? [at] : Array.isArray(o) ? o.flatMap((x, i) => leaves(x, `${at}.${i}`)) : Object.keys(o).length ? Object.entries(o).flatMap(([k, v]) => leaves(v, at ? `${at}.${k}` : k)) : [at]);

// Fields edited by the creator's own tools rather than a form field (and why).
const TOOLS = {
    'format': 'set by the creator', 'id': 'set by the creator', 'version': 'set by the creator', 'kind': 'the style picked at the start', 'base': 'set by the loader', 'i18n': 'set by the loader',
    'presetActions': 'set when the preset actions are added', 'presetRpg': 'set when the preset RPG is added',
    'rpg.attributes.*.id': 'set by the creator', 'rpg.skills.*.id': 'set by the creator', 'rpg.classes.*.id': 'set by the creator', 'rpg.classes.*.subclasses.*.id': 'set by the creator',
    'rpg.schools.*.id': 'set by the creator', 'rpg.spells.*.id': 'set by the creator', 'rpg.titles.*.id': 'set by the creator', 'rpg.bestiary.*.id': 'set by the creator', 'presetCombat': 'set when the preset combat data is added', 'presetLife2': 'set when the preset habits, festivals and animals are added', 'habits.*.id': 'set by the creator', 'festivals.*.id': 'set by the creator', 'cityEvents.*.id': 'set by the creator', 'hobbies.*.id': 'set by the creator', 'pets.*.id': 'set by the creator', 'factions.*.id': 'set by the creator', 'realm.pantheon.*.id': 'set by the creator', 'institutions.*.id': 'set by the creator', 'goods.*.id': 'set by the creator', 'crops.*.id': 'set by the creator', 'businesses.*.id': 'set by the creator', 'skies.events.*.id': 'set by the creator', 'skies.hazards.*.id': 'set by the creator', 'presetEconomy': 'set when the preset economy and skies are added', 'rpg.talents.*.id': 'set by the creator', 'presetSchools': 'set when the preset schools and talents are added', 'presetRealm': 'set when the preset factions and realm are added', 'realm.pantheon': 'the Pantheon list (Realm & factions)', 'presetCrises': 'set when the preset crises are added', 'presetSkills2': 'set when the weapon skills, crafts and weapons are added', 'presetTraits2': 'set when the bigger trait lists are added', 'presetRevive': 'set when the ways to bring someone back are added', 'presetAdventure': 'set when the preset crafting, towers, weapons and mounts are added', 'recipes.*.id': 'set by the creator', 'towers.*.id': 'set by the creator', 'blades.*.id': 'set by the creator', 'cover': 'Choose a picture / Use the first map', 'mode': 'Game mode cards', 'retired': 'written by Mundi when a built-in world retires an id (not a creator field)',
    'plan.*': 'Maps & places › Floor plan: floors, their pictures, and the rooms drawn on them', 'maps.*': 'Maps & places: the map editor (add a map, picture, name, parent)', 'places.*': 'Maps & places: the map editor (pins, links, tags, background)',
    'homes.zones.*.spots': 'Place the homes on the map', 'homes.kinds.*.image': 'Inside picture (scene)', 'homes.zones.*.id': 'set by the creator',
    'statuses.*.id': 'set by the creator', 'actions.*.id': 'set by the creator', 'occupations.*.id': 'set by the creator', 'catalogs.origins.*.id': 'set by the creator',
    'catalogs.courses.*.id': 'set by the creator', 'occupations.*.branches.*.options.*.id': 'set by the creator', 'catalogs.shop.*.id': 'set by the creator', 'homes.expenses.*.id': 'set by the creator', 'homes.breakables.*.id': 'set by the creator',
    'actions.*.home': 'Where', 'actions.*.anywhere': 'Where', 'actions.*.place': 'Where', 'actions.*.tags': 'Where',
    'actions.*.roll': 'a d20 roll is part of the action system (not edited, by design)',
    'features.apps': 'the apps list (Features)', 'time.periods.*.id': 'set by the creator',
    'occupations.*.courses': 'Courses tab: Required for these jobs', 'occupations.*.likes': 'Jobs tab / Courses tab', 'cast.routineTemplates.*': 'Routines tab',
};
const covered = (leaf, shown) => shown.some(s => leaf === s || leaf.startsWith(`${s}.`)) || Object.keys(TOOLS).some(t => leaf === t || leaf.startsWith(`${t.replace(/\.\*$/, '')}.`) || leaf === t.replace(/\.\*$/, ''));

let fails = 0;
for (const id of ['modern', 'urban', 'medieval', 'house']) {
    const w = world(ext, id); W.registerWorld(w);
    cw.CW.w = structuredClone(w);
    const shown = new Set();
    const grab = () => { for (const m of cw.creatorHtml().matchAll(/data-path="([^"]+)"/g)) shown.add(norm(m[1])); };
    const lists = { needs: 'statuses', actions: 'actions', jobs: 'occupations', zones: 'homes.zones', origins: 'catalogs.origins', people: 'cast.examples', lore: 'lore', courses: 'catalogs.courses', shop: 'catalogs.shop', expenses: 'homes.expenses', breakables: 'homes.breakables', rattr: 'rpg.attributes', rskill: 'rpg.skills', rclass: 'rpg.classes', rschool: 'rpg.schools', rspell: 'rpg.spells', rtitle: 'rpg.titles', rfoe: 'rpg.bestiary', habit: 'habits', festival: 'festivals', cevent: 'cityEvents', hobby: 'hobbies', pet: 'pets', god: 'realm.pantheon', faction: 'factions', inst: 'institutions', rtal: 'rpg.talents', good: 'goods', recipe: 'recipes', tower: 'towers', blade: 'blades', crop: 'crops', biz: 'businesses', sky: 'skies.events', hazard: 'skies.hazards' };
    for (const tab of ['general', 'features', 'needs', 'maps', 'homes', 'actions', 'jobs', 'courses', 'shop', 'words', 'character', 'rpg', 'customs', 'realm', 'economy', 'people', 'lore', 'books']) {
        cw.CW.tab = tab; grab();
        for (const [key, p] of Object.entries(lists)) { const n = (p.split('.').reduce((o, k) => o?.[k], cw.CW.w) ?? []).length; for (let i = 0; i < n; i++) { cw.CW.sel[key] = i; grab(); } cw.CW.sel[key] = 0; }
        for (const r of Object.keys(cw.CW.w.cast.routineTemplates)) { cw.CW.sel.routine = r; grab(); }
    }
    const all = [...new Set(leaves(cw.CW.w).map(norm))].filter(Boolean).sort();
    const miss = all.filter(l => !covered(l, [...shown]));
    console.log(`${id}: ${all.length} kinds of field, ${miss.length} not editable${miss.length ? `:\n  ${miss.join('\n  ')}` : ''}`);
    fails += miss.length;
}
process.exit(fails ? 1 : 0);
