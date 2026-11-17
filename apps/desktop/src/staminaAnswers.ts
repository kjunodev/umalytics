import { passes } from './staminaDraft';
import type { Course, StaminaPoint, StaminaResult } from './staminaTypes';

export const formatStamina = (value: number) => Math.round(value).toLocaleString('en-US');
export const raceName = (course: Course) => `${course.track_name} ${course.distance}`;

export function staminaTableRows(curve: StaminaPoint[], current: StaminaPoint): (StaminaPoint | null)[] {
  const points = [...curve].sort((a, b) => a.stamina - b.stamina);
  if (!points.length) return [current];
  const allRates = (point: StaminaPoint, rate: number) =>
    point.full_spurt_percent === rate && point.survival_percent === rate && point.joint_percent === rate;
  const start = Math.max(0, points.map(point => allRates(point, 0)).lastIndexOf(true));
  const end = points.findIndex(point => allRates(point, 100));
  const range = end >= 0 && end < start ? points : points.slice(start, end < 0 ? undefined : end + 1);
  if (current.stamina < range[0]!.stamina) return [current, null, ...range];
  if (current.stamina > range[range.length - 1]!.stamina) return [...range, null, current];
  return [...range.filter(point => point.stamina !== current.stamina), current].sort((a, b) => a.stamina - b.stamina);
}

export function staminaMargin(result: StaminaResult): number | null {
  const need = result.thresholds.joint;
  if (need === null) return null;
  const margin = result.current.stamina - need;
  return margin >= 0 && !passes(result) ? null : margin;
}

export function higherTargetStamina(result: StaminaResult): number | null {
  if (result.input.target >= 95 || result.thresholds.joint === null) return null;
  const points = [...result.curve].sort((a, b) => a.stamina - b.stamina);
  const lastBelow = points.map(point => point.joint_percent < 95).lastIndexOf(true);
  const crossing = lastBelow >= 0 ? points[lastBelow + 1]?.stamina : undefined;
  return crossing !== undefined && crossing >= result.thresholds.joint ? crossing : null;
}

export function noRecoveryStamina(result: StaminaResult): number | null {
  if (result.thresholds.joint === null || !result.heal_equivalents.some(heal => heal.stamina > 0)) return null;
  const estimate = result.needed_effective_stamina.joint;
  return estimate === null || estimate <= result.thresholds.joint ? null : Math.ceil(estimate / 10) * 10;
}
