/**
 * Centralised mascot asset manager. One character, fixed expressions, fixed files.
 * Every message picks an expression by NAME; URLs are built in one place so swapping art
 * (or the CDN) never touches templates.
 *
 * Character spec (never vary): white chicken, red comb, yellow beak, pink cheeks, dark-brown outline.
 */
import type { AvailableBreakdown } from '../../domain/calculations/available.ts';
import type { BudgetLevel } from '../../domain/calculations/budget.ts';

/** Required expressions (PRD) + extras cut from the same sticker sheet. */
export const MASCOT_EXPRESSIONS = [
  'happy',
  'proud',
  'angry',
  'worried',
  'shocked',
  'thinking',
  'sleepy',
  'celebrating',
  'encouraging',
  // extras
  'excited',
  'saving',
  'planning',
  'smart',
  'discipline',
] as const;

export type MascotExpression = (typeof MASCOT_EXPRESSIONS)[number];

/** Bump when art changes so LINE's image cache refreshes. */
export const MASCOT_ASSET_VERSION = '1';

let assetBaseUrl = '';

export function configureAssetBaseUrl(url: string): void {
  assetBaseUrl = url.replace(/\/+$/, '');
}

export function assetUrl(path: string): string {
  if (!assetBaseUrl) throw new Error('PUBLIC_ASSET_BASE_URL is not configured');
  return `${assetBaseUrl}/${path.replace(/^\/+/, '')}?v=${MASCOT_ASSET_VERSION}`;
}

export function mascotUrl(expression: MascotExpression): string {
  return assetUrl(`mascot/${expression}.png`);
}

// ── mood selection (pure; input is pre-calculated data) ──

export function moodForAvailable(a: AvailableBreakdown): MascotExpression {
  if (a.isNegative) return 'shocked';
  if (!a.hasIncome) return 'thinking';
  if (a.incomeSatang > 0 && a.availableSatang * 10 < a.incomeSatang) return 'worried'; // < 10% left
  if (a.availableSatang * 2 >= a.incomeSatang) return 'proud'; // >= 50% left
  return 'happy';
}

export function moodForBudget(level: BudgetLevel): MascotExpression {
  return level === 'exceeded' ? 'angry' : level === 'warning' ? 'worried' : 'happy';
}

export function moodForSavedTransaction(type: 'income' | 'expense' | 'saving', amountSatang: number): MascotExpression {
  if (type === 'income') return 'celebrating';
  if (type === 'saving') return 'saving';
  if (amountSatang >= 500_000) return 'shocked'; // >= ฿5,000 in one go
  return 'happy';
}
