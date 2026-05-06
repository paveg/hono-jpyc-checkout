import { ulid } from 'ulid'
import * as v from 'valibot'
import { parseJpycAmount } from './jpyc/erc20'
import { DEFAULT_EXPIRES_IN_SEC, type Session } from './types'

const InternalCreateParams = v.object({
  orderId: v.pipe(v.string(), v.minLength(1)),
  amount: v.pipe(v.string(), v.minLength(1)),
  successUrl: v.pipe(v.string(), v.url()),
  cancelUrl: v.pipe(v.string(), v.url()),
  receivingAddress: v.pipe(v.string(), v.regex(/^0x[a-fA-F0-9]{40}$/)),
  checkoutPathPrefix: v.optional(v.pipe(v.string(), v.startsWith('/'))),
  origin: v.pipe(v.string(), v.url()),
  expiresInSec: v.optional(v.number()),
  metadata: v.optional(v.record(v.string(), v.string())),
})

export type InternalCreateInput = v.InferInput<typeof InternalCreateParams>

export async function createCheckoutSession(
  db: D1Database,
  params: InternalCreateInput,
): Promise<{ id: string; url: string }> {
  const parsed = v.parse(InternalCreateParams, params)
  // Validate amount precision; throws on bad input.
  parseJpycAmount(parsed.amount)

  const prefix = parsed.checkoutPathPrefix ?? '/checkout'
  const id = `cs_${ulid()}`
  const now = new Date()
  const nowIso = now.toISOString()
  const expires = new Date(now.getTime() + (parsed.expiresInSec ?? DEFAULT_EXPIRES_IN_SEC) * 1000)
  const metadata = {
    ...(parsed.metadata ?? {}),
    __successUrl: parsed.successUrl,
    __cancelUrl: parsed.cancelUrl,
  }

  await db
    .prepare(
      `INSERT INTO sessions (
         id, order_id, amount, status, receiving_address,
         created_at, updated_at, expires_at, metadata
       ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      parsed.orderId,
      parsed.amount,
      parsed.receivingAddress.toLowerCase(),
      nowIso,
      nowIso,
      expires.toISOString(),
      JSON.stringify(metadata),
    )
    .run()

  const url = `${parsed.origin}${prefix}/${id}`
  return { id, url }
}

export async function getSession(db: D1Database, id: string): Promise<Session | null> {
  const row = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<RawRow>()
  return row ? rowToSession(row) : null
}

export async function registerSenderAddress(
  db: D1Database,
  id: string,
  fromAddress: string,
): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `UPDATE sessions
         SET expected_from_address = ?, updated_at = ?
       WHERE id = ?
         AND status = 'pending'
         AND expected_from_address IS NULL`,
    )
    .bind(fromAddress.toLowerCase(), now, id)
    .run()
  return result.meta.changes === 1
}

export async function markSessionPaid(
  db: D1Database,
  id: string,
  txHash: string,
  blockNumber: number,
): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `UPDATE sessions
         SET status = 'paid', tx_hash = ?, block_number = ?, paid_at = ?, updated_at = ?
       WHERE id = ?
         AND status = 'pending'`,
    )
    .bind(txHash.toLowerCase(), blockNumber, now, now, id)
    .run()
  return result.meta.changes === 1
}

export async function markSessionFailed(db: D1Database, id: string): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE sessions SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending'`,
    )
    .bind(now, id)
    .run()
}

export async function setSessionTxHashIfMissing(
  db: D1Database,
  id: string,
  txHash: string,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE sessions
         SET tx_hash = ?, updated_at = ?
       WHERE id = ?
         AND status = 'pending'
         AND (tx_hash IS NULL OR tx_hash = ?)`,
    )
    .bind(txHash.toLowerCase(), now, id, txHash.toLowerCase())
    .run()
}

export async function expireOverdueSessions(db: D1Database): Promise<number> {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `UPDATE sessions
         SET status = 'expired', updated_at = ?
       WHERE status = 'pending'
         AND expires_at <= ?`,
    )
    .bind(now, now)
    .run()
  return result.meta.changes
}

export async function listOpenSessionsWithTxHash(
  db: D1Database,
  limit: number,
): Promise<Session[]> {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `SELECT * FROM sessions
       WHERE status = 'pending'
         AND tx_hash IS NOT NULL
         AND expires_at > ?
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .bind(now, limit)
    .all<RawRow>()
  return result.results.map(rowToSession)
}

interface RawRow {
  id: string
  order_id: string
  amount: string
  status: string
  expected_from_address: string | null
  receiving_address: string
  tx_hash: string | null
  block_number: number | null
  paid_at: string | null
  created_at: string
  updated_at: string
  expires_at: string
  metadata: string
}

function rowToSession(row: RawRow): Session {
  return {
    id: row.id,
    orderId: row.order_id,
    amount: row.amount,
    status: row.status as Session['status'],
    expectedFromAddress: (row.expected_from_address ?? null) as Session['expectedFromAddress'],
    receivingAddress: row.receiving_address as `0x${string}`,
    txHash: (row.tx_hash ?? null) as Session['txHash'],
    blockNumber: row.block_number,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    metadata: JSON.parse(row.metadata) as Record<string, string>,
  }
}

export function readStoredUrl(session: Session, kind: 'success' | 'cancel'): string {
  const stored = kind === 'success' ? session.metadata.__successUrl : session.metadata.__cancelUrl
  return stored ?? '/'
}
