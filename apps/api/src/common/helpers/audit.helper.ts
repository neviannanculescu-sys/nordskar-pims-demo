import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

export interface AuditContext {
  userId: string;
  ip?: string;
  sessionId?: string;
}

/**
 * Wraps a DB operation in a transaction that sets PostgreSQL session variables
 * consumed by audit_trigger_fn(). Must be used for all INSERT/UPDATE/DELETE.
 */
export async function withAuditContext<TSchema extends Record<string, unknown>, T>(
  db: NodePgDatabase<TSchema>,
  ctx: AuditContext,
  fn: (tx: NodePgDatabase<TSchema>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT
        set_config('app.current_user_id', ${ctx.userId}, true),
        set_config('app.current_ip',      ${ctx.ip ?? ''},        true),
        set_config('app.current_session', ${ctx.sessionId ?? ''}, true)
    `);
    return fn(tx);
  });
}
