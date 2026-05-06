import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull(),
    amount: text('amount').notNull(),
    status: text('status').notNull().default('pending'),
    expectedFromAddress: text('expected_from_address'),
    receivingAddress: text('receiving_address').notNull(),
    txHash: text('tx_hash'),
    blockNumber: integer('block_number'),
    paidAt: text('paid_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  },
  (table) => ({
    statusCheck: check(
      'status_valid',
      sql`${table.status} IN ('pending', 'paid', 'expired', 'failed')`,
    ),
    txHashUnique: uniqueIndex('sessions_tx_hash_unique')
      .on(table.txHash)
      .where(sql`${table.txHash} IS NOT NULL`),
    statusExpiresIdx: uniqueIndex('sessions_status_expires_idx').on(
      table.status,
      table.expiresAt,
    ),
  }),
)

export type SessionRow = typeof sessions.$inferSelect
export type SessionInsert = typeof sessions.$inferInsert
