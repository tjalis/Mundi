// An RPG system made by your AI from lorebooks (a series, a game, your own setting): its attributes, skills,
// classes, powers, titles and foes, in two asks (the bones, then the powers). Whatever the AI sends back is checked
// and filled in, so the system always works with the engine: the usual skill ids stay (the world's actions, jobs and
// quests use them), numbers are kept in range, and foes get stats for their level.
import { loadLore, quiet } from '../st/bridge.js';
import { parseJson } from './fromlore.js';
import type { RpgDef, RpgSkill, RpgClass, RpgSpell, Foe, RpgTitle, RpgWeapon, Ability, Element } from '../core/rpgdef.js';

const XP = [100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500, 5500, 6600];
// The skills every system keeps (their names and attributes may change): the engine and the worlds use these ids.
const CORE: [string, string, string][] = [
    ['athletics', 'Athletics', 'body'], ['acrobatics', 'Acrobatics', 'speed'], ['stealth', 'Stealth', 'speed'], ['sleight', 'Sleight of hand', 'speed'],
    ['investigation', 'Investigation', 'mind'], ['history', 'Lore', 'mind'], ['arcana', 'Power lore', 'mind'], ['nature', 'Nature', 'mind'], ['religion', 'Customs and beliefs', 'mind'],
    ['insight', 'Insight', 'sense'], ['perception', 'Perception', 'sense'], ['medicine', 'Medicine', 'mind'], ['survival', 'Survival', 'tough'], ['animals', 'Animal handling', 'sense'],
    ['persuasion', 'Persuasion', 'presence'], ['deception', 'Deception', 'presence'], ['intimidation', 'Intimidation', 'presence'], ['performance', 'Performance', 'presence'], ['tech', 'Technology', 'mind'],
];
const ROLES = ['body', 'speed', 'tough', 'mind', 'sense', 'presence'];
const ABILITY: Ability['kind'][] = ['heal', 'guard', 'inspire', 'hide', 'mark', 'shield', 'rage'];
const ELEMENTS: Element[] = ['fire', 'water', 'lightning', 'ice', 'earth', 'light', 'dark'];

async function loreText(names: string[], max = 14000): Promise<string> {
    const out: string[] = [];
    for (const n of names) {
        const data = await loadLore(n);
        for (const e of Object.values<any>(data?.entries ?? {})) if (!e?.disable && e?.content) out.push(`- ${(e.comment || (e.key ?? [])[0] || '').toString().slice(0, 60)}: ${String(e.content).replace(/\s+/g, ' ').trim()}`);
    }
    return out.join('\n').slice(0, max);
}

const slug = (s: unknown, fb = 'x') => (String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || fb);
const str = (s: unknown, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v: unknown, lo: number, hi: number, fb: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb; };
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const uniq = <T extends { id: string }>(l: T[]) => { const seen = new Set<string>(); return l.filter(x => !seen.has(x.id) && (seen.add(x.id), true)); };

function askBones(lore: string, hint: string) {
    return `You design the RPG rules of an interactive story game, based on the setting below. The engine rolls d20 checks (d20 + attribute bonus + proficiency against 10 to 19), has classes with a subclass at level 3, hit points, and one resource for special powers.
${hint ? `\nWhat the player wants: ${hint}\n` : ''}
Setting (lorebook notes):
${lore}

Answer with JSON only, no text around it, in this shape:
{"name":"short name of the system, like 'Nen hunter'","desc":"one sentence","focusName":"the power resource, like Mana, Aura, Chakra, Qi, the Force",
"attributes":[{"id":"short lowercase id","name":"Strength","short":"STR","desc":"what it is for","role":"body"}],
"skills":[{"id":"lowercase_id","name":"Skill name","attr":"an attribute id"}],
"classes":[{"id":"lowercase_id","name":"Class","desc":"one sentence","hit":10,"key":"an attribute id","skills":["4 to 6 skill ids"],"armor":2,"weapon":{"name":"their weapon","dice":1,"sides":8,"attr":"an attribute id","ranged":false},"ability":{"name":"a signature move","kind":"one of ${ABILITY.join(', ')}","desc":"what it does"},"powers":true,"subclasses":[{"id":"lowercase_id","name":"Subclass","desc":"one sentence","skill":"a skill id"}]}]}

Rules: 4 to 7 attributes, each with a "role" among ${ROLES.join(', ')} (body: strength and melee; speed: dodging and initiative; tough: hit points; mind; sense; presence). Use the attributes the setting itself uses if it has stats (for example Solo Leveling uses STR AGI VIT INT SEN).
Skills: 8 to 20 skills of the setting (fighting styles, weapons, crafts, knowledge). Also map these usual skills to your attributes by listing them with these exact ids (rename them to fit if you like): ${CORE.map(c => c[0]).join(', ')}.
Classes: 4 to 8 classes, paths, types or roles of the setting, each with 2 or 3 subclasses. "hit" is 6 (frail) to 12 (tough). "armor" is 0 to 7. "sides" is 4 to 12. "powers": true if the class uses the setting's special powers.`;
}
function askPowers(lore: string, bones: RpgDef) {
    return `You are finishing the RPG rules of an interactive story game called "${bones.name}". Attributes: ${bones.attributes.map(a => `${a.id} (${a.name})`).join(', ')}. Skills: ${bones.skills.map(k => k.id).join(', ')}.
Classes: ${bones.classes.map(c => `${c.id} (${c.name})`).join(', ')}. The power resource is called ${bones.focusName}.

Setting (lorebook notes):
${lore.slice(0, 8000)}

Answer with JSON only, in this shape:
{"schools":[{"id":"lowercase_id","name":"a kind of power, technique or magic of the setting","desc":"one sentence","classes":["class ids that use it"]}],
"spells":[{"id":"lowercase_id","name":"Power name","school":"a school id","level":1,"cost":1,"desc":"one sentence","kind":"damage","element":"fire","skills":["skill ids"],"amount":2}],
"weapons":[{"id":"lowercase_id","name":"a weapon of the setting","dice":1,"sides":8,"attr":"an attribute id","skill":"a weapon skill id","ranged":false}],
"titles":[{"name":"the Something","desc":"how to earn it","level":5}],
"foes":[{"name":"Foe","icon":"one emoji","level":1,"desc":"one sentence","ranged":false,"boss":false,"where":"road, town, wild or tower","element":""}]}

Rules: 3 to 6 schools; 12 to 24 powers, levels 1 to 5, cost 1 to 5. "kind" is damage (a blow in a fight), shield (a guard in a fight), heal ("amount": 15 to 80, a share of hit points), bonus (+"amount" 1 to 4 to the next check), advantage (roll twice on the next check of "skills"), cleanse (lifts poisons and curses), rumor (learn a rumor) or scene (only narrated). "element" is empty or one of ${ELEMENTS.join(', ')}.
6 to 14 weapons; 4 to 8 titles (with "level" 2 to 12, or "renown" 20 to 250 instead); 6 to 12 foes of levels 1 to 8, 1 or 2 of them bosses. Use the setting's own names everywhere.`;
}

// The bones: attributes (with what each does), skills, classes.
export function bonesOf(j: any): RpgDef {
    const attributes = uniq(arr(j.attributes).slice(0, 8).map((a: any) => ({ id: slug(a.id ?? a.short ?? a.name, 'attr'), name: str(a.name, 30) || 'Attribute', short: str(a.short, 5).toUpperCase() || str(a.name, 3).toUpperCase(), desc: str(a.desc, 120), role: String(a.role ?? '') })));
    if (attributes.length < 3) throw new Error('The AI gave too few attributes. Try again.');
    const byRole = (role: string, i: number) => attributes.find(a => a.role === role)?.id ?? attributes[Math.min(i, attributes.length - 1)].id;
    const ids = new Set(attributes.map(a => a.id));
    const att = (v: unknown, fb: string) => { const s = slug(v); return ids.has(s) ? s : fb; };
    const role: Record<string, string> = Object.fromEntries(ROLES.map((r, i) => [r, byRole(r, i)]));
    const skills: RpgSkill[] = uniq(arr(j.skills).slice(0, 40).map((k: any) => ({ id: slug(k.id ?? k.name, 'skill'), name: str(k.name, 30) || 'Skill', attr: att(k.attr, role.mind) })));
    for (const [id, name, r] of CORE) if (!skills.some(k => k.id === id)) skills.push({ id, name, attr: role[r] });
    const sk = new Set(skills.map(k => k.id));
    const classes: RpgClass[] = uniq(arr(j.classes).slice(0, 10).map((c: any) => {
        const key = att(c.key, role.body);
        const own = arr(c.skills).map((x: unknown) => slug(x)).filter((x: string) => sk.has(x));
        const wp = c.weapon ?? {};
        const ability = c.ability && ABILITY.includes(c.ability.kind) ? { name: str(c.ability.name, 40) || 'Signature move', kind: c.ability.kind, desc: str(c.ability.desc, 120), ...(c.ability.kind === 'heal' ? { amount: 35 } : c.ability.kind === 'rage' ? { amount: 3 } : c.ability.kind === 'shield' || c.ability.kind === 'guard' ? { amount: 4 } : {}) } as Ability : undefined;
        return {
            id: slug(c.id ?? c.name, 'class'), name: str(c.name, 40) || 'Class', desc: str(c.desc, 200), hit: int(c.hit, 6, 12, 8), key,
            skills: own.length ? [...new Set(own)].slice(0, 6) : skills.filter(k => k.attr === key).slice(0, 4).map(k => k.id),
            armor: int(c.armor, 0, 7, 2),
            weapon: { name: str(wp.name, 40) || 'weapon', dice: int(wp.dice, 1, 2, 1), sides: int(wp.sides, 4, 12, 8), attr: att(wp.attr, key), ...(wp.ranged ? { ranged: true } : {}) },
            ...(ability ? { ability } : {}),
            ...(c.powers === false ? {} : { schools: [] as string[] }),
            subAt: 3,
            subclasses: uniq(arr(c.subclasses).slice(0, 4).map((x: any) => ({ id: slug(x.id ?? x.name, 'sub'), name: str(x.name, 40) || 'Subclass', desc: str(x.desc, 160), ...(sk.has(slug(x.skill)) ? { skill: slug(x.skill) } : {}) }))),
        } as RpgClass;
    }));
    if (classes.length < 2) throw new Error('The AI gave too few classes. Try again.');
    const points = attributes.length >= 6 ? 27 : attributes.length === 5 ? 22 : 18;
    return {
        name: str(j.name, 40) || 'Lore RPG', attributes: attributes.map(({ role: _r, ...a }) => a), hpAttr: role.tough,
        roles: { defense: role.speed, initiative: role.speed, melee: role.body }, pointBuy: { points, min: 8, max: 15 },
        skills, classes, xp: XP, focusName: str(j.focusName, 20) || 'Power', schools: [], spells: [], titles: [], campEvery: 8,
    };
}

// The powers, weapons, titles and foes, fitted to the bones.
export function powersInto(r: RpgDef, j: any) {
    const sk = new Set(r.skills.map(k => k.id)), at = new Set(r.attributes.map(a => a.id)), cl = new Set(r.classes.map(c => c.id));
    r.schools = uniq(arr(j.schools).slice(0, 8).map((s: any) => ({ id: slug(s.id ?? s.name, 'school'), name: str(s.name, 40) || 'Powers', desc: str(s.desc, 160), classes: arr(s.classes).map((x: unknown) => slug(x)).filter((x: string) => cl.has(x)) })))
        .map(({ classes, ...s }) => { for (const c of r.classes) if (c.schools && (classes.includes(c.id) || !classes.length)) c.schools.push(s.id); return s; });
    const schools = new Set(r.schools.map(s => s.id));
    r.spells = uniq(arr(j.spells).slice(0, 30).map((p: any): RpgSpell | null => {
        const school = slug(p.school); if (!schools.has(school)) return null;
        const kind = String(p.kind ?? 'scene');
        const skills = arr(p.skills).map((x: unknown) => slug(x)).filter((x: string) => sk.has(x));
        const element = ELEMENTS.includes(p.element) ? { element: p.element as Element } : {};
        const base = { id: slug(p.id ?? p.name, 'power'), name: str(p.name, 40) || 'Power', school, level: int(p.level, 1, 5, 1), cost: int(p.cost, 1, 5, 1), desc: str(p.desc, 160), ...element };
        if (kind === 'damage') return { ...base, effect: { kind: 'scene' }, combat: 'damage' };
        if (kind === 'shield') return { ...base, effect: { kind: 'scene' }, combat: 'shield' };
        if (kind === 'heal') return { ...base, effect: { kind: 'heal', amount: int(p.amount, 10, 80, 30) } };
        if (kind === 'bonus') return { ...base, effect: { kind: 'bonus', amount: int(p.amount, 1, 4, 2), ...(skills.length ? { skills } : {}) } };
        if (kind === 'advantage' && skills.length) return { ...base, effect: { kind: 'advantage', skills } };
        if (kind === 'cleanse') return { ...base, effect: { kind: 'cleanse' } };
        if (kind === 'rumor') return { ...base, effect: { kind: 'rumor' } };
        return { ...base, effect: { kind: 'scene' } };
    }).filter((x): x is RpgSpell => !!x));
    // a class with powers but none to learn: no powers after all
    for (const c of r.classes) if (c.schools && !c.schools.some(s => r.spells.some(p => p.school === s))) delete c.schools;
    r.weapons = uniq(arr(j.weapons).slice(0, 16).map((w: any): RpgWeapon => {
        const skill = slug(w.skill);
        return { id: slug(w.id ?? w.name, 'weapon'), name: str(w.name, 40) || 'weapon', dice: int(w.dice, 1, 2, 1), sides: int(w.sides, 4, 12, 6), attr: at.has(slug(w.attr)) ? slug(w.attr) : r.roles?.melee ?? r.attributes[0].id, ...(sk.has(skill) ? { skill } : {}), ...(w.ranged ? { ranged: true } : {}) };
    }));
    r.titles = arr(j.titles).slice(0, 10).map((t: any, i: number): RpgTitle => ({ id: `t${i}_${slug(t.name, 'title')}`, name: str(t.name, 40) || 'the Known', desc: str(t.desc, 120),
        when: t.renown ? { renown: int(t.renown, 10, 300, 50) } : { level: int(t.level, 2, 12, 5) } }));
    r.bestiary = uniq(arr(j.foes ?? j.bestiary).slice(0, 14).map((f: any, i: number): Foe => {
        const lv = int(f.level, 1, 10, 1 + (i % 5)), boss = !!f.boss;
        const where = ['road', 'town', 'wild', 'tower'].includes(f.where) ? f.where : 'road';
        const element = ELEMENTS.includes(f.element) ? { element: f.element as Element } : {};
        return { id: slug(f.id ?? f.name, 'foe'), icon: str(f.icon, 4) || '⚔️', name: str(f.name, 40) || 'Foe', level: lv,
            hp: Math.round((8 + lv * 7) * (boss ? 2 : 1)), ac: Math.min(18, 11 + Math.ceil(lv / 2)), atk: 2 + lv, dice: lv >= 4 ? 2 : 1, sides: lv >= 4 ? 6 : 8, bonus: 1 + Math.floor(lv / 2),
            row: f.ranged ? 'back' : 'front', ...(f.ranged ? { ranged: true } : {}), tags: [...new Set([where, ...(where === 'tower' ? [] : ['road']), ...(boss ? ['tower', 'boss'] : [])])], desc: str(f.desc, 160), ...element };
    }));
}

export interface LoreSystem { id: string; name: string; desc: string; def: RpgDef }
/** Your AI reads the lorebooks and writes an RPG system (two asks). `hint`: what you want ("ninja clans", "only 5 stats"…). */
export async function systemFromLore(books: string[], hint = ''): Promise<LoreSystem> {
    const lore = await loreText(books);
    if (!lore.trim()) throw new Error('Those lorebooks have no entries to read.');
    const j1 = parseJson(await quiet(askBones(lore, str(hint, 300)), 3000));
    const def = bonesOf(j1);
    try { powersInto(def, parseJson(await quiet(askPowers(lore, def), 3500))); }
    catch (e) { console.warn('[Mundi] system powers', e); }   // the bones alone still play (no powers, plain foes)
    if (!def.bestiary?.length) def.bestiary = [{ id: 'foe', icon: '⚔️', name: 'Hostile', level: 1, hp: 12, ac: 12, atk: 3, dice: 1, sides: 6, bonus: 1, row: 'front', tags: ['road', 'town', 'wild', 'tower'], desc: 'Someone who wants a fight.' }];
    const desc = str(j1.desc, 200) || `From ${books.join(', ')}.`;
    return { id: `lore_${slug(def.name)}_${Date.now().toString(36)}`, name: def.name!, desc: `${desc} (from ${books.join(', ')})`, def };
}
