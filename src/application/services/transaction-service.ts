/**
 * Transaction use cases: draft → confirm/cancel → save; edit draft; delete/undo; history.
 * Nothing financial is written until the user confirms a draft.
 */
import { addDays, isValidLocalDate, type LocalDate } from '../../domain/dates.ts';
import { getCategory, isKnownCategory } from '../../domain/entities/categories.ts';
import type { Transaction, TransactionSource, TransactionType } from '../../domain/entities/index.ts';
import { isValidPositiveAmount, type Satang } from '../../domain/money.ts';
import type { PendingAction } from '../../infrastructure/db/repositories/conversation.ts';
import type { Repos } from '../../infrastructure/db/repositories/index.ts';
import { createRepos } from '../../infrastructure/db/repositories/index.ts';
import type { Sql } from '../../infrastructure/db/sql.ts';

export const TXN_DRAFT_KIND = 'transaction';
export const DRAFT_TTL_MINUTES = 60;
/** How far back / forward a transaction date may be set. */
export const MAX_BACKDATE_DAYS = 366;
export const MAX_FUTURE_DAYS = 31;

export interface TransactionDraft {
  type: TransactionType;
  amountSatang: Satang;
  categoryId: string;
  categoryConfident: boolean;
  note: string | null;
  txnDate: LocalDate;
  source: TransactionSource;
  savingsGoalId?: string | null;
}

export class ValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateDraft(d: TransactionDraft, today: LocalDate): void {
  if (!isValidPositiveAmount(d.amountSatang)) throw new ValidationError('amount', 'จำนวนเงินไม่ถูกต้อง');
  if (!isValidLocalDate(d.txnDate)) throw new ValidationError('date', 'วันที่ไม่ถูกต้อง');
  if (d.txnDate < addDays(today, -MAX_BACKDATE_DAYS)) throw new ValidationError('date', 'ย้อนหลังได้ไม่เกิน 1 ปีนะ');
  if (d.txnDate > addDays(today, MAX_FUTURE_DAYS)) throw new ValidationError('date', 'ล่วงหน้าได้ไม่เกิน 31 วันนะ');
  if (!isKnownCategory(d.categoryId)) throw new ValidationError('category', 'ไม่รู้จักหมวดนี้');
  const kind = getCategory(d.categoryId).kind;
  if (kind !== d.type) throw new ValidationError('category', 'หมวดไม่ตรงกับประเภทรายการ');
  if (d.type === 'saving' && !d.savingsGoalId) throw new ValidationError('goal', 'ต้องเลือกเป้าหมายการออม');
  if (d.note && d.note.length > 200) throw new ValidationError('note', 'โน้ตยาวเกินไป');
}

export type ConfirmResult =
  | { status: 'saved'; transaction: Transaction }
  | { status: 'already_confirmed' }
  | { status: 'cancelled' }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'invalid'; error: ValidationError };

export function createTransactionService(sql: Sql, repos: Repos = createRepos(sql)) {
  return {
    async createDraft(userId: string, draft: TransactionDraft, today: LocalDate): Promise<PendingAction<TransactionDraft>> {
      validateDraft(draft, today);
      // one open transaction draft at a time keeps the chat unambiguous
      await repos.pending.cancelAllPending(userId, TXN_DRAFT_KIND);
      return repos.pending.create(userId, TXN_DRAFT_KIND, draft, DRAFT_TTL_MINUTES);
    },

    async getDraft(userId: string, id: string): Promise<PendingAction<TransactionDraft> | null> {
      const d = await repos.pending.get<TransactionDraft>(userId, id);
      return d && d.kind === TXN_DRAFT_KIND ? d : null;
    },

    async updateDraft(
      userId: string,
      id: string,
      patch: Partial<Pick<TransactionDraft, 'categoryId' | 'txnDate' | 'amountSatang' | 'note'>>,
      today: LocalDate,
    ): Promise<PendingAction<TransactionDraft> | null> {
      const current = await this.getDraft(userId, id);
      if (!current || current.status !== 'pending') return null;
      const next: TransactionDraft = { ...current.payload, ...patch };
      if (patch.categoryId) next.categoryConfident = true;
      validateDraft(next, today);
      return repos.pending.updatePayload(userId, id, next);
    },

    /** Atomic: the draft flips to confirmed and the transaction is inserted together, or neither. */
    async confirm(userId: string, id: string, today: LocalDate): Promise<ConfirmResult> {
      return sql.transaction(async (tx) => {
        const r = createRepos(tx);
        const draft = await r.pending.get<TransactionDraft>(userId, id);
        if (!draft || draft.kind !== TXN_DRAFT_KIND) return { status: 'not_found' as const };
        try {
          validateDraft(draft.payload, today);
        } catch (e) {
          if (e instanceof ValidationError) return { status: 'invalid' as const, error: e };
          throw e;
        }
        const won = await r.pending.resolve<TransactionDraft>(userId, id, 'confirmed');
        if (!won) {
          if (draft.status === 'confirmed') return { status: 'already_confirmed' as const };
          if (draft.status === 'cancelled') return { status: 'cancelled' as const };
          return { status: 'expired' as const };
        }
        const p = won.payload;
        const transaction = await r.transactions.insert({
          userId,
          type: p.type,
          amountSatang: p.amountSatang,
          categoryId: p.categoryId,
          note: p.note,
          txnDate: p.txnDate,
          source: p.source,
          savingsGoalId: p.savingsGoalId ?? null,
        });
        return { status: 'saved' as const, transaction };
      });
    },

    async cancel(userId: string, id: string): Promise<boolean> {
      return (await repos.pending.resolve(userId, id, 'cancelled')) !== null;
    },

    /**
     * Soft-delete a transaction. If it paid a Fixed Cost occurrence, that occurrence returns to
     * pending in the same database transaction so it is counted as unpaid again.
     */
    async remove(userId: string, transactionId: string): Promise<Transaction | null> {
      return sql.transaction(async (tx) => {
        const r = createRepos(tx);
        const deleted = await r.transactions.softDelete(userId, transactionId);
        if (deleted?.fixedCostOccurrenceId) {
          await r.fixedCosts.setOccurrenceStatus(userId, deleted.fixedCostOccurrenceId, 'paid', 'pending');
        }
        return deleted;
      });
    },

    /** Undo a delete. Fails (null) if the linked bill has since been paid by another transaction. */
    async restore(userId: string, transactionId: string): Promise<Transaction | null> {
      return sql.transaction(async (tx) => {
        const r = createRepos(tx);
        const existing = await r.transactions.get(userId, transactionId);
        if (!existing || existing.deletedAt === null) return null;
        if (existing.fixedCostOccurrenceId) {
          const flipped = await r.fixedCosts.setOccurrenceStatus(userId, existing.fixedCostOccurrenceId, 'pending', 'paid');
          if (!flipped) return null;
        }
        return r.transactions.restore(userId, transactionId);
      });
    },

    async get(userId: string, id: string): Promise<Transaction | null> {
      return repos.transactions.get(userId, id);
    },

    async history(userId: string, page: number, pageSize = 10): Promise<{ items: Transaction[]; hasMore: boolean }> {
      const rows = await repos.transactions.listRecent(userId, pageSize + 1, page * pageSize);
      return { items: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
    },
  };
}
export type TransactionService = ReturnType<typeof createTransactionService>;
