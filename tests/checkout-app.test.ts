import { env } from 'cloudflare:test'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { jpycCheckout } from '../src/checkout-app'
import { createCheckoutSession } from '../src/session'

const RECEIVING = '0x1234567890123456789012345678901234567890'

function buildApp() {
  const app = new Hono()
  app.route(
    '/checkout',
    jpycCheckout({
      network: 'polygon',
      receivingAddress: () => RECEIVING,
      rpcUrl: () => 'https://rpc.example',
      db: () => env.DB,
    }),
  )
  return app
}

async function newSession() {
  return createCheckoutSession(env.DB, {
    orderId: 'order-1',
    amount: '100',
    successUrl: 'https://e.com/ok',
    cancelUrl: 'https://e.com/cancel',
    receivingAddress: RECEIVING,
    origin: 'https://e.com',
  })
}

describe('GET /checkout/:id', () => {
  it('renders HTML for a known session', async () => {
    const { id } = await newSession()
    const res = await buildApp().request(`/checkout/${id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const html = await res.text()
    expect(html).toContain('100 JPYC')
    expect(html).toContain(id)
  })
  it('returns 404 for unknown id', async () => {
    expect((await buildApp().request('/checkout/cs_unknown')).status).toBe(404)
  })
})

describe('POST /checkout/:id/connect', () => {
  it('registers fromAddress and returns 200', async () => {
    const { id } = await newSession()
    const res = await buildApp().request(`/checkout/${id}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAddress: '0xaaaa567890123456789012345678901234567890' }),
    })
    expect(res.status).toBe(200)
  })
  it('400 for invalid body', async () => {
    const { id } = await newSession()
    const res = await buildApp().request(`/checkout/${id}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAddress: 'not-an-address' }),
    })
    expect(res.status).toBe(400)
  })
  it('409 when fromAddress already set', async () => {
    const { id } = await newSession()
    const app = buildApp()
    await app.request(`/checkout/${id}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAddress: '0xaaaa567890123456789012345678901234567890' }),
    })
    const res = await app.request(`/checkout/${id}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAddress: '0xbbbb567890123456789012345678901234567890' }),
    })
    expect(res.status).toBe(409)
  })
})

describe('POST /checkout/:id/verify (idempotent)', () => {
  it('returns 200 paid:true for already-paid session without consulting RPC', async () => {
    const { id } = await newSession()
    // Force the session into paid state without going through the route
    await env.DB.prepare(
      `UPDATE sessions SET status='paid', tx_hash=?, block_number=?, paid_at=?, updated_at=? WHERE id=?`,
    )
      .bind('0xabc', 1, new Date().toISOString(), new Date().toISOString(), id)
      .run()

    const res = await buildApp().request(`/checkout/${id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash: `0x${'a'.repeat(64)}` }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ paid: true })
  })
})

describe('GET /checkout/:id/status', () => {
  it('returns JSON status', async () => {
    const { id } = await newSession()
    const res = await buildApp().request(`/checkout/${id}/status`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id, status: 'pending' })
  })
})
