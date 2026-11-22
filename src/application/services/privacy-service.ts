/**
 * Data export (one-time download link) and complete deletion.
 */
import { getCategory } from '../../domain/entities/categories.ts';
import { csvCell } from '../../domain/calculations/statement.ts';
import type { Transaction } from '../../domain/entities/index.ts';
import { formatSatang } from '../../domain/money.ts';
import { createRepos } from '../../infrastructure/db/repositories/index.ts';
import type { Sql } from '../../infrastructure/db/sql.ts';

export const EXPORT_TOKEN_TTL_MINUTES = 15;

function base64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}


export function transactionsToCsv(txns: Transaction[]): string {
  const header = ['date', 'type', 'amount_baht', 'category', 'note', 'source'];
  const lines = txns.map((t) =>
    [t.txnDate, t.type, formatSatang(t.amountSatang, { alwaysShowFraction: true }).replace(/,/g, ''), getCategory(t.categoryId).labelTh, t.note, t.source]
      .map(csvCell)
      .join(','),
  );
  // BOM so Excel opens Thai text correctly
  return `﻿${[header.join(','), ...lines].join('\n')}\n`;
}

export function createPrivacyService(sql: Sql) {
  const repos = createRepos(sql);
  return {
    /** Returns the raw token (to put in a link). Only its hash is stored. */
    async createExportToken(userId: string): Promise<string> {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const token = base64Url(bytes);
      await sql.query(
        `insert into data_export_tokens (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(mins => $3))`,
        [await sha256Hex(token), userId, EXPORT_TOKEN_TTL_MINUTES],
      );
      return token;
    },

    /** Consume a token (single use). Returns the owner's user id, or null if invalid/expired/used. */
    async consumeExportToken(token: string): Promise<string | null> {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const rows = await sql.query<{ user_id: string }>(
        `update data_export_tokens set used_at = now()
         where token_hash = $1 and used_at is null and expires_at > now() returning user_id`,
        [await sha256Hex(token)],
      );
      return rows[0]?.user_id ?? null;
    },

    async buildExport(userId: string) {
      const [user, transactions, fixedCosts, budgets, goals] = await Promise.all([
        repos.users.get(userId),
        repos.transactions.listAllForExport(userId),
        repos.fixedCosts.list(userId),
        repos.budgets.list(userId),
        repos.goals.listActive(userId),
      ]);
      return {
        exportedAt: new Date().toISOString(),
        note: 'Amounts are in satang (1 baht = 100 satang).',
        user: user && { displayName: user.displayName, cycleStartDay: user.cycleStartDay, notifications: user.notifications, createdAt: user.createdAt },
        transactions: transactions.map(({ userId: _u, ...t }) => t),
        fixedCosts: fixedCosts.map(({ userId: _u, ...f }) => f),
        budgets: budgets.map(({ userId: _u, ...b }) => b),
        savingsGoals: goals.map(({ userId: _u, ...g }) => g),
      };
    },

    async deleteEverything(userId: string): Promise<boolean> {
      return repos.users.deleteCompletely(userId);
    },
  };
}
export type PrivacyService = ReturnType<typeof createPrivacyService>;
