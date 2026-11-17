/**
 * Fixed Cost use cases: create, occurrence generation (idempotent), pay/skip, pause/resume/delete.
 * Reminders never create transactions; only an explicit, confirmed "paid" does.
 */
import { addDays, maxDate, type LocalDate } from '../../domain/dates.ts';
import { toOccurrenceView, type OccurrenceView } from '../../domain/calculations/bills.ts';
import type { FixedCost, FixedCostOccurrence, Transaction } from '../../domain/entities/index.ts';
import { isValidPositiveAmount, type Satang } from '../../domain/money.ts';
import { nextOccurrenceOnOrAfter, occurrencesBetween, validateRule, type RecurrenceRule } from '../../domain/recurrence.ts';
import { createRepos, type Repos } from '../../infrastructure/db/repositories/index.ts';
import type { Sql } from '../../infrastructure/db/sql.ts';
import { ValidationError } from './transaction-service.ts';

/** Occurrences are kept generated this far ahead so upcoming bills and reminders are visible. */
export const GENERATION_HORIZON_DAYS = 45;

export interface NewFixedCostInput {
  name: string;
  amountSatang: Satang;
  categoryId: string;
  rule: RecurrenceRule;
  remindDaysBefore?: number;
}

export function ruleOf(fc: FixedCost): RecurrenceRule {
  return { frequency: fc.frequency, interval: fc.interval, anchorDate: fc.anchorDate, endDate: fc.endDate };
}

/** Pure: which occurrence rows should exist for this cost up to `through`. */
export function plannedOccurrences(fc: FixedCost, through: LocalDate) {
  if (fc.status !== 'active') return [];
  const from = maxDate(fc.anchorDate, fc.activeFrom);
  return occurrencesBetween(ruleOf(fc), from, through).map((slot) => ({
    userId: fc.userId,
    fixedCostId: fc.id,
    occurrenceKey: slot.occurrenceKey,
    dueDate: slot.dueDate,
    amountSatang: fc.amountSatang,
  }));
}

export type PayResult =
  | { status: 'paid'; transaction: Transaction; occurrence: FixedCostOccurrence }
  | { status: 'already_resolved'; occurrence: FixedCostOccurrence }
  | { status: 'not_found' };

export interface FixedCostSummary {
  fixedCost: FixedCost;
  next: OccurrenceView | null;
  overdue: OccurrenceView[];
}

export function createFixedCostService(sql: Sql, repos: Repos = createRepos(sql)) {
  const service = {
    async create(userId: string, input: NewFixedCostInput, today: LocalDate): Promise<FixedCost> {
      const name = input.name.trim();
      if (!name || name.length > 60) throw new ValidationError('name', 'ชื่อต้องยาว 1-60 ตัวอักษร');
      if (!isValidPositiveAmount(input.amountSatang)) throw new ValidationError('amount', 'จำนวนเงินไม่ถูกต้อง');
      const errors = validateRule(input.rule);
      if (errors.length) throw new ValidationError('rule', errors.join('; '));
      const fc = await repos.fixedCosts.insert({
        userId,
        name,
        amountSatang: input.amountSatang,
        categoryId: input.categoryId,
        frequency: input.rule.frequency,
        interval: input.rule.interval,
        anchorDate: input.rule.anchorDate,
        endDate: input.rule.endDate ?? null,
        remindDaysBefore: input.remindDaysBefore ?? 1,
        activeFrom: today,
      });
      await service.generateFor(fc, addDays(today, GENERATION_HORIZON_DAYS));
      return fc;
    },

    /** Idempotent: safe to run any number of times (UNIQUE(fixed_cost_id, occurrence_key)). */
    async generateFor(fc: FixedCost, through: LocalDate): Promise<FixedCostOccurrence[]> {
      return repos.fixedCosts.insertOccurrencesIfAbsent(plannedOccurrences(fc, through));
    },

    async generateForUser(userId: string, through: LocalDate): Promise<number> {
      let created = 0;
      for (const fc of await repos.fixedCosts.list(userId)) created += (await service.generateFor(fc, through)).length;
      return created;
    },

    async generateForAllUsers(through: LocalDate): Promise<number> {
      let created = 0;
      for (const fc of await repos.fixedCosts.listActiveAllUsers()) created += (await service.generateFor(fc, through)).length;
      return created;
    },

    async list(userId: string, today: LocalDate): Promise<FixedCostSummary[]> {
      const costs = await repos.fixedCosts.list(userId);
      const occ = await repos.fixedCosts.listOccurrencesForPeriod(userId, today, addDays(today, GENERATION_HORIZON_DAYS));
      return costs.map((fc) => {
        const mine = occ.filter((o) => o.fixedCostId === fc.id && o.status === 'pending');
        const overdue = mine.filter((o) => o.dueDate < today).map((o) => toOccurrenceView(o, today));
        const nextOcc = mine.find((o) => o.dueDate >= today);
        let next = nextOcc ? toOccurrenceView(nextOcc, today) : null;
        if (!next && fc.status === 'active') {
          // not generated yet (beyond horizon): show the computed date
          const slot = nextOccurrenceOnOrAfter(ruleOf(fc), maxDate(today, fc.activeFrom));
          if (slot) {
            next = toOccurrenceView(
              { id: '', userId, fixedCostId: fc.id, occurrenceKey: slot.occurrenceKey, dueDate: slot.dueDate, amountSatang: fc.amountSatang, status: 'pending' },
              today,
            );
          }
        }
        return { fixedCost: fc, next, overdue };
      });
    },

    async detail(userId: string, fixedCostId: string) {
      const fc = await repos.fixedCosts.get(userId, fixedCostId);
      if (!fc) return null;
      const recent = await repos.fixedCosts.listOccurrencesOfFixedCost(userId, fixedCostId, 6);
      return { fixedCost: fc, recent };
    },

    async getOccurrence(userId: string, occurrenceId: string) {
      const occ = await repos.fixedCosts.getOccurrence(userId, occurrenceId);
      if (!occ) return null;
      const fc = await repos.fixedCosts.get(userId, occ.fixedCostId);
      return fc ? { occurrence: occ, fixedCost: fc } : null;
    },

    /**
     * Mark an occurrence paid: in ONE database transaction flip pending→paid and insert the linked
     * expense. A second tap finds it already paid; the partial unique index is a final backstop.
     */
    async pay(userId: string, occurrenceId: string, today: LocalDate, actualAmountSatang?: Satang): Promise<PayResult> {
      if (actualAmountSatang !== undefined && !isValidPositiveAmount(actualAmountSatang)) {
        throw new ValidationError('amount', 'จำนวนเงินไม่ถูกต้อง');
      }
      return sql.transaction(async (tx) => {
        const r = createRepos(tx);
        const occ = await r.fixedCosts.getOccurrence(userId, occurrenceId);
        if (!occ) return { status: 'not_found' as const };
        const fc = await r.fixedCosts.get(userId, occ.fixedCostId);
        const flipped = await r.fixedCosts.setOccurrenceStatus(userId, occurrenceId, 'pending', 'paid');
        if (!flipped) return { status: 'already_resolved' as const, occurrence: occ };
        const transaction = await r.transactions.insert({
          userId,
          type: 'expense',
          amountSatang: actualAmountSatang ?? occ.amountSatang,
          categoryId: fc?.categoryId ?? 'bills',
          note: fc?.name ?? null,
          txnDate: today,
          source: 'fixed_cost',
          fixedCostOccurrenceId: occ.id,
        });
        return { status: 'paid' as const, transaction, occurrence: flipped };
      });
    },

    async skip(userId: string, occurrenceId: string): Promise<FixedCostOccurrence | null> {
      return repos.fixedCosts.setOccurrenceStatus(userId, occurrenceId, 'pending', 'skipped');
    },

    async pause(userId: string, fixedCostId: string, today: LocalDate): Promise<boolean> {
      return sql.transaction(async (tx) => {
        const r = createRepos(tx);
        if (!(await r.fixedCosts.pause(userId, fixedCostId))) return false;
        await r.fixedCosts.deleteFuturePending(userId, fixedCostId, today);
        return true;
      });
    },

    async resume(userId: string, fixedCostId: string, today: LocalDate): Promise<boolean> {
      if (!(await repos.fixedCosts.resume(userId, fixedCostId, today))) return false;
      const fc = await repos.fixedCosts.get(userId, fixedCostId);
      if (fc) await service.generateFor(fc, addDays(today, GENERATION_HORIZON_DAYS));
      return true;
    },

    async remove(userId: string, fixedCostId: string, today: LocalDate): Promise<boolean> {
      return repos.fixedCosts.softDelete(userId, fixedCostId, today);
    },
  };
  return service;
}
export type FixedCostService = ReturnType<typeof createFixedCostService>;
