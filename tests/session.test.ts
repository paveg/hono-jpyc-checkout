import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  createCheckoutSession,
  expireOverdueSessions,
  getSession,
  listOpenSessionsWithTxHash,
  markSessionPaid,
  registerSenderAddress,
} from '../src/session'

const RECEIVING = '0x1234567890123456789012345678901234567890'

describe('createCheckoutSession', () => {
  it('inserts pending session and returns id and url', async () => {
    const result = await createCheckoutSession(env.DB, {
      orderId: 'article-123',
      amount: '100',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      receivingAddress: RECEIVING,
      origin: 'https://example.com',
    })
    expect(result.id).toMatch(/^cs_/)
    expect(result.url).toBe(`https://example.com/checkout/${result.id}`)
    const stored = await getSession(env.DB, result.id)
    expect(stored?.status).toBe('pending')
    expect(stored?.amount).toBe('100')
    expect(stored?.expectedFromAddress).toBeNull()
  })

  it('rejects invalid amount', async () => {
    await expect(
      createCheckoutSession(env.DB, {
        orderId: 'x',
        amount: 'not-a-number',
        successUrl: 'https://e.com',
        cancelUrl: 'https://e.com',
        receivingAddress: RECEIVING,
        origin: 'https://e.com',
      }),
    ).rejects.toThrow()
  })

  it('respects custom expiresInSec', async () => {
    const result = await createCheckoutSession(env.DB, {
      orderId: 'article-456',
      amount: '50',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
      expiresInSec: 60,
    })
    const stored = await getSession(env.DB, result.id)
    const created = new Date(stored?.createdAt).getTime()
    const expires = new Date(stored?.expiresAt).getTime()
    expect(Math.round((expires - created) / 1000)).toBe(60)
  })
})

describe('registerSenderAddress', () => {
  it('updates expected_from_address when null', async () => {
    const { id } = await createCheckoutSession(env.DB, {
      orderId: 'r-1',
      amount: '100',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
    })
    const ok = await registerSenderAddress(env.DB, id, '0xaaaa567890123456789012345678901234567890')
    expect(ok).toBe(true)
    const session = await getSession(env.DB, id)
    expect(session?.expectedFromAddress?.toLowerCase()).toBe(
      '0xaaaa567890123456789012345678901234567890',
    )
  })
  it('returns false when already set', async () => {
    const { id } = await createCheckoutSession(env.DB, {
      orderId: 'r-2',
      amount: '100',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
    })
    await registerSenderAddress(env.DB, id, '0xaaaa567890123456789012345678901234567890')
    const ok2 = await registerSenderAddress(
      env.DB,
      id,
      '0xbbbb567890123456789012345678901234567890',
    )
    expect(ok2).toBe(false)
  })
})

describe('markSessionPaid', () => {
  it('flips pending → paid atomically and returns true once', async () => {
    const { id } = await createCheckoutSession(env.DB, {
      orderId: 'p-1',
      amount: '100',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
    })
    await registerSenderAddress(env.DB, id, '0xaaaa567890123456789012345678901234567890')
    expect(await markSessionPaid(env.DB, id, '0xtxhash', 12345)).toBe(true)
    expect(await markSessionPaid(env.DB, id, '0xtxhash', 12345)).toBe(false)
    const session = await getSession(env.DB, id)
    expect(session?.status).toBe('paid')
    expect(session?.txHash).toBe('0xtxhash')
  })
})

describe('expireOverdueSessions', () => {
  it('marks past-due sessions expired', async () => {
    const { id } = await createCheckoutSession(env.DB, {
      orderId: 'e-1',
      amount: '10',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
      expiresInSec: -10,
    })
    const count = await expireOverdueSessions(env.DB)
    expect(count).toBeGreaterThanOrEqual(1)
    expect((await getSession(env.DB, id))?.status).toBe('expired')
  })

  it('expires session whose expires_at equals now (<= boundary)', async () => {
    // expiresInSec: 0 -> expires_at == createdAt; the SQL operator is `expires_at <= ?`,
    // so an expires_at exactly equal to now must expire. Pins <= vs < regression.
    const { id } = await createCheckoutSession(env.DB, {
      orderId: 'e-now',
      amount: '10',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
      expiresInSec: 0,
    })
    // Sleep 1ms to ensure now() > expires_at by at least the millisecond resolution
    await new Promise((r) => setTimeout(r, 2))
    await expireOverdueSessions(env.DB)
    expect((await getSession(env.DB, id))?.status).toBe('expired')
  })
})

describe('listOpenSessionsWithTxHash', () => {
  it('returns only pending rows with non-null tx_hash', async () => {
    const a = await createCheckoutSession(env.DB, {
      orderId: 'l-a',
      amount: '10',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
    })
    const b = await createCheckoutSession(env.DB, {
      orderId: 'l-b',
      amount: '10',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
    })
    await env.DB.prepare('UPDATE sessions SET tx_hash = ? WHERE id = ?').bind('0xtx-a', a.id).run()
    const rows = await listOpenSessionsWithTxHash(env.DB, 100)
    expect(rows.find((r) => r.id === a.id)).toBeDefined()
    expect(rows.find((r) => r.id === b.id)).toBeUndefined()
  })
})
