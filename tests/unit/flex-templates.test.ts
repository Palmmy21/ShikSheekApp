import { describe, expect, it } from 'vitest';
import { buildSamples } from '../../scripts/lib/flex-samples.ts';
import { MASCOT_EXPRESSIONS, moodForAvailable, moodForBudget } from '../../src/presentation/line/mascot.ts';
import { decodePostback } from '../../src/presentation/line/postback.ts';
import { RICH_MENU_SIZE, RICH_MENU_VARIANTS, richMenuDefinition, TILES } from '../../src/presentation/line/rich-menu/definition.ts';
import { ALL_SITUATIONS, line } from '../../src/application/personality/rule-based.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateMessages } from '../helpers/flex-validator.ts';

const samples = buildSamples();

describe('Flex templates', () => {
  it.each(Object.entries(samples))('%s passes structural validation', (_name, msgs) => {
    expect(validateMessages(msgs)).toEqual([]);
  });

  it('templates never compute money: displayed amounts come from inputs', () => {
    const json = JSON.stringify(samples.dashboard);
    // income 25,000 − spent (65 + 500 + 1,299 = 1,864) − unpaid bills (6,500 + 599 = 7,099) = 16,037
    expect(json).toContain('"text":"฿16,037"');
    expect(json).toContain('"text":"฿1,864"');
    expect(json).toContain('"text":"฿7,099"');
  });

  it('every mascot image referenced exists on disk', () => {
    const urls = new Set(JSON.stringify(samples).match(/mascot\/[a-z]+\.png/g));
    for (const u of urls) expect(existsSync(join(import.meta.dirname, '../../assets', u)), u).toBe(true);
    for (const e of MASCOT_EXPRESSIONS) expect(existsSync(join(import.meta.dirname, '../../assets/mascot', `${e}.png`)), e).toBe(true);
  });
});

describe('mascot mood selection', () => {
  const base = { incomeSatang: 100_000, expenseSatang: 0, paidFixedCostsSatang: 0, unpaidFixedCostsSatang: 0, unpaidFixedCostCount: 0, savingContributedSatang: 0, savingsReservedSatang: 0, daysRemaining: 10, dailyAllowanceSatang: 0, hasIncome: true };
  it('maps balance health to expressions', () => {
    expect(moodForAvailable({ ...base, availableSatang: -1, isNegative: true })).toBe('shocked');
    expect(moodForAvailable({ ...base, availableSatang: 5_000, isNegative: false })).toBe('worried');
    expect(moodForAvailable({ ...base, availableSatang: 30_000, isNegative: false })).toBe('happy');
    expect(moodForAvailable({ ...base, availableSatang: 60_000, isNegative: false })).toBe('proud');
    expect(moodForAvailable({ ...base, incomeSatang: 0, hasIncome: false, availableSatang: 0, isNegative: false })).toBe('thinking');
    expect(moodForBudget('exceeded')).toBe('angry');
  });
});

describe('Rich Menu', () => {
  const LIFF = 'https://liff.line.me/2012666543-0a8D84ww';
  it.each(RICH_MENU_VARIANTS)('%s: status bar + 8 tiles cover the full 2500x1686 image without overlap', (v) => {
    const def = richMenuDefinition(v, LIFF);
    expect(def.size).toEqual(RICH_MENU_SIZE);
    expect(def.areas).toHaveLength(1 + TILES.length);
    expect(TILES).toHaveLength(8);
    const area = def.areas.reduce((s, a) => s + a.bounds.width * a.bounds.height, 0);
    expect(area).toBe(2500 * 1686);
    for (const a of def.areas) {
      expect(a.bounds.x + a.bounds.width).toBeLessThanOrEqual(2500);
      expect(a.bounds.y + a.bounds.height).toBeLessThanOrEqual(1686);
    }
    expect(def.chatBarText.length).toBeLessThanOrEqual(14);
    expect(existsSync(join(import.meta.dirname, `../../assets/rich-menu/rich-menu-${v}.jpg`))).toBe(true);
  });

  it('the bar opens plans; dashboard/history/settings open LIFF directly; the rest are valid postbacks', () => {
    const def = richMenuDefinition('free', LIFF);
    const [bar, ...tiles] = def.areas as Array<{ action: { type: string; data?: string; uri?: string } }>;
    expect(decodePostback(bar!.action.data!)?.action).toBe('plans');
    expect(tiles.filter((t) => t.action.type === 'uri').map((t) => t.action.uri)).toEqual([`${LIFF}?tab=home`, `${LIFF}?tab=txns`, `${LIFF}?tab=settings`]);
    for (const t of tiles.filter((t) => t.action.type === 'postback')) expect(decodePostback(t.action.data!)).not.toBeNull();
  });
});

describe('personality', () => {
  it('has lines for every situation and is deterministic', () => {
    for (const s of ALL_SITUATIONS) {
      expect(line(s, 'seed').length).toBeGreaterThan(0);
      expect(line(s, 'seed')).toBe(line(s, 'seed'));
    }
  });
});
