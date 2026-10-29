// How hurt someone is, by the share of hit points left (RPG, the same for you, companions, sellswords and foes):
//   75%+ fine · 75–50% hurt (−1 to every roll) · 50–30% badly hurt (−3) · 30–10% barely standing (−5: no work,
//   training or picking a fight) · under 10% unconscious (out of the fight; wounds bleed out) · 0 dead.
// No imports: the fight, the needs and the sheet all use it without waiting on each other.
export type Band = 'fine' | 'hurt' | 'wounded' | 'critical' | 'out' | 'dead';
export const OUT_SHARE = 0.1;
export function bandOf(hp: number, max: number): Band {
    const s = hp / Math.max(1, max);
    return hp <= 0 ? 'dead' : s < OUT_SHARE ? 'out' : s < 0.3 ? 'critical' : s < 0.5 ? 'wounded' : s < 0.75 ? 'hurt' : 'fine';
}
export const BAND_PENALTY: Record<Band, number> = { fine: 0, hurt: 1, wounded: 3, critical: 5, out: 10, dead: 10 };
export const BAND_WORD: Record<Band, string> = { fine: 'unhurt', hurt: 'hurt', wounded: 'badly hurt', critical: 'barely standing', out: 'unconscious', dead: 'dead' };
export const penaltyOf = (hp: number, max: number) => BAND_PENALTY[bandOf(hp, max)];
/** Down: unconscious or dead (out of a fight). */
export const isDown = (hp: number, max: number) => hp <= 0 || hp / Math.max(1, max) < OUT_SHARE;
/** The fewest hit points that keep someone on their feet (just above the unconscious line). */
export const awakeHp = (max: number) => Math.min(max, Math.floor(max * OUT_SHARE) + 1);
