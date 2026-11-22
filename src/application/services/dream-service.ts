/**
 * Life plan ("อนาคตที่อยากมี"): dreams are savings goals with a kind + target date, so saving into
 * them uses the normal `saving` transactions and (optionally) their monthly reserve reduces
 * available-to-spend — "เก็บก่อนใช้" for the future you want.
 */
import {
  coachNote, DREAM_MAX_YEARS, dreamIllustrations, dreamTemplate, planDream,
  type CoachNote, type DreamPlan, type DreamTemplate, type Illustration,
} from '../../domain/calculations/dreams.ts';
import type { SavingsProgress } from '../../domain/calculations/savings.ts';
import { addMonths, isValidLocalDate, type LocalDate } from '../../domain/dates.ts';
import type { DreamKind } from '../../domain/entities/index.ts';
import { isValidPositiveAmount, type Satang } from '../../domain/money.ts';
import type { Repos } from '../../infrastructure/db/repositories/index.ts';
import type { EntitlementService } from './entitlement-service.ts';
import type { FinanceService } from './finance-service.ts';
import { ValidationError } from './transaction-service.ts';

export interface DreamView {
  progress: SavingsProgress;
  template: DreamTemplate;
  plan: DreamPlan;
  coach: CoachNote;
  illustrations: Illustration[];
  reserving: boolean;
}

export function createDreamService(repos: Repos, finance: FinanceService, plans: EntitlementService) {
  function validDate(today: LocalDate, targetDate: string): LocalDate {
    if (!isValidLocalDate(targetDate) || targetDate <= today) throw new ValidationError('date', 'วันที่อยากไปถึงต้องเป็นอนาคต');
    if (targetDate > addMonths(today, DREAM_MAX_YEARS * 12)) throw new ValidationError('date', `ตั้งได้ไกลสุด ${DREAM_MAX_YEARS} ปี`);
    return targetDate;
  }
  function validAmount(s: Satang) {
    if (!isValidPositiveAmount(s)) throw new ValidationError('amount', 'จำนวนเงินไม่ถูกต้อง');
  }

  return {
    async list(userId: string, today: LocalDate): Promise<DreamView[]> {
      const goals = await finance.goals(userId);
      return goals
        .filter((g) => g.goal.dream && g.goal.targetDate)
        .map((g) => {
          const template = dreamTemplate(g.goal.dream!);
          const plan = planDream({ targetSatang: g.goal.targetSatang, savedSatang: g.savedSatang, today, startDate: g.goal.createdOn ?? today, targetDate: g.goal.targetDate! });
          return { progress: g, template, plan, coach: coachNote(g.goal.name, plan, template), illustrations: dreamIllustrations(plan), reserving: g.goal.monthlyReserveSatang > 0 };
        });
    },

    async create(userId: string, today: LocalDate, input: { kind: DreamKind; name?: string | null; targetSatang: Satang; targetDate: string; reserve: boolean }) {
      validAmount(input.targetSatang);
      const targetDate = validDate(today, input.targetDate);
      const name = (input.name?.trim() || dreamTemplate(input.kind).label).slice(0, 60);
      await plans.assertCanAdd(userId, 'goals');
      const plan = planDream({ targetSatang: input.targetSatang, savedSatang: 0, today, startDate: today, targetDate });
      return repos.goals.insert({ userId, name, targetSatang: input.targetSatang, monthlyReserveSatang: input.reserve ? plan.monthlyNeededSatang : 0, targetDate, dream: input.kind });
    },

    /** Change the amount and/or date; a reserving dream gets its monthly reserve recalculated. */
    async adjust(userId: string, today: LocalDate, id: string, patch: { targetSatang?: Satang; targetDate?: string; reserve?: boolean }): Promise<boolean> {
      const goal = await repos.goals.get(userId, id);
      if (!goal || !goal.dream || goal.status === 'archived') return false;
      if (patch.targetSatang !== undefined) validAmount(patch.targetSatang);
      const targetDate = patch.targetDate !== undefined ? validDate(today, patch.targetDate) : goal.targetDate!;
      const target = patch.targetSatang ?? goal.targetSatang;
      const progress = await finance.goalProgress(userId, id);
      const reserve = patch.reserve ?? goal.monthlyReserveSatang > 0;
      const plan = planDream({ targetSatang: target, savedSatang: progress?.savedSatang ?? 0, today, startDate: goal.createdOn ?? today, targetDate });
      return repos.goals.update(userId, id, { targetSatang: target, targetDate, monthlyReserveSatang: reserve ? plan.monthlyNeededSatang : 0 });
    },
  };
}
export type DreamService = ReturnType<typeof createDreamService>;
