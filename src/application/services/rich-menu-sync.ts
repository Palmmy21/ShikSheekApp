/**
 * Keep each user's rich menu in sync with their plan (free / trial / plus / pro), so the status
 * bar always shows the right plan and CTA. LINE is only called when the variant changes.
 * Menu ids are resolved from LINE rich menu aliases (created by scripts/setup-rich-menu.ts) and
 * cached per isolate. Never throws: a menu is cosmetic.
 */
import type { Sql } from '../../infrastructure/db/sql.ts';
import type { LineClient } from '../../infrastructure/line/client.ts';
import { richMenuAlias, type RichMenuVariant } from '../../presentation/line/rich-menu/definition.ts';
import type { EntitlementService, PlanStatus } from './entitlement-service.ts';

export function variantFor(s: Pick<PlanStatus, 'plan' | 'source'>): RichMenuVariant {
  if (s.source === 'trial') return 'trial';
  return s.plan;
}

export function createRichMenuSync(sql: Sql, line: LineClient, plans: EntitlementService, log: { warn(m: string, d?: Record<string, unknown>): void }) {
  const ids = new Map<RichMenuVariant, string | null>();

  async function menuId(v: RichMenuVariant): Promise<string | null> {
    if (!ids.has(v)) ids.set(v, await line.getRichMenuIdByAlias(richMenuAlias(v)));
    return ids.get(v) ?? null;
  }

  return {
    /** Link the right menu if it changed. Returns the variant now linked (or null if unchanged/failed). */
    async sync(userId: string, now?: Date, force = false): Promise<RichMenuVariant | null> {
      try {
        const v = variantFor(await plans.status(userId, now));
        const rows = await sql.query<{ rich_menu_id: string | null }>(`select rich_menu_id from users where line_user_id = $1`, [userId]);
        if (!rows[0]) return null;
        const id = await menuId(v);
        if (!id) return null; // menus not set up yet
        // compare menu ids (not just variants) so re-uploaded menus re-link everyone automatically
        if (!force && rows[0].rich_menu_id === id) return null;
        await line.linkRichMenu(userId, id);
        await sql.query(`update users set rich_menu_variant = $2, rich_menu_id = $3 where line_user_id = $1`, [userId, v, id]);
        return v;
      } catch (err) {
        log.warn('rich_menu_sync_failed', { status: (err as { status?: number }).status ?? null });
        return null;
      }
    },
  };
}
export type RichMenuSync = ReturnType<typeof createRichMenuSync>;
