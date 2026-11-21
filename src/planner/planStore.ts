// The planner's writes: the server first, then the device's copy (`planCache.ts`), so a failed write
// never shows as planned.
import type { RequestResult } from '../lib/requestResult';
import { addDays } from '../stats/periods';
import { PLAN_DAYS, readStoredPlans, storePlans } from './planCache';
import { listPlans, planOutfit, removePlan, type PlanInput, type PlannedOutfit } from './plannedOutfits';

/** False when the read failed; the stored plans stay as they were. */
export async function refreshPlans(userId: string, today: string): Promise<boolean> {
  try {
    storePlans(userId, await listPlans(today, addDays(today, PLAN_DAYS - 1)));
    return true;
  } catch {
    return false;
  }
}

export async function savePlan(userId: string, input: PlanInput): Promise<RequestResult> {
  const result = await planOutfit(input);
  if (!result.ok) return result;
  storePlans(userId, [...readStoredPlans(userId).filter((plan) => plan.day !== input.day), result.plan]);
  return { ok: true };
}

export async function deletePlan(userId: string, plan: PlannedOutfit): Promise<RequestResult> {
  const result = await removePlan(plan.id);
  if (result.ok) storePlans(userId, readStoredPlans(userId).filter((stored) => stored.id !== plan.id));
  return result;
}
