/**
 * Transaction use cases: draft → confirm/cancel → save; edit draft; delete/undo; history.
 * Nothing financial is written until the user confirms a draft.
 */
import { addDays, isValidLocalDate, type LocalDate } from '../../domain/dates.ts';
import { defaultCategoryFor, getCategory, isKnownCategory } from '../../domain/entities/categories.ts';
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
  /** Slip reference / PDF fingerprint: the same document can be recorded only once. */
  externalRef?: string | null;
}

export class ValidationError extends Error {
  // explicit field (no parameter property) so Node's type-stripping can run this file directly
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
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
  | { status: 'duplicate'; existing: Transaction | null }
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
      patch: Partial<Pick<TransactionDraft, 'categoryId' | 'txnDate' | 'amountSatang' | 'note' | 'type'>>,
      today: LocalDate,
    ): Promise<PendingAction<TransactionDraft> | null> {
      const current = await this.getDraft(userId, id);
      if (!current || current.status !== 'pending') return null;
      const next: TransactionDraft = { ...current.payload, ...patch };
      if (patch.type && patch.type !== current.payload.type && !patch.categoryId) {
        if (patch.type === 'saving') throw new ValidationError('type', 'เปลี่ยนเป็นเงินออมผ่านเมนูเป้าหมายนะ');
        next.categoryId = defaultCategoryFor(patch.type);
        next.categoryConfident = false;
      }
      if (patch.categoryId) next.categoryConfident = true;
      validateDraft(next, today);
      return repos.pending.updatePayload(userId, id, next);
    },

    /** Atomic: the draft flips to confirmed and the transaction is inserted together, or neither. */
    async confirm(userId: string, id: string, today: LocalDate): Promise<ConfirmResult> {
      try {
        return await this.confirmInner(userId, id, today);
      } catch (e) {
        // DB backstop: unique external_ref (same slip confirmed twice concurrently)
        if ((e as { code?: string }).code === '23505' && String((e as Error).message).includes('external_ref')) {
          return { status: 'duplicate', existing: null };
        }
        throw e;
      }
    },

    async confirmInner(userId: string, id: string, today: LocalDate): Promise<ConfirmResult> {
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
        if (draft.status === 'pending' && draft.payload.externalRef) {
          const existing = await r.transactions.findByExternalRef(userId, draft.payload.externalRef);
          if (existing) {
            await r.pending.resolve(userId, id, 'cancelled');
            return { status: 'duplicate' as const, existing };
          }
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
          externalRef: p.externalRef ?? null,
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

    /**
     * Auto-record: validate and save immediately (the caller only uses this for confident entries
     * and always shows an undo button). Duplicate slip references are still refused.
     */
    async saveDirect(userId: string, d: TransactionDraft, today: LocalDate): Promise<ConfirmResult> {
      try {
        validateDraft(d, today);
      } catch (e) {
        if (e instanceof ValidationError) return { status: 'invalid', error: e };
        throw e;
      }
      if (d.externalRef) {
        const existing = await repos.transactions.findByExternalRef(userId, d.externalRef);
        if (existing) return { status: 'duplicate', existing };
      }
      try {
        const transaction = await repos.transactions.insert({
          userId, type: d.type, amountSatang: d.amountSatang, categoryId: d.categoryId, note: d.note,
          txnDate: d.txnDate, source: d.source, savingsGoalId: d.savingsGoalId ?? null, externalRef: d.externalRef ?? null,
        });
        return { status: 'saved', transaction };
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return { status: 'duplicate', existing: null };
        throw e;
      }
    },

    /** Several items from one message, waiting for one confirm tap. */
    async createMultiDraft(userId: string, items: TransactionDraft[], today: LocalDate): Promise<PendingAction<{ items: TransactionDraft[] }>> {
      if (items.length < 2) throw new ValidationError('items', 'ต้องมีอย่างน้อย 2 รายการ');
      for (const d of items) validateDraft(d, today);
      await repos.pending.cancelAllPending(userId, MULTI_DRAFT_KIND);
      return repos.pending.create(userId, MULTI_DRAFT_KIND, { items }, DRAFT_TTL_MINUTES);
    },

    /** Atomic: every item is saved, or none. A second tap gets `stale`. */
    async confirmMulti(userId: string, id: string, today: LocalDate): Promise<{ status: 'saved'; transactions: Transaction[] } | { status: 'stale' } | { status: 'invalid'; error: ValidationError }> {
      return sql.transaction(async (tx) => {
        const r = createRepos(tx);
        const won = await r.pending.resolve<{ items: TransactionDraft[] }>(userId, id, 'confirmed');
        if (!won || won.kind !== MULTI_DRAFT_KIND) return { status: 'stale' as const };
        // a ValidationError thrown here rolls back the resolve too (mapped to `invalid` below)
        for (const d of won.payload.items) validateDraft(d, today);
        const transactions: Transaction[] = [];
        for (const d of won.payload.items) {
          transactions.push(await r.transactions.insert({ userId, type: d.type, amountSatang: d.amountSatang, categoryId: d.categoryId, note: d.note, txnDate: d.txnDate, source: d.source }));
        }
        return { status: 'saved' as const, transactions };
      }).catch((e) => {
        if (e instanceof ValidationError) return { status: 'invalid' as const, error: e };
        throw e;
      });
    },

    /** Save several confident items at once (auto-record), atomically. */
    async saveManyDirect(userId: string, items: TransactionDraft[], today: LocalDate): Promise<Transaction[]> {
      for (const d of items) validateDraft(d, today);
      return sql.transaction(async (tx) => {
        const r = createRepos(tx);
        const out: Transaction[] = [];
        for (const d of items) out.push(await r.transactions.insert({ userId, type: d.type, amountSatang: d.amountSatang, categoryId: d.categoryId, note: d.note, txnDate: d.txnDate, source: d.source }));
        return out;
      });
    },

    /** Undo several saved items at once (each reverts its bill link like `remove`). */
    async removeMany(userId: string, ids: string[]): Promise<number> {
      let n = 0;
      for (const id of ids) if (await this.remove(userId, id)) n++;
      return n;
    },

    async last(userId: string): Promise<Transaction | null> {
      const [t] = await repos.transactions.listRecentlyCreated(userId, 1);
      return t ?? null;
    },

    /** Change the amount of a saved transaction (e.g. "แก้ล่าสุดเป็น 80"). */
    async editAmount(userId: string, id: string, amountSatang: Satang, today: LocalDate): Promise<Transaction | null> {
      const current = await repos.transactions.get(userId, id);
      if (!current || current.deletedAt) return null;
      validateDraft({ type: current.type, amountSatang, categoryId: current.categoryId, categoryConfident: true, note: current.note, txnDate: current.txnDate, source: current.source, savingsGoalId: current.savingsGoalId }, today);
      return repos.transactions.update(userId, id, { amountSatang });
    },
  };
}

export const MULTI_DRAFT_KIND = 'multi';
export type TransactionService = ReturnType<typeof createTransactionService>;
