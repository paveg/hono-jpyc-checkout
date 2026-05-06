import { env } from 'cloudflare:test'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { jpycCheckout } from '../../src/checkout-app'
import { JPYC_CONTRACTS } from '../../src/jpyc/contracts'
import { TRANSFER_EVENT_TOPIC } from '../../src/jpyc/erc20'
import { createCheckoutSession } from '../../src/session'

const RECEIVING = '0x1234567890123456789012345678901234567890'
const FROM = '0xaaaa567890123456789012345678901234567890'

function rpcResponder(receipt: object | null, blockHex: string): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { method: string }
    if (body.method === 'eth_getTransactionReceipt') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: receipt }))
    }
    if (body.method === 'eth_blockNumber') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: blockHex }))
    }
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'unknown' } }),
    )
  }) as unknown as typeof fetch
}

describe('paywall happy path E2E', () => {
  it('completes a full payment lifecycle and fires onPaid', async () => {
    const onPaid = vi.fn(async () => {})

    const realFetch = globalThis.fetch
    globalThis.fetch = rpcResponder(
      {
        status: '0x1',
        to: JPYC_CONTRACTS.polygon,
        blockNumber: '0x100',
        logs: [
          {
            address: JPYC_CONTRACTS.polygon,
            topics: [
              TRANSFER_EVENT_TOPIC,
              `0x000000000000000000000000${FROM.slice(2)}`,
              `0x000000000000000000000000${RECEIVING.slice(2)}`,
            ],
            data: '0x0000000000000000000000000000000000000000000000056bc75e2d63100000',
          },
        ],
      },
      '0x108',
    )

    try {
      const app = new Hono()
      app.route(
        '/checkout',
        jpycCheckout({
          network: 'polygon',
          receivingAddress: () => RECEIVING,
          rpcUrl: () => 'https://rpc.example',
          db: () => env.DB,
          onPaid,
        }),
      )

      const session = await createCheckoutSession(env.DB, {
        orderId: 'article-123',
        amount: '100',
        successUrl: 'https://e.com/ok',
        cancelUrl: 'https://e.com/cancel',
        receivingAddress: RECEIVING,
        origin: 'https://e.com',
      })

      let res = await app.request(session.url.replace('https://e.com', ''))
      expect(res.status).toBe(200)

      res = await app.request(`/checkout/${session.id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromAddress: FROM }),
      })
      expect(res.status).toBe(200)

      res = await app.request(`/checkout/${session.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: `0x${'a'.repeat(64)}` }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ paid: true })
      expect(onPaid).toHaveBeenCalledOnce()

      const stored = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?')
        .bind(session.id)
        .first()
      expect(stored?.status).toBe('paid')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
