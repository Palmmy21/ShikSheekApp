/**
 * Slip / receipt / statement import. AI output is treated as untrusted input:
 *  - amounts are re-parsed from the printed text with the exact satang parser (no floats, no maths);
 *  - dates, categories and directions are validated with the same rules as chat entries;
 *  - nothing is saved until the user confirms (single slip → normal confirmation card;
 *    statement → one summary card, imported atomically);
 *  - de-duplication: slips by printed reference, statement rows by a content fingerprint, both
 *    enforced by the unique (user_id, external_ref) index.
 */
import { addDays, isValidLocalDate, type LocalDate } from '../../domain/dates.ts';
import { defaultCategoryFor, getCategory, isKnownCategory } from '../../domain/entities/categories.ts';
import type { TransactionSource, TransactionType } from '../../domain/entities/index.ts';
import { isValidPositiveAmount, parseBahtToSatang, type Satang } from '../../domain/money.ts';
import type { DocExtraction, DocRow } from '../../infrastructure/ai/claude.ts';
import { createRepos, type Repos } from '../../infrastructure/db/repositories/index.ts';
import type { Sql } from '../../infrastructure/db/sql.ts';
import { sha256Hex } from './privacy-service.ts';
import { MAX_BACKDATE_DAYS, type TransactionDraft } from './transaction-service.ts';

export const IMPORT_DRAFT_KIND = 'import';
export const MAX_IMPORT_ROWS = 300;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface ImportRow {
  type: Exclude<TransactionType, 'saving'>;
  amountSatang: Satang;
  categoryId: string;
  categoryConfident: boolean;
  note: string | null;
  txnDate: LocalDate;
  dateGuessed: boolean;
  externalRef: string | null;
}

export interface PreparedImport {
  kind: DocExtraction['kind'];
  rows: ImportRow[];
  skipped: number;
}

export function parsePrintedAmount(text: string): Satang | null {
  const cleaned = text.replace(/฿|THB|บาท|\s/gi, '').replace(/^\+/, '');
  if (cleaned.startsWith('-')) return parsePrintedAmount(cleaned.slice(1)); // statements print debits as -1,250.00
  const satang = parseBahtToSatang(cleaned);
  return satang !== null && isValidPositiveAmount(satang) ? satang : null;
}

function normalizeRef(ref: string): string | null {
  const r = ref.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{6,60}$/.test(r) ? r : null;
}

function normalizeDesc(desc: string): string {
  return desc.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function prepareImport(extraction: DocExtraction, today: LocalDate): Promise<PreparedImport> {
  const isStatement = extraction.kind === 'statement';
  const earliest = addDays(today, -MAX_BACKDATE_DAYS);
  const latest = addDays(today, 1); // allow timezone slack on slips made just after midnight
  const rows: ImportRow[] = [];
  const seen = new Map<string, number>(); // identical statement lines → nth occurrence
  let skipped = 0;

  for (const raw of extraction.rows.slice(0, MAX_IMPORT_ROWS)) {
    const row = raw as DocRow;
    const amount = parsePrintedAmount(row.amount_text);
    if (amount === null) {
      skipped++;
      continue;
    }
    let txnDate = row.date && isValidLocalDate(row.date) ? row.date : null;
    let dateGuessed = false;
    if (!txnDate || txnDate < earliest || txnDate > latest) {
      if (isStatement) {
        skipped++; // a statement row without a trustworthy date is not imported
        continue;
      }
      txnDate = today;
      dateGuessed = true;
    }
    if (txnDate > today) txnDate = today;
    const categoryOk = !!row.category_id && isKnownCategory(row.category_id) && getCategory(row.category_id).kind === row.type;
    const note = row.description.trim().slice(0, 100) || null;

    let externalRef: string | null = null;
    const ref = row.reference ? normalizeRef(row.reference) : null;
    if (ref) {
      externalRef = `ref:${ref}`;
    } else if (isStatement) {
      const base = `${row.type}|${amount}|${txnDate}|${normalizeDesc(row.description)}`;
      const nth = (seen.get(base) ?? 0) + 1;
      seen.set(base, nth);
      externalRef = `fp:${(await sha256Hex(`${base}|${nth}`)).slice(0, 40)}`;
    }

    rows.push({
      type: row.type,
      amountSatang: amount,
      categoryId: categoryOk ? row.category_id! : defaultCategoryFor(row.type),
      categoryConfident: categoryOk,
      note,
      txnDate,
      dateGuessed,
      externalRef,
    });
  }
  skipped += Math.max(0, extraction.rows.length - MAX_IMPORT_ROWS);
  return { kind: extraction.kind, rows, skipped };
}

export function rowToDraft(row: ImportRow, source: TransactionSource): TransactionDraft {
  return {
    type: row.type,
    amountSatang: row.amountSatang,
    categoryId: row.categoryId,
    categoryConfident: row.categoryConfident,
    note: row.note,
    txnDate: row.txnDate,
    source,
    externalRef: row.externalRef,
  };
}

export interface ImportSummary {
  count: number;
  incomeSatang: Satang;
  expenseSatang: Satang;
  firstDate: LocalDate | null;
  lastDate: LocalDate | null;
}

export function summarizeRows(rows: ImportRow[]): ImportSummary {
  let income = 0;
  let expense = 0;
  let first: LocalDate | null = null;
  let last: LocalDate | null = null;
  for (const r of rows) {
    if (r.type === 'income') income += r.amountSatang;
    else expense += r.amountSatang;
    if (!first || r.txnDate < first) first = r.txnDate;
    if (!last || r.txnDate > last) last = r.txnDate;
  }
  return { count: rows.length, incomeSatang: income, expenseSatang: expense, firstDate: first, lastDate: last };
}

export type ImportConfirmResult =
  | { status: 'imported'; inserted: number; duplicates: number }
  | { status: 'stale' };

export function createImportService(sql: Sql, repos: Repos = createRepos(sql)) {
  return {
    async createDraft(userId: string, rows: ImportRow[]) {
      // drop rows already recorded so the summary shows only what is new
      const fresh: ImportRow[] = [];
      let alreadyRecorded = 0;
      for (const r of rows) {
        if (r.externalRef && (await repos.transactions.findByExternalRef(userId, r.externalRef))) alreadyRecorded++;
        else fresh.push(r);
      }
      const draft = fresh.length ? await repos.pending.create(userId, IMPORT_DRAFT_KIND, { rows: fresh }, 60) : null;
      return { draft, rows: fresh, alreadyRecorded };
    },

    /** Atomic: all new rows are inserted together; rows recorded meanwhile are skipped, never doubled. */
    async confirm(userId: string, draftId: string): Promise<ImportConfirmResult> {
      return sql.transaction(async (tx) => {
        const r = createRepos(tx);
        const won = await r.pending.resolve<{ rows: ImportRow[] }>(userId, draftId, 'confirmed');
        if (!won || won.kind !== IMPORT_DRAFT_KIND) return { status: 'stale' as const };
        let inserted = 0;
        let duplicates = 0;
        for (const row of won.payload.rows) {
          const base = { userId, type: row.type, amountSatang: row.amountSatang, categoryId: row.categoryId, note: row.note, txnDate: row.txnDate, source: 'pdf' as const };
          if (row.externalRef) {
            const t = await r.transactions.insertIfNewRef({ ...base, externalRef: row.externalRef });
            if (t) inserted++;
            else duplicates++;
          } else {
            await r.transactions.insert(base);
            inserted++;
          }
        }
        return { status: 'imported' as const, inserted, duplicates };
      });
    },
  };
}
export type ImportService = ReturnType<typeof createImportService>;
