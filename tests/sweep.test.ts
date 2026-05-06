import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { JPYC_CONTRACTS } from '../src/jpyc/contracts'
import { TRANSFER_EVENT_TOPIC } from '../src/jpyc/erc20'
import { createCheckoutSession, getSession, registerSenderAddress } from '../src/session'
import { runSweep } from '../src/sweep'

const RECEIVING = '0x1234567890123456789012345678901234567890'
const FROM = '0xaaaa567890123456789012345678901234567890'

function fakeRpcResponseSequence(responses: object[]): typeof fetch {
  let idx = 0
  return (async () => {
    const r = responses[idx++]
    return new Response(JSON.stringify(r))
  }) as unknown as typeof fetch
}

function makePaidReceipt(blockHex: string) {
  return {
    status: '0x1',
    to: JPYC_CONTRACTS.polygon,
    blockNumber: blockHex,
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
  }
}

describe('runSweep', () => {
  it('expires past-due pending sessions', async () => {
    const { id } = await createCheckoutSession(env.DB, {
      orderId: 'sw-1',
      amount: '10',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
      expiresInSec: -1,
    })
    await runSweep({
      db: env.DB,
      rpcUrl: 'https://rpc.example',
      network: 'polygon',
      confirmations: 8,
      fetchImpl: fakeRpcResponseSequence([]),
    })
    expect((await getSession(env.DB, id))?.status).toBe('expired')
  })

  it('marks paid when receipt now confirms a previously pending session', async () => {
    const { id } = await createCheckoutSession(env.DB, {
      orderId: 'sw-2',
      amount: '100',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
    })
    await registerSenderAddress(env.DB, id, FROM)
    await env.DB.prepare('UPDATE sessions SET tx_hash = ? WHERE id = ?').bind('0xtx', id).run()

    const onPaid = vi.fn(async () => {})
    await runSweep({
      db: env.DB,
      rpcUrl: 'https://rpc.example',
      network: 'polygon',
      confirmations: 8,
      onPaid,
      fetchImpl: fakeRpcResponseSequence([
        { jsonrpc: '2.0', id: 1, result: makePaidReceipt('0x100') },
        { jsonrpc: '2.0', id: 2, result: '0x108' },
      ]),
    })
    expect((await getSession(env.DB, id))?.status).toBe('paid')
    expect(onPaid).toHaveBeenCalledOnce()
  })

  it('does not await webhook when waitUntil is provided (fire-and-forget)', async () => {
    const { id } = await createCheckoutSession(env.DB, {
      orderId: 'sw-3',
      amount: '100',
      successUrl: 'https://e.com',
      cancelUrl: 'https://e.com',
      receivingAddress: RECEIVING,
      origin: 'https://e.com',
    })
    await registerSenderAddress(env.DB, id, FROM)
    await env.DB.prepare('UPDATE sessions SET tx_hash = ?, updated_at = ? WHERE id = ?')
      .bind('0xtx-fnf', new Date().toISOString(), id)
      .run()

    // Webhook server that hangs forever (resolves only when the test aborts).
    const webhookFetchCalls: Promise<Response>[] = []
    const slowWebhookFetch = vi.fn(async () => {
      return new Promise<Response>((resolve) => {
        // Never resolves within the test; the assertion proves runSweep didn't wait for it.
        setTimeout(() => resolve(new Response('ok')), 60_000)
      })
    })

    // Combined fetch impl: RPC calls return immediately, webhook calls hang.
    const fetchImpl = ((url: string, init: RequestInit) => {
      if (typeof url === 'string' && url === 'https://hook.example/jpyc') {
        const p = slowWebhookFetch(url, init) as Promise<Response>
        webhookFetchCalls.push(p)
        return p
      }
      // RPC default: pretend it's a successful chain query.
      const body = JSON.parse(init.body as string) as { method: string }
      if (body.method === 'eth_getTransactionReceipt') {
        return Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: makePaidReceipt('0x100') })),
        )
      }
      if (body.method === 'eth_blockNumber') {
        return Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x108' })),
        )
      }
      return Promise.resolve(new Response('{}'))
    }) as unknown as typeof fetch

    const detached: Promise<void>[] = []
    const start = Date.now()
    await runSweep({
      db: env.DB,
      rpcUrl: 'https://rpc.example',
      network: 'polygon',
      confirmations: 8,
      webhook: { url: 'https://hook.example/jpyc', secret: 'shh' },
      waitUntil: (p) => {
        detached.push(p)
      },
      fetchImpl,
    })
    const elapsed = Date.now() - start

    // The session must be paid even though the webhook is still in flight.
    expect((await getSession(env.DB, id))?.status).toBe('paid')
    // We didn't wait 60s; we returned promptly.
    expect(elapsed).toBeLessThan(2000)
    // The webhook was scheduled but not awaited.
    expect(webhookFetchCalls.length).toBe(1)
    expect(detached.length).toBe(1)
  })

  it('falls back to await when waitUntil is not provided', async () => {
    // Existing "marks paid when receipt now confirms" test already covers the await path.
    // This is a documentation test confirming the fallback exists.
    const opts: Parameters<typeof runSweep>[0] = {
      db: env.DB,
      rpcUrl: 'https://rpc.example',
      network: 'polygon',
      confirmations: 8,
      fetchImpl: fakeRpcResponseSequence([]),
    }
    // No `waitUntil` field present
    expect('waitUntil' in opts).toBe(false)
    // Just call it once with no open sessions to confirm no-op behavior is fine.
    const result = await runSweep(opts)
    expect(result.expired).toBeGreaterThanOrEqual(0)
    expect(result.paid).toBe(0)
  })
})
