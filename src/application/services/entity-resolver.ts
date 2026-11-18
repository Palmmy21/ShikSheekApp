/**
 * Fuzzy name matching for things the user refers to by name ("ค่าห้อง", "เน็ต", "เป้าญี่ปุ่น").
 * Tolerates missing "ค่า"/"งบ"/"เป้า" prefixes, spacing, case, partial names and small typos.
 * The resolver only RANKS candidates; callers decide whether the match is confident enough or
 * whether to ask the user.
 */

export type EntityKind = 'fixed_cost' | 'goal' | 'budget' | 'transaction';

export interface EntityCandidate {
  kind: EntityKind;
  id: string;
  name: string;
  /** Current amount (for messages like "ตอนนี้ตั้งไว้ ฿2,500"). */
  amountSatang?: number;
}

export interface ScoredCandidate extends EntityCandidate {
  score: number;
}

const PREFIXES = /^(ค่า|งบ(ประมาณ)?|เป้า(หมาย)?|บิล|ออม(เงิน)?)/;

export function normalizeName(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[\s\-_.]/g, '').replace(PREFIXES, '');
}

function bigrams(s: string): string[] {
  const chars = [...s];
  if (chars.length < 2) return chars;
  const out: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) out.push(chars[i]! + chars[i + 1]!);
  return out;
}

/** Sørensen–Dice coefficient on character bigrams (works for Thai without word segmentation). */
export function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }
  return (2 * overlap) / (A.length + B.length);
}

/** 0..1 similarity between what the user typed and an entity name. */
export function nameScore(query: string, name: string): number {
  const q = normalizeName(query);
  const n = normalizeName(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const shorter = q.length <= n.length ? q : n;
  const longer = q.length <= n.length ? n : q;
  if (shorter.length >= 2 && longer.includes(shorter)) return 0.75 + 0.2 * (shorter.length / longer.length);
  return Math.max(dice(q, n) * 0.9, sameCharacters(q, n) * 0.75);
}

/**
 * Multiset character overlap for strings of similar length — catches Thai typing slips where a
 * vowel/tone mark lands on the wrong consonant ("หอ้ง" vs "ห้อง"), which share no bigrams.
 */
function sameCharacters(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  if (Math.abs(A.length - B.length) > 1 || Math.min(A.length, B.length) < 3) return 0;
  const counts = new Map<string, number>();
  for (const c of A) counts.set(c, (counts.get(c) ?? 0) + 1);
  let common = 0;
  for (const c of B) {
    const k = counts.get(c) ?? 0;
    if (k > 0) {
      common++;
      counts.set(c, k - 1);
    }
  }
  return common / Math.max(A.length, B.length);
}

export function rank(query: string, candidates: EntityCandidate[], minScore = 0.45): ScoredCandidate[] {
  return candidates
    .map((c) => ({ ...c, score: nameScore(query, c.name) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

export type Resolution =
  | { status: 'unique'; match: ScoredCandidate }
  | { status: 'ambiguous'; options: ScoredCandidate[] }
  | { status: 'none' };

/**
 * Confident only when the best match is strong AND clearly ahead of the runner-up; otherwise the
 * caller asks the user to pick.
 */
export function resolve(query: string, candidates: EntityCandidate[]): Resolution {
  const ranked = rank(query, candidates);
  if (ranked.length === 0) return { status: 'none' };
  const [top, second] = ranked;
  if (top!.score >= 0.72 && (!second || top!.score - second.score >= 0.15)) return { status: 'unique', match: top! };
  return { status: 'ambiguous', options: ranked.slice(0, 6) };
}
