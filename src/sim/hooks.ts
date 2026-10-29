// Places other systems hook into time (kept apart, with no imports, so no module waits on another).
import type { Save } from '../core/store.js';
import type { WorldDef } from '../core/world.js';
export const onHour: ((g: Save, w: WorldDef) => string[])[] = [];
export const onDay: ((g: Save, w: WorldDef) => string[])[] = [];

// After you do an action (habits, pets…).
export const onAction: ((g: Save, w: WorldDef, a: { id: string; tags?: string[]; name: string }) => void)[] = [];
// Who you are seen as right now (an alter ego in disguise): facts, and so rumors, are about that name.
export const seenAs: ((g: Save) => string)[] = [];
// Other things that help or hurt a d20 check (a familiar, an injury, a debuff, a talent…).
export const checkMods: ((g: Save, w: WorldDef, skill: string) => number)[] = [];
// How fast a need drops right now (a heatwave dries you out faster…): multipliers.
export const decayMods: ((g: Save, w: WorldDef, status: string) => number)[] = [];
// Places shut by events (a blood moon, a storm…).
export const closedByEvents: ((g: Save, w: WorldDef, placeId: string) => boolean)[] = [];
// Things that react to the end of a fight (a quest step, the ecology…).
export const afterFight: ((g: Save, w: WorldDef, c: any) => string[])[] = [];
// Every d20 check that is rolled (the screen can show the die).
export const onRoll: ((c: { skill: string; d20: number; other?: number; total: number; dc: number; grade: string }) => void)[] = [];
// Hit points went down (RPG): falling unconscious or dying is handled where the rules of death live (sim/mortal.ts).
export const onHurt: ((g: Save, w: WorldDef) => void)[] = [];
