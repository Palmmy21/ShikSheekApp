import type { Sql } from '../sql.ts';

/** Normalised key for a note: lower-case, collapsed spaces, no digits/currency. */
export function ruleKeyword(note: string): string | null {
  const k = note
    .normalize('NFC')
    .toLowerCase()
    .replace(/[0-9๐-๙.,฿]+/g, ' ')
    .replace(/บาท/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return k.length >= 2 && k.length <= 60 ? k : null;
}

/** Per-user learned categories (note → category), written when the user corrects a category. */
export function categoryRuleRepo(sql: Sql) {
  return {
    async learn(userId: string, note: string, categoryId: string): Promise<void> {
      const keyword = ruleKeyword(note);
      if (!keyword) return;
      await sql.query(
        `insert into user_category_rules (user_id, keyword, category_id) values ($1, $2, $3)
         on conflict (user_id, keyword) do update set category_id = excluded.category_id,
           hits = case when user_category_rules.category_id = excluded.category_id then user_category_rules.hits + 1 else 1 end,
           updated_at = now()`,
        [userId, keyword, categoryId],
      );
    },
    /** Best learned category for this text: exact keyword first, else the longest keyword it contains. */
    async match(userId: string, text: string): Promise<string | null> {
      const key = ruleKeyword(text);
      if (!key) return null;
      const rows = await sql.query<{ keyword: string; category_id: string }>(
        `select keyword, category_id from user_category_rules
         where user_id = $1 and (keyword = $2 or position(keyword in $2) > 0)
         order by (keyword = $2) desc, char_length(keyword) desc, hits desc limit 1`,
        [userId, key],
      );
      return rows[0]?.category_id ?? null;
    },
  };
}
export type CategoryRuleRepo = ReturnType<typeof categoryRuleRepo>;
