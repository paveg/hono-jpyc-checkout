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
})
