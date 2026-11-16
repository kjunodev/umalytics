import { passes } from './staminaDraft';
import type { Course, StaminaResult } from './staminaTypes';

export const formatStamina = (value: number) => Math.round(value).toLocaleString('en-US');
export const raceName = (course: Course) => `${course.track_name} ${course.distance}`;

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
